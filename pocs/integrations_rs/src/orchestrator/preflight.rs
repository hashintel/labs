//! Side-effect-free Graph authorization preflight.
//!
//! This module checks two provisioned managed canaries with exactly two batched
//! permission requests. It never reads entity payloads and never mutates Graph.
//! The production activation gate consumes the same typed result as `doctor`.

use std::collections::BTreeSet;
use std::fmt;
use std::sync::Arc;

use async_trait::async_trait;
use error_stack::{Report, ResultExt as _};
use futures::StreamExt as _;
use serde::Serialize;
use serde_json::{json, Value};

use crate::config::Env;
use crate::secret::Secret;

const PERMISSION_PATH: &str = "/entities/permissions";
const ENTITY_CANARY_ENV: &str = "INTEGRATIONS_GRAPH_PERMISSION_ENTITY_ID";
const LINK_CANARY_ENV: &str = "INTEGRATIONS_GRAPH_PERMISSION_LINK_ID";
const MAX_GRAPH_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_ENTITY_ID_BYTES: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionPreflightStatus {
    Verified,
    Denied,
    Unverified,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionAction {
    UpdateEntity,
    ArchiveEntity,
}

impl PermissionAction {
    const ALL: [Self; 2] = [Self::UpdateEntity, Self::ArchiveEntity];

    const fn wire_name(self) -> &'static str {
        match self {
            Self::UpdateEntity => "updateEntity",
            Self::ArchiveEntity => "archiveEntity",
        }
    }
}

