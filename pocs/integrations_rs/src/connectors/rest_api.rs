//! Loads REST responses into a source table one page at a time. Each page is
//! inserted before the next request, so a slow insert delays fetching and only
//! one page is buffered. Pagination follows next links or advances an offset.
//!
//! URLs, query parameters, and authentication values can contain allowed
//! environment variables and `${NOW+-Nm|h|d}` time expressions. Authentication
//! uses a configured header or bearer token. Requests share host pacing and
//! retry HTTP 429 responses. Next links must keep the endpoint's origin.
//!
//! Rust renders the response cells. [`snapshot::materialize`] then lets DuckDB
//! compute the `_op`, `_key`, and `_before` columns used by the pipeline.

use std::sync::Arc;

use crate::secret::Secret;
use error_stack::{Report, ResultExt as _};
use futures::future::BoxFuture;
use serde::Deserialize;
use serde_json::Value;

use crate::config::Env;
use crate::error::SourceError;
use crate::http::egress;
use crate::http::pacer::FetchPacer;
use crate::http::retry::with_429_retry;
use crate::snapshot;
use crate::store::{qi, Store};
use crate::value::Row;

pub type Fetcher = Arc<
    dyn Fn(String, Vec<(String, String)>) -> BoxFuture<'static, Result<Value, String>>
        + Send
        + Sync,
>;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum ReferencedAuth {
    Header {
        name: String,
        #[serde(rename = "secretEntityUuid")]
        secret_entity_uuid: uuid::Uuid,
    },
    Bearer {
        #[serde(rename = "secretEntityUuid")]
        secret_entity_uuid: uuid::Uuid,
    },
}

impl ReferencedAuth {
    pub fn entity_uuid(&self) -> uuid::Uuid {
        match self {
            Self::Header {
                secret_entity_uuid, ..
            }
            | Self::Bearer { secret_entity_uuid } => *secret_entity_uuid,
        }
    }

    pub fn resolve(&self, secret: &Secret<Vec<u8>>) -> Result<ResolvedAuth, Report<SourceError>> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct StoredValue {
            value: String,
        }
        let stored: StoredValue = serde_json::from_slice(secret.expose()).map_err(|_error| {
            Report::new(SourceError)
                .attach_printable("REST User Secret must contain a string field named value")
        })?;
        if stored.value.is_empty() {
            return Err(Report::new(SourceError)
                .attach_printable("REST User Secret value must not be empty"));
        }
        let (name, value) = match self {
            Self::Header { name, .. } => (name.clone(), stored.value),
            Self::Bearer { .. } => (
                "authorization".to_owned(),
                format!("Bearer {}", stored.value),
            ),
        };
        reqwest::header::HeaderValue::from_str(&value).map_err(|_error| {
            Report::new(SourceError)
                .attach_printable("REST User Secret is not a valid HTTP header value")
        })?;
        Ok(ResolvedAuth {
            name,
            value: Secret::new(value),
        })
    }
}

#[derive(Debug)]
pub struct ResolvedAuth {
    name: String,
    value: Secret<String>,
}

#[derive(Default)]
pub struct HydrationOptions {
    pub fetcher: Option<Fetcher>,
    pub auth: Option<ResolvedAuth>,
}

pub fn referenced_auth(endpoint: &Value) -> Result<Option<ReferencedAuth>, &'static str> {
    let Some(auth) = endpoint
        .get("auth")
        .filter(|auth| auth.get("secretEntityUuid").is_some())
    else {
        return Ok(None);
    };
    let reference: ReferencedAuth = serde_json::from_value(auth.clone())
        .map_err(|_error| "auth must specify header or bearer authentication with a secretEntityUuid and no inline value")?;
    if let ReferencedAuth::Header { name, .. } = &reference {
        reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|_error| "auth.name must be a valid HTTP header name")?;
    }
    Ok(Some(reference))
}

pub fn global_pacer() -> &'static FetchPacer {
    static PACER: std::sync::OnceLock<FetchPacer> = std::sync::OnceLock::new();
    PACER.get_or_init(FetchPacer::new)
}

