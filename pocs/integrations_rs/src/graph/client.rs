//! Sends entity and link changes to HASH Graph. Creates use deterministic
//! entity UUIDs and set `readOnly` to `true`. An HTTP 409 retries the same
//! entity as a patch. Bulk requests retry rejected operations separately and
//! stop after the configured number of failed batches. All requests share the
//! per-web rate limiter and `Retry-After` handling.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use error_stack::{Report, ResultExt as _};
use futures::StreamExt as _;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde_json::{json, Map, Value};

use crate::config::{self, Env};
use crate::error::GraphError;
use crate::http::retry::with_429_retry;
use crate::throttle::RateLimiter;
use crate::value::{js_string, unwrap_typed};

use super::executor::{
    EffectRequestV1, EffectResponseV1, GraphEffectTransport, TransportFailureV1,
};
use super::uuid::{composite_entity_id, deterministic_uuid};
use super::{ArchiveOp, BatchOk, BulkResult, EntityOp, GraphClient, LinkOp, OpFailure};

pub struct HttpClient {
    base_url: String,
    /// Actor used for direct Graph calls. Durable delivery uses the owner in
    /// the verified work manifest. The `Debug` and `Display` implementations
    /// redact this value.
    actor_id: crate::secret::Secret<String>,
    bulk_size: usize,
    durable_bulk_size: usize,
    concurrency: usize,
    max_failed_batches: u32,
    batch_rejection_reported: AtomicBool,
    timeout_ms: u64,
    rate_limit: Option<u64>,
    throttle_scope: String,
    throttle: Arc<dyn RateLimiter>,
    http: reqwest::Client,
}

pub struct HttpClientOptions {
    pub base_url: String,
    pub actor_id: String,
    pub rate_limit: Option<u64>,
    pub throttle_scope: String,
    pub throttle: Arc<dyn RateLimiter>,
}

