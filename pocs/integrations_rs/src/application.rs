//! Framework-independent application commands shared by HTTP and the local
//! CLI. Durable orchestration remains below this boundary; transports supply
//! authenticated request context and translate results into their own DTOs.

use std::collections::BTreeMap;
use std::fmt;

use async_trait::async_trait;
use serde_json::{Map, Value};

use crate::config::Env;
use crate::orchestrator::managed::{
    IngressDisposition, ManagedDefinition, ManagedDesiredState, ManagedError, ManagedStore,
    ProviderBinding, WebhookProvider,
};
use crate::orchestrator::{
    self, CommandRunStatus, CommandSubmission, CommandSurface, CommandSurfaceError, InvocationV1,
    PublishedCancellation, SubmissionTriggerV1, TaskMetadata,
};
use crate::yaml::Source;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestContext {
    pub web_id: String,
    pub actor_id: Option<String>,
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

    fn from_command(report: error_stack::Report<CommandSurfaceError>) -> Self {
        let context = *report.current_context();
        let kind = match context {
            CommandSurfaceError::InvalidRunId
            | CommandSurfaceError::InvalidSubmission
            | CommandSurfaceError::InvalidControlRequest => ApplicationErrorKind::InvalidRequest,
            CommandSurfaceError::RunNotFound => ApplicationErrorKind::NotFound,
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
        run_id: &str,
    ) -> Result<CommandRunStatus, ApplicationError>;

    async fn cancel(
        &self,
        context: RequestContext,
        connector_id: Option<&str>,
        run_id: &str,
    ) -> Result<PublishedCancellation, ApplicationError>;

    async fn put_managed(
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

    async fn get_managed(
        &self,
        _context: RequestContext,
        _connector_id: &str,
    ) -> Result<ManagedDefinition, ApplicationError> {
        Err(ApplicationError {
            kind: ApplicationErrorKind::Unavailable,
            message: "managed integrations are unavailable".to_owned(),
        })
    }

    async fn set_managed_desired_state(
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

    async fn bind_managed(
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

    fn surface(&self, context: &RequestContext) -> Result<CommandSurface, ApplicationError> {
        if let Some(configured_web) = self
            .env
            .get("HASH_WEB_ID")
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if configured_web != context.web_id {
                return Err(ApplicationError::invalid(
                    "request web does not match this node's configured web",
                ));
            }
        }
        CommandSurface::open_for(&self.env, &context.web_id, context.actor_id.as_deref())
            .map_err(ApplicationError::from_command)
    }

    fn managed(&self) -> Result<ManagedStore, ApplicationError> {
        let blobs = crate::blob::ArtifactStore::from_url(
            &crate::config::blob_store_url(&self.env),
            crate::config::blob_cache_dir(&self.env),
        )
        .map_err(|error| ApplicationError {
            kind: ApplicationErrorKind::Unavailable,
            message: format!("open managed integration storage failed: {error:?}"),
        })?;
        Ok(ManagedStore::new(
            blobs,
            std::sync::Arc::new(crate::orchestrator::managed::UnavailableVaultSecretStore),
        ))
    }
}

#[async_trait]
impl IntegrationService for DurableIntegrationService {
    async fn submit(
        &self,
        context: RequestContext,
        command: SubmitIntegration,
    ) -> Result<CommandSubmission, ApplicationError> {
        if context
            .actor_id
            .as_deref()
            .is_none_or(|actor_id| actor_id.trim().is_empty())
        {
            return Err(ApplicationError::invalid(
                "an authenticated owner actor is required",
            ));
        }
        let prepared = orchestrator::prepare_task_for_web(
            &command.source,
            command.invocation,
            command.trigger,
            command.trace_context,
            &context.web_id,
            &self.env,
        )
        .map_err(|report| {
            tracing::info!(error = ?report, "integration submission rejected");
            ApplicationError::invalid("integration definition is invalid")
        })?;
        let prepared_connector = match &prepared.metadata {
            TaskMetadata::V1(metadata) => &metadata.connector_id,
        };
        if let Some(connector_id) = command.connector_id {
            if prepared_connector != &connector_id {
                return Err(ApplicationError::invalid(
                    "route connector does not match the integration definition",
                ));
            }
        }
        self.surface(&context)?
            .submit(prepared)
            .await
            .map_err(ApplicationError::from_command)
    }

    async fn status(
        &self,
        context: RequestContext,
        connector_id: Option<&str>,
        run_id: &str,
    ) -> Result<CommandRunStatus, ApplicationError> {
        let status = self
            .surface(&context)?
            .status(run_id)
            .await
            .map_err(ApplicationError::from_command)?;
        if let Some(connector_id) = connector_id {
            require_matching_integration(&context.web_id, connector_id, &status.integration_id)?;
        }
        Ok(status)
    }

    async fn cancel(
        &self,
        context: RequestContext,
        connector_id: Option<&str>,
        run_id: &str,
    ) -> Result<PublishedCancellation, ApplicationError> {
        let surface = self.surface(&context)?;
        let status = surface
            .status(run_id)
            .await
            .map_err(ApplicationError::from_command)?;
        if let Some(connector_id) = connector_id {
            require_matching_integration(&context.web_id, connector_id, &status.integration_id)?;
        }
        surface
            .cancel(run_id)
            .await
            .map_err(ApplicationError::from_command)
    }

    async fn put_managed(
        &self,
        context: RequestContext,
        connector_id: &str,
        definition: Value,
        expected_revision: Option<&str>,
        replaces_connector_id: Option<String>,
    ) -> Result<ManagedDefinition, ApplicationError> {
        let actor = context
            .actor_id
            .as_deref()
            .ok_or_else(|| ApplicationError::invalid("an authenticated owner actor is required"))?;
        self.managed()?
            .put_definition(
                &context.web_id,
                connector_id,
                actor,
                definition,
                expected_revision,
                replaces_connector_id,
            )
            .await
            .map_err(ApplicationError::from_managed)
    }

    async fn get_managed(
        &self,
        context: RequestContext,
        connector_id: &str,
    ) -> Result<ManagedDefinition, ApplicationError> {
        self.managed()?
            .get_definition(&context.web_id, connector_id)
            .await
            .map_err(ApplicationError::from_managed)
    }

    async fn set_managed_desired_state(
        &self,
        context: RequestContext,
        connector_id: &str,
        desired: ManagedDesiredState,
        expected_revision: &str,
    ) -> Result<ManagedDefinition, ApplicationError> {
        self.managed()?
            .set_desired_state(&context.web_id, connector_id, desired, expected_revision)
            .await
            .map_err(ApplicationError::from_managed)
    }

    async fn bind_managed(
        &self,
        context: RequestContext,
        binding: ProviderBinding,
        secret: Option<crate::secret::Secret<Vec<u8>>>,
    ) -> Result<(), ApplicationError> {
        if binding.web_id != context.web_id {
            return Err(ApplicationError::invalid(
                "binding web does not match route",
            ));
        }
        self.managed()?
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
        self.managed()?
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