impl fmt::Display for PermissionAction {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.wire_name())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionTargetKind {
    Entity,
    Link,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionTarget {
    pub kind: PermissionTargetKind,
    pub entity_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionDenial {
    pub target: PermissionTargetKind,
    pub action: PermissionAction,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionPreflightReport {
    pub status: PermissionPreflightStatus,
    pub production_blocking: bool,
    pub endpoint: &'static str,
    pub requests_made: u8,
    pub targets: Vec<PermissionTarget>,
    pub denied: Vec<PermissionDenial>,
    pub unverified_reasons: Vec<String>,
}

impl PermissionPreflightReport {
    /// Only a proven denial blocks activation. Canary IDs are optional
    /// operator configuration: without them the preflight is `Unverified`
    /// and activation proceeds with a warning instead of demanding canary
    /// entities up front. An unreachable preflight still fails activation
    /// through its own error path.
    pub fn allows_production_activation(&self) -> bool {
        self.status != PermissionPreflightStatus::Denied
    }

    fn unverified(reasons: Vec<String>) -> Self {
        Self {
            status: PermissionPreflightStatus::Unverified,
            production_blocking: false,
            endpoint: PERMISSION_PATH,
            requests_made: 0,
            targets: vec![],
            denied: vec![],
            unverified_reasons: reasons,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PermissionPreflightError {
    InvalidConfiguration,
    GraphRequest,
    MalformedGraphResponse,
}

impl fmt::Display for PermissionPreflightError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidConfiguration => "Graph permission preflight configuration is invalid",
            Self::GraphRequest => "Graph permission preflight request failed",
            Self::MalformedGraphResponse => "Graph permission preflight response is malformed",
        })
    }
}

impl std::error::Error for PermissionPreflightError {}

#[async_trait]
trait PermissionChecker: Send + Sync {
    async fn permitted(
        &self,
        action: PermissionAction,
        entity_ids: &[String],
    ) -> Result<BTreeSet<String>, Report<PermissionPreflightError>>;
}

struct HttpPermissionChecker {
    base_url: String,
    actor_id: Secret<String>,
    timeout: std::time::Duration,
    client: reqwest::Client,
}

struct ConfiguredPreflight {
    checker: Arc<dyn PermissionChecker>,
    targets: Vec<PermissionTarget>,
}

impl HttpPermissionChecker {
    fn new(base_url: &str, actor_id: &str, timeout_ms: u64) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_owned(),
            actor_id: Secret::new(actor_id.to_owned()),
            timeout: std::time::Duration::from_millis(timeout_ms),
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl PermissionChecker for HttpPermissionChecker {
    async fn permitted(
        &self,
        action: PermissionAction,
        entity_ids: &[String],
    ) -> Result<BTreeSet<String>, Report<PermissionPreflightError>> {
        let body = json!({
            "action": action.wire_name(),
            "entityIds": entity_ids,
            "temporalAxes": {
                "pinned": {"axis": "transactionTime", "timestamp": null},
                "variable": {
                    "axis": "decisionTime",
                    "interval": {"start": null, "end": null}
                }
            },
            "includeDrafts": false
        });
        let response = self
            .client
            .post(format!("{}{PERMISSION_PATH}", self.base_url))
            .header("content-type", "application/json")
            .header("x-authenticated-user-actor-id", self.actor_id.expose())
            .json(&body)
            .timeout(self.timeout)
            .send()
            .await
            .map_err(Report::from)
            .change_context(PermissionPreflightError::GraphRequest)
            .attach_printable_lazy(|| format!("{action} permission request did not complete"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(
                Report::new(PermissionPreflightError::GraphRequest).attach_printable(format!(
                    "{action} permission request returned HTTP {status}"
                )),
            );
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_GRAPH_RESPONSE_BYTES as u64)
        {
            return Err(
                Report::new(PermissionPreflightError::MalformedGraphResponse).attach_printable(
                    format!(
                        "{action} permission response exceeds {MAX_GRAPH_RESPONSE_BYTES} bytes"
                    ),
                ),
            );
        }

        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk
                .map_err(Report::from)
                .change_context(PermissionPreflightError::GraphRequest)
                .attach_printable_lazy(|| {
                    format!("{action} permission response body was interrupted")
                })?;
            if bytes.len().saturating_add(chunk.len()) > MAX_GRAPH_RESPONSE_BYTES {
                return Err(
                    Report::new(PermissionPreflightError::MalformedGraphResponse).attach_printable(
                        format!(
                            "{action} permission response exceeds {MAX_GRAPH_RESPONSE_BYTES} bytes"
                        ),
                    ),
                );
            }
            bytes.extend_from_slice(&chunk);
        }

        decode_permission_response(action, entity_ids, &bytes)
    }
}

/// Runs the permission preflight from process configuration.
///
/// Missing Graph credentials or canaries are observable `unverified` results,
/// not transport errors. A configured request that fails or returns malformed
/// bytes is a diagnostics error and also blocks activation.
pub(crate) async fn graph_permission_preflight(
    env: &Env,
) -> Result<PermissionPreflightReport, Report<PermissionPreflightError>> {
    let Some(configured) = configured_checker(env)? else {
        return Ok(PermissionPreflightReport::unverified(
            missing_configuration(env),
        ));
    };
    evaluate(configured.checker.as_ref(), configured.targets).await
}

fn configured_checker(
    env: &Env,
) -> Result<Option<ConfiguredPreflight>, Report<PermissionPreflightError>> {
    let Some(base_url) = nonempty(env, "HASH_GRAPH_URL")? else {
        return Ok(None);
    };
    let Some(actor_id) = nonempty(env, "HASH_ACTOR_ID")? else {
        return Ok(None);
    };
    let Some(web_id) = nonempty(env, "HASH_WEB_ID")? else {
        return Ok(None);
    };
    let Some(entity_id) = nonempty(env, ENTITY_CANARY_ENV)? else {
        return Ok(None);
    };
    let Some(link_id) = nonempty(env, LINK_CANARY_ENV)? else {
        return Ok(None);
    };
    validate_base_url(base_url)?;
    validate_uuid("HASH_ACTOR_ID", actor_id)?;
    validate_uuid("HASH_WEB_ID", web_id)?;
    validate_entity_id(ENTITY_CANARY_ENV, entity_id, web_id)?;
    validate_entity_id(LINK_CANARY_ENV, link_id, web_id)?;
    if entity_id == link_id {
        return Err(
            Report::new(PermissionPreflightError::InvalidConfiguration).attach_printable(format!(
                "{ENTITY_CANARY_ENV} and {LINK_CANARY_ENV} must identify different canaries"
            )),
        );
    }

    Ok(Some(ConfiguredPreflight {
        checker: Arc::new(HttpPermissionChecker::new(
            base_url,
            actor_id,
            crate::config::graph_timeout_ms(env),
        )),
        targets: vec![
            PermissionTarget {
                kind: PermissionTargetKind::Entity,
                entity_id: entity_id.to_owned(),
            },
            PermissionTarget {
                kind: PermissionTargetKind::Link,
                entity_id: link_id.to_owned(),
            },
        ],
    }))
}

fn missing_configuration(env: &Env) -> Vec<String> {
    [
        "HASH_GRAPH_URL",
        "HASH_ACTOR_ID",
        "HASH_WEB_ID",
        ENTITY_CANARY_ENV,
        LINK_CANARY_ENV,
    ]
    .into_iter()
    .filter(|name| env.get(name).is_none_or(|value| value.trim().is_empty()))
    .map(|name| format!("{name} is not configured"))
    .collect()
}

fn nonempty<'a>(
    env: &'a Env,
    name: &'static str,
) -> Result<Option<&'a str>, Report<PermissionPreflightError>> {
    match env.get(name) {
        None => Ok(None),
        Some(value) if value.trim().is_empty() => Ok(None),
        Some(value) if value != value.trim() => {
            Err(Report::new(PermissionPreflightError::InvalidConfiguration)
                .attach_printable(format!("{name} must not have surrounding whitespace")))
        }
        Some(value) => Ok(Some(value)),
    }
}

fn validate_base_url(value: &str) -> Result<(), Report<PermissionPreflightError>> {
    let url = reqwest::Url::parse(value)
        .map_err(Report::from)
        .change_context(PermissionPreflightError::InvalidConfiguration)
        .attach_printable("HASH_GRAPH_URL must be a valid URL")?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(Report::new(
            PermissionPreflightError::InvalidConfiguration,
        )
        .attach_printable(
            "HASH_GRAPH_URL must be an HTTP(S) base URL without embedded credentials, query, or fragment",
        ));
    }
    Ok(())
}

