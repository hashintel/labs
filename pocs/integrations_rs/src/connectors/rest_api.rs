//! Paginated REST hydration with fetch-side throttling: next-link, offset, or
//! single-page pagination; header or bearer auth; `${NOW+-Nm|h|d}` and
//! `${ENV}` interpolation in urls/params/auth (through the env allowlist);
//! `rateLimitMs` paces requests through the node-wide pacer, keyed by host;
//! every request revalidates against the egress guard (next-link URLs come
//! from response bodies); 429s retry honoring Retry-After. Hydration is a
//! sequential fetch-then-land loop: memory is bounded to one page and a slow
//! insert back-pressures the fetch by construction. The final staging table
//! goes through `snapshot::materialize`, so the envelope and `_key` stay
//! DuckDB-computed (adopted-state contract); raw page cells are rendered
//! host-side (the documented event-path adoption caveat).

use std::sync::Arc;

use error_stack::{Report, ResultExt as _};
use futures::future::BoxFuture;
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
    fetcher: Option<Fetcher>,
    env: &Env,
) -> Result<i64, Report<SourceError>> {
    let raw_table = format!("_raw/{source}");
    let _ = store
        .exec(&format!("DROP TABLE IF EXISTS {}", qi(&raw_table)))
        .await;

    let fetcher = fetcher.unwrap_or_else(|| default_fetcher(env.clone()));
    let row_count = stream_pages_into(store, &raw_table, endpoint, &fetcher, env).await?;

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

        let body = fetcher(full_url.clone(), headers(endpoint, &visible))
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

// Pages land incrementally with column evolution: a later page may grow a
// column; earlier rows read NULL there.
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
) -> Vec<(String, String)> {
    let mut headers = vec![("content-type".to_owned(), "application/json".to_owned())];
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
    // Build the client (connection pool + TLS config) once for the whole fetch: a
    // paginated fetch reuses one pool across all its requests. Redirects stay
    // disabled (a redirect is an unvalidated URL).
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap_or_default();

    Arc::new(move |url: String, headers: Vec<(String, String)>| {
        let env = env.clone();
        let client = client.clone();
        Box::pin(async move {
            // Every page revalidates: next-link URLs come from the RESPONSE
            // BODY, so the guard runs per request.
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
            .map_err(|err| format!("REST API request failed for {label}: {err}"))?;

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

/// Interpolates NOW arithmetic and env tokens: minute-precision ISO for NOW.
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
            let signed = amount * unit_minutes;
            if sign.as_str() == "-" {
                -signed
            } else {
                signed
            }
        }
        _ => 0,
    };

    let now = chrono::Utc::now() + chrono::Duration::minutes(minutes);
    Some(now.format("%Y-%m-%dT%H:%M:00Z").to_string())
}

#[cfg(test)]
mod tests {
    use super::resolve_next_link;

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