impl HttpClient {
    pub fn new(options: HttpClientOptions, env: &Env) -> Self {
        let mut headers = HeaderMap::new();
        if let Some(secret) = env
            .get("HASH_GRAPH_SERVICE_SECRET")
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let mut authorization = HeaderValue::from_str(&format!("HASH-Service {secret}"))
                .expect("Graph service credential should be a valid HTTP header value");
            authorization.set_sensitive(true);
            headers.insert(AUTHORIZATION, authorization);
        }
        Self {
            base_url: options.base_url.trim_end_matches('/').to_owned(),
            actor_id: crate::secret::Secret::new(options.actor_id),
            bulk_size: config::graph_bulk_size(env),
            durable_bulk_size: config::durable_graph_bulk_size(env),
            concurrency: config::graph_concurrency(env),
            max_failed_batches: config::graph_max_failed_batches(env),
            batch_rejection_reported: AtomicBool::new(false),
            timeout_ms: config::graph_timeout_ms(env),
            rate_limit: options.rate_limit,
            throttle_scope: options.throttle_scope,
            throttle: options.throttle,
            http: reqwest::Client::builder()
                .default_headers(headers)
                .build()
                .expect("Graph HTTP client configuration should be valid"),
        }
    }

    async fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: &Value,
        op_weight: u64,
    ) -> Result<Value, RequestError> {
        if op_weight > 0 {
            self.throttle
                .acquire(&self.throttle_scope, op_weight, self.rate_limit)
                .await
                .map_err(|body| RequestError { status: 0, body })?;
        }

        let url = format!("{}{path}", self.base_url);
        let response = with_429_retry(|| {
            self.http
                .request(method.clone(), &url)
                .json(body)
                .header("content-type", "application/json")
                .header("x-authenticated-user-actor-id", self.actor_id.expose())
                .timeout(std::time::Duration::from_millis(self.timeout_ms))
                .send()
        })
        .await
        .map_err(|error| RequestError {
            status: 0,
            body: if error.is_timeout() {
                format!(
                    "{method} {path} timed out after {}ms (graph overloaded or unreachable)",
                    self.timeout_ms
                )
            } else {
                error.to_string()
            },
        })?;

        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();

        if (200..300).contains(&status) {
            Ok(serde_json::from_str(&text).unwrap_or(Value::String(text)))
        } else {
            Err(RequestError { status, body: text })
        }
    }

    async fn effect_request_once(
        &self,
        actor_id: &str,
        request: EffectRequestV1,
    ) -> EffectResponseV1 {
        if self
            .throttle
            .acquire(&self.throttle_scope, 1, self.rate_limit)
            .await
            .is_err()
        {
            return EffectResponseV1::Transport(TransportFailureV1::Throttle);
        }
        let (method, body) = match request {
            EffectRequestV1::Create(body) => (reqwest::Method::POST, body),
            EffectRequestV1::Patch(body) | EffectRequestV1::Archive(body) => {
                (reqwest::Method::PATCH, body)
            }
        };
        let response = self
            .http
            .request(method.clone(), format!("{}/entities", self.base_url))
            .json(&body)
            .header("content-type", "application/json")
            .header("x-authenticated-user-actor-id", actor_id)
            .timeout(std::time::Duration::from_millis(self.timeout_ms))
            .send()
            .await;
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                let failure = if error.is_timeout() {
                    TransportFailureV1::Timeout
                } else {
                    TransportFailureV1::Request
                };
                return EffectResponseV1::Transport(failure);
            }
        };
        let status = response.status().as_u16();
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.trim().parse::<u64>().ok())
            .map(|seconds| Duration::from_millis(seconds.saturating_mul(1_000).min(30_000)));
        let diagnostic = response.text().await.unwrap_or_default();
        if (200..300).contains(&status) {
            EffectResponseV1::Success
        } else {
            EffectResponseV1::Http {
                status,
                retry_after,
                diagnostic,
            }
        }
    }

    async fn create_batch_once(&self, actor_id: &str, requests: Vec<Value>) -> EffectResponseV1 {
        if self
            .throttle
            .acquire(&self.throttle_scope, 1, self.rate_limit)
            .await
            .is_err()
        {
            return EffectResponseV1::Transport(TransportFailureV1::Throttle);
        }
        let response = self
            .http
            .post(format!("{}/entities/bulk", self.base_url))
            .json(&requests)
            .header("content-type", "application/json")
            .header("x-authenticated-user-actor-id", actor_id)
            .timeout(std::time::Duration::from_millis(self.timeout_ms))
            .send()
            .await;
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                return EffectResponseV1::Transport(if error.is_timeout() {
                    TransportFailureV1::Timeout
                } else {
                    TransportFailureV1::Request
                });
            }
        };
        let status = response.status().as_u16();
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.trim().parse::<u64>().ok())
            .map(|seconds| Duration::from_millis(seconds.saturating_mul(1_000).min(30_000)));
        let diagnostic = response.text().await.unwrap_or_default();
        if (200..300).contains(&status) {
            EffectResponseV1::Success
        } else {
            if !self.batch_rejection_reported.swap(true, Ordering::AcqRel) {
                let diagnostic = diagnostic
                    .chars()
                    .take(512)
                    .map(|character| {
                        if character.is_control() {
                            ' '
                        } else {
                            character
                        }
                    })
                    .collect::<String>();
                tracing::warn!(
                    status,
                    diagnostic,
                    "Graph rejected the bulk create. Retrying each effect separately"
                );
            }
            EffectResponseV1::Http {
                status,
                retry_after,
                diagnostic,
            }
        }
    }
}

#[async_trait::async_trait]
impl GraphEffectTransport for HttpClient {
    async fn send(&self, request: EffectRequestV1) -> EffectResponseV1 {
        self.effect_request_once(self.actor_id.expose(), request)
            .await
    }

    async fn send_as(&self, actor_id: &str, request: EffectRequestV1) -> EffectResponseV1 {
        self.effect_request_once(actor_id, request).await
    }

