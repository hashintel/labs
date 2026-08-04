//! Framework-independent application commands shared by HTTP and the local
//! CLI. Durable orchestration remains below this boundary; transports supply
//! authenticated request context and translate results into their own DTOs.

use std::fmt;

use async_trait::async_trait;
use serde_json::{Map, Value};

use crate::config::Env;
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