fn validate_uuid(name: &'static str, value: &str) -> Result<(), Report<PermissionPreflightError>> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(Report::from)
        .change_context(PermissionPreflightError::InvalidConfiguration)
        .attach_printable_lazy(|| format!("{name} must be a UUID"))
}

fn validate_entity_id(
    name: &'static str,
    value: &str,
    expected_web_id: &str,
) -> Result<(), Report<PermissionPreflightError>> {
    if value.len() > MAX_ENTITY_ID_BYTES || value.chars().any(char::is_whitespace) {
        return Err(
            Report::new(PermissionPreflightError::InvalidConfiguration).attach_printable(format!(
                "{name} must be a whitespace-free Graph entity ID of at most {MAX_ENTITY_ID_BYTES} bytes"
            )),
        );
    }
    let mut parts = value.split('~');
    let web_id = parts.next().unwrap_or_default();
    let entity_uuid = parts.next().unwrap_or_default();
    if parts.next().is_some()
        || uuid::Uuid::parse_str(web_id).is_err()
        || uuid::Uuid::parse_str(entity_uuid).is_err()
    {
        return Err(
            Report::new(PermissionPreflightError::InvalidConfiguration).attach_printable(format!(
                "{name} must have the canonical <web-uuid>~<entity-uuid> shape"
            )),
        );
    }
    if web_id != expected_web_id {
        return Err(
            Report::new(PermissionPreflightError::InvalidConfiguration).attach_printable(format!(
                "{name} belongs to web {web_id}, not configured HASH_WEB_ID {expected_web_id}"
            )),
        );
    }
    Ok(())
}

async fn evaluate(
    checker: &dyn PermissionChecker,
    targets: Vec<PermissionTarget>,
) -> Result<PermissionPreflightReport, Report<PermissionPreflightError>> {
    let entity_ids = targets
        .iter()
        .map(|target| target.entity_id.clone())
        .collect::<Vec<_>>();
    let mut denied = Vec::new();
    for action in PermissionAction::ALL {
        let permitted = checker.permitted(action, &entity_ids).await?;
        for target in &targets {
            if !permitted.contains(&target.entity_id) {
                denied.push(PermissionDenial {
                    target: target.kind,
                    action,
                });
            }
        }
    }
    denied.sort_by_key(|denial| (denial.target, denial.action));
    let verified = denied.is_empty();
    Ok(PermissionPreflightReport {
        status: if verified {
            PermissionPreflightStatus::Verified
        } else {
            PermissionPreflightStatus::Denied
        },
        production_blocking: !verified,
        endpoint: PERMISSION_PATH,
        requests_made: PermissionAction::ALL.len() as u8,
        targets,
        denied,
        unverified_reasons: vec![],
    })
}