    async fn send_create_batch(&self, requests: Vec<Value>) -> Option<EffectResponseV1> {
        Some(
            self.create_batch_once(self.actor_id.expose(), requests)
                .await,
        )
    }

    async fn send_create_batch_as(
        &self,
        actor_id: &str,
        requests: Vec<Value>,
    ) -> Option<EffectResponseV1> {
        Some(self.create_batch_once(actor_id, requests).await)
    }

    fn max_create_batch_size(&self) -> usize {
        self.durable_bulk_size
    }

    fn max_in_flight(&self) -> usize {
        self.concurrency.max(1)
    }
}

#[derive(Debug, Clone)]
struct RequestError {
    status: u16,
    body: String,
}

impl std::fmt::Display for RequestError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message())
    }
}

impl std::error::Error for RequestError {}

impl RequestError {
    fn is_conflict(&self) -> bool {
        self.status == 409
    }

    fn message(&self) -> String {
        format!(
            "Graph API failed ({}): {}",
            self.status,
            self.body.chars().take(1000).collect::<String>()
        )
    }
}

struct Breaker {
    streak: AtomicU32,
    tripped: AtomicBool,
    max: u32,
}

impl Breaker {
    fn new(max: u32) -> Self {
        Self {
            streak: AtomicU32::new(0),
            tripped: AtomicBool::new(false),
            max,
        }
    }

    fn tripped(&self) -> bool {
        self.tripped.load(Ordering::Relaxed)
    }

    fn record(&self, any_ok: bool) {
        if any_ok {
            self.streak.store(0, Ordering::Relaxed);
        } else if self.streak.fetch_add(1, Ordering::Relaxed) + 1 >= self.max {
            self.tripped.store(true, Ordering::Relaxed);
        }
    }
}

enum ChunkOutcome {
    BatchOk(Vec<String>),
    FellBack {
        ok: Vec<String>,
        failed: Vec<OpFailure>,
    },
    Skipped,
}

pub fn entity_create_params(op: &EntityOp) -> Value {
    json!({
        "webId": op.web_id,
        "entityTypeIds": [op.entity_type],
        "properties": map_properties(&op.properties, &op.property_provenance),
        "draft": false,
        "provenance": op.provenance.op_json(),
        "entityUuid": deterministic_uuid(&op.namespace, &op.entity_type, &op.entity_id),
        "readOnly": true,
    })
}

pub fn entity_patch_params(op: &EntityOp) -> Value {
    json!({
        "entityId": entity_graph_id(op),
        "provenance": op.provenance.op_json(),
        "archived": false,
        "entityTypeIds": [op.entity_type],
        "properties": map_properties_as_patch(&op.properties, &op.property_provenance),
    })
}

pub struct LinkIds {
    pub left: String,
    pub right: String,
    pub link_uuid: String,
    pub full_link_id: String,
}

pub fn link_entity_ids(op: &LinkOp) -> LinkIds {
    let left = composite_entity_id(
        &op.web_id,
        &deterministic_uuid(
            &op.namespace,
            &op.source_entity_type,
            &Value::String(op.source_entity_id.clone()),
        ),
    );
    let right = composite_entity_id(
        &op.web_id,
        &deterministic_uuid(
            &op.namespace,
            &op.target_entity_type,
            &Value::String(op.target_id.clone()),
        ),
    );
    let link_uuid = deterministic_uuid(
        &op.namespace,
        &op.link_type,
        &Value::String(format!(
            "{}::{}::{}::{}",
            op.source_entity_type, op.source_entity_id, op.target_entity_type, op.target_id
        )),
    );
    let full_link_id = composite_entity_id(&op.web_id, &link_uuid);

    LinkIds {
        left,
        right,
        link_uuid,
        full_link_id,
    }
}