pub async fn hydrate(
    store: &Store,
    source: &str,
    staging_table: &str,
    endpoint: &Value,
    primary_key: &[String],
    options: HydrationOptions,
    env: &Env,
) -> Result<i64, Report<SourceError>> {
    if referenced_auth(endpoint)
        .map_err(|message| Report::new(SourceError).attach_printable(message))?
        .is_some()
        && options.auth.is_none()
    {
        return Err(Report::new(SourceError).attach_printable(
            "REST secret reference must be resolved by the run owner before capture",
        ));
    }
    let raw_table = format!("_raw/{source}");
    let _ = store
        .exec(&format!("DROP TABLE IF EXISTS {}", qi(&raw_table)))
        .await;

    let fetcher = options
        .fetcher
        .unwrap_or_else(|| default_fetcher(env.clone()));
    let row_count = stream_pages_into(
        store,
        &raw_table,
        endpoint,
        &fetcher,
        options.auth.as_ref(),
        env,
    )
    .await?;

    if row_count == 0 {
        return Ok(0);
    }

    let materialized = snapshot::materialize(
        store,
        source,
        staging_table,
        &format!("SELECT * FROM {}", qi(&raw_table)),
        primary_key,
    )
    .await?;

    let _ = store
        .exec(&format!("DROP TABLE IF EXISTS {}", qi(&raw_table)))
        .await;
    Ok(materialized.row_count)
}

struct PageState {
    url: String,
    origin: reqwest::Url,
    page: u64,
    offset: u64,
    max_pages: Option<u64>,
    page_size: u64,
    rate_ms: u64,
}

async fn stream_pages_into(
    store: &Store,
    raw_table: &str,
    endpoint: &Value,
    fetcher: &Fetcher,
    auth: Option<&ResolvedAuth>,
    env: &Env,
) -> Result<i64, Report<SourceError>> {
    let visible = crate::config::interpolation_env(env);

    let url = interpolate(text(endpoint, "url").unwrap_or_default(), &visible);
    let origin = reqwest::Url::parse(&url).map_err(|_error| {
        Report::new(SourceError).attach_printable("REST endpoint has an invalid configured URL")
    })?;

    let mut state = PageState {
        url,
        origin,
        page: 0,
        offset: 0,
        max_pages: endpoint.get("maxPages").and_then(Value::as_u64),
        page_size: endpoint
            .get("pageSize")
            .and_then(Value::as_u64)
            .unwrap_or(100),
        rate_ms: endpoint
            .get("rateLimitMs")
            .and_then(Value::as_u64)
            .unwrap_or(0),
    };

    let mut columns: Vec<String> = vec![];
    let mut total = 0i64;

    loop {
        if state
            .max_pages
            .map(|max| state.page >= max)
            .unwrap_or(false)
        {
            break;
        }

        let full_url = build_url(&state, endpoint, &visible);
        global_pacer()
            .await_slot(&host_of(&full_url), state.rate_ms)
            .await;

        let body = fetcher(full_url.clone(), headers(endpoint, &visible, auth))
            .await
            .map_err(|message| {
                Report::new(SourceError)
                    .attach_printable(format!("REST hydration failed: {message}"))
            })?;

        let results = extract(&body, text(endpoint, "resultsField"));
        let Some(rows) = results.as_array().filter(|rows| !rows.is_empty()) else {
            break;
        };

        let page_rows: Vec<Row> = rows.iter().map(render_row).collect();
        land_page(store, raw_table, &mut columns, &page_rows).await?;
        total += page_rows.len() as i64;
        state.page += 1;

        match endpoint
            .get("pagination")
            .and_then(|pagination| pagination.get("type"))
            .and_then(Value::as_str)
        {
            Some("next-link") => {
                let field = endpoint
                    .pointer("/pagination/field")
                    .and_then(Value::as_str)
                    .unwrap_or("next");
                match extract(&body, Some(field)).as_str() {
                    Some(next) if !next.is_empty() => {
                        state.url = resolve_next_link(&full_url, next, &state.origin).map_err(
                            |message| {
                                Report::new(SourceError).attach_printable(format!(
                                    "REST hydration blocked an unsafe next-link: {message}"
                                ))
                            },
                        )?;
                    }
                    _ => break,
                }
            }
            Some("offset") => {
                if (rows.len() as u64) < state.page_size {
                    break;
                }
                state.offset += rows.len() as u64;
            }
            _ => break,
        }
    }

    Ok(total)
}

