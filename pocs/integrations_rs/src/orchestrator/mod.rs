//! Transport-neutral durable execution with a blob-backed OpenData control plane.
//! Pipeline definitions remain domain data; task identity, retry policy and
//! tracing live in the versioned internal envelope defined here. The runner
//! depends only on opaque IDs, durable JSON checkpoints, and claim fencing.

pub(crate) mod activation;
pub mod baseline;
mod command_surface;
#[cfg(test)]
mod conformance;
pub mod control;
pub mod events;
pub mod gc;
pub mod ids;
mod inbox;
mod internal_metadata;
pub(crate) mod lease;
mod memory_adapter;
mod metadata;
#[cfg(test)]
mod phase2_adapter;
pub(crate) mod planning;
mod port;
pub mod projection;
pub(crate) mod projection_snapshot;
mod projection_types;
pub(crate) mod record_io;
pub mod registry;
pub mod routing;
pub(crate) mod run_artifacts;
pub(crate) mod run_input;
pub mod runner;
pub(crate) mod shard;
pub(crate) mod shard_log;
pub(crate) mod state;
mod submission;
pub mod work;
pub(crate) mod worker_dispatch;

pub use command_surface::{
    CommandRunState, CommandRunStatus, CommandSubmission, CommandSurface, CommandSurfaceError,
    PublishedCancellation,
};
pub use memory_adapter::InMemoryOrchestrator;
pub use metadata::{
    prepare_task, prepare_task_for_web, CurrentTaskMetadata, CurrentTaskPayload, InvocationV1,
    PreparedTask, SubmissionTriggerV1, TaskMetadata, TaskMetadataV1, TaskPayload, TaskPayloadV1,
};
pub use port::{
    CheckpointCommand, CheckpointName, CheckpointValue, ControlCommand, ControlCommandKind,
    ControlCommands, ExecutionContext, ExecutionError, IntegrationDefinition, Orchestrator,
    OrchestratorError, OrchestratorErrorKind, RequestHandle, RequestOutcome, RunHandler, RunInput,
    RunOutput, RunPolicy, RunQuery, RunState, RunStatus, RunSubmission, RunVariables,
    SharedExecutionContext, SharedRunHandler, SubmitOutcome, SubmitRun, WorkerHost,
};
pub use submission::{
    admitted_run_record, delete_ready_receipt, discover_known_shards, discover_ready_receipts,
    submit_durable, AdmissionPointer, AdmissionPointerV1, DiscoveredReadyReceipt, KnownShardMarker,
    KnownShardMarkerV1, ReadyReceipt, ReadyReceiptV1, SubmitOutcome as DurableSubmitOutcome,
};

use std::fmt;

/// Context for database, envelope or durable-worker failures.
#[derive(Debug)]
pub struct DurableError;

impl fmt::Display for DurableError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("durable integration runner failed")
    }
}

impl std::error::Error for DurableError {}