pub fn link_create_params(op: &LinkOp) -> Value {
    let ids = link_entity_ids(op);
    let properties = match &op.properties {
        Some(properties) => map_properties(properties, &Default::default()),
        None => json!({"value": {}}),
    };

    json!({
        "webId": op.web_id,
        "entityTypeIds": [op.link_type],
        "properties": properties,
        "draft": false,
        "provenance": op.provenance.op_json(),
        "entityUuid": ids.link_uuid,
        "linkData": {"leftEntityId": ids.left, "rightEntityId": ids.right},
        "readOnly": true,
    })
}

pub fn link_patch_params(op: &LinkOp) -> Value {
    let mut patch = Map::new();
    patch.insert(
        "entityId".to_owned(),
        json!(link_entity_ids(op).full_link_id),
    );
    patch.insert("provenance".to_owned(), op.provenance.op_json());
    patch.insert("archived".to_owned(), json!(false));
    if let Some(properties) = &op.properties {
        let property_patches = map_properties_as_patch(properties, &Default::default());
        // Graph rejects an empty property patch. Omitting the patch revives
        // the link without changing its properties.
        if property_patches
            .as_array()
            .is_some_and(|patches| !patches.is_empty())
        {
            patch.insert("properties".to_owned(), property_patches);
        }
    }
    Value::Object(patch)
}

pub fn entity_graph_id(op: &EntityOp) -> String {
    composite_entity_id(
        &op.web_id,
        &deterministic_uuid(&op.namespace, &op.entity_type, &op.entity_id),
    )
}

pub fn archive_params(op: &ArchiveOp) -> Value {
    let full_id = composite_entity_id(
        &op.web_id,
        &deterministic_uuid(
            &op.namespace,
            &op.entity_type,
            &Value::String(op.entity_id.clone()),
        ),
    );
    json!({
        "entityId": full_id,
        "provenance": op.provenance.op_json(),
        "archived": true,
    })
}

pub fn to_base_url(versioned_url: &str) -> String {
    match versioned_url.rfind("v/") {
        Some(index)
            if versioned_url[index + 2..]
                .chars()
                .all(|c| c.is_ascii_digit())
                && !versioned_url[index + 2..].is_empty() =>
        {
            versioned_url[..index].to_owned()
        }
        _ => versioned_url.to_owned(),
    }
}

fn property_with_metadata(
    url: &str,
    value: &Value,
    data_type_id: Option<&str>,
    property_provenance: &std::collections::BTreeMap<String, Value>,
) -> Value {
    let mut metadata = Map::new();
    metadata.insert(
        "dataTypeId".to_owned(),
        data_type_id.map(|id| json!(id)).unwrap_or(Value::Null),
    );
    if let Some(provenance) = property_provenance.get(url) {
        metadata.insert("provenance".to_owned(), provenance.clone());
    }
    json!({"value": value, "metadata": metadata})
}

pub fn map_properties(
    properties: &[(String, Value)],
    property_provenance: &std::collections::BTreeMap<String, Value>,
) -> Value {
    let mut value = Map::new();
    for (url, raw) in properties {
        let (inner, data_type_id) = unwrap_typed(raw);
        if inner.is_null() {
            continue;
        }
        value.insert(
            to_base_url(url),
            property_with_metadata(url, &inner, data_type_id.as_deref(), property_provenance),
        );
    }
    json!({"value": value})
}

pub fn map_properties_as_patch(
    properties: &[(String, Value)],
    property_provenance: &std::collections::BTreeMap<String, Value>,
) -> Value {
    let patches: Vec<Value> = properties
        .iter()
        .filter_map(|(url, raw)| {
            let (inner, data_type_id) = unwrap_typed(raw);
            if inner.is_null() {
                return None;
            }
            Some(json!({
                "op": "add",
                "path": [to_base_url(url)],
                "property": property_with_metadata(url, &inner, data_type_id.as_deref(), property_provenance),
            }))
        })
        .collect();
    json!(patches)
}