/// Raw page cells render host-side: scalars via JS String() parity for
/// nested-object columns as JSON text.
fn render_row(row: &Value) -> Row {
    let mut out = Row::new();
    if let Some(map) = row.as_object() {
        for (key, value) in map {
            let cell = match value {
                Value::Object(_) | Value::Array(_) => Value::String(value.to_string()),
                other => other.clone(),
            };
            out.insert(key.clone(), cell);
        }
    }
    out
}

// A column first seen on a later page is null in earlier rows.
async fn land_page(
    store: &Store,
    raw_table: &str,
    known_columns: &mut Vec<String>,
    rows: &[Row],
) -> Result<(), Report<SourceError>> {
    if rows.is_empty() {
        return Ok(());
    }

    let mut new_columns: Vec<String> = vec![];
    for row in rows {
        for key in row.keys() {
            if !known_columns.contains(key) && !new_columns.contains(key) {
                new_columns.push(key.clone());
            }
        }
    }

    if known_columns.is_empty() {
        let defs = new_columns
            .iter()
            .map(|column| format!("{} VARCHAR", qi(column)))
            .collect::<Vec<_>>()
            .join(", ");
        store
            .exec(&format!(
                "CREATE OR REPLACE TABLE {} ({defs})",
                qi(raw_table)
            ))
            .await
            .change_context(SourceError)?;
        known_columns.extend(new_columns);
    } else {
        for column in new_columns {
            store
                .exec(&format!(
                    "ALTER TABLE {} ADD COLUMN {} VARCHAR",
                    qi(raw_table),
                    qi(&column)
                ))
                .await
                .change_context(SourceError)?;
            known_columns.push(column);
        }
    }

    for chunk in rows.chunks(500) {
        let placeholders = (0..chunk.len())
            .map(|row_index| {
                let base = row_index * known_columns.len();
                let cells = (1..=known_columns.len())
                    .map(|offset| format!("${}", base + offset))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("({cells})")
            })
            .collect::<Vec<_>>()
            .join(", ");

        let params: Vec<Value> = chunk
            .iter()
            .flat_map(|row| {
                known_columns
                    .iter()
                    .map(|column| match row.get(column) {
                        None | Some(Value::Null) => Value::Null,
                        Some(value) => Value::String(crate::value::js_string(value)),
                    })
                    .collect::<Vec<_>>()
            })
            .collect();

        store
            .exec_params(
                &format!("INSERT INTO {} VALUES {placeholders}", qi(raw_table)),
                params,
            )
            .await
            .change_context(SourceError)?;
    }

    Ok(())
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn host_of(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(str::to_owned))
        .unwrap_or_else(|| url.to_owned())
}

/// Resolve a response-controlled next-link against the page that supplied it,
/// but never let pagination change origin. Reusing endpoint auth on another
/// scheme/host/port would disclose credentials to that origin.
fn resolve_next_link(
    current: &str,
    next: &str,
    allowed_origin: &reqwest::Url,
) -> Result<String, String> {
    let current = reqwest::Url::parse(current)
        .map_err(|err| format!("current page url {current:?} is invalid: {err}"))?;
    let resolved = match reqwest::Url::parse(next) {
        Ok(url) => url,
        Err(_) => current
            .join(next)
            .map_err(|err| format!("next-link {next:?} is invalid: {err}"))?,
    };

    if !same_origin(&resolved, allowed_origin) {
        return Err(format!(
            "next-link origin {} does not match endpoint origin {}",
            resolved.origin().ascii_serialization(),
            allowed_origin.origin().ascii_serialization()
        ));
    }

    Ok(resolved.to_string())
}