fn decode_permission_response(
    action: PermissionAction,
    requested: &[String],
    bytes: &[u8],
) -> Result<BTreeSet<String>, Report<PermissionPreflightError>> {
    let response: Value = serde_json::from_slice(bytes)
        .map_err(Report::from)
        .change_context(PermissionPreflightError::MalformedGraphResponse)
        .attach_printable_lazy(|| format!("{action} permission response is not valid JSON"))?;
    let object = response.as_object().ok_or_else(|| {
        Report::new(PermissionPreflightError::MalformedGraphResponse)
            .attach_printable(format!("{action} permission response must be an object"))
    })?;
    let requested = requested
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let mut permitted = BTreeSet::new();
    for (entity_id, editions) in object {
        if !requested.contains(entity_id.as_str()) {
            return Err(
                Report::new(PermissionPreflightError::MalformedGraphResponse).attach_printable(
                    format!("{action} permission response contains an unrequested entity ID"),
                ),
            );
        }
        let editions = editions.as_array().ok_or_else(|| {
            Report::new(PermissionPreflightError::MalformedGraphResponse).attach_printable(format!(
                "{action} permission response editions must be an array"
            ))
        })?;
        if editions.iter().any(|edition| edition.as_str().is_none()) {
            return Err(
                Report::new(PermissionPreflightError::MalformedGraphResponse).attach_printable(
                    format!("{action} permission response contains a non-string edition ID"),
                ),
            );
        }
        if !editions.is_empty() {
            permitted.insert(entity_id.clone());
        }
    }
    Ok(permitted)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use wiremock::matchers::{body_json, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    const WEB: &str = "00000000-0000-4000-8000-000000000001";
    const ENTITY: &str =
        "00000000-0000-4000-8000-000000000001~00000000-0000-4000-8000-000000000002";
    const LINK: &str = "00000000-0000-4000-8000-000000000001~00000000-0000-4000-8000-000000000003";

    fn env(server: &MockServer) -> Env {
        Env::from_map(HashMap::from([
            ("HASH_GRAPH_URL".to_owned(), server.uri()),
            (
                "HASH_ACTOR_ID".to_owned(),
                "00000000-0000-4000-8000-000000000004".to_owned(),
            ),
            ("HASH_WEB_ID".to_owned(), WEB.to_owned()),
            (ENTITY_CANARY_ENV.to_owned(), ENTITY.to_owned()),
            (LINK_CANARY_ENV.to_owned(), LINK.to_owned()),
            ("HASH_GRAPH_TIMEOUT_MS".to_owned(), "1000".to_owned()),
        ]))
    }

    fn request(action: &str) -> Value {
        json!({
            "action": action,
            "entityIds": [ENTITY, LINK],
            "temporalAxes": {
                "pinned": {"axis": "transactionTime", "timestamp": null},
                "variable": {
                    "axis": "decisionTime",
                    "interval": {"start": null, "end": null}
                }
            },
            "includeDrafts": false
        })
    }

    #[tokio::test]
    async fn exactly_two_batched_permission_posts_verify_entity_and_link_without_reads() {
        let server = MockServer::start().await;
        let permitted = json!({
            ENTITY: ["00000000-0000-4000-8000-000000000010"],
            LINK: ["00000000-0000-4000-8000-000000000011"]
        });
        for action in ["updateEntity", "archiveEntity"] {
            Mock::given(method("POST"))
                .and(path(PERMISSION_PATH))
                .and(body_json(request(action)))
                .respond_with(ResponseTemplate::new(200).set_body_json(&permitted))
                .expect(1)
                .mount(&server)
                .await;
        }

        let report = graph_permission_preflight(&env(&server))
            .await
            .expect("verified preflight");
        assert_eq!(report.status, PermissionPreflightStatus::Verified);
        assert_eq!(report.requests_made, 2);
        assert!(!report.production_blocking);
        let requests = server.received_requests().await.expect("request log");
        assert_eq!(requests.len(), 2);
        assert!(requests.iter().all(|request| {
            request.method == wiremock::http::Method::POST && request.url.path() == PERMISSION_PATH
        }));
    }

    #[tokio::test]
    async fn a_missing_permission_is_denied_and_production_blocking() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path(PERMISSION_PATH))
            .and(body_json(request("updateEntity")))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                ENTITY: ["00000000-0000-4000-8000-000000000010"],
                LINK: ["00000000-0000-4000-8000-000000000011"]
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(PERMISSION_PATH))
            .and(body_json(request("archiveEntity")))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                ENTITY: ["00000000-0000-4000-8000-000000000010"]
            })))
            .mount(&server)
            .await;

        let report = graph_permission_preflight(&env(&server))
            .await
            .expect("denial is a report, not a transport error");
        assert_eq!(report.status, PermissionPreflightStatus::Denied);
        assert!(report.production_blocking);
        assert_eq!(
            report.denied,
            [PermissionDenial {
                target: PermissionTargetKind::Link,
                action: PermissionAction::ArchiveEntity,
            }]
        );
    }

    #[tokio::test]
    async fn missing_canaries_are_unverified_without_consulting_graph() {
        let server = MockServer::start().await;
        let env = Env::from_map(HashMap::from([
            ("HASH_GRAPH_URL".to_owned(), server.uri()),
            (
                "HASH_ACTOR_ID".to_owned(),
                "00000000-0000-4000-8000-000000000004".to_owned(),
            ),
        ]));
        let report = graph_permission_preflight(&env)
            .await
            .expect("missing optional configuration is observable");
        assert_eq!(report.status, PermissionPreflightStatus::Unverified);
        assert_eq!(report.requests_made, 0);
        // Canary IDs are optional: absence is observable without a network
        // request and activation proceeds unverified with a warning.
        assert!(!report.production_blocking);
        assert!(report.allows_production_activation());
        assert_eq!(report.unverified_reasons.len(), 3);
        assert!(server
            .received_requests()
            .await
            .expect("request log")
            .is_empty());
    }

    #[test]
    fn canaries_must_be_distinct_canonical_ids_in_the_configured_web() {
        let invalid = Env::from_map(HashMap::from([
            ("HASH_GRAPH_URL".to_owned(), "http://graph".to_owned()),
            (
                "HASH_ACTOR_ID".to_owned(),
                "00000000-0000-4000-8000-000000000004".to_owned(),
            ),
            ("HASH_WEB_ID".to_owned(), WEB.to_owned()),
            (ENTITY_CANARY_ENV.to_owned(), ENTITY.to_owned()),
            (LINK_CANARY_ENV.to_owned(), ENTITY.to_owned()),
        ]));
        let error = configured_checker(&invalid)
            .err()
            .expect("same canary is unsafe");
        assert!(format!("{error:?}").contains("must identify different canaries"));
    }

    #[tokio::test]
    async fn malformed_response_is_bounded_and_does_not_expose_its_body() {
        let server = MockServer::start().await;
        let secret = "response-body-secret";
        Mock::given(method("POST"))
            .and(path(PERMISSION_PATH))
            .respond_with(
                ResponseTemplate::new(200).set_body_string(format!("{{\"{secret}\": true}}")),
            )
            .expect(1)
            .mount(&server)
            .await;

        let error = graph_permission_preflight(&env(&server))
            .await
            .expect_err("malformed response");
        assert!(!format!("{error:?}").contains(secret));
    }

    #[tokio::test]
    async fn http_error_body_is_not_read_or_retained() {
        let server = MockServer::start().await;
        let secret = "upstream-secret-bearing-diagnostic";
        Mock::given(method("POST"))
            .and(path(PERMISSION_PATH))
            .respond_with(ResponseTemplate::new(500).set_body_string(secret))
            .expect(1)
            .mount(&server)
            .await;

        let error = graph_permission_preflight(&env(&server))
            .await
            .expect_err("HTTP failure");
        let diagnostic = format!("{error:?}");
        assert!(diagnostic.contains("HTTP 500"));
        assert!(!diagnostic.contains(secret));
    }

    #[tokio::test]
    async fn oversized_success_response_fails_before_unbounded_allocation() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path(PERMISSION_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![
                b'x';
                MAX_GRAPH_RESPONSE_BYTES
                    + 1
            ]))
            .expect(1)
            .mount(&server)
            .await;

        let error = graph_permission_preflight(&env(&server))
            .await
            .expect_err("oversized response");
        assert!(format!("{error:?}").contains("exceeds 65536 bytes"));
    }
}