impl HttpClient {
    async fn upsert_main(&self, create: &Value, patch: &Value) -> Result<bool, RequestError> {
        match self
            .request(reqwest::Method::POST, "/entities", create, 0)
            .await
        {
            Ok(_) => Ok(false),
            Err(err) if err.is_conflict() => self
                .request(reqwest::Method::PATCH, "/entities", patch, 0)
                .await
                .map(|_| true),
            Err(err) => Err(err),
        }
    }

    async fn upsert_patch_first(
        &self,
        create: &Value,
        patch: &Value,
    ) -> Result<bool, RequestError> {
        match self
            .request(reqwest::Method::PATCH, "/entities", patch, 0)
            .await
        {
            Ok(_) => Ok(true),
            Err(err) if err.status == 404 => self.upsert_main(create, patch).await,
            Err(err) => Err(err),
        }
    }

    /// Sends bounded bulk requests and retries rejected operations
    /// individually. An HTTP 409 switches the remaining operations in that
    /// batch to patch-first delivery.
    async fn bulk(
        &self,
        payloads: Vec<(String, Value, Value)>,
        on_batch_ok: BatchOk,
    ) -> BulkResult {
        let breaker = Arc::new(Breaker::new(self.max_failed_batches));
        let chunks: Vec<Vec<(String, Value, Value)>> = payloads
            .chunks(self.bulk_size.max(1))
            .map(<[_]>::to_vec)
            .collect();

        let outcomes: Vec<ChunkOutcome> = futures::stream::iter(chunks.into_iter().map(|chunk| {
            let breaker = Arc::clone(&breaker);
            let on_batch_ok = on_batch_ok.clone();
            async move {
                if breaker.tripped() {
                    return ChunkOutcome::Skipped;
                }
                let outcome = self.run_chunk(chunk, &on_batch_ok).await;
                breaker.record(match &outcome {
                    ChunkOutcome::BatchOk(_) => true,
                    ChunkOutcome::FellBack { ok, .. } => !ok.is_empty(),
                    ChunkOutcome::Skipped => false,
                });
                outcome
            }
        }))
        .buffer_unordered(self.concurrency.max(1))
        .collect()
        .await;

        let mut result = BulkResult {
            aborted: breaker.tripped(),
            ..BulkResult::default()
        };
        for outcome in outcomes {
            match outcome {
                ChunkOutcome::BatchOk(ids) => result.ok.extend(ids),
                ChunkOutcome::FellBack { ok, failed } => {
                    result.ok.extend(ok);
                    result.failed.extend(failed);
                }
                ChunkOutcome::Skipped => {}
            }
        }
        result
    }

    async fn run_chunk(
        &self,
        chunk: Vec<(String, Value, Value)>,
        on_batch_ok: &BatchOk,
    ) -> ChunkOutcome {
        let payload: Vec<&Value> = chunk.iter().map(|(_, create, _)| create).collect();

        match self
            .request(
                reqwest::Method::POST,
                "/entities/bulk",
                &json!(payload),
                chunk.len() as u64,
            )
            .await
        {
            Ok(_) => {
                let ids: Vec<String> = chunk.into_iter().map(|(id, _, _)| id).collect();
                on_batch_ok(ids.clone()).await;
                ChunkOutcome::BatchOk(ids)
            }
            Err(batch_err) => {
                let batch_conflicted = batch_err.is_conflict();
                let mut ok = vec![];
                let mut failed = vec![];
                let mut patch_first = false;
                let mut notified = 0;

                for (index, (id, create, patch)) in chunk.into_iter().enumerate() {
                    // The bulk request covered the original operations. Each
                    // fallback request consumes another rate-limit token.
                    let throttle = self
                        .throttle
                        .acquire(&self.throttle_scope, 1, self.rate_limit)
                        .await;

                    let attempt = match throttle {
                        Err(body) => Err(RequestError { status: 0, body }),
                        Ok(()) if patch_first => self.upsert_patch_first(&create, &patch).await,
                        Ok(()) => self.upsert_main(&create, &patch).await,
                    };

                    match attempt {
                        Ok(existed) => {
                            if index == 0 && existed && batch_conflicted {
                                patch_first = true;
                            }
                            ok.push(id);
                            if ok.len() - notified >= 16 {
                                on_batch_ok(ok[notified..].to_vec()).await;
                                notified = ok.len();
                            }
                        }
                        Err(err) => failed.push(OpFailure {
                            id,
                            message: err.message(),
                        }),
                    }
                }

                // Commit fallback successes in groups of 16 to match the
                // TypeScript runner.
                if notified < ok.len() {
                    on_batch_ok(ok[notified..].to_vec()).await;
                }
                ChunkOutcome::FellBack { ok, failed }
            }
        }
    }
}