fn same_origin(left: &reqwest::Url, right: &reqwest::Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

fn build_url(
    state: &PageState,
    endpoint: &Value,
    visible: &std::collections::HashMap<String, String>,
) -> String {
    let mut params: Vec<(String, String)> = endpoint
        .get("params")
        .and_then(Value::as_object)
        .map(|params| {
            params
                .iter()
                .map(|(key, value)| {
                    (
                        key.clone(),
                        interpolate(&crate::value::js_string(value), visible),
                    )
                })
                .collect()
        })
        .unwrap_or_default();

    if endpoint.pointer("/pagination/type").and_then(Value::as_str) == Some("offset") {
        params.push(("offset".to_owned(), state.offset.to_string()));
        params.push(("limit".to_owned(), state.page_size.to_string()));
    }

    if params.is_empty() {
        return state.url.clone();
    }

    let query = params
        .iter()
        .map(|(key, value)| format!("{}={}", urlencode(key), urlencode(value)))
        .collect::<Vec<_>>()
        .join("&");
    let separator = if state.url.contains('?') { '&' } else { '?' };
    format!("{}{separator}{query}", state.url)
}

fn urlencode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

fn headers(
    endpoint: &Value,
    visible: &std::collections::HashMap<String, String>,
    resolved: Option<&ResolvedAuth>,
) -> Vec<(String, String)> {
    let mut headers = vec![("content-type".to_owned(), "application/json".to_owned())];
    if let Some(auth) = resolved {
        headers.push((auth.name.clone(), auth.value.expose().clone()));
        return headers;
    }
    if let Some(auth) = endpoint.get("auth") {
        match text(auth, "type") {
            Some("header") => {
                if let (Some(name), Some(value)) = (text(auth, "name"), text(auth, "value")) {
                    headers.push((name.to_owned(), interpolate(value, visible)));
                }
            }
            Some("bearer") => {
                if let Some(token) = text(auth, "token") {
                    headers.push((
                        "authorization".to_owned(),
                        format!("Bearer {}", interpolate(token, visible)),
                    ));
                }
            }
            _ => {}
        }
    }
    headers
}

fn default_fetcher(env: Env) -> Fetcher {
    let client = egress::client(&env).map_err(|error| error.to_string());

    Arc::new(move |url: String, headers: Vec<(String, String)>| {
        let env = env.clone();
        let client = client.clone();
        Box::pin(async move {
            let client =
                client.map_err(|error| format!("REST client initialization failed: {error}"))?;
            egress::validate_url(&url, &env)
                .await
                .map_err(|err| format!("{err:?}"))?;

            let label = egress::safe_url_label(&url);
            let response = with_429_retry(|| {
                let mut request = client.get(&url);
                for (name, value) in &headers {
                    request = request.header(name, value);
                }
                request.send()
            })
            .await
            .map_err(|err| format!("REST API request failed for {label}: {}", err.without_url()))?;

            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            if (200..300).contains(&status) {
                serde_json::from_str(&body)
                    .map_err(|err| format!("REST API bad JSON from {label}: {err}"))
            } else {
                Err(format!(
                    "REST API {status} from {label}: {}",
                    body.chars().take(200).collect::<String>()
                ))
            }
        })
    })
}

fn extract(body: &Value, path: Option<&str>) -> Value {
    match path {
        None => body.clone(),
        Some(path) => {
            let mut current = body;
            for segment in path.split('.') {
                match current.get(segment) {
                    Some(next) => current = next,
                    None => return Value::Null,
                }
            }
            current.clone()
        }
    }
}

/// Time expressions produce ISO timestamps rounded down to the minute.
pub fn interpolate(text: &str, visible: &std::collections::HashMap<String, String>) -> String {
    crate::yaml::placeholder_re()
        .replace_all(text, |captures: &regex::Captures<'_>| {
            let token = &captures[1];
            if let Some(now) = now_token(token) {
                now
            } else {
                visible.get(token).cloned().unwrap_or_default()
            }
        })
        .into_owned()
}

