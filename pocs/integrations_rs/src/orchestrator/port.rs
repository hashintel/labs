//! Backend-neutral orchestration capabilities.
//!
//! This module is limited to integration-domain values. Object
//! keys, stream names, leases, writer epochs, and storage SDK types belong in
//! adapters, never in these signatures.

use std::collections::BTreeMap;
use std::fmt;
use std::num::{NonZeroU32, NonZeroU64};
use std::sync::Arc;

use async_trait::async_trait;
use tokio_util::sync::CancellationToken;

use super::control::IntegrationDesiredState;
use super::events::{ControlRejectionReason, FailureSummary};
use super::ids::{AttemptId, CanonicalIntegrationId, EventId, RequestId, RunId, WorkId};

const MAX_CHECKPOINT_NAME_BYTES: usize = 512;
const MAX_MEDIA_TYPE_BYTES: usize = 255;
const MAX_CONTROL_PAYLOAD_BYTES: usize = 1024 * 1024;

/// Immutable unresolved pipeline definition. Environment placeholders may be
/// present; resolved secret values must not be submitted through this port.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntegrationDefinition(String);

impl IntegrationDefinition {
    pub fn parse(value: impl Into<String>) -> Result<Self, OrchestratorError> {
        let value = value.into();
        if value.trim().is_empty() || value.len() > MAX_CONTROL_PAYLOAD_BYTES {
            return Err(OrchestratorError::invalid(format!(
                "integration definition must be 1..={MAX_CONTROL_PAYLOAD_BYTES} UTF-8 bytes"
            )));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// An admitted integration definition and its non-secret invocation values.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunInput {
    pub definition: IntegrationDefinition,
    pub public_variables: RunVariables,
}

/// Bounded, explicitly non-secret invocation variables.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RunVariables(BTreeMap<String, String>);

impl RunVariables {
    pub fn new(values: BTreeMap<String, String>) -> Result<Self, OrchestratorError> {
        let encoded = serde_json::to_vec(&values).map_err(|error| {
            OrchestratorError::invalid(format!("invalid run variables: {error}"))
        })?;
        validate_control_payload("run variables", encoded.len())?;
        Ok(Self(values))
    }

    pub fn as_map(&self) -> &BTreeMap<String, String> {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunPolicy {
    /// Handler-reported retryable failures. Worker/process loss does not consume
    /// this budget because no durable business failure was observed.
    pub max_handler_failures: NonZeroU32,
}

impl Default for RunPolicy {
    fn default() -> Self {
        Self {
            max_handler_failures: NonZeroU32::MIN.saturating_add(4),
        }
    }
}

/// `run_id` is proposed by the caller before submission, making a retry after a
/// lost response the same request. Admission may attach to another winning run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubmitRun {
    pub run_id: RunId,
    pub integration_id: CanonicalIntegrationId,
    pub input: RunInput,
    pub policy: RunPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubmitOutcome {
    pub run_id: RunId,
    pub initial_revision: EventId,
    pub created: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunState {
    Accepted,
    Running,
    Completed,
    Terminated,
}

impl RunState {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Terminated)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunOutput {
    media_type: String,
    bytes: Vec<u8>,
}

impl RunOutput {
    pub fn new(
        media_type: impl Into<String>,
        bytes: impl Into<Vec<u8>>,
    ) -> Result<Self, OrchestratorError> {
        let media_type = media_type.into();
        validate_media_type(&media_type)?;
        let bytes = bytes.into();
        validate_control_payload("run output", bytes.len())?;
        Ok(Self { media_type, bytes })
    }

    pub fn media_type(&self) -> &str {
        &self.media_type
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunStatus {
    pub run_id: RunId,
    pub integration_id: CanonicalIntegrationId,
    pub state: RunState,
    pub attempt: u64,
    pub attempt_id: Option<AttemptId>,
    pub active_work_id: Option<WorkId>,
    pub revision: EventId,
    pub output: Option<RunOutput>,
    pub failure: Option<FailureSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ControlCommand {
    pub request_id: RequestId,
    pub integration_id: CanonicalIntegrationId,
    pub kind: ControlCommandKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ControlCommandKind {
    CancelRun {
        run_id: RunId,
        expected_revision: EventId,
    },
    RetryWork {
        work_id: WorkId,
        expected_revision: EventId,
        settings_revision: NonZeroU64,
    },
    SetDesiredState {
        desired: IntegrationDesiredState,
        definition: IntegrationDefinition,
        expected_revision: Option<EventId>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestHandle {
    pub request_id: RequestId,
    pub outcome: RequestOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RequestOutcome {
    Accepted {
        revision: EventId,
    },
    Rejected {
        reason: ControlRejectionReason,
        observed_revision: Option<EventId>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct CheckpointName(String);

impl CheckpointName {
    pub fn parse(value: impl Into<String>) -> Result<Self, OrchestratorError> {
        let value = value.into();
        if value.is_empty()
            || value.len() > MAX_CHECKPOINT_NAME_BYTES
            || value.chars().any(char::is_control)
        {
            return Err(OrchestratorError::invalid(format!(
                "checkpoint name must be 1..={MAX_CHECKPOINT_NAME_BYTES} UTF-8 bytes without control characters"
            )));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for CheckpointName {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckpointValue {
    media_type: String,
    bytes: Vec<u8>,
}

impl CheckpointValue {
    pub fn new(
        media_type: impl Into<String>,
        bytes: impl Into<Vec<u8>>,
    ) -> Result<Self, OrchestratorError> {
        let media_type = media_type.into();
        validate_media_type(&media_type)?;
        let bytes = bytes.into();
        validate_control_payload("checkpoint value", bytes.len())?;
        Ok(Self { media_type, bytes })
    }

    pub fn media_type(&self) -> &str {
        &self.media_type
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckpointCommand {
    pub name: CheckpointName,
    pub value: CheckpointValue,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutionError {
    Retryable(String),
    Permanent(String),
    Cancelled,
    StaleAttempt,
}

impl ExecutionError {
    pub fn retryable(message: impl Into<String>) -> Self {
        Self::Retryable(message.into())
    }

    pub fn permanent(message: impl Into<String>) -> Self {
        Self::Permanent(message.into())
    }
}

impl fmt::Display for ExecutionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Retryable(message) | Self::Permanent(message) => formatter.write_str(message),
            Self::Cancelled => formatter.write_str("execution cancelled"),
            Self::StaleAttempt => formatter.write_str("execution attempt is no longer current"),
        }
    }
}

impl std::error::Error for ExecutionError {}

/// Context for one at-least-once delivery.
///
/// `ensure_current` and checkpoint commits reject a stale attempt, but this is
/// cooperative ownership validation, not a fence for Graph HTTP effects.
#[async_trait]
pub trait ExecutionContext: Send + Sync {
    fn run_id(&self) -> RunId;
    fn attempt_id(&self) -> AttemptId;
    fn attempt(&self) -> u64;
    fn active_work_id(&self) -> Option<WorkId>;

    async fn load_checkpoint(
        &self,
        name: &CheckpointName,
    ) -> Result<Option<CheckpointValue>, ExecutionError>;
    async fn commit_checkpoint(&self, command: CheckpointCommand) -> Result<(), ExecutionError>;
    async fn ensure_current(&self) -> Result<(), ExecutionError>;
}

pub type SharedExecutionContext = Arc<dyn ExecutionContext>;

#[async_trait]
pub trait RunHandler: Send + Sync {
    async fn execute(
        &self,
        input: RunInput,
        context: SharedExecutionContext,
    ) -> Result<RunOutput, ExecutionError>;
}

pub type SharedRunHandler = Arc<dyn RunHandler>;

#[async_trait]
pub trait RunSubmission: Send + Sync {
    async fn submit_run(&self, request: SubmitRun) -> Result<SubmitOutcome, OrchestratorError>;
}

#[async_trait]
pub trait RunQuery: Send + Sync {
    async fn run_status(&self, run_id: &RunId) -> Result<Option<RunStatus>, OrchestratorError>;
}

#[async_trait]
pub trait ControlCommands: Send + Sync {
    async fn request(&self, command: ControlCommand) -> Result<RequestHandle, OrchestratorError>;
}

#[async_trait]
pub trait WorkerHost: Send + Sync {
    async fn run(
        &self,
        handler: SharedRunHandler,
        shutdown: CancellationToken,
    ) -> Result<(), OrchestratorError>;
}

pub trait Orchestrator:
    RunSubmission + RunQuery + ControlCommands + WorkerHost + Send + Sync
{
}

impl<T> Orchestrator for T where
    T: RunSubmission + RunQuery + ControlCommands + WorkerHost + Send + Sync
{
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrchestratorErrorKind {
    InvalidRequest,
    Conflict,
    Unavailable,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrchestratorError {
    pub kind: OrchestratorErrorKind,
    pub message: String,
}

impl OrchestratorError {
    pub fn invalid(message: impl Into<String>) -> Self {
        Self {
            kind: OrchestratorErrorKind::InvalidRequest,
            message: message.into(),
        }
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self {
            kind: OrchestratorErrorKind::Conflict,
            message: message.into(),
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            kind: OrchestratorErrorKind::Internal,
            message: message.into(),
        }
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self {
            kind: OrchestratorErrorKind::Unavailable,
            message: message.into(),
        }
    }
}

impl fmt::Display for OrchestratorError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for OrchestratorError {}

fn validate_media_type(value: &str) -> Result<(), OrchestratorError> {
    if value.is_empty()
        || value.len() > MAX_MEDIA_TYPE_BYTES
        || value.chars().any(char::is_control)
        || !value.contains('/')
    {
        Err(OrchestratorError::invalid(format!(
            "media type must be 1..={MAX_MEDIA_TYPE_BYTES} bytes, contain '/', and have no control characters"
        )))
    } else {
        Ok(())
    }
}

fn validate_control_payload(name: &str, size: usize) -> Result<(), OrchestratorError> {
    if size > MAX_CONTROL_PAYLOAD_BYTES {
        Err(OrchestratorError::invalid(format!(
            "{name} is {size} bytes; maximum is {MAX_CONTROL_PAYLOAD_BYTES}"
        )))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_object_safe(_: &dyn Orchestrator) {}

    #[allow(
        dead_code,
        reason = "compile-time signature assertion; invoking it would add no runtime coverage"
    )]
    fn capability_signatures_are_backend_neutral(
        submission: &dyn RunSubmission,
        query: &dyn RunQuery,
        controls: &dyn ControlCommands,
        worker: &dyn WorkerHost,
    ) {
        let _ = (submission, query, controls, worker);
    }

    #[test]
    fn validated_domain_values_reject_ambiguous_strings() {
        assert!(CheckpointName::parse("").is_err());
        assert!(CheckpointName::parse("line\nbreak").is_err());
        assert!(CheckpointValue::new("not-a-media-type", []).is_err());
        assert!(IntegrationDefinition::parse("  ").is_err());
        assert!(RunVariables::new(BTreeMap::from([(
            "large".to_owned(),
            "x".repeat(MAX_CONTROL_PAYLOAD_BYTES),
        )]))
        .is_err());
        assert!(CheckpointValue::new(
            "application/octet-stream",
            vec![0; MAX_CONTROL_PAYLOAD_BYTES + 1]
        )
        .is_err());
        let _ = assert_object_safe;
    }
}
