//! Framework-independent application commands shared by HTTP and the local
//! CLI. Durable orchestration remains below this boundary; transports supply
//! authenticated request context and translate results into their own DTOs.

use std::collections::BTreeMap;
use std::fmt;

use async_trait::async_trait;
use serde_json::{Map, Value};

use crate::config::Env;
use crate::orchestrator::ids::{ActorId, RunId, TenantNamespace};
use crate::orchestrator::managed::{
    IngressDisposition, ManagedDefinition, ManagedDesiredState, ManagedError, ManagedStore,
    ProviderBinding, WebhookProvider,
};
use crate::orchestrator::{
    self, CommandRunStatus, CommandSubmission, InvocationV1, OperatorCommandError,
    OperatorCommands, PublishedCancellation, SubmissionTriggerV1, ValidatedSubmission,
};
use crate::yaml::Source;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestContext {
    pub web_id: TenantNamespace,
    pub actor_id: Option<ActorId>,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SubmitIntegration {
    pub connector_id: Option<String>,
    pub source: Source,
    pub invocation: InvocationV1,
    pub trigger: SubmissionTriggerV1,
    pub trace_context: Map<String, Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplicationErrorKind {
    InvalidRequest,
    NotFound,
    Conflict,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplicationError {
    pub kind: ApplicationErrorKind,
    pub message: String,
}

impl ApplicationError {
    pub fn invalid(message: impl Into<String>) -> Self {
        Self {
            kind: ApplicationErrorKind::InvalidRequest,
            message: message.into(),
        }
    }

    fn from_managed(error: ManagedError) -> Self {
        let kind = match error {
            ManagedError::Invalid(_)
            | ManagedError::IdentityBreaking { .. }
            | ManagedError::Signature
            | ManagedError::Replay
            | ManagedError::DeliveryCollision
            | ManagedError::Disabled => ApplicationErrorKind::InvalidRequest,
            ManagedError::NotFound => ApplicationErrorKind::NotFound,
            ManagedError::Conflict { .. } => ApplicationErrorKind::Conflict,
            ManagedError::BacklogFull
            | ManagedError::SecretUnavailable
            | ManagedError::Storage(_) => ApplicationErrorKind::Unavailable,
        };
        Self {
            kind,
            message: error.to_string(),
        }
    }

    fn from_command(report: error_stack::Report<OperatorCommandError>) -> Self {
        let context = *report.current_context();
        let kind = match context {
            OperatorCommandError::InvalidRunId
            | OperatorCommandError::InvalidSubmission
            | OperatorCommandError::InvalidControlRequest => ApplicationErrorKind::InvalidRequest,
            OperatorCommandError::RunNotFound => ApplicationErrorKind::NotFound,
            _ => ApplicationErrorKind::Unavailable,
        };
        tracing::warn!(error = ?report, "durable application command failed");
        Self {
            kind,
            message: context.to_string(),
        }
    }
}

impl fmt::Display for ApplicationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ApplicationError {}

#[async_trait]
pub trait IntegrationService: Send + Sync {
    async fn submit(
        &self,
        context: RequestContext,
        command: SubmitIntegration,
    ) -> Result<CommandSubmission, ApplicationError>;

    async fn status(
        &self,
        context: RequestContext,
        connector_id: Option<&str>,
        run_id: &RunId,
    ) -> Result<CommandRunStatus, ApplicationError>;

    async fn cancel(
        &self,
        context: RequestContext,
        connector_id: Option<&str>,
        run_id: &RunId,
    ) -> Result<PublishedCancellation, ApplicationError>;

    async fn put_definition(
        &self,
        _context: RequestContext,
        _connector_id: &str,
        _definition: Value,
        _expected_revision: Option<&str>,
        _replaces_connector_id: Option<String>,
    ) -> Result<ManagedDefinition, ApplicationError> {
        Err(ApplicationError {
            kind: ApplicationErrorKind::Unavailable,
            message: "managed integrations are unavailable".to_owned(),
        })
    }

    async fn get_definition(
        &self,
        _context: RequestContext,
        _connector_id: &str,
    ) -> Result<ManagedDefinition, ApplicationError> {
        Err(ApplicationError {
            kind: ApplicationErrorKind::Unavailable,
            message: "managed integrations are unavailable".to_owned(),
        })
    }

    async fn set_definition_desired_state(
        &self,
        _context: RequestContext,
        _connector_id: &str,
        _desired: ManagedDesiredState,
        _expected_revision: &str,
    ) -> Result<ManagedDefinition, ApplicationError> {
        Err(ApplicationError {
            kind: ApplicationErrorKind::Unavailable,
            message: "managed integrations are unavailable".to_owned(),
        })
    }

    async fn bind_webhook_provider(
        &self,
        _context: RequestContext,
        _binding: ProviderBinding,
        _secret: Option<crate::secret::Secret<Vec<u8>>>,
    ) -> Result<(), ApplicationError> {
        Err(ApplicationError {
            kind: ApplicationErrorKind::Unavailable,
            message: "managed integrations are unavailable".to_owned(),
        })
    }

    async fn ingest_webhook(
        &self,
        _provider: WebhookProvider,
        _binding_id: Option<&str>,
        _headers: &BTreeMap<String, String>,
        _body: &[u8],
    ) -> Result<IngressDisposition, ApplicationError> {
        Err(ApplicationError {
            kind: ApplicationErrorKind::Unavailable,
            message: "webhook ingress is unavailable".to_owned(),
        })
    }
}

#[derive(Clone)]
pub struct DurableIntegrationService {
    env: Env,
}

impl DurableIntegrationService {
    pub fn new(env: Env) -> Self {
        Self { env }
    }

    fn open_operator_commands(
        &self,
        context: &RequestContext,
    ) -> Result<OperatorCommands, ApplicationError> {
        self.validate_node_web(context)?;
        OperatorCommands::open_for(&self.env, &context.web_id, context.actor_id.as_ref())
            .map_err(ApplicationError::from_command)
    }

    fn validate_node_web(&self, context: &RequestContext) -> Result<(), ApplicationError> {
        if let Some(configured_web) = self
            .env
            .get("HASH_WEB_ID")
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if configured_web != context.web_id.as_str() {
                return Err(ApplicationError::invalid(
                    "request web does not match this node's configured web",
                ));
            }
        }
        Ok(())
    }

    fn open_definition_store(&self) -> Result<ManagedStore, ApplicationError> {
        let blobs = crate::blob::ArtifactStore::from_url(
            &crate::config::blob_store_url(&self.env),
            crate::config::blob_cache_dir(&self.env),
        )
        .map_err(|error| ApplicationError {
            kind: ApplicationErrorKind::Unavailable,
            message: format!("open managed integration storage failed: {error:?}"),
        })?;
        let secrets: std::sync::Arc<dyn crate::orchestrator::managed::SecretStore> =
            match crate::orchestrator::hash_graph_vault::HashGraphVaultSecretStore::from_env(
                &self.env,
            )
            .map_err(|message| ApplicationError {
                kind: ApplicationErrorKind::Unavailable,
                message,
            })? {
                Some(store) => std::sync::Arc::new(store),
                None => {
                    std::sync::Arc::new(crate::orchestrator::managed::UnavailableVaultSecretStore)
                }
            };
        Ok(ManagedStore::new(blobs, secrets))
    }
}

impl DurableIntegrationService {
    fn validate_submission(
        &self,
        context: &RequestContext,
        command: SubmitIntegration,
    ) -> Result<ValidatedSubmission, ApplicationError> {
        self.validate_node_web(context)?;
        if context.actor_id.is_none() {
            return Err(ApplicationError::invalid(
                "an authenticated owner actor is required",
            ));
        }
        let prepared = orchestrator::prepare_task_for_web(
            &command.source,
            command.invocation,
            command.trigger,
            command.trace_context,
            context.web_id.as_str(),
            &self.env,
        )
        .map_err(|report| {
            tracing::info!(error = ?report, "integration submission rejected");
            ApplicationError::invalid("integration definition is invalid")
        })?;
        if let Some(connector_id) = command.connector_id {
            if prepared.connector_id() != connector_id {
                return Err(ApplicationError::invalid(
                    "route connector does not match the integration definition",
                ));
            }
        }
        Ok(prepared)
    }
}

#[async_trait]
impl IntegrationService for DurableIntegrationService {
    async fn submit(
        &self,
        context: RequestContext,
        command: SubmitIntegration,
    ) -> Result<CommandSubmission, ApplicationError> {
        let prepared = self.validate_submission(&context, command)?;
        OperatorCommands::open_for(&self.env, &context.web_id, context.actor_id.as_ref())
            .map_err(ApplicationError::from_command)?
            .submit(prepared)
            .await
            .map_err(ApplicationError::from_command)
    }

    async fn status(
        &self,
        context: RequestContext,
        connector_id: Option<&str>,
        run_id: &RunId,
    ) -> Result<CommandRunStatus, ApplicationError> {
        let status = self
            .open_operator_commands(&context)?
            .status(run_id)
            .await
            .map_err(ApplicationError::from_command)?;
        if let Some(connector_id) = connector_id {
            require_matching_integration(
                context.web_id.as_str(),
                connector_id,
                &status.integration_id,
            )?;
        }
        Ok(status)
    }

    async fn cancel(
        &self,
        context: RequestContext,
        connector_id: Option<&str>,
        run_id: &RunId,
    ) -> Result<PublishedCancellation, ApplicationError> {
        let commands = self.open_operator_commands(&context)?;
        let status = commands
            .status(run_id)
            .await
            .map_err(ApplicationError::from_command)?;
        if let Some(connector_id) = connector_id {
            require_matching_integration(
                context.web_id.as_str(),
                connector_id,
                &status.integration_id,
            )?;
        }
        commands
            .cancel(run_id)
            .await
            .map_err(ApplicationError::from_command)
    }

    async fn put_definition(
        &self,
        context: RequestContext,
        connector_id: &str,
        definition: Value,
        expected_revision: Option<&str>,
        replaces_connector_id: Option<String>,
    ) -> Result<ManagedDefinition, ApplicationError> {
        let actor = context
            .actor_id
            .as_ref()
            .map(ActorId::as_str)
            .ok_or_else(|| ApplicationError::invalid("an authenticated owner actor is required"))?;
        self.open_definition_store()?
            .put_definition(
                context.web_id.as_str(),
                connector_id,
                actor,
                definition,
                expected_revision,
                replaces_connector_id,
            )
            .await
            .map_err(ApplicationError::from_managed)
    }

    async fn get_definition(
        &self,
        context: RequestContext,
        connector_id: &str,
    ) -> Result<ManagedDefinition, ApplicationError> {
        self.open_definition_store()?
            .get_definition(context.web_id.as_str(), connector_id)
            .await
            .map_err(ApplicationError::from_managed)
    }

    async fn set_definition_desired_state(
        &self,
        context: RequestContext,
        connector_id: &str,
        desired: ManagedDesiredState,
        expected_revision: &str,
    ) -> Result<ManagedDefinition, ApplicationError> {
        self.open_definition_store()?
            .set_desired_state(
                context.web_id.as_str(),
                connector_id,
                desired,
                expected_revision,
            )
            .await
            .map_err(ApplicationError::from_managed)
    }

    async fn bind_webhook_provider(
        &self,
        context: RequestContext,
        binding: ProviderBinding,
        secret: Option<crate::secret::Secret<Vec<u8>>>,
    ) -> Result<(), ApplicationError> {
        if binding.web_id != context.web_id.as_str() {
            return Err(ApplicationError::invalid(
                "binding web does not match route",
            ));
        }
        self.open_definition_store()?
            .bind(binding, secret)
            .await
            .map_err(ApplicationError::from_managed)
    }

    async fn ingest_webhook(
        &self,
        provider: WebhookProvider,
        binding_id: Option<&str>,
        headers: &BTreeMap<String, String>,
        body: &[u8],
    ) -> Result<IngressDisposition, ApplicationError> {
        self.open_definition_store()?
            .accept(
                provider,
                binding_id,
                headers,
                body,
                crate::orchestrator::managed::unix_now(),
            )
            .await
            .map_err(ApplicationError::from_managed)
    }
}

fn require_matching_integration(
    web_id: &str,
    connector_id: &str,
    actual: &crate::orchestrator::ids::CanonicalIntegrationId,
) -> Result<(), ApplicationError> {
    let expected = format!("{web_id}:{connector_id}");
    if actual.as_str() == expected {
        Ok(())
    } else {
        // Do not reveal that a run exists under another integration route.
        Err(ApplicationError {
            kind: ApplicationErrorKind::NotFound,
            message: "run was not found for this integration".to_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> (RequestContext, SubmitIntegration) {
        (
            RequestContext {
                web_id: TenantNamespace::parse("alice").expect("fixture web should be valid"),
                actor_id: Some(
                    ActorId::parse("actor:alice").expect("fixture actor should be valid"),
                ),
                request_id: None,
            },
            SubmitIntegration {
                connector_id: Some("orders".to_owned()),
                source: Source::Definition(serde_json::json!({
                    "connector": {"id": "orders", "mode": "batch"},
                    "sources": {},
                    "pipelines": {"entities": []}
                })),
                invocation: InvocationV1::default(),
                trigger: SubmissionTriggerV1::Manual,
                trace_context: Map::new(),
            },
        )
    }

    #[test]
    fn validation_produces_a_submission_without_opening_storage() {
        let service =
            DurableIntegrationService::new(Env::from_map(std::collections::HashMap::from([(
                "INTEGRATIONS_BLOB_URL".to_owned(),
                "unsupported://storage".to_owned(),
            )])));
        let (context, command) = request();
        let validated = service
            .validate_submission(&context, command)
            .expect("valid request should pass submission validation");
        assert_eq!(validated.connector_id(), "orders");
    }

    #[tokio::test]
    async fn invalid_requests_fail_before_opening_storage() {
        let service =
            DurableIntegrationService::new(Env::from_map(std::collections::HashMap::from([
                ("HASH_WEB_ID".to_owned(), "alice".to_owned()),
                (
                    "INTEGRATIONS_BLOB_URL".to_owned(),
                    "unsupported://storage".to_owned(),
                ),
            ])));
        for case in 0..6 {
            let (mut context, mut command) = request();
            match case {
                0 => context.actor_id = None,
                1 => {
                    context.web_id =
                        TenantNamespace::parse("bob").expect("fixture web should be valid");
                }
                2 => command.connector_id = Some("other".to_owned()),
                3 => {
                    command.invocation.replay.insert("orders".to_owned(), None);
                }
                4 => command.source = Source::Definition(Value::Null),
                5 => {
                    command.source = Source::Definition(serde_json::json!({
                        "connector": {"id": "orders", "mode": "stream"},
                        "sources": {}, "pipelines": {"entities": []}
                    }));
                }
                _ => unreachable!(),
            }
            let error = service
                .submit(context, command)
                .await
                .expect_err("invalid request should fail before storage is opened");
            assert_eq!(
                error.kind,
                ApplicationErrorKind::InvalidRequest,
                "case {case} should fail validation"
            );
        }
    }
}