fn now_token(token: &str) -> Option<String> {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE
        .get_or_init(|| regex::Regex::new(r"^NOW(?:([+-])(\d+)([mhd]))?$").expect("static regex"));

    let captures = re.captures(token)?;
    let minutes: i64 = match (captures.get(1), captures.get(2), captures.get(3)) {
        (Some(sign), Some(amount), Some(unit)) => {
            let amount: i64 = amount.as_str().parse().ok()?;
            let unit_minutes = match unit.as_str() {
                "m" => 1,
                "h" => 60,
                _ => 1440,
            };
            let signed = amount.checked_mul(unit_minutes)?;
            if sign.as_str() == "-" {
                -signed
            } else {
                signed
            }
        }
        _ => 0,
    };

    let now = chrono::Utc::now().checked_add_signed(chrono::Duration::try_minutes(minutes)?)?;
    Some(now.format("%Y-%m-%dT%H:%M:00Z").to_string())
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn unresolved_reference_cannot_send_a_request() {
        let store = super::Store::open(crate::store::StoreOptions::default())
            .expect("test store should open");
        let fetcher: super::Fetcher = std::sync::Arc::new(|_, _| {
            Box::pin(async { panic!("unresolved credentials should prevent fetching") })
        });
        let endpoint = serde_json::json!({
            "url": "https://example.test/orders",
            "auth": {"type": "bearer", "secretEntityUuid": "11111111-1111-4111-8111-111111111111"}
        });
        let env = crate::config::Env::from_map(std::collections::HashMap::new());
        let result = super::hydrate(
            &store,
            "orders",
            "orders",
            &endpoint,
            &[],
            super::HydrationOptions {
                fetcher: Some(fetcher),
                auth: None,
            },
            &env,
        )
        .await;
        assert!(result.is_err());
    }

    #[test]
    fn referenced_auth_rejects_inline_values_and_invalid_fields() {
        let id = "11111111-1111-4111-8111-111111111111";
        for auth in [
            serde_json::json!({"type": "bearer", "secretEntityUuid": "invalid"}),
            serde_json::json!({"type": "bearer", "secretEntityUuid": id, "token": "secret"}),
            serde_json::json!({"type": "header", "secretEntityUuid": id, "name": "bad\nname"}),
            serde_json::json!({"type": "unknown", "secretEntityUuid": id}),
        ] {
            assert!(super::referenced_auth(&serde_json::json!({"auth": auth})).is_err());
        }
    }

    #[test]
    fn resolved_auth_is_redacted_and_never_interpolated() {
        for (kind, expected) in [
            ("header", "literal-${TOKEN}"),
            ("bearer", "Bearer literal-${TOKEN}"),
        ] {
            let mut auth = serde_json::json!({"type": kind, "secretEntityUuid": "11111111-1111-4111-8111-111111111111"});
            if kind == "header" {
                auth["name"] = "x-api-key".into();
            }
            let endpoint = serde_json::json!({"auth": auth});
            let reference = super::referenced_auth(&endpoint)
                .expect("auth reference should parse")
                .expect("reference should be present");
            let secret = crate::secret::Secret::new(br#"{"value":"literal-${TOKEN}"}"#.to_vec());
            let resolved = reference
                .resolve(&secret)
                .expect("secret should resolve to a header");
            assert!(!format!("{resolved:?}").contains("literal-"));
            let visible =
                std::collections::HashMap::from([("TOKEN".to_owned(), "expanded".to_owned())]);
            let headers = super::headers(&endpoint, &visible, Some(&resolved));
            assert_eq!(headers[1].1, expected);
            assert!(endpoint["auth"].get("value").is_none());
            assert!(endpoint["auth"].get("token").is_none());
            for invalid in [
                br#"{"value":"secret\r\ninjected"}"#.as_slice(),
                br#"{"password":"secret"}"#.as_slice(),
            ] {
                let error = reference
                    .resolve(&crate::secret::Secret::new(invalid.to_vec()))
                    .expect_err("invalid secret should be rejected");
                assert!(!format!("{error:?}").contains("injected"));
            }
        }
    }
    use super::resolve_next_link;

    #[test]
    fn oversized_time_offsets_do_not_panic() {
        for token in [
            "NOW+9223372036854775807d",
            "NOW-9223372036854775807h",
            "NOW+9223372036854775807m",
            "NOW+1000000000000m",
        ] {
            assert!(
                super::now_token(token).is_none(),
                "{token} should be out of range"
            );
        }
        assert!(super::now_token("NOW-5m").is_some());
    }

    #[test]
    fn next_links_stay_on_the_endpoint_origin() {
        let origin = reqwest::Url::parse("https://api.example/v1/items").expect("origin");

        assert_eq!(
            resolve_next_link(
                "https://api.example/v1/items?page=1",
                "/v1/items?page=2",
                &origin,
            )
            .expect("relative next-link"),
            "https://api.example/v1/items?page=2"
        );
        assert!(resolve_next_link(
            "https://api.example/v1/items?page=1",
            "https://collector.example/steal",
            &origin,
        )
        .is_err());
        assert!(resolve_next_link(
            "https://api.example/v1/items?page=1",
            "http://api.example/v1/items?page=2",
            &origin,
        )
        .is_err());
    }
}