#[async_trait::async_trait]
impl GraphClient for HttpClient {
    fn identity(&self) -> String {
        self.base_url.clone()
    }

    async fn has_entity(&self, full_entity_id: &str) -> Result<bool, Report<GraphError>> {
        let uuid = full_entity_id.rsplit('~').next().unwrap_or(full_entity_id);
        let body = json!({
            "filter": {"equal": [{"path": ["uuid"]}, {"parameter": uuid}]},
            "temporalAxes": {
                "pinned": {"axis": "transactionTime", "timestamp": null},
                "variable": {"axis": "decisionTime", "interval": {"start": null, "end": null}}
            },
            "includeDrafts": false,
            "includePermissions": false,
            "limit": 1,
        });

        let response = self
            .request(reqwest::Method::POST, "/entities/query", &body, 0)
            .await
            .change_context(GraphError)?;

        let found = response
            .get("entities")
            .and_then(Value::as_array)
            .map(|entities| {
                entities.iter().any(|entity| {
                    entity
                        .pointer("/metadata/recordId/entityId")
                        .and_then(Value::as_str)
                        == Some(full_entity_id)
                })
            })
            .unwrap_or(false);
        Ok(found)
    }

    async fn archive_entity(&self, op: &ArchiveOp) -> Result<(), Report<GraphError>> {
        let body = archive_params(op);

        match self
            .request(reqwest::Method::PATCH, "/entities", &body, 1)
            .await
        {
            Ok(_) => Ok(()),
            Err(err) if err.status == 404 => Ok(()),
            Err(err) => Err(err).change_context(GraphError),
        }
    }

    async fn bulk_upsert_entities(&self, ops: Vec<EntityOp>, on_batch_ok: BatchOk) -> BulkResult {
        let payloads = ops
            .iter()
            .map(|op| {
                (
                    js_string(&op.entity_id),
                    entity_create_params(op),
                    entity_patch_params(op),
                )
            })
            .collect();
        self.bulk(payloads, on_batch_ok).await
    }

    async fn bulk_upsert_links(&self, ops: Vec<LinkOp>, on_batch_ok: BatchOk) -> BulkResult {
        let payloads = ops
            .iter()
            .map(|op| {
                (
                    op.op_id.clone(),
                    link_create_params(op),
                    link_patch_params(op),
                )
            })
            .collect();
        self.bulk(payloads, on_batch_ok).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use wiremock::matchers::{body_json, header, method, path};
    use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

    #[derive(Clone)]
    struct CreateOnceThenConflict {
        calls: Arc<AtomicUsize>,
    }

    impl Respond for CreateOnceThenConflict {
        fn respond(&self, _request: &Request) -> ResponseTemplate {
            if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
                ResponseTemplate::new(200).set_body_json(json!({}))
            } else {
                ResponseTemplate::new(409)
            }
        }
    }

    fn test_client(server: &MockServer) -> HttpClient {
        HttpClient::new(
            HttpClientOptions {
                base_url: server.uri(),
                actor_id: "actor".to_owned(),
                rate_limit: None,
                throttle_scope: "web:test".to_owned(),
                throttle: Arc::new(crate::throttle::Throttle::new()),
            },
            &Env::default(),
        )
    }

