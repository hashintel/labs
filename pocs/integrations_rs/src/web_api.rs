//! HTTP adapter for the transport-neutral application service.
//!
//! Authentication is intentionally not implemented here. The deployment
//! boundary must authenticate requests and supply the trusted actor header;
//! this module validates shape and forwards explicit context only.

use std::collections::BTreeMap;
use std::sync::Arc;

use aide::axum::routing::{get, patch, post};
use aide::axum::{ApiRouter, IntoApiResponse};
use aide::openapi::{
    HeaderStyle, Info, OpenApi, Parameter, ParameterData, ParameterSchemaOrContent, Response,
    SchemaObject,
};
use aide::operation::OperationOutput;
use aide::scalar::Scalar;
use axum::extract::DefaultBodyLimit;
use axum::extract::{Extension, FromRequestParts, Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response as AxumResponse};
use axum::routing::get as axum_get;
use axum::Json;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::application::{
    ApplicationError, ApplicationErrorKind, IntegrationService, RequestContext, SubmitIntegration,
};
use crate::orchestrator::managed::{
    IngressDisposition, ManagedDesiredState, ProviderBinding, SecretRef, WebhookProvider,
    DEFAULT_MAX_BODY_BYTES,
};
use crate::orchestrator::{
    CommandRunStatus, CommandSubmission, InvocationV1, PublishedCancellation, SubmissionTriggerV1,
};
use crate::yaml::Source;

const ACTOR_HEADER: &str = "x-hash-actor-id";
const REQUEST_ID_HEADER: &str = "x-request-id";

#[derive(Clone)]
struct ApiState {
    service: Arc<dyn IntegrationService>,
}

struct RequestHeaders(HeaderMap);

impl<S> FromRequestParts<S> for RequestHeaders
where
    S: Send + Sync,
{
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        Ok(Self(parts.headers.clone()))
    }
}