    #[tokio::test]
    async fn effect_transport_returns_create_409_without_hiding_the_patch_cost() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/entities"))
            .and(body_json(json!({"create": true})))
            .respond_with(ResponseTemplate::new(409).set_body_string("conflict"))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("PATCH"))
            .and(path("/entities"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&server)
            .await;

        let response = GraphEffectTransport::send(
            &test_client(&server),
            EffectRequestV1::Create(json!({"create": true})),
        )
        .await;
        assert!(matches!(
            response,
            EffectResponseV1::Http { status: 409, .. }
        ));
    }

    #[tokio::test]
    async fn durable_effect_transport_authenticates_the_service_and_uses_the_run_owner() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/entities"))
            .and(header("x-authenticated-user-actor-id", "run-owner"))
            .and(header("authorization", "HASH-Service service-secret"))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/entities/bulk"))
            .and(header("x-authenticated-user-actor-id", "run-owner"))
            .and(header("authorization", "HASH-Service service-secret"))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;

        let client = HttpClient::new(
            HttpClientOptions {
                base_url: server.uri(),
                actor_id: "node-actor".to_owned(),
                rate_limit: None,
                throttle_scope: "web:test".to_owned(),
                throttle: Arc::new(crate::throttle::Throttle::new()),
            },
            &Env::from_map(std::collections::HashMap::from([(
                "HASH_GRAPH_SERVICE_SECRET".to_owned(),
                "service-secret".to_owned(),
            )])),
        );

        let response = GraphEffectTransport::send_as(
            &client,
            "run-owner",
            EffectRequestV1::Create(json!({"create": true})),
        )
        .await;
        assert_eq!(response, EffectResponseV1::Success);
        let response = GraphEffectTransport::send_create_batch_as(
            &client,
            "run-owner",
            vec![json!({"create": true})],
        )
        .await;
        assert_eq!(response, Some(EffectResponseV1::Success));
    }

    #[tokio::test]
    async fn effect_transport_exposes_one_429_and_capped_retry_after_to_the_budget_owner() {
        let server = MockServer::start().await;
        Mock::given(method("PATCH"))
            .and(path("/entities"))
            .respond_with(
                ResponseTemplate::new(429)
                    .insert_header("retry-after", "999999")
                    .set_body_string("slow down"),
            )
            .expect(1)
            .mount(&server)
            .await;

        let response = GraphEffectTransport::send(
            &test_client(&server),
            EffectRequestV1::Archive(json!({"archived": true})),
        )
        .await;
        assert!(matches!(
            response,
            EffectResponseV1::Http {
                status: 429,
                retry_after: Some(delay),
                ..
            } if delay == Duration::from_secs(30)
        ));
    }

    #[tokio::test]
    async fn authoritative_409_conflict_falls_back_from_create_to_patch() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/entities"))
            .respond_with(ResponseTemplate::new(409))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("PATCH"))
            .and(path("/entities"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
            .expect(1)
            .mount(&server)
            .await;

        assert!(test_client(&server)
            .upsert_main(&json!({}), &json!({"archived": false}))
            .await
            .expect("HTTP 409 should converge through PATCH"));
    }

    #[tokio::test]
    async fn replay_after_lost_create_ack_converges_through_same_uuid_and_patch() {
        let server = MockServer::start().await;
        let create_calls = Arc::new(AtomicUsize::new(0));
        Mock::given(method("POST"))
            .and(path("/entities"))
            .respond_with(CreateOnceThenConflict {
                calls: Arc::clone(&create_calls),
            })
            .expect(2)
            .mount(&server)
            .await;
        Mock::given(method("PATCH"))
            .and(path("/entities"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
            .expect(1)
            .mount(&server)
            .await;

        let op = EntityOp {
            namespace: "supply-chain".to_owned(),
            entity_type: "https://hash.ai/@h/types/entity-type/material/v/1".to_owned(),
            entity_id: json!("material-42"),
            properties: vec![(
                "https://hash.ai/@h/types/property-type/name/v/1".to_owned(),
                json!("Steel"),
            )],
            property_provenance: Default::default(),
            provenance: crate::graph::Provenance::default(),
            web_id: "alice".to_owned(),
        };
        let create = entity_create_params(&op);
        let patch = entity_patch_params(&op);
        let uuid = create["entityUuid"]
            .as_str()
            .expect("create request should contain an entity UUID");
        assert!(patch["entityId"]
            .as_str()
            .expect("patch request should contain an entity ID")
            .ends_with(uuid));
        assert_eq!(
            entity_create_params(&op)["entityUuid"],
            create["entityUuid"]
        );

        let client = test_client(&server);
        assert!(!client
            .upsert_main(&create, &patch)
            .await
            .expect("the original create should succeed"));
        // Graph committed the create before the process stopped. The replay
        // receives HTTP 409 and patches the same deterministic entity.
        assert!(client
            .upsert_main(&create, &patch)
            .await
            .expect("replayed create should converge through PATCH"));
        assert_eq!(create_calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn duplicate_words_in_a_non_409_error_do_not_imply_conflict() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/entities"))
            .respond_with(ResponseTemplate::new(500).set_body_string("duplicate key"))
            .expect(1)
            .mount(&server)
            .await;

        let error = test_client(&server)
            .upsert_main(&json!({}), &json!({}))
            .await
            .expect_err("only status 409 is a conflict");
        assert_eq!(error.status, 500);
    }

    #[tokio::test]
    async fn per_op_fallback_commits_successes_in_sixteen_row_slices() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/entities/bulk"))
            .respond_with(ResponseTemplate::new(409))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/entities"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
            .expect(17)
            .mount(&server)
            .await;

        let commits = Arc::new(tokio::sync::Mutex::new(Vec::<Vec<String>>::new()));
        let recorded = Arc::clone(&commits);
        let on_batch_ok: BatchOk = Arc::new(move |ids| {
            let recorded = Arc::clone(&recorded);
            Box::pin(async move { recorded.lock().await.push(ids) })
        });
        let chunk = (0..17)
            .map(|index| (index.to_string(), json!({}), json!({})))
            .collect();

        let outcome = test_client(&server).run_chunk(chunk, &on_batch_ok).await;
        assert!(matches!(outcome, ChunkOutcome::FellBack { .. }));
        let commits = commits.lock().await;
        assert_eq!(commits.iter().map(Vec::len).collect::<Vec<_>>(), [16, 1]);
    }

    #[test]
    fn propertyless_link_patch_only_revives_like_typescript() {
        let patch = link_patch_params(&LinkOp {
            op_id: "link-1".to_owned(),
            namespace: "connector".to_owned(),
            web_id: "web".to_owned(),
            source_entity_type: "source/v/1".to_owned(),
            source_entity_id: "source-1".to_owned(),
            link_type: "link/v/1".to_owned(),
            target_entity_type: "target/v/1".to_owned(),
            target_id: "target-1".to_owned(),
            properties: None,
            provenance: crate::graph::Provenance::default(),
        });
        assert_eq!(patch["archived"], false);
        assert!(patch.get("properties").is_none());
        assert!(patch.get("entityTypeIds").is_none());
    }

    #[test]
    fn all_null_link_properties_do_not_emit_an_empty_patch_array() {
        let patch = link_patch_params(&LinkOp {
            op_id: "link-1".to_owned(),
            namespace: "connector".to_owned(),
            web_id: "web".to_owned(),
            source_entity_type: "source/v/1".to_owned(),
            source_entity_id: "source-1".to_owned(),
            link_type: "link/v/1".to_owned(),
            target_entity_type: "target/v/1".to_owned(),
            target_id: "target-1".to_owned(),
            properties: Some(vec![("property/v/1".to_owned(), Value::Null)]),
            provenance: crate::graph::Provenance::default(),
        });
        assert_eq!(patch["archived"], false);
        assert!(patch.get("properties").is_none());
    }
}