impl aide::OperationInput for RequestHeaders {
    fn operation_input(
        context: &mut aide::generate::GenContext,
        operation: &mut aide::openapi::Operation,
    ) {
        let schema = context.schema.subschema_for::<String>();
        let parameter = |name: &str, description: &str, required| Parameter::Header {
            parameter_data: ParameterData {
                name: name.to_owned(),
                description: Some(description.to_owned()),
                required,
                deprecated: None,
                format: ParameterSchemaOrContent::Schema(SchemaObject {
                    json_schema: schema.clone(),
                    example: None,
                    external_docs: None,
                }),
                example: None,
                examples: Default::default(),
                explode: None,
                extensions: Default::default(),
            },
            style: HeaderStyle::Simple,
        };
        aide::operation::add_parameters(
            context,
            operation,
            [
                parameter(
                    ACTOR_HEADER,
                    "Authenticated HASH actor supplied by the trusted deployment boundary.",
                    true,
                ),
                parameter(
                    REQUEST_ID_HEADER,
                    "Optional caller request identifier retained in engine-owned metadata.",
                    false,
                ),
            ],
        );
    }
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmitRunRequest {
    /// Unresolved pipeline definition. Credential placeholders remain intact
    /// and are resolved only inside the durable engine.
    pub definition: Value,
    #[serde(default)]
    pub invocation: InvocationRequest,
}

#[derive(Debug, Clone, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InvocationRequest {
    #[serde(default)]
    pub links_only: bool,
    #[serde(default)]
    pub replay: BTreeMap<String, Option<String>>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmitRunResponse {
    pub run_id: String,
    pub initial_revision: String,
    pub created: bool,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunStatusResponse {
    pub run_id: String,
    pub integration_id: String,
    pub state: String,
    pub attempt: u64,
    pub attempt_id: Option<String>,
    pub active_work_id: Option<String>,
    pub effect_count: Option<u64>,
    pub completed_effect_count: Option<u64>,
    pub revision: String,
    pub result: Option<Value>,
    pub failure: Option<Value>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelRunResponse {
    pub run_id: String,
    pub request_id: String,
    pub expected_revision: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ErrorResponse {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PutManagedRequest {
    pub definition: Value,
    pub expected_revision: Option<String>,
    pub replaces_connector_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesiredStateRequest {
    pub desired_state: String,
    pub expected_revision: String,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BindManagedRequest {
    pub binding_id: String,
    pub provider: String,
    pub external_id: String,
    pub secret_backend: String,
    pub secret_path: String,
    /// Optional write-once bootstrap value. It is never returned or persisted
    /// in object storage; production rejects it until Vault is available.
    pub secret: Option<String>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HealthResponse {
    status: String,
}

struct ApiError {
    status: StatusCode,
    body: ErrorResponse,
}

impl ApiError {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            body: ErrorResponse {
                code: "invalid_request".to_owned(),
                message: message.into(),
            },
        }
    }
}

impl From<ApplicationError> for ApiError {
    fn from(error: ApplicationError) -> Self {
        let (status, code) = match error.kind {
            ApplicationErrorKind::InvalidRequest => (StatusCode::BAD_REQUEST, "invalid_request"),
            ApplicationErrorKind::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            ApplicationErrorKind::Conflict => (StatusCode::CONFLICT, "revision_conflict"),
            ApplicationErrorKind::Unavailable => {
                (StatusCode::SERVICE_UNAVAILABLE, "service_unavailable")
            }
        };
        Self {
            status,
            body: ErrorResponse {
                code: code.to_owned(),
                message: error.message,
            },
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> AxumResponse {
        (self.status, Json(self.body)).into_response()
    }
}

impl OperationOutput for ApiError {
    type Inner = ErrorResponse;

    fn operation_response(
        context: &mut aide::generate::GenContext,
        operation: &mut aide::openapi::Operation,
    ) -> Option<Response> {
        Json::<ErrorResponse>::operation_response(context, operation)
    }

    fn inferred_responses(
        context: &mut aide::generate::GenContext,
        operation: &mut aide::openapi::Operation,
    ) -> Vec<(Option<u16>, Response)> {
        let Some(response) = Self::operation_response(context, operation) else {
            return Vec::new();
        };
        [400_u16, 404, 409, 503]
            .into_iter()
            .map(|status| (Some(status), response.clone()))
            .collect()
    }
}

/// Build the complete HTTP adapter and its OpenAPI 3.1 document. Tests inject
/// a fake application service; production injects the durable implementation.
pub fn router(service: Arc<dyn IntegrationService>) -> axum::Router {
    aide::generate::on_error(|error| tracing::warn!(%error, "OpenAPI generation warning"));
    aide::generate::extract_schemas(true);

    let app = ApiRouter::new()
        .api_route("/health/live", get(live))
        .api_route(
            "/v1/webs/{web_id}/integrations/{connector_id}/runs",
            post(submit_run),
        )
        .api_route(
            "/v1/webs/{web_id}/integrations/{connector_id}/runs/{run_id}",
            get(run_status).delete(cancel_run),
        )
        .api_route(
            "/v1/webs/{web_id}/integrations/{connector_id}",
            get(get_managed).put(put_managed),
        )
        .api_route(
            "/v1/webs/{web_id}/integrations/{connector_id}/desired-state",
            patch(patch_desired_state),
        )
        .api_route(
            "/v1/webs/{web_id}/integrations/{connector_id}/bindings",
            post(bind_managed),
        )
        .api_route("/v1/hooks/github", post(github_hook))
        .api_route("/v1/hooks/slack", post(slack_hook))
        .api_route("/v1/hooks/linear", post(linear_hook))
        .api_route("/v1/hooks/notion/{binding_id}", post(notion_hook))
        .route(
            "/docs",
            Scalar::new("/openapi.json")
                .with_title("HASH Integrations API")
                .axum_route(),
        )
        .route("/openapi.json", axum_get(openapi));
    let mut document = OpenApi {
        info: Info {
            title: "HASH Integrations API".to_owned(),
            description: Some(
                "Submit and control durable integration runs. Authentication is supplied by the deployment boundary."
                    .to_owned(),
            ),
            version: env!("CARGO_PKG_VERSION").to_owned(),
            ..Info::default()
        },
        ..OpenApi::default()
    };
    app.finish_api(&mut document)
        .layer(DefaultBodyLimit::max(DEFAULT_MAX_BODY_BYTES))
        .layer(Extension(Arc::new(document)))
        .with_state(ApiState { service })
}

async fn put_managed(
    State(state): State<ApiState>,
    Path((web_id, connector_id)): Path<(String, String)>,
    headers: RequestHeaders,
    Json(request): Json<PutManagedRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let context = request_context(web_id, &headers.0)?;
    let created = request.expected_revision.is_none();
    let definition = state
        .service
        .put_managed(
            context,
            &connector_id,
            request.definition,
            request.expected_revision.as_deref(),
            request.replaces_connector_id,
        )
        .await?;
    Ok((
        if created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        Json(serde_json::to_value(definition).expect("managed definition serializes")),
    ))
}

async fn get_managed(
    State(state): State<ApiState>,
    Path((web_id, connector_id)): Path<(String, String)>,
    headers: RequestHeaders,
) -> Result<Json<Value>, ApiError> {
    let context = request_context(web_id, &headers.0)?;
    let definition = state.service.get_managed(context, &connector_id).await?;
    Ok(Json(
        serde_json::to_value(definition).expect("managed definition serializes"),
    ))
}

async fn patch_desired_state(
    State(state): State<ApiState>,
    Path((web_id, connector_id)): Path<(String, String)>,
    headers: RequestHeaders,
    Json(request): Json<DesiredStateRequest>,
) -> Result<Json<Value>, ApiError> {
    let context = request_context(web_id, &headers.0)?;
    let desired = match request.desired_state.as_str() {
        "enabled" => ManagedDesiredState::Enabled,
        "disabled" => ManagedDesiredState::Disabled,
        _ => {
            return Err(ApiError::invalid(
                "desiredState must be enabled or disabled",
            ))
        }
    };
    let definition = state
        .service
        .set_managed_desired_state(context, &connector_id, desired, &request.expected_revision)
        .await?;
    Ok(Json(
        serde_json::to_value(definition).expect("managed definition serializes"),
    ))
}

async fn bind_managed(
    State(state): State<ApiState>,
    Path((web_id, connector_id)): Path<(String, String)>,
    headers: RequestHeaders,
    Json(request): Json<BindManagedRequest>,
) -> Result<StatusCode, ApiError> {
    let context = request_context(web_id.clone(), &headers.0)?;
    let provider = request
        .provider
        .parse::<WebhookProvider>()
        .map_err(|error| ApiError::invalid(error.to_string()))?;
    let binding = ProviderBinding {
        binding_id: request.binding_id,
        provider,
        external_id: request.external_id,
        web_id,
        connector_id,
        secret_ref: SecretRef {
            backend: request.secret_backend,
            path: request.secret_path,
        },
    };
    let secret = request
        .secret
        .map(|value| crate::secret::Secret::new(value.into_bytes()));
    state.service.bind_managed(context, binding, secret).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn github_hook(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Json<Value>, ApiError> {
    hook(state, WebhookProvider::Github, None, headers, body).await
}

async fn slack_hook(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Json<Value>, ApiError> {
    hook(state, WebhookProvider::Slack, None, headers, body).await
}

async fn linear_hook(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Json<Value>, ApiError> {
    hook(state, WebhookProvider::Linear, None, headers, body).await
}

async fn notion_hook(
    State(state): State<ApiState>,
    Path(binding_id): Path<String>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Json<Value>, ApiError> {
    hook(
        state,
        WebhookProvider::Notion,
        Some(binding_id.as_str()),
        headers,
        body,
    )
    .await
}

async fn hook(
    state: ApiState,
    provider: WebhookProvider,
    binding_id: Option<&str>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Json<Value>, ApiError> {
    let headers = headers
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.as_str().to_ascii_lowercase(), value.to_owned()))
        })
        .collect();
    let disposition = state
        .service
        .ingest_webhook(provider, binding_id, &headers, &body)
        .await?;
    let response = match disposition {
        IngressDisposition::Accepted { targets } => {
            serde_json::json!({"accepted": true, "duplicate": false, "targets": targets})
        }
        IngressDisposition::Duplicate { targets } => {
            serde_json::json!({"accepted": true, "duplicate": true, "targets": targets})
        }
        IngressDisposition::Challenge(challenge) => serde_json::json!({"challenge": challenge}),
    };
    Ok(Json(response))
}

pub async fn serve(
    listener: tokio::net::TcpListener,
    service: Arc<dyn IntegrationService>,
    shutdown: tokio_util::sync::CancellationToken,
) -> std::io::Result<()> {
    axum::serve(listener, router(service))
        .with_graceful_shutdown(shutdown.cancelled_owned())
        .await
}

async fn live() -> impl IntoApiResponse {
    Json(HealthResponse {
        status: "ok".to_owned(),
    })
}

async fn openapi(Extension(document): Extension<Arc<OpenApi>>) -> impl IntoResponse {
    Json((*document).clone())
}

async fn submit_run(
    State(state): State<ApiState>,
    Path((web_id, connector_id)): Path<(String, String)>,
    headers: RequestHeaders,
    Json(request): Json<SubmitRunRequest>,
) -> Result<(StatusCode, Json<SubmitRunResponse>), ApiError> {
    let context = request_context(web_id, &headers.0)?;
    let request_id = context.request_id.clone();
    let outcome = state
        .service
        .submit(
            context,
            SubmitIntegration {
                connector_id: Some(connector_id),
                source: Source::Definition(request.definition),
                invocation: InvocationV1 {
                    links_only: request.invocation.links_only,
                    replay: request.invocation.replay,
                },
                trigger: SubmissionTriggerV1::Api { request_id },
                trace_context: Map::new(),
            },
        )
        .await?;
    let status = if outcome.created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(outcome.into())))
}

async fn run_status(
    State(state): State<ApiState>,
    Path((web_id, connector_id, run_id)): Path<(String, String, String)>,
    headers: RequestHeaders,
) -> Result<Json<RunStatusResponse>, ApiError> {
    let context = request_context(web_id, &headers.0)?;
    state
        .service
        .status(context, Some(&connector_id), &run_id)
        .await
        .map(RunStatusResponse::from)
        .map(Json)
        .map_err(ApiError::from)
}

async fn cancel_run(
    State(state): State<ApiState>,
    Path((web_id, connector_id, run_id)): Path<(String, String, String)>,
    headers: RequestHeaders,
) -> Result<(StatusCode, Json<CancelRunResponse>), ApiError> {
    let context = request_context(web_id, &headers.0)?;
    let response = state
        .service
        .cancel(context, Some(&connector_id), &run_id)
        .await?;
    Ok((StatusCode::ACCEPTED, Json(response.into())))
}

fn request_context(web_id: String, headers: &HeaderMap) -> Result<RequestContext, ApiError> {
    let actor_id = required_header(headers, ACTOR_HEADER)?;
    if actor_id.len() > 256 {
        return Err(ApiError::invalid(
            "x-hash-actor-id must not exceed 256 bytes",
        ));
    }
    let request_id = headers
        .get(REQUEST_ID_HEADER)
        .map(|value| {
            value
                .to_str()
                .map(str::trim)
                .map(str::to_owned)
                .map_err(|_error| ApiError::invalid("x-request-id must be valid ASCII"))
        })
        .transpose()?
        .filter(|value| !value.is_empty());
    Ok(RequestContext {
        web_id,
        actor_id: Some(actor_id),
        request_id,
    })
}

fn required_header(headers: &HeaderMap, name: &'static str) -> Result<String, ApiError> {
    let value = headers
        .get(name)
        .ok_or_else(|| ApiError::invalid(format!("{name} is required")))?
        .to_str()
        .map_err(|_error| ApiError::invalid(format!("{name} must be valid ASCII")))?
        .trim();
    if value.is_empty() {
        return Err(ApiError::invalid(format!("{name} must not be empty")));
    }
    Ok(value.to_owned())
}

impl From<CommandSubmission> for SubmitRunResponse {
    fn from(value: CommandSubmission) -> Self {
        Self {
            run_id: value.run_id.to_string(),
            initial_revision: value.initial_revision.to_string(),
            created: value.created,
        }
    }
}

impl From<CommandRunStatus> for RunStatusResponse {
    fn from(value: CommandRunStatus) -> Self {
        Self {
            run_id: value.run_id.to_string(),
            integration_id: value.integration_id.to_string(),
            state: value.state.to_string(),
            attempt: value.attempt,
            attempt_id: value.attempt_id.map(|id| id.to_string()),
            active_work_id: value.active_work_id.map(|id| id.to_string()),
            effect_count: value.effect_count,
            completed_effect_count: value.completed_effect_count,
            revision: value.revision.to_string(),
            result: value
                .result
                .map(|result| serde_json::to_value(result).expect("blob reference serializes")),
            failure: value
                .failure
                .map(|failure| serde_json::to_value(failure).expect("failure serializes")),
        }
    }
}

impl From<PublishedCancellation> for CancelRunResponse {
    fn from(value: PublishedCancellation) -> Self {
        Self {
            run_id: value.run_id.to_string(),
            request_id: value.request_id.to_string(),
            expected_revision: value.expected_revision.to_string(),
        }
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use std::sync::Mutex;

    use async_trait::async_trait;
    use axum::body::{to_bytes, Body};
    use axum::http::Request;
    use tower::ServiceExt as _;

    use super::*;
    use crate::orchestrator::ids::{EventId, RunId};
    use crate::orchestrator::managed::{InMemorySecretStore, ManagedStore};

    #[derive(Default)]
    struct FakeService {
        submissions: Mutex<Vec<(RequestContext, Option<String>)>>,
    }

    #[async_trait]
    impl IntegrationService for FakeService {
        async fn submit(
            &self,
            context: RequestContext,
            command: SubmitIntegration,
        ) -> Result<CommandSubmission, ApplicationError> {
            self.submissions
                .lock()
                .unwrap()
                .push((context, command.connector_id));
            Ok(CommandSubmission {
                run_id: RunId::parse("00000000-0000-4000-8000-000000000001").unwrap(),
                initial_revision: EventId::parse("a".repeat(64)).unwrap(),
                created: true,
            })
        }

        async fn status(
            &self,
            _context: RequestContext,
            _connector_id: Option<&str>,
            _run_id: &str,
        ) -> Result<CommandRunStatus, ApplicationError> {
            Err(ApplicationError::invalid("not used"))
        }

        async fn cancel(
            &self,
            _context: RequestContext,
            _connector_id: Option<&str>,
            _run_id: &str,
        ) -> Result<PublishedCancellation, ApplicationError> {
            Err(ApplicationError::invalid("not used"))
        }
    }

    struct ManagedTestService {
        store: ManagedStore,
    }

    fn managed_error(error: crate::orchestrator::managed::ManagedError) -> ApplicationError {
        ApplicationError::invalid(error.to_string())
    }

    #[async_trait]
    impl IntegrationService for ManagedTestService {
        async fn submit(
            &self,
            _context: RequestContext,
            _command: SubmitIntegration,
        ) -> Result<CommandSubmission, ApplicationError> {
            Err(ApplicationError::invalid("not used"))
        }

        async fn status(
            &self,
            _context: RequestContext,
            _connector_id: Option<&str>,
            _run_id: &str,
        ) -> Result<CommandRunStatus, ApplicationError> {
            Err(ApplicationError::invalid("not used"))
        }

        async fn cancel(
            &self,
            _context: RequestContext,
            _connector_id: Option<&str>,
            _run_id: &str,
        ) -> Result<PublishedCancellation, ApplicationError> {
            Err(ApplicationError::invalid("not used"))
        }

        async fn put_managed(
            &self,
            context: RequestContext,
            connector_id: &str,
            definition: Value,
            expected_revision: Option<&str>,
            replaces_connector_id: Option<String>,
        ) -> Result<crate::orchestrator::managed::ManagedDefinition, ApplicationError> {
            self.store
                .put_definition(
                    &context.web_id,
                    connector_id,
                    context.actor_id.as_deref().unwrap_or_default(),
                    definition,
                    expected_revision,
                    replaces_connector_id,
                )
                .await
                .map_err(managed_error)
        }

        async fn get_managed(
            &self,
            context: RequestContext,
            connector_id: &str,
        ) -> Result<crate::orchestrator::managed::ManagedDefinition, ApplicationError> {
            self.store
                .get_definition(&context.web_id, connector_id)
                .await
                .map_err(managed_error)
        }

        async fn set_managed_desired_state(
            &self,
            context: RequestContext,
            connector_id: &str,
            desired: ManagedDesiredState,
            expected_revision: &str,
        ) -> Result<crate::orchestrator::managed::ManagedDefinition, ApplicationError> {
            self.store
                .set_desired_state(&context.web_id, connector_id, desired, expected_revision)
                .await
                .map_err(managed_error)
        }

        async fn bind_managed(
            &self,
            _context: RequestContext,
            binding: ProviderBinding,
            secret: Option<crate::secret::Secret<Vec<u8>>>,
        ) -> Result<(), ApplicationError> {
            self.store
                .bind(binding, secret)
                .await
                .map_err(managed_error)
        }

        async fn ingest_webhook(
            &self,
            provider: WebhookProvider,
            binding_id: Option<&str>,
            headers: &BTreeMap<String, String>,
            body: &[u8],
        ) -> Result<IngressDisposition, ApplicationError> {
            self.store
                .accept(provider, binding_id, headers, body, 1_700_000_000)
                .await
                .map_err(managed_error)
        }
    }

    #[tokio::test]
    async fn submit_forwards_explicit_context_and_returns_transport_dto() {
        let service = Arc::new(FakeService::default());
        let app = router(service.clone());
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/webs/alice/integrations/sap/runs")
                    .header(ACTOR_HEADER, "actor:alice")
                    .header(REQUEST_ID_HEADER, "request-17")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"definition":{"kind":"integration"},"invocation":{"linksOnly":true}}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(
            body.get("runId").and_then(Value::as_str),
            Some("00000000-0000-4000-8000-000000000001")
        );
        let submissions = service.submissions.lock().unwrap();
        let (context, connector) = submissions.first().unwrap();
        assert_eq!(context.web_id, "alice");
        assert_eq!(context.actor_id.as_deref(), Some("actor:alice"));
        assert_eq!(context.request_id.as_deref(), Some("request-17"));
        assert_eq!(connector.as_deref(), Some("sap"));
    }

    #[tokio::test]
    async fn body_is_strict_and_openapi_describes_the_public_routes() {
        let app = router(Arc::new(FakeService::default()));
        let invalid = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/webs/alice/integrations/sap/runs")
                    .header(ACTOR_HEADER, "actor:alice")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"definition":{},"unexpectedEngineMetadata":"no"}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(invalid.status(), StatusCode::UNPROCESSABLE_ENTITY);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/openapi.json")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let document: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(
            document.pointer("/info/title").and_then(Value::as_str),
            Some("HASH Integrations API")
        );
        let submit_operation = document
            .pointer("/paths/~1v1~1webs~1{web_id}~1integrations~1{connector_id}~1runs/post")
            .unwrap();
        assert!(submit_operation.to_string().contains(ACTOR_HEADER));
    }

    #[tokio::test]
    async fn managed_http_journey_accepts_one_real_signed_github_delivery() {
        let cache = tempfile::tempdir().expect("cache");
        let blobs = crate::blob::ArtifactStore::in_memory(cache.path()).expect("blob store");
        let store = ManagedStore::new(blobs, Arc::new(InMemorySecretStore::default()));
        let service = Arc::new(ManagedTestService {
            store: store.clone(),
        });
        let app = router(service);
        let definition = serde_json::json!({
            "connector": {
                "id": "events",
                "mode": "webhook",
                "provider": "github",
                "subscriptions": ["issues"]
            },
            "sources": {"events": {"kind": "table", "primaryKey": "delivery"}},
            "pipelines": {"entities": [{
                "source": "events",
                "steps": [{
                    "id": "sink", "kind": "graph-sink", "config": {
                        "entityType": "issue/v/1", "entityId": "payload.id",
                        "webId": "alice", "properties": {}
                    }
                }]
            }]}
        });

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/v1/webs/alice/integrations/events")
                    .header(ACTOR_HEADER, "actor:alice")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({"definition": definition}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let created: Value = serde_json::from_slice(&bytes).unwrap();
        let revision = created["revision"].as_str().expect("definition revision");

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri("/v1/webs/alice/integrations/events/desired-state")
                    .header(ACTOR_HEADER, "actor:alice")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "desiredState": "enabled",
                            "expectedRevision": revision
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/webs/alice/integrations/events/bindings")
                    .header(ACTOR_HEADER, "actor:alice")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "bindingId": "github-7",
                            "provider": "github",
                            "externalId": "7",
                            "secretBackend": "memory",
                            "secretPath": "github/7",
                            "secret": "secret"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let body = br#"{"installation":{"id":7},"action":"opened"}"#;
        let signature = hex::encode(crate::orchestrator::managed::hmac_sha256(b"secret", body));
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/hooks/github")
                    .header("content-type", "application/json")
                    .header("x-github-delivery", "delivery-1")
                    .header("x-github-event", "issues")
                    .header("x-hub-signature-256", format!("sha256={signature}"))
                    .body(Body::from(body.as_slice()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let accepted: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(accepted["accepted"], Value::Bool(true));

        let pending = store
            .pending_events("alice", "events")
            .await
            .expect("durable accepted event");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].receipt.owner_actor, "actor:alice");
        assert_eq!(pending[0].receipt.definition_revision, revision);
    }
}
