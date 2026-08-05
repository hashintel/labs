//! Serialized mutation path for one shard journal and its authoritative fold.
//!
//! Producers can submit typed records but cannot access the append-capable log
//! or clone the whole projection. Expensive planning and external effects stay
//! outside this loop and return as ordinary, potentially stale proposals.

use std::fmt;
use std::num::NonZeroUsize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use error_stack::{Report, ResultExt as _};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

use super::{AppendDisposition, ShardAppendError, ShardLogLocation, ShardLogWriter};
use crate::blob::ArtifactStore;
use crate::orchestrator::control::ControlRequestV1;
use crate::orchestrator::events::{
    ControlRejectionReason, FailureSummary, InputRef, JournalRecord, JournalRecordV1, PolicyRef,
    SequencedJournalRecord, WorkManifestRef,
};
use crate::orchestrator::ids::TenantNamespace;
use crate::orchestrator::ids::{AttemptId, CanonicalIntegrationId, EffectId, EventId, WorkId};
use crate::kernel::domain::{Domain, Prepared};
use crate::orchestrator::projection::{
    apply, ControlRequestOutcomeV1, InvalidTransition, PreparedTransition, Projection,
    ProjectionDelta, WorkStatus,
};
use crate::orchestrator::routing::Shard;
use crate::orchestrator::projection_snapshot::{
    self, ControlProjectionSnapshot, SnapshotCapture, SnapshotError,
};
use crate::orchestrator::state::StateCursor;
use crate::orchestrator::work::WorkKind;

#[cfg(test)]
use super::ShardLogRecovery;
#[cfg(test)]
use std::collections::VecDeque;
#[cfg(test)]
use tokio::sync::Notify;

const DEFAULT_CHANNEL_CAPACITY: usize = 64;
const DEFAULT_SAFE_APPEND_RETRIES: u32 = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ShardCommandOutcome {
    Applied {
        event_id: EventId,
        shard_sequence: u64,
    },
    AlreadyDurable {
        event_id: EventId,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ControlRequestSnapshot {
    pub(crate) outcome: Option<ControlRequestOutcomeV1>,
    pub(crate) target_exists: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ControlResolution {
    pub(crate) append: ShardCommandOutcome,
    pub(crate) outcome: ControlRequestOutcomeV1,
}

/// Bounded run view used by orchestration adapters. The command loop retains
/// the projection; callers receive only fields needed for one query or
/// delivery.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RunView {
    pub(crate) run_id: super::super::ids::RunId,
    pub(crate) integration_id: CanonicalIntegrationId,
    pub(crate) status: super::super::projection::RunStatus,
    pub(crate) attempt: u64,
    pub(crate) handler_failures: u32,
    pub(crate) attempt_id: Option<AttemptId>,
    pub(crate) immutable_input: InputRef,
    pub(crate) policy: PolicyRef,
    pub(crate) submitted_at: String,
    pub(crate) artifacts:
        std::collections::BTreeMap<crate::orchestrator::events::ArtifactRole, crate::blob::BlobRef>,
    pub(crate) steps: std::collections::BTreeMap<String, crate::blob::BlobRef>,
    pub(crate) result: Option<crate::blob::BlobRef>,
    pub(crate) failure: Option<FailureSummary>,
    pub(crate) revision: EventId,
    pub(crate) active_work_id: Option<WorkId>,
    /// A completed Apply whose run-level completion record is not durable yet.
    /// Recovery finalizes this exact immutable state artifact before planning
    /// any new attempt.
    pub(crate) completion_result: Option<crate::blob::BlobRef>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ShardCommandErrorKind {
    InvalidCandidate,
    DefinitelyNotCommitted,
    CommitUnknown,
    Fenced,
    Recovery,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ShardCommandError {
    pub(crate) kind: ShardCommandErrorKind,
    pub(crate) message: String,
}

impl fmt::Display for ShardCommandError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ShardCommandError {}

/// Durable work reconstructed before command admission or fresh planning is
/// enabled. `completed_effect_count` is the exclusive resume cursor: delivery
/// continues at that index, never from the beginning.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkRecoveryIntent {
    pub(crate) integration_id: CanonicalIntegrationId,
    pub(crate) work_id: WorkId,
    pub(crate) manifest: WorkManifestRef,
    pub(crate) kind: WorkKind,
    pub(crate) status: WorkStatus,
    pub(crate) effect_count: u64,
    pub(crate) completed_effect_count: u64,
    pub(crate) last_completed_effect: Option<EffectId>,
    pub(crate) failure: Option<FailureSummary>,
    pub(crate) settings_revision: Option<u64>,
    pub(crate) revision: EventId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct IntegrationDeliveryView {
    pub(crate) checkpoint_state: Option<crate::orchestrator::work::StateVersionRef>,
    pub(crate) applied_state: Option<crate::orchestrator::work::StateVersionRef>,
    pub(crate) applied_incarnation: Option<EventId>,
    pub(crate) foreground_work: Option<WorkId>,
    pub(crate) reconciliation_work: Option<WorkId>,
    pub(crate) reconciliation_cycle: u64,
    pub(crate) execution_eligible: bool,
    pub(crate) maintenance: super::super::projection::MaintenanceStatus,
    pub(crate) restore_evidence: Option<super::super::projection::RestoreEvidence>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StartupRecovery {
    pub(crate) durable_end_exclusive: u64,
    /// Inclusive sequence restored from a validated snapshot, or `None` when
    /// startup replayed the complete journal.
    pub(crate) snapshot_through_log_sequence: Option<u64>,
    pub(crate) live_work: Vec<WorkRecoveryIntent>,
}

/// Lossy, derived notifications for rebuilding non-authoritative state hints.
/// The initial set makes restart repair independent of whether a notification
/// was observed before the previous process stopped.
#[derive(Debug)]
pub(crate) struct StateChangeFeed {
    pub(crate) initial: Vec<CanonicalIntegrationId>,
    pub(crate) receiver: mpsc::Receiver<CanonicalIntegrationId>,
}

#[derive(Debug, Clone)]
pub(crate) struct ShardCommandHandle {
    sender: mpsc::Sender<Command>,
    accepting: Arc<AtomicBool>,
    ownership_lost: CancellationToken,
    shard: super::super::routing::Shard,
}

impl ShardCommandHandle {
    pub(crate) async fn propose(
        &self,
        record: JournalRecordV1,
    ) -> Result<ShardCommandOutcome, ShardCommandError> {
        if !self.accepting.load(Ordering::Acquire) {
            return Err(closed("shard command loop is not accepting proposals"));
        }
        let (reply, response) = oneshot::channel();
        self.sender
            .send(Command::Propose { record, reply })
            .await
            .map_err(|_send_error| closed("shard command loop closed before accepting proposal"))?;
        response.await.map_err(|_receive_error| {
            closed("shard command loop stopped before replying to proposal")
        })?
    }

    /// Captures the current pure projection inside the serialized loop,
    /// publishes it outside the loop, then records the immutable reference
    /// through the same sole writer. The projection itself never escapes.
    pub(crate) async fn publish_projection_snapshot(
        &self,
        store: &ArtifactStore,
        tenant: &TenantNamespace,
        created_at: chrono::DateTime<chrono::Utc>,
        minimum_sequence_span: u64,
    ) -> Result<Option<ControlProjectionSnapshot>, Report<SnapshotError>> {
        if !self.accepting.load(Ordering::Acquire) {
            return Err(Report::new(SnapshotError::CommitReference)
                .attach_printable("shard command loop is not accepting snapshot captures"));
        }
        let (reply, response) = oneshot::channel();
        self.sender
            .send(Command::CaptureSnapshot {
                minimum_sequence_span,
                reply,
            })
            .await
            .change_context(SnapshotError::CommitReference)
            .attach_printable("submit projection-snapshot capture")?;
        let Some(capture) = response
            .await
            .change_context(SnapshotError::CommitReference)
            .attach_printable("receive projection-snapshot capture")?
            .change_context(SnapshotError::CommitReference)?
        else {
            return Ok(None);
        };
        let snapshot_created_at = created_at;
        let snapshot =
            projection_snapshot::publish_capture(store, tenant, self.shard, capture, created_at)
                .await?;
        let (reply, response) = oneshot::channel();
        self.sender
            .send(Command::CommitSnapshot {
                snapshot: snapshot.clone(),
                reply,
            })
            .await
            .change_context(SnapshotError::CommitReference)
            .attach_printable("submit projection-snapshot reference")?;
        response
            .await
            .change_context(SnapshotError::CommitReference)
            .attach_printable("receive projection-snapshot commit")?
            .change_context(SnapshotError::CommitReference)?;
        store
            .telemetry()
            .record_snapshot_published(snapshot_created_at);
        Ok(Some(snapshot))
    }

    /// Returns only the bounded control-plane view needed by the inbox. The
    /// whole projection and append handle never escape the shard owner loop.
    pub(crate) async fn inspect_control(
        &self,
        request: ControlRequestV1,
    ) -> Result<ControlRequestSnapshot, ShardCommandError> {
        if !self.accepting.load(Ordering::Acquire) {
            return Err(closed("shard command loop is not accepting control reads"));
        }
        let (reply, response) = oneshot::channel();
        self.sender
            .send(Command::InspectControl { request, reply })
            .await
            .map_err(|_send_error| {
                closed("shard command loop closed before accepting control read")
            })?;
        response.await.map_err(|_receive_error| {
            closed("shard command loop stopped before replying to control read")
        })?
    }

    /// Atomically re-checks the request against the current projection, builds
    /// its pure promoted event (or durable rejection), and appends it through
    /// the sole fenced writer.
    pub(crate) async fn resolve_control(
        &self,
        request: ControlRequestV1,
        preflight_rejection: Option<ControlRejectionReason>,
    ) -> Result<ControlResolution, ShardCommandError> {
        if !self.accepting.load(Ordering::Acquire) {
            return Err(closed(
                "shard command loop is not accepting control requests",
            ));
        }
        let (reply, response) = oneshot::channel();
        self.sender
            .send(Command::ResolveControl {
                request,
                preflight_rejection,
                reply,
            })
            .await
            .map_err(|_send_error| {
                closed("shard command loop closed before accepting control request")
            })?;
        response.await.map_err(|_receive_error| {
            closed("shard command loop stopped before replying to control request")
        })?
    }

    pub(crate) async fn inspect_run(
        &self,
        run_id: super::super::ids::RunId,
    ) -> Result<Option<RunView>, ShardCommandError> {
        self.query(CommandQuery::Run(run_id))
            .await
            .map(|result| match result {
                QueryResult::Run(run) => run,
                QueryResult::Checkpoint(_)
                | QueryResult::AttemptCurrent(_)
                | QueryResult::NextRun(_)
                | QueryResult::NextRestore(_)
                | QueryResult::Work(_)
                | QueryResult::NextWork(_)
                | QueryResult::Delivery(_)
                | QueryResult::State(_)
                | QueryResult::ReconcileCandidates(_)
                | QueryResult::RunnableDeliveryWork(_)
                | QueryResult::TerminalRuns(_) => {
                    unreachable!("run query returns a run result")
                }
            })
    }

    pub(crate) async fn next_runnable_run(&self) -> Result<Option<RunView>, ShardCommandError> {
        self.query(CommandQuery::NextRun)
            .await
            .map(|result| match result {
                QueryResult::NextRun(run) => run,
                QueryResult::Run(_)
                | QueryResult::Checkpoint(_)
                | QueryResult::AttemptCurrent(_)
                | QueryResult::NextRestore(_)
                | QueryResult::Work(_)
                | QueryResult::NextWork(_)
                | QueryResult::Delivery(_)
                | QueryResult::State(_)
                | QueryResult::ReconcileCandidates(_)
                | QueryResult::RunnableDeliveryWork(_)
                | QueryResult::TerminalRuns(_) => {
                    unreachable!("next-run query returns a next-run result")
                }
            })
    }

    pub(crate) async fn next_restore_required(
        &self,
    ) -> Result<Option<CanonicalIntegrationId>, ShardCommandError> {
        self.query(CommandQuery::NextRestore)
            .await
            .map(|result| match result {
                QueryResult::NextRestore(integration_id) => integration_id,
                QueryResult::Run(_)
                | QueryResult::Checkpoint(_)
                | QueryResult::AttemptCurrent(_)
                | QueryResult::NextRun(_)
                | QueryResult::Work(_)
                | QueryResult::NextWork(_)
                | QueryResult::Delivery(_)
                | QueryResult::State(_)
                | QueryResult::ReconcileCandidates(_)
                | QueryResult::RunnableDeliveryWork(_)
                | QueryResult::TerminalRuns(_) => {
                    unreachable!("next-restore query returns a next-restore result")
                }
            })
    }

    pub(crate) async fn inspect_work(
        &self,
        work_id: WorkId,
    ) -> Result<Option<WorkRecoveryIntent>, ShardCommandError> {
        self.query(CommandQuery::Work(work_id))
            .await
            .map(|result| match result {
                QueryResult::Work(work) => work,
                QueryResult::Run(_)
                | QueryResult::Checkpoint(_)
                | QueryResult::AttemptCurrent(_)
                | QueryResult::NextRun(_)
                | QueryResult::NextRestore(_)
                | QueryResult::NextWork(_)
                | QueryResult::Delivery(_)
                | QueryResult::State(_)
                | QueryResult::ReconcileCandidates(_)
                | QueryResult::RunnableDeliveryWork(_)
                | QueryResult::TerminalRuns(_) => {
                    unreachable!("work query returns a work result")
                }
            })
    }

    /// Returns one planned work item, preferring foreground Apply/Restore over
    /// reconciliation. Blocked work remains visible through `inspect_work` but
    /// cannot execute until a durable retry request returns it to Planned.
    /// Production delivery discovery uses `runnable_delivery_work`; this
    /// single-item form remains the lifecycle tests' reference query.
    #[allow(
        dead_code,
        reason = "single-turn reference query exercised by the lifecycle tests; production uses runnable_delivery_work"
    )]
    pub(crate) async fn next_runnable_work(
        &self,
    ) -> Result<Option<WorkRecoveryIntent>, ShardCommandError> {
        self.query(CommandQuery::NextWork)
            .await
            .map(|result| match result {
                QueryResult::NextWork(work) => work,
                QueryResult::Run(_)
                | QueryResult::Checkpoint(_)
                | QueryResult::AttemptCurrent(_)
                | QueryResult::NextRun(_)
                | QueryResult::NextRestore(_)
                | QueryResult::Work(_)
                | QueryResult::Delivery(_)
                | QueryResult::State(_)
                | QueryResult::ReconcileCandidates(_)
                | QueryResult::RunnableDeliveryWork(_)
                | QueryResult::TerminalRuns(_) => {
                    unreachable!("next-work query returns a work result")
                }
            })
    }

    /// Returns every runnable planned work item in deterministic integration
    /// order: each integration's planned foreground work, or its planned
    /// reconciliation work when the integration is healthy, eligible, and has
    /// no foreground slot in use. This is the process-wide delivery
    /// scheduler's lane discovery; single-item `next_runnable_work` remains
    /// the single-turn reference path.
    pub(crate) async fn runnable_delivery_work(
        &self,
    ) -> Result<Vec<WorkRecoveryIntent>, ShardCommandError> {
        self.query(CommandQuery::RunnableDeliveryWork)
            .await
            .map(|result| match result {
                QueryResult::RunnableDeliveryWork(work) => work,
                QueryResult::Run(_)
                | QueryResult::Checkpoint(_)
                | QueryResult::AttemptCurrent(_)
                | QueryResult::NextRun(_)
                | QueryResult::NextRestore(_)
                | QueryResult::Work(_)
                | QueryResult::NextWork(_)
                | QueryResult::Delivery(_)
                | QueryResult::State(_)
                | QueryResult::ReconcileCandidates(_)
                | QueryResult::TerminalRuns(_) => {
                    unreachable!("runnable-delivery query returns a work list")
                }
            })
    }

    /// Every integration's terminal run IDs, for sweeping stale depth-one
    /// admission pointers: an admission naming a terminal run must be
    /// cleared or the next submission attaches to a finished run forever.
    pub(crate) async fn terminal_runs_by_integration(
        &self,
    ) -> Result<
        Vec<(
            CanonicalIntegrationId,
            std::collections::BTreeSet<super::super::ids::RunId>,
        )>,
        ShardCommandError,
    > {
        self.query(CommandQuery::TerminalRuns)
            .await
            .map(|result| match result {
                QueryResult::TerminalRuns(terminal) => terminal,
                QueryResult::Run(_)
                | QueryResult::Checkpoint(_)
                | QueryResult::AttemptCurrent(_)
                | QueryResult::NextRun(_)
                | QueryResult::NextRestore(_)
                | QueryResult::Work(_)
                | QueryResult::NextWork(_)
                | QueryResult::Delivery(_)
                | QueryResult::State(_)
                | QueryResult::ReconcileCandidates(_)
                | QueryResult::RunnableDeliveryWork(_) => {
                    unreachable!("terminal-run query returns a terminal-run result")
                }
            })
    }

    /// Returns integrations whose applied state could start a new
    /// reconciliation cycle right now: applied, healthy, eligible, and with no
    /// live foreground or reconciliation work. Interval pacing is the
    /// scheduler's concern; the projection only answers structural eligibility.
    pub(crate) async fn reconcile_candidates(
        &self,
    ) -> Result<Vec<CanonicalIntegrationId>, ShardCommandError> {
        self.query(CommandQuery::ReconcileCandidates)
            .await
            .map(|result| match result {
                QueryResult::ReconcileCandidates(candidates) => candidates,
                QueryResult::Run(_)
                | QueryResult::Checkpoint(_)
                | QueryResult::AttemptCurrent(_)
                | QueryResult::NextRun(_)
                | QueryResult::NextRestore(_)
                | QueryResult::Work(_)
                | QueryResult::NextWork(_)
                | QueryResult::Delivery(_)
                | QueryResult::State(_)
                | QueryResult::RunnableDeliveryWork(_)
                | QueryResult::TerminalRuns(_) => {
                    unreachable!("reconcile-candidate query returns a candidate result")
                }
            })
    }

    /// Named-step checkpoint lookup for the backend-neutral orchestration
    /// port. The production V1 surface reads steps from `RunView`; the
    /// `cfg(test)` port adapter is the only current caller.
    #[allow(
        dead_code,
        reason = "backend-neutral port conformance surface exercised by the cfg(test) adapter"
    )]
    pub(crate) async fn checkpoint(
        &self,
        run_id: super::super::ids::RunId,
        name: String,
    ) -> Result<Option<crate::blob::BlobRef>, ShardCommandError> {
        self.query(CommandQuery::Checkpoint { run_id, name })
            .await
            .map(|result| match result {
                QueryResult::Checkpoint(checkpoint) => checkpoint,
                QueryResult::Run(_)
                | QueryResult::AttemptCurrent(_)
                | QueryResult::NextRun(_)
                | QueryResult::NextRestore(_)
                | QueryResult::Work(_)
                | QueryResult::NextWork(_)
                | QueryResult::Delivery(_)
                | QueryResult::State(_)
                | QueryResult::ReconcileCandidates(_)
                | QueryResult::RunnableDeliveryWork(_)
                | QueryResult::TerminalRuns(_) => {
                    unreachable!("checkpoint query returns a checkpoint result")
                }
            })
    }

    pub(crate) async fn attempt_is_current(
        &self,
        run_id: super::super::ids::RunId,
        attempt_id: AttemptId,
    ) -> Result<bool, ShardCommandError> {
        self.query(CommandQuery::AttemptCurrent { run_id, attempt_id })
            .await
            .map(|result| match result {
                QueryResult::AttemptCurrent(current) => current,
                QueryResult::Run(_)
                | QueryResult::Checkpoint(_)
                | QueryResult::NextRun(_)
                | QueryResult::NextRestore(_)
                | QueryResult::Work(_)
                | QueryResult::NextWork(_)
                | QueryResult::Delivery(_)
                | QueryResult::State(_)
                | QueryResult::ReconcileCandidates(_)
                | QueryResult::RunnableDeliveryWork(_)
                | QueryResult::TerminalRuns(_) => {
                    unreachable!("attempt query returns an attempt result")
                }
            })
    }

    pub(crate) async fn inspect_state(
        &self,
        integration_id: CanonicalIntegrationId,
    ) -> Result<Option<StateCursor>, ShardCommandError> {
        if super::super::routing::shard(&integration_id) != self.shard {
            return Err(ShardCommandError {
                kind: ShardCommandErrorKind::InvalidCandidate,
                message: format!(
                    "state query integration {integration_id} routes to a different shard"
                ),
            });
        }
        self.query(CommandQuery::State(integration_id))
            .await
            .map(|result| match result {
                QueryResult::State(state) => state,
                QueryResult::Run(_)
                | QueryResult::Checkpoint(_)
                | QueryResult::AttemptCurrent(_)
                | QueryResult::NextRun(_)
                | QueryResult::NextRestore(_)
                | QueryResult::Work(_)
                | QueryResult::NextWork(_)
                | QueryResult::Delivery(_)
                | QueryResult::ReconcileCandidates(_)
                | QueryResult::RunnableDeliveryWork(_)
                | QueryResult::TerminalRuns(_) => {
                    unreachable!("state query returns a state result")
                }
            })
    }

    pub(crate) async fn inspect_delivery(
        &self,
        integration_id: CanonicalIntegrationId,
    ) -> Result<Option<IntegrationDeliveryView>, ShardCommandError> {
        if super::super::routing::shard(&integration_id) != self.shard {
            return Err(ShardCommandError {
                kind: ShardCommandErrorKind::InvalidCandidate,
                message: format!(
                    "delivery query integration {integration_id} routes to a different shard"
                ),
            });
        }
        self.query(CommandQuery::Delivery(integration_id))
            .await
            .map(|result| match result {
                QueryResult::Delivery(delivery) => delivery,
                QueryResult::Run(_)
                | QueryResult::Checkpoint(_)
                | QueryResult::AttemptCurrent(_)
                | QueryResult::NextRun(_)
                | QueryResult::NextRestore(_)
                | QueryResult::Work(_)
                | QueryResult::NextWork(_)
                | QueryResult::State(_)
                | QueryResult::ReconcileCandidates(_)
                | QueryResult::RunnableDeliveryWork(_)
                | QueryResult::TerminalRuns(_) => {
                    unreachable!("delivery query returns a delivery result")
                }
            })
    }

    async fn query(&self, query: CommandQuery) -> Result<QueryResult, ShardCommandError> {
        if !self.accepting.load(Ordering::Acquire) {
            return Err(closed("shard command loop is not accepting queries"));
        }
        let (reply, response) = oneshot::channel();
        self.sender
            .send(Command::Query { query, reply })
            .await
            .map_err(|_send_error| closed("shard command loop closed before accepting query"))?;
        response.await.map_err(|_receive_error| {
            closed("shard command loop stopped before replying to query")
        })?
    }

    pub(crate) async fn shutdown(&self) -> Result<(), ShardCommandError> {
        if self
            .accepting
            .compare_exchange(true, false, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(closed("shard command loop is already stopping"));
        }
        let (reply, response) = oneshot::channel();
        self.sender
            .send(Command::Shutdown { reply })
            .await
            .map_err(|_send_error| closed("shard command loop closed before accepting shutdown"))?;
        response.await.map_err(|_receive_error| {
            closed("shard command loop stopped before acknowledging shutdown")
        })?
    }

    /// Stops new admission immediately and wakes the loop through a dedicated
    /// control path. Commands already queued are rejected rather than draining
    /// through a lease-lost writer.
    pub(crate) fn stop_admission(&self) {
        self.accepting.store(false, Ordering::Release);
    }

    pub(crate) fn cancel_owned_writer(&self) {
        self.ownership_lost.cancel();
    }
}

enum Command {
    Propose {
        record: JournalRecordV1,
        reply: oneshot::Sender<Result<ShardCommandOutcome, ShardCommandError>>,
    },
    InspectControl {
        request: ControlRequestV1,
        reply: oneshot::Sender<Result<ControlRequestSnapshot, ShardCommandError>>,
    },
    ResolveControl {
        request: ControlRequestV1,
        preflight_rejection: Option<ControlRejectionReason>,
        reply: oneshot::Sender<Result<ControlResolution, ShardCommandError>>,
    },
    CaptureSnapshot {
        minimum_sequence_span: u64,
        reply: oneshot::Sender<Result<Option<SnapshotCapture>, ShardCommandError>>,
    },
    CommitSnapshot {
        snapshot: ControlProjectionSnapshot,
        reply: oneshot::Sender<Result<u64, ShardCommandError>>,
    },
    Query {
        query: CommandQuery,
        reply: oneshot::Sender<Result<QueryResult, ShardCommandError>>,
    },
    Shutdown {
        reply: oneshot::Sender<Result<(), ShardCommandError>>,
    },
}

pub(crate) enum CommandQuery {
    Run(super::super::ids::RunId),
    NextRun,
    NextRestore,
    Work(WorkId),
    NextWork,
    RunnableDeliveryWork,
    ReconcileCandidates,
    TerminalRuns,
    Delivery(CanonicalIntegrationId),
    Checkpoint {
        run_id: super::super::ids::RunId,
        name: String,
    },
    AttemptCurrent {
        run_id: super::super::ids::RunId,
        attempt_id: AttemptId,
    },
    State(CanonicalIntegrationId),
}

pub(crate) enum QueryResult {
    Run(Option<RunView>),
    NextRun(Option<RunView>),
    NextRestore(Option<CanonicalIntegrationId>),
    Work(Option<WorkRecoveryIntent>),
    NextWork(Option<WorkRecoveryIntent>),
    RunnableDeliveryWork(Vec<WorkRecoveryIntent>),
    ReconcileCandidates(Vec<CanonicalIntegrationId>),
    TerminalRuns(
        Vec<(
            CanonicalIntegrationId,
            std::collections::BTreeSet<super::super::ids::RunId>,
        )>,
    ),
    Delivery(Option<IntegrationDeliveryView>),
    Checkpoint(Option<crate::blob::BlobRef>),
    AttemptCurrent(bool),
    State(Option<StateCursor>),
}

/// Protocol V1's implementation of the kernel [`Domain`] contract. It lives
/// next to its consumer because the query vocabulary is private to this
/// module; everything here delegates to the existing V1 functions, so the
/// trait adds a seam, not behavior.
pub(crate) struct IntegrationsDomain;

impl Domain for IntegrationsDomain {
    type Record = JournalRecord;
    type RecordCurrent = JournalRecordV1;
    type Projection = Projection;
    type Delta = ProjectionDelta;
    type FoldError = InvalidTransition;
    type StateKey = CanonicalIntegrationId;
    type Query = CommandQuery;
    type QueryResult = QueryResult;
    type ControlRequest = ControlRequestV1;
    type ControlSnapshot = ControlRequestSnapshot;
    type ControlOutcome = ControlRequestOutcomeV1;
    type ControlRejection = ControlRejectionReason;
    type Snapshot = ControlProjectionSnapshot;
    type SnapshotCapture = SnapshotCapture;
    type WorkIntent = WorkRecoveryIntent;

    fn record_shard(record: &JournalRecordV1) -> Shard {
        crate::orchestrator::routing::shard(&record.integration_id)
    }

    fn record_event_id(record: &JournalRecordV1) -> EventId {
        record.event_id.clone()
    }

    fn record_state_key(record: &JournalRecordV1) -> CanonicalIntegrationId {
        record.integration_id.clone()
    }

    fn wire(record: JournalRecordV1) -> JournalRecord {
        JournalRecord::V1(record)
    }

    fn prepare(
        projection: &Projection,
        record: &JournalRecordV1,
    ) -> Result<Prepared<ProjectionDelta>, InvalidTransition> {
        Ok(
            match crate::orchestrator::projection::prepare(projection, record)? {
                PreparedTransition::Noop => Prepared::Noop,
                PreparedTransition::Mutation(delta) => Prepared::Mutation(delta),
            },
        )
    }

    fn finalize(
        projection: &mut Projection,
        delta: ProjectionDelta,
        shard_sequence: u64,
    ) -> Result<(), InvalidTransition> {
        crate::orchestrator::projection::finalize(
            projection,
            PreparedTransition::Mutation(delta),
            shard_sequence,
        )
        .map(|_outcome| ())
    }

    fn state_sequence(projection: &Projection, key: &CanonicalIntegrationId) -> Option<u64> {
        projection
            .integrations
            .get(key)
            .and_then(|integration| integration.checkpoint_state_sequence)
    }

    fn answer(projection: &Projection, query: CommandQuery) -> QueryResult {
        query_projection(projection, query)
    }

    fn control_shard(request: &ControlRequestV1) -> Shard {
        crate::orchestrator::routing::shard(&request.integration_id)
    }

    fn inspect_control(
        projection: &Projection,
        request: &ControlRequestV1,
    ) -> Result<ControlRequestSnapshot, ShardCommandError> {
        crate::orchestrator::inbox::inspect_projection(projection, request)
    }

    fn control_prior_outcome(snapshot: &ControlRequestSnapshot) -> Option<ControlRequestOutcomeV1> {
        snapshot.outcome.clone()
    }

    fn control_event_id(request: &ControlRequestV1) -> EventId {
        crate::orchestrator::events::control_outcome_event_id(&request.request_id)
    }

    fn promote_control(
        projection: &Projection,
        request: &ControlRequestV1,
        preflight_rejection: Option<ControlRejectionReason>,
    ) -> Result<JournalRecordV1, InvalidTransition> {
        crate::orchestrator::inbox::promote_control_request(projection, request, preflight_rejection)
    }

    fn control_outcome_after_append(
        projection: &Projection,
        request: &ControlRequestV1,
    ) -> Result<ControlRequestOutcomeV1, String> {
        let outcome = projection
            .control_request_outcomes
            .get(&request.request_id)
            .cloned()
            .ok_or_else(|| {
                format!(
                    "control outcome {} missing after durable resolution",
                    request.request_id
                )
            })?;
        let digest = request
            .digest()
            .map_err(|error| format!("recompute control request digest after append: {error}"))?;
        if outcome.request_digest != digest {
            return Err(format!(
                "control outcome {} has a conflicting request digest after append",
                request.request_id
            ));
        }
        Ok(outcome)
    }

    fn capture_snapshot(shard: Shard, projection: &Projection) -> Option<SnapshotCapture> {
        SnapshotCapture::new(shard, projection)
    }

    fn snapshot_bounds(snapshot: &ControlProjectionSnapshot) -> Result<(Shard, u64), String> {
        let value = snapshot.current();
        let shard = projection_snapshot::parse_shard(&value.shard)
            .map_err(|error| format!("validate snapshot shard: {error}"))?;
        Ok((shard, value.through_log_sequence))
    }

    fn snapshot_created_at(snapshot: &ControlProjectionSnapshot) -> String {
        snapshot.current().created_at.clone()
    }

    async fn load_snapshot_projection(
        store: &ArtifactStore,
        tenant: &TenantNamespace,
        shard: Shard,
        snapshot: &ControlProjectionSnapshot,
    ) -> Result<Projection, String> {
        projection_snapshot::load_projection(store, tenant, shard, snapshot)
            .await
            .map_err(|error| format!("{error:?}"))
    }

    fn through_sequence(projection: &Projection) -> Option<u64> {
        projection.through_log_sequence
    }

    fn replay(
        projection: &mut Projection,
        shard: Shard,
        sequence: u64,
        record: JournalRecord,
    ) -> Result<(), String> {
        let input = SequencedJournalRecord::try_new(sequence, record)
            .map_err(|error| format!("validate durable record at sequence {sequence}: {error}"))?;
        if crate::orchestrator::routing::shard(&input.record().integration_id) != shard {
            return Err(format!(
                "durable record at sequence {sequence} routes to a different shard"
            ));
        }
        apply(projection, input)
            .map(|_outcome| ())
            .map_err(|error| format!("replay durable record at sequence {sequence}: {error}"))
    }

    fn validate_recovered_prefix(
        previous: &Projection,
        recovered: &Projection,
    ) -> Result<(), String> {
        if previous
            .through_log_sequence
            .is_some_and(|old| recovered.through_log_sequence.is_none_or(|new| new < old))
        {
            return Err(format!(
                "durable prefix regressed from {:?} to {:?}",
                previous.through_log_sequence, recovered.through_log_sequence
            ));
        }
        for (event_id, digest) in &previous.seen_event_digests {
            if recovered.seen_event_digests.get(event_id) != Some(digest) {
                return Err(format!(
                    "durable prefix lost or changed acknowledged event {event_id}"
                ));
            }
        }
        Ok(())
    }

    fn live_work(projection: &Projection) -> Vec<WorkRecoveryIntent> {
        projection
            .work
            .iter()
            .filter(|(_work_id, work)| work.status.is_live())
            .map(|(work_id, work)| work_intent_from_projection(work_id, work))
            .collect()
    }

    fn initial_state_keys(projection: &Projection) -> Vec<CanonicalIntegrationId> {
        projection
            .integrations
            .iter()
            .filter(|(_integration_id, projection)| projection.checkpoint_state_sequence.is_some())
            .map(|(integration_id, _projection)| integration_id.clone())
            .collect()
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ShardCommandConfig {
    channel_capacity: NonZeroUsize,
    safe_append_retries: u32,
    recovery_mode: RecoveryMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RecoveryMode {
    LocalReopen,
    FullLeaseHandshake,
}

/// The `Default` configuration keeps `LocalReopen` recovery for unleased test
/// rigs and reference embeddings, where reopening the writer locally is the
/// intended ambiguity resolution. Production construction goes through
/// [`ShardCommandConfig::new`], which is fail-closed by default: an ambiguous
/// append requires a fresh lease acquisition handshake.
impl Default for ShardCommandConfig {
    fn default() -> Self {
        Self {
            channel_capacity: NonZeroUsize::new(DEFAULT_CHANNEL_CAPACITY)
                .unwrap_or(NonZeroUsize::MIN),
            safe_append_retries: DEFAULT_SAFE_APPEND_RETRIES,
            recovery_mode: RecoveryMode::LocalReopen,
        }
    }
}

impl ShardCommandConfig {
    /// Production constructor: fail-closed recovery by default, so exclusivity
    /// never depends on a later call site remembering to flip the mode.
    pub(crate) fn new(channel_capacity: NonZeroUsize, safe_append_retries: u32) -> Self {
        Self {
            channel_capacity,
            safe_append_retries,
            recovery_mode: RecoveryMode::FullLeaseHandshake,
        }
    }

    pub(crate) fn require_full_lease_handshake(mut self) -> Self {
        self.recovery_mode = RecoveryMode::FullLeaseHandshake;
        self
    }

    /// Unleased ambiguity recovery for the reference and fault-injection
    /// rigs that exercise the reopen-and-adopt loop directly.
    #[cfg(test)]
    pub(crate) fn allow_local_reopen(mut self) -> Self {
        self.recovery_mode = RecoveryMode::LocalReopen;
        self
    }
}

#[derive(Debug)]
pub(crate) struct StartedShard {
    pub(crate) handle: ShardCommandHandle,
    pub(crate) recovery: StartupRecovery,
    pub(crate) state_changes: StateChangeFeed,
    pub(crate) task: tokio::task::JoinHandle<Result<(), ShardCommandError>>,
}

/// An opened writer that has not yet certified its durable prefix. No command
/// handle exists at this stage, so lease revalidation can safely fail closed.
pub(crate) struct OpenedShard {
    location: ShardLogLocation,
    writer: Option<ShardLogWriter>,
}

impl OpenedShard {
    pub(crate) async fn open(location: ShardLogLocation) -> Result<Self, ShardCommandError> {
        let started = std::time::Instant::now();
        let writer = ShardLogWriter::open(&location)
            .await
            .map_err(|error| recovery(format!("open shard writer: {error:?}")))?;
        tracing::info!(
            shard = %crate::orchestrator::routing::shard_path(location.shard),
            durable_end_exclusive = writer.durable_end_exclusive(),
            elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
            "opened durable shard log"
        );
        Ok(Self {
            location,
            writer: Some(writer),
        })
    }

    /// Snapshot-free recovery used by unleased test rigs. The production
    /// handshake always recovers through `recover_with_snapshots`.
    #[cfg(test)]
    pub(crate) async fn recover(self) -> Result<RecoveredShard, ShardCommandError> {
        self.recover_inner(None).await
    }

    pub(crate) async fn recover_with_snapshots(
        self,
        store: &ArtifactStore,
        tenant: &TenantNamespace,
    ) -> Result<RecoveredShard, ShardCommandError> {
        self.recover_inner(Some((store, tenant))).await
    }

    async fn recover_inner(
        mut self,
        snapshots: Option<(&ArtifactStore, &TenantNamespace)>,
    ) -> Result<RecoveredShard, ShardCommandError> {
        let snapshot_store = snapshots.map(|(store, _tenant)| store.clone());
        let snapshot_tenant = snapshots.map(|(_store, tenant)| tenant.clone());
        let writer = self
            .writer
            .take()
            .ok_or_else(|| recovery("opened shard writer is unavailable"))?;
        let durable_end_exclusive = writer.durable_end_exclusive();
        let replay_started = std::time::Instant::now();
        let recovered = match replay_with_snapshots(
            &writer,
            self.location.shard,
            durable_end_exclusive,
            snapshots,
        )
        .await
        {
            Ok(recovered) => recovered,
            Err(error) => {
                if let Err(close_error) = writer.close().await {
                    return Err(recovery(format!(
                        "{error}; closing failed startup writer also failed: {close_error:?}"
                    )));
                }
                return Err(error);
            }
        };
        if let Some(store) = &snapshot_store {
            let latest_snapshot_created_at =
                recovered.snapshot_created_at.as_deref().and_then(|value| {
                    chrono::DateTime::parse_from_rfc3339(value)
                        .ok()
                        .map(chrono::DateTime::<chrono::Utc>::from)
                });
            store.telemetry().record_snapshot_recovery(
                recovered.replayed_events,
                replay_started.elapsed(),
                recovered.corruption_fallbacks,
                latest_snapshot_created_at,
            );
        }
        let projection = recovered.projection;
        let recovery = StartupRecovery {
            durable_end_exclusive,
            snapshot_through_log_sequence: recovered.snapshot_through_log_sequence,
            live_work: IntegrationsDomain::live_work(&projection),
        };
        let initial_state_changes = IntegrationsDomain::initial_state_keys(&projection);
        Ok(RecoveredShard {
            location: self.location,
            writer: Some(writer),
            projection,
            last_snapshot_through_log_sequence: recovered.snapshot_through_log_sequence,
            snapshot_store,
            snapshot_tenant,
            recovery,
            initial_state_changes,
        })
    }

    pub(crate) async fn close(mut self) -> Result<(), ShardCommandError> {
        if let Some(writer) = self.writer.take() {
            writer
                .close()
                .await
                .map_err(|error| recovery(format!("close unopened shard loop: {error:?}")))?;
        }
        Ok(())
    }
}

/// Fully recovered state that is still unable to accept commands. The lease
/// handshake performs its second revalidation before consuming this value.
pub(crate) struct RecoveredShard {
    location: ShardLogLocation,
    writer: Option<ShardLogWriter>,
    projection: Projection,
    last_snapshot_through_log_sequence: Option<u64>,
    snapshot_store: Option<ArtifactStore>,
    snapshot_tenant: Option<TenantNamespace>,
    recovery: StartupRecovery,
    initial_state_changes: Vec<CanonicalIntegrationId>,
}

impl RecoveredShard {
    pub(crate) fn enable(self, config: ShardCommandConfig) -> StartedShard {
        self.enable_inner(
            config,
            #[cfg(test)]
            TestHarness::default(),
        )
    }

    #[cfg(test)]
    fn enable_with_harness(self, config: ShardCommandConfig, harness: TestHarness) -> StartedShard {
        self.enable_inner(config, harness)
    }

    fn enable_inner(
        mut self,
        config: ShardCommandConfig,
        #[cfg(test)] harness: TestHarness,
    ) -> StartedShard {
        let (sender, receiver) = mpsc::channel(config.channel_capacity.get());
        let (state_change_sender, state_change_receiver) =
            mpsc::channel(config.channel_capacity.get());
        let accepting = Arc::new(AtomicBool::new(true));
        let ownership_lost = CancellationToken::new();
        let handle = ShardCommandHandle {
            sender,
            accepting: accepting.clone(),
            ownership_lost: ownership_lost.clone(),
            shard: self.location.shard,
        };
        let command_loop = CommandLoop {
            location: self.location,
            writer: self.writer.take(),
            projection: self.projection,
            last_snapshot_through_log_sequence: self.last_snapshot_through_log_sequence,
            snapshot_store: self.snapshot_store,
            snapshot_tenant: self.snapshot_tenant,
            safe_append_retries: config.safe_append_retries,
            recovery_mode: config.recovery_mode,
            receiver,
            state_change_sender,
            accepting,
            ownership_lost,
            #[cfg(test)]
            faults: harness.faults,
            #[cfg(test)]
            before_append: harness.before_append,
            #[cfg(test)]
            before_recovery: harness.before_recovery,
        };
        let task = tokio::spawn(command_loop.run());
        StartedShard {
            handle,
            recovery: self.recovery,
            state_changes: StateChangeFeed {
                initial: self.initial_state_changes,
                receiver: state_change_receiver,
            },
            task,
        }
    }

    pub(crate) async fn close(mut self) -> Result<(), ShardCommandError> {
        if let Some(writer) = self.writer.take() {
            writer.close().await.map_err(|error| {
                recovery(format!("close recovered shard before enable: {error:?}"))
            })?;
        }
        Ok(())
    }
}

/// Unleased shard constructor for lifecycle and conformance test rigs. It does
/// not return a command handle until the writer's captured remote durable
/// prefix has been completely projected and live work has been reconstructed.
/// Production shards start only through the full lease acquisition handshake.
#[cfg(test)]
pub(crate) async fn start_recovered(
    location: ShardLogLocation,
    config: ShardCommandConfig,
) -> Result<StartedShard, ShardCommandError> {
    let opened = OpenedShard::open(location).await?;
    let recovered = opened.recover().await?;
    Ok(recovered.enable(config))
}

struct CommandLoop {
    location: ShardLogLocation,
    writer: Option<ShardLogWriter>,
    projection: Projection,
    last_snapshot_through_log_sequence: Option<u64>,
    snapshot_store: Option<ArtifactStore>,
    snapshot_tenant: Option<TenantNamespace>,
    safe_append_retries: u32,
    recovery_mode: RecoveryMode,
    receiver: mpsc::Receiver<Command>,
    state_change_sender: mpsc::Sender<CanonicalIntegrationId>,
    accepting: Arc<AtomicBool>,
    ownership_lost: CancellationToken,
    #[cfg(test)]
    faults: VecDeque<super::AppendFault>,
    #[cfg(test)]
    before_append: Option<Arc<TestGate>>,
    #[cfg(test)]
    before_recovery: Option<Arc<TestGate>>,
}

impl CommandLoop {
    #[cfg(test)]
    async fn start(
        location: ShardLogLocation,
        config: ShardCommandConfig,
        harness: TestHarness,
    ) -> Result<
        (
            ShardCommandHandle,
            StartupRecovery,
            StateChangeFeed,
            tokio::task::JoinHandle<Result<(), ShardCommandError>>,
        ),
        ShardCommandError,
    > {
        let opened = OpenedShard::open(location).await?;
        let recovered = opened.recover().await?;
        let started = recovered.enable_with_harness(config, harness);
        Ok((
            started.handle,
            started.recovery,
            started.state_changes,
            started.task,
        ))
    }

    async fn run(mut self) -> Result<(), ShardCommandError> {
        loop {
            let command = tokio::select! {
                biased;
                () = self.ownership_lost.cancelled() => {
                    let error = ShardCommandError {
                        kind: ShardCommandErrorKind::Fenced,
                        message: "shard ownership was lost".to_owned(),
                    };
                    return self.stop_after_terminal(Some(error)).await;
                }
                command = self.receiver.recv() => command,
            };
            let Some(command) = command else {
                break;
            };
            match command {
                Command::Propose { record, reply } => {
                    let result = self.process(record).await;
                    let terminal = result
                        .as_ref()
                        .err()
                        .is_some_and(|error| is_terminal(error.kind));
                    let terminal_error = result.as_ref().err().cloned();
                    let _ = reply.send(result);
                    if terminal {
                        self.accepting.store(false, Ordering::Release);
                        self.receiver.close();
                        let error = terminal_error
                            .unwrap_or_else(|| recovery("terminal command-loop failure"));
                        self.observe_terminal(&error);
                        self.reject_queued(error.clone());
                        let _ = self.close_writer().await;
                        return Err(error);
                    }
                }
                Command::InspectControl { request, reply } => {
                    let result = self.inspect_control_request(&request);
                    let terminal = result
                        .as_ref()
                        .err()
                        .is_some_and(|error| is_terminal(error.kind));
                    let terminal_error = result.as_ref().err().cloned();
                    let _ = reply.send(result);
                    if terminal {
                        return self.stop_after_terminal(terminal_error).await;
                    }
                }
                Command::ResolveControl {
                    request,
                    preflight_rejection,
                    reply,
                } => {
                    let result =
                        Box::pin(self.process_control_request(request, preflight_rejection)).await;
                    let terminal = result
                        .as_ref()
                        .err()
                        .is_some_and(|error| is_terminal(error.kind));
                    let terminal_error = result.as_ref().err().cloned();
                    let _ = reply.send(result);
                    if terminal {
                        return self.stop_after_terminal(terminal_error).await;
                    }
                }
                Command::CaptureSnapshot {
                    minimum_sequence_span,
                    reply,
                } => {
                    let capture = IntegrationsDomain::through_sequence(&self.projection)
                        .filter(|through| {
                            let span = self.last_snapshot_through_log_sequence.map_or_else(
                                || through.saturating_add(1),
                                |previous| through.saturating_sub(previous),
                            );
                            span >= minimum_sequence_span.max(1)
                        })
                        .and_then(|_through| {
                            IntegrationsDomain::capture_snapshot(
                                self.location.shard,
                                &self.projection,
                            )
                        });
                    let _ = reply.send(Ok(capture));
                }
                Command::CommitSnapshot { snapshot, reply } => {
                    let result = self.process_snapshot(snapshot).await;
                    let terminal = result
                        .as_ref()
                        .err()
                        .is_some_and(|error| is_terminal(error.kind));
                    let terminal_error = result.as_ref().err().cloned();
                    let _ = reply.send(result);
                    if terminal {
                        return self.stop_after_terminal(terminal_error).await;
                    }
                }
                Command::Query { query, reply } => {
                    let _ = reply.send(Ok(IntegrationsDomain::answer(&self.projection, query)));
                }
                Command::Shutdown { reply } => {
                    self.accepting.store(false, Ordering::Release);
                    self.receiver.close();
                    self.reject_queued(closed("shard command loop is shutting down"));
                    let result = self.close_writer().await;
                    let _ = reply.send(result.clone());
                    return result;
                }
            }
        }
        self.accepting.store(false, Ordering::Release);
        self.close_writer().await
    }

    async fn stop_after_terminal(
        &mut self,
        terminal_error: Option<ShardCommandError>,
    ) -> Result<(), ShardCommandError> {
        self.accepting.store(false, Ordering::Release);
        self.receiver.close();
        let error = terminal_error.unwrap_or_else(|| recovery("terminal command-loop failure"));
        self.observe_terminal(&error);
        self.reject_queued(error.clone());
        let _ = self.close_writer().await;
        Err(error)
    }

    fn observe_terminal(&self, error: &ShardCommandError) {
        if error.kind == ShardCommandErrorKind::Fenced {
            if let Some(store) = &self.snapshot_store {
                store.telemetry().record_fencing_error();
            }
        }
    }

    fn inspect_control_request(
        &self,
        request: &ControlRequestV1,
    ) -> Result<ControlRequestSnapshot, ShardCommandError> {
        if IntegrationsDomain::control_shard(request) != self.location.shard {
            return Err(ShardCommandError {
                kind: ShardCommandErrorKind::InvalidCandidate,
                message: format!(
                    "control request integration {} routes to a different shard",
                    request.integration_id
                ),
            });
        }
        IntegrationsDomain::inspect_control(&self.projection, request)
    }

    async fn process_control_request(
        &mut self,
        request: ControlRequestV1,
        preflight_rejection: Option<ControlRejectionReason>,
    ) -> Result<ControlResolution, ShardCommandError> {
        let snapshot = self.inspect_control_request(&request)?;
        if let Some(outcome) = IntegrationsDomain::control_prior_outcome(&snapshot) {
            return Ok(ControlResolution {
                append: ShardCommandOutcome::AlreadyDurable {
                    event_id: IntegrationsDomain::control_event_id(&request),
                },
                outcome,
            });
        }
        let record =
            IntegrationsDomain::promote_control(&self.projection, &request, preflight_rejection)
                .map_err(invalid_candidate)?;
        let append = self.process(record).await?;
        let outcome = IntegrationsDomain::control_outcome_after_append(&self.projection, &request)
            .map_err(recovery)?;
        Ok(ControlResolution { append, outcome })
    }

    async fn process(
        &mut self,
        record: JournalRecordV1,
    ) -> Result<ShardCommandOutcome, ShardCommandError> {
        if IntegrationsDomain::record_shard(&record) != self.location.shard {
            return Err(invalid_candidate(InvalidTransition {
                event_id: record.event_id.clone(),
                reason: format!(
                    "integration {} routes to a different shard",
                    record.integration_id
                ),
            }));
        }
        let event_id = IntegrationsDomain::record_event_id(&record);
        let integration_id = IntegrationsDomain::record_state_key(&record);
        let mut safe_failures = 0_u32;
        loop {
            let previous_state_sequence = self.checkpoint_state_sequence(&integration_id);
            let transition =
                IntegrationsDomain::prepare(&self.projection, &record).map_err(invalid_candidate)?;
            let Prepared::Mutation(delta) = transition else {
                self.notify_state_change_if_established(&integration_id);
                return Ok(ShardCommandOutcome::AlreadyDurable { event_id });
            };

            self.wait_before_append().await;
            if self.ownership_lost.is_cancelled() {
                return Err(ShardCommandError {
                    kind: ShardCommandErrorKind::Fenced,
                    message: "shard ownership was lost before append".to_owned(),
                });
            }
            let append_result = self
                .append(&IntegrationsDomain::wire(record.clone()))
                .await;
            match append_result {
                Ok(sequence) => {
                    if let Err(error) =
                        IntegrationsDomain::finalize(&mut self.projection, delta, sequence)
                    {
                        // The append is already durable. A local finalization
                        // failure is never a candidate rejection: rebuild from
                        // the authoritative prefix and require it to adopt the
                        // exact event before serving another command.
                        self.recover_durable_prefix()
                            .await
                            .map_err(|recovery_error| {
                                recovery(format!(
                                "finalize failed after durable append ({error}); {recovery_error}"
                            ))
                            })?;
                        return match IntegrationsDomain::prepare(&self.projection, &record) {
                            Ok(Prepared::Noop) => {
                                self.notify_state_change_if_established(&integration_id);
                                Ok(ShardCommandOutcome::AlreadyDurable { event_id })
                            }
                            Ok(Prepared::Mutation(_)) => Err(recovery(format!(
                                "event {event_id} was acknowledged but is absent after recovery"
                            ))),
                            Err(prepare_error) => Err(recovery(format!(
                                "event {event_id} was acknowledged but conflicts after recovery: {prepare_error}"
                            ))),
                        };
                    }
                    if self.checkpoint_state_sequence(&integration_id) != previous_state_sequence {
                        self.notify_state_change_if_established(&integration_id);
                    }
                    return Ok(ShardCommandOutcome::Applied {
                        event_id,
                        shard_sequence: sequence,
                    });
                }
                Err(error) if error.disposition == AppendDisposition::DefinitelyNotCommitted => {
                    if safe_failures >= self.safe_append_retries {
                        return Err(append_error(error));
                    }
                    safe_failures = safe_failures.saturating_add(1);
                }
                Err(error) if error.disposition == AppendDisposition::CommitUnknown => {
                    self.wait_before_recovery().await;
                    self.recover_durable_prefix().await?;
                    // Re-entering `prepare` adopts the exact durable event,
                    // rejects a same-ID conflict, or proves it absent and
                    // retries the exact record before any later command runs.
                    safe_failures = 0;
                }
                Err(error) => return Err(append_error(error)),
            }
        }
    }

    async fn process_snapshot(
        &mut self,
        snapshot: ControlProjectionSnapshot,
    ) -> Result<u64, ShardCommandError> {
        let (snapshot_shard, snapshot_through) =
            IntegrationsDomain::snapshot_bounds(&snapshot).map_err(recovery)?;
        if snapshot_shard != self.location.shard {
            return Err(ShardCommandError {
                kind: ShardCommandErrorKind::InvalidCandidate,
                message: format!(
                    "projection snapshot for shard {} was proposed to shard {}",
                    super::super::routing::shard_path(snapshot_shard),
                    super::super::routing::shard_path(self.location.shard)
                ),
            });
        }
        let Some(current_sequence) = IntegrationsDomain::through_sequence(&self.projection) else {
            return Err(ShardCommandError {
                kind: ShardCommandErrorKind::InvalidCandidate,
                message: "cannot reference a snapshot for an empty projection".to_owned(),
            });
        };
        if snapshot_through > current_sequence {
            return Err(ShardCommandError {
                kind: ShardCommandErrorKind::InvalidCandidate,
                message: format!(
                    "projection snapshot through {snapshot_through} is ahead of current projection {current_sequence}"
                ),
            });
        }

        let mut safe_failures = 0_u32;
        loop {
            self.wait_before_append().await;
            if self.ownership_lost.is_cancelled() {
                return Err(ShardCommandError {
                    kind: ShardCommandErrorKind::Fenced,
                    message: "shard ownership was lost before snapshot append".to_owned(),
                });
            }
            let writer = self
                .writer
                .as_ref()
                .ok_or_else(|| recovery("shard writer is unavailable"))?;
            match writer.append_projection_snapshot(&snapshot).await {
                Ok(sequence) => {
                    self.last_snapshot_through_log_sequence = Some(snapshot_through);
                    return Ok(sequence);
                }
                Err(error) if error.disposition == AppendDisposition::DefinitelyNotCommitted => {
                    if safe_failures >= self.safe_append_retries {
                        return Err(append_error(error));
                    }
                    safe_failures = safe_failures.saturating_add(1);
                }
                Err(error) => return Err(append_error(error)),
            }
        }
    }

    fn checkpoint_state_sequence(&self, integration_id: &CanonicalIntegrationId) -> Option<u64> {
        IntegrationsDomain::state_sequence(&self.projection, integration_id)
    }

    fn notify_state_change_if_established(&self, integration_id: &CanonicalIntegrationId) {
        if self.checkpoint_state_sequence(integration_id).is_some() {
            // Hints are derived. A full channel may drop this notification;
            // startup replay and later state events deterministically repair it.
            let _ = self.state_change_sender.try_send(integration_id.clone());
        }
    }

    #[allow(
        clippy::needless_pass_by_ref_mut,
        reason = "test builds consume the deterministic fault schedule before append"
    )]
    async fn append(&mut self, record: &JournalRecord) -> Result<u64, ShardAppendError> {
        let writer = self.writer.as_ref().ok_or_else(|| ShardAppendError {
            disposition: AppendDisposition::CommitUnknown,
            source: error_stack::Report::new(super::super::DurableError)
                .attach_printable("shard writer is unavailable"),
        })?;
        #[cfg(test)]
        if let Some(fault) = self.faults.pop_front() {
            return writer.append_with_fault(record, fault).await;
        }
        writer.append(record).await
    }

    async fn recover_durable_prefix(&mut self) -> Result<(), ShardCommandError> {
        if self.recovery_mode == RecoveryMode::FullLeaseHandshake {
            return Err(ShardCommandError {
                kind: ShardCommandErrorKind::CommitUnknown,
                message: "shard writer recovery requires a new lease acquisition handshake"
                    .to_owned(),
            });
        }
        if let Some(writer) = self.writer.take() {
            // Close may itself be ambiguous. Reopening establishes a newer
            // storage epoch before absence is evaluated from remote history.
            let _ = writer.close().await;
        }
        let writer = ShardLogWriter::open(&self.location)
            .await
            .map_err(|error| recovery(format!("reopen shard writer: {error:?}")))?;
        let durable_end_exclusive = writer.durable_end_exclusive();
        self.writer = Some(writer);
        let writer = self
            .writer
            .as_ref()
            .ok_or_else(|| recovery("reopened shard writer is unavailable"))?;
        let snapshots = self
            .snapshot_store
            .as_ref()
            .zip(self.snapshot_tenant.as_ref());
        let recovered = replay_with_snapshots(
            writer,
            self.location.shard,
            durable_end_exclusive,
            snapshots,
        )
        .await?;
        IntegrationsDomain::validate_recovered_prefix(&self.projection, &recovered.projection)
            .map_err(recovery)?;
        self.projection = recovered.projection;
        self.last_snapshot_through_log_sequence = recovered.snapshot_through_log_sequence;
        Ok(())
    }

    fn reject_queued(&mut self, error: ShardCommandError) {
        while let Ok(command) = self.receiver.try_recv() {
            match command {
                Command::Propose { reply, .. } => {
                    let _ = reply.send(Err(error.clone()));
                }
                Command::InspectControl { reply, .. } => {
                    let _ = reply.send(Err(error.clone()));
                }
                Command::ResolveControl { reply, .. } => {
                    let _ = reply.send(Err(error.clone()));
                }
                Command::CaptureSnapshot { reply, .. } => {
                    let _ = reply.send(Err(error.clone()));
                }
                Command::CommitSnapshot { reply, .. } => {
                    let _ = reply.send(Err(error.clone()));
                }
                Command::Query { reply, .. } => {
                    let _ = reply.send(Err(error.clone()));
                }
                Command::Shutdown { reply } => {
                    let _ = reply.send(Err(error.clone()));
                }
            }
        }
    }

    async fn close_writer(&mut self) -> Result<(), ShardCommandError> {
        if let Some(writer) = self.writer.take() {
            writer
                .close()
                .await
                .map_err(|error| recovery(format!("close shard writer: {error:?}")))?;
        }
        Ok(())
    }

    #[cfg(test)]
    async fn wait_before_append(&self) {
        if let Some(gate) = &self.before_append {
            gate.wait_once().await;
        }
    }

    #[cfg(not(test))]
    async fn wait_before_append(&self) {}

    #[cfg(test)]
    async fn wait_before_recovery(&self) {
        if let Some(gate) = &self.before_recovery {
            gate.wait_once().await;
        }
    }

    #[cfg(not(test))]
    async fn wait_before_recovery(&self) {}
}

fn query_projection(projection: &Projection, query: CommandQuery) -> QueryResult {
    match query {
        CommandQuery::Run(run_id) => QueryResult::Run(run_view(projection, &run_id)),
        CommandQuery::NextRun => {
            // Run finalization performs no Graph delivery and closes the
            // WorkCompleted-to-RunCompleted crash window, so it is answered
            // before the shard-wide guard: an unrelated integration's planned
            // lane (for example one pinned in provider backoff) must not
            // defer healing without bound.
            let finalize = projection.integrations.values().find_map(|integration| {
                let run_id = integration.active_run.as_ref()?;
                // Cheap preconditions first: `run_view` clones the whole run,
                // and this scan runs on every scheduler turn. A finalizable
                // run is always Running with a free foreground slot.
                if integration.foreground_work.is_some() {
                    return None;
                }
                let run = projection.runs.get(run_id)?;
                if run.status != super::super::projection::RunStatus::Running {
                    return None;
                }
                let view = run_view(projection, run_id)?;
                view.completion_result.is_some().then_some(view)
            });
            if let Some(view) = finalize {
                return QueryResult::NextRun(Some(view));
            }
            // Incomplete durable work always wins over fresh attempt delivery.
            // Incomplete durable work always prevents a fresh run from
            // overtaking it.
            if projection.work.values().any(|work| {
                work.status == WorkStatus::Planned && !matches!(work.kind, WorkKind::Reconcile(_))
            }) {
                return QueryResult::NextRun(None);
            }
            let run = projection.integrations.values().find_map(|integration| {
                if !integration.execution_eligible() || integration.foreground_work.is_some() {
                    return None;
                }
                let run_id = integration.active_run.as_ref()?;
                let run = projection.runs.get(run_id)?;
                matches!(
                    run.status,
                    super::super::projection::RunStatus::Accepted
                        | super::super::projection::RunStatus::Running
                )
                .then(|| run_view(projection, run_id))
                .flatten()
            });
            QueryResult::NextRun(run)
        }
        CommandQuery::NextRestore => QueryResult::NextRestore(
            projection
                .integrations
                .iter()
                .find(|(_integration_id, integration)| {
                    integration.maintenance
                        == super::super::projection::MaintenanceStatus::RestoreRequired
                        && integration.foreground_work.is_none()
                })
                .map(|(integration_id, _integration)| integration_id.clone()),
        ),
        CommandQuery::Work(work_id) => QueryResult::Work(work_intent(projection, &work_id)),
        CommandQuery::NextWork => {
            // Foreground work is ordered globally ahead of any reconciliation.
            let selected = projection
                .integrations
                .values()
                .find_map(|integration| planned_foreground_work(projection, integration))
                .or_else(|| {
                    projection
                        .integrations
                        .values()
                        .find_map(|integration| runnable_reconcile_work(projection, integration))
                });
            QueryResult::NextWork(selected)
        }
        CommandQuery::RunnableDeliveryWork => QueryResult::RunnableDeliveryWork(
            projection
                .integrations
                .values()
                .filter_map(|integration| {
                    planned_foreground_work(projection, integration)
                        .or_else(|| runnable_reconcile_work(projection, integration))
                })
                .collect(),
        ),
        CommandQuery::TerminalRuns => {
            let mut terminal: std::collections::BTreeMap<
                CanonicalIntegrationId,
                std::collections::BTreeSet<super::super::ids::RunId>,
            > = std::collections::BTreeMap::new();
            for (run_id, run) in &projection.runs {
                if matches!(
                    run.status,
                    super::super::projection::RunStatus::Completed
                        | super::super::projection::RunStatus::Terminated
                ) {
                    terminal
                        .entry(run.integration_id.clone())
                        .or_default()
                        .insert(run_id.clone());
                }
            }
            QueryResult::TerminalRuns(terminal.into_iter().collect())
        }
        CommandQuery::ReconcileCandidates => QueryResult::ReconcileCandidates(
            projection
                .integrations
                .iter()
                .filter(|(_integration_id, integration)| {
                    if integration.applied_state.is_none()
                        || !integration.background_delivery_eligible()
                    {
                        return false;
                    }
                    // A runnable or running run means foreground delivery is
                    // pending; new maintenance cycles wait for it.
                    if integration.active_run.as_ref().is_some_and(|run_id| {
                        projection.runs.get(run_id).is_some_and(|run| {
                            matches!(
                                run.status,
                                super::super::projection::RunStatus::Accepted
                                    | super::super::projection::RunStatus::Running
                            )
                        })
                    }) {
                        return false;
                    }
                    // A live cycle (planned or blocked) is never doubled; a
                    // terminal cycle permits the next one.
                    integration
                        .reconciliation_work
                        .as_ref()
                        .is_none_or(|work_id| {
                            projection.work.get(work_id).is_none_or(|work| {
                                matches!(
                                    work.status,
                                    WorkStatus::Completed | WorkStatus::Superseded
                                )
                            })
                        })
                })
                .map(|(integration_id, _integration)| integration_id.clone())
                .collect(),
        ),
        CommandQuery::Delivery(integration_id) => QueryResult::Delivery(
            projection
                .integrations
                .get(&integration_id)
                .map(|integration| IntegrationDeliveryView {
                    checkpoint_state: integration.checkpoint_state.clone(),
                    applied_state: integration.applied_state.clone(),
                    applied_incarnation: integration.applied_incarnation.clone(),
                    foreground_work: integration.foreground_work.clone(),
                    reconciliation_work: integration.reconciliation_work.clone(),
                    reconciliation_cycle: integration.reconciliation_cycle,
                    execution_eligible: integration.execution_eligible(),
                    maintenance: integration.maintenance,
                    restore_evidence: integration.restore_evidence.clone(),
                }),
        ),
        CommandQuery::Checkpoint { run_id, name } => QueryResult::Checkpoint(
            projection
                .runs
                .get(&run_id)
                .and_then(|run| run.steps.get(&name))
                .cloned(),
        ),
        CommandQuery::AttemptCurrent { run_id, attempt_id } => {
            let current = projection.runs.get(&run_id).is_some_and(|run| {
                run.status == super::super::projection::RunStatus::Running
                    && run.attempt_id.as_ref() == Some(&attempt_id)
            });
            QueryResult::AttemptCurrent(current)
        }
        CommandQuery::State(integration_id) => QueryResult::State(
            projection
                .integrations
                .get(&integration_id)
                .map(|integration| StateCursor {
                    state: integration.checkpoint_state.clone(),
                    established_at_sequence: integration.checkpoint_state_sequence,
                    projected_through_sequence: projection.through_log_sequence,
                }),
        ),
    }
}

fn run_view(projection: &Projection, run_id: &super::super::ids::RunId) -> Option<RunView> {
    let run = projection.runs.get(run_id)?;
    let integration = projection.integrations.get(&run.integration_id)?;
    let completion_result = (run.status == super::super::projection::RunStatus::Running
        && integration.foreground_work.is_none())
    .then(|| {
        projection.work.values().find_map(|work| {
            if work.status != WorkStatus::Completed {
                return None;
            }
            match &work.kind {
                WorkKind::Apply(apply) if &apply.run_id == run_id => {
                    Some(apply.candidate.artifact.clone())
                }
                WorkKind::Apply(_) | WorkKind::Restore(_) | WorkKind::Reconcile(_) => None,
            }
        })
    })
    .flatten();
    Some(RunView {
        run_id: run_id.clone(),
        integration_id: run.integration_id.clone(),
        status: run.status,
        attempt: run.attempt,
        handler_failures: run.handler_failures,
        attempt_id: run.attempt_id.clone(),
        immutable_input: run.immutable_input.clone(),
        policy: run.policy.clone(),
        submitted_at: run.submitted_at.clone(),
        artifacts: run.artifacts.clone(),
        steps: run.steps.clone(),
        result: run.result.clone(),
        failure: run.failure.clone(),
        revision: run.revision.clone(),
        active_work_id: integration.foreground_work.clone(),
        completion_result,
    })
}

struct RecoveredProjection {
    projection: Projection,
    snapshot_through_log_sequence: Option<u64>,
    snapshot_created_at: Option<String>,
    replayed_events: u64,
    corruption_fallbacks: u64,
}

async fn replay_with_snapshots(
    writer: &ShardLogWriter,
    shard: crate::orchestrator::routing::Shard,
    durable_end_exclusive: u64,
    snapshots: Option<(&ArtifactStore, &TenantNamespace)>,
) -> Result<RecoveredProjection, ShardCommandError> {
    let mut corruption_fallbacks = 0_u64;
    if let Some((store, tenant)) = snapshots {
        match writer
            .scan_projection_snapshots(durable_end_exclusive)
            .await
        {
            Ok(candidates) => {
                for (reference_sequence, candidate) in candidates.into_iter().rev() {
                    let snapshot = match candidate {
                        Ok(snapshot) => snapshot,
                        Err(error) => {
                            corruption_fallbacks = corruption_fallbacks.saturating_add(1);
                            tracing::warn!(
                                shard = %crate::orchestrator::routing::shard_path(shard),
                                reference_sequence,
                                error = %error,
                                "ignored malformed projection-snapshot reference"
                            );
                            continue;
                        }
                    };
                    let through = match IntegrationsDomain::snapshot_bounds(&snapshot) {
                        Ok((_shard, through)) => through,
                        Err(error) => {
                            corruption_fallbacks = corruption_fallbacks.saturating_add(1);
                            tracing::warn!(
                                shard = %crate::orchestrator::routing::shard_path(shard),
                                reference_sequence,
                                error = %error,
                                "ignored projection snapshot with invalid addressing"
                            );
                            continue;
                        }
                    };
                    if through >= reference_sequence || through >= durable_end_exclusive {
                        corruption_fallbacks = corruption_fallbacks.saturating_add(1);
                        tracing::warn!(
                            shard = %crate::orchestrator::routing::shard_path(shard),
                            reference_sequence,
                            through_log_sequence = through,
                            durable_end_exclusive,
                            "ignored projection snapshot with an impossible journal range"
                        );
                        continue;
                    }
                    let projection = match IntegrationsDomain::load_snapshot_projection(
                        store, tenant, shard, &snapshot,
                    )
                    .await
                    {
                        Ok(projection) => projection,
                        Err(error) => {
                            corruption_fallbacks = corruption_fallbacks.saturating_add(1);
                            tracing::warn!(
                                shard = %crate::orchestrator::routing::shard_path(shard),
                                reference_sequence,
                                error = %error,
                                "ignored unusable projection snapshot"
                            );
                            continue;
                        }
                    };
                    match replay_durable_suffix(writer, shard, durable_end_exclusive, projection)
                        .await
                    {
                        Ok((projection, replayed_events)) => {
                            return Ok(RecoveredProjection {
                                projection,
                                snapshot_through_log_sequence: Some(through),
                                snapshot_created_at: Some(IntegrationsDomain::snapshot_created_at(
                                    &snapshot,
                                )),
                                replayed_events,
                                corruption_fallbacks,
                            });
                        }
                        Err(error) => {
                            corruption_fallbacks = corruption_fallbacks.saturating_add(1);
                            tracing::warn!(
                                shard = %crate::orchestrator::routing::shard_path(shard),
                                reference_sequence,
                                error = %error,
                                "projection snapshot suffix failed validation; trying an older snapshot"
                            );
                        }
                    }
                }
            }
            Err(error) => {
                corruption_fallbacks = corruption_fallbacks.saturating_add(1);
                tracing::warn!(
                    shard = %crate::orchestrator::routing::shard_path(shard),
                    error = ?error,
                    "projection-snapshot discovery failed; replaying the complete journal"
                );
            }
        }
    }
    replay_durable_prefix(writer, shard, durable_end_exclusive)
        .await
        .map(|(projection, replayed_events)| RecoveredProjection {
            projection,
            snapshot_through_log_sequence: None,
            snapshot_created_at: None,
            replayed_events,
            corruption_fallbacks,
        })
}

async fn replay_durable_prefix(
    writer: &ShardLogWriter,
    shard: crate::orchestrator::routing::Shard,
    durable_end_exclusive: u64,
) -> Result<(Projection, u64), ShardCommandError> {
    replay_durable_suffix(writer, shard, durable_end_exclusive, Projection::default()).await
}

async fn replay_durable_suffix(
    writer: &ShardLogWriter,
    shard: crate::orchestrator::routing::Shard,
    durable_end_exclusive: u64,
    mut recovered: Projection,
) -> Result<(Projection, u64), ShardCommandError> {
    // Scan through the same Remote-visible LogDb whose watermark was captured.
    // A detached or stale reader must never certify prefix completeness.
    let scan_started = std::time::Instant::now();
    let through_sequence = IntegrationsDomain::through_sequence(&recovered);
    let records = writer
        .scan_suffix(through_sequence, durable_end_exclusive)
        .await
        .map_err(|error| recovery(format!("scan durable shard prefix: {error:?}")));
    let records = records?;

    tracing::info!(
        shard = %crate::orchestrator::routing::shard_path(shard),
        from_sequence = through_sequence.map_or(0, |sequence| sequence.saturating_add(1)),
        durable_end_exclusive,
        records = records.len(),
        elapsed_ms = u64::try_from(scan_started.elapsed().as_millis()).unwrap_or(u64::MAX),
        "scanned durable shard replay suffix"
    );

    let replayed_events = u64::try_from(records.len()).unwrap_or(u64::MAX);
    for (sequence, record) in records {
        IntegrationsDomain::replay(&mut recovered, shard, sequence, record).map_err(recovery)?;
    }
    Ok((recovered, replayed_events))
}

/// The integration's planned foreground work, when it is runnable.
fn planned_foreground_work(
    projection: &Projection,
    integration: &super::super::projection::IntegrationProjection,
) -> Option<WorkRecoveryIntent> {
    integration
        .foreground_work
        .as_ref()
        .and_then(|work_id| work_intent(projection, work_id))
        .filter(|work| work.status == WorkStatus::Planned)
}

/// The integration's planned reconciliation work, when the shared
/// background-delivery eligibility predicate admits it.
fn runnable_reconcile_work(
    projection: &Projection,
    integration: &super::super::projection::IntegrationProjection,
) -> Option<WorkRecoveryIntent> {
    if !integration.background_delivery_eligible() {
        return None;
    }
    integration
        .reconciliation_work
        .as_ref()
        .and_then(|work_id| work_intent(projection, work_id))
        .filter(|work| work.status == WorkStatus::Planned)
}

fn work_intent(projection: &Projection, work_id: &WorkId) -> Option<WorkRecoveryIntent> {
    projection
        .work
        .get(work_id)
        .map(|work| work_intent_from_projection(work_id, work))
}

fn work_intent_from_projection(
    work_id: &WorkId,
    work: &super::super::projection::WorkProjection,
) -> WorkRecoveryIntent {
    WorkRecoveryIntent {
        integration_id: work.integration_id.clone(),
        work_id: work_id.clone(),
        manifest: work.manifest.clone(),
        kind: work.kind.clone(),
        status: work.status,
        effect_count: work.effect_count,
        completed_effect_count: work.completed_effect_count,
        last_completed_effect: work.last_completed_effect.clone(),
        failure: work.failure.clone(),
        settings_revision: work.settings_revision,
        revision: work.revision.clone(),
    }
}

fn invalid_candidate(error: InvalidTransition) -> ShardCommandError {
    ShardCommandError {
        kind: ShardCommandErrorKind::InvalidCandidate,
        message: error.to_string(),
    }
}

fn append_error(error: ShardAppendError) -> ShardCommandError {
    let kind = match error.disposition {
        AppendDisposition::DefinitelyNotCommitted => ShardCommandErrorKind::DefinitelyNotCommitted,
        AppendDisposition::CommitUnknown => ShardCommandErrorKind::CommitUnknown,
        AppendDisposition::Fenced => ShardCommandErrorKind::Fenced,
    };
    ShardCommandError {
        kind,
        message: error.to_string(),
    }
}

fn recovery(message: impl Into<String>) -> ShardCommandError {
    ShardCommandError {
        kind: ShardCommandErrorKind::Recovery,
        message: message.into(),
    }
}

fn closed(message: impl Into<String>) -> ShardCommandError {
    ShardCommandError {
        kind: ShardCommandErrorKind::Closed,
        message: message.into(),
    }
}

fn is_terminal(kind: ShardCommandErrorKind) -> bool {
    matches!(
        kind,
        ShardCommandErrorKind::CommitUnknown
            | ShardCommandErrorKind::Fenced
            | ShardCommandErrorKind::Recovery
    )
}

#[cfg(test)]
#[derive(Default)]
struct TestHarness {
    faults: VecDeque<super::AppendFault>,
    before_append: Option<Arc<TestGate>>,
    before_recovery: Option<Arc<TestGate>>,
}

#[cfg(test)]
#[derive(Default)]
struct TestGate {
    armed: AtomicBool,
    entered: Notify,
    release: Notify,
}

#[cfg(test)]
impl TestGate {
    fn armed() -> Arc<Self> {
        Arc::new(Self {
            armed: AtomicBool::new(true),
            entered: Notify::new(),
            release: Notify::new(),
        })
    }

    async fn wait_once(&self) {
        if self.armed.swap(false, Ordering::AcqRel) {
            self.entered.notify_one();
            self.release.notified().await;
        }
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]
mod tests {
    use std::time::Duration;

    use opendata_common::storage::config::{
        LocalObjectStoreConfig, ObjectStoreConfig, SlateDbStorageConfig,
    };
    use opendata_common::StorageConfig;
    use sha2::{Digest as _, Sha256};
    use tempfile::TempDir;

    use super::*;
    use crate::blob::{
        ArtifactStore, BlobRef, BlobRefV1, BoundedCasDocument, StateSnapshot, StateSnapshotV1,
    };
    use crate::orchestrator::control::{
        CancelRunV1, ControlCommandV1, ControlRequest, ControlRequestContextV1,
        ControlRequestTargetV1, ControlRequestV1, IntegrationDesiredState,
        SetIntegrationDesiredStateV1,
    };
    use crate::orchestrator::events::{
        AttemptStartedV1, ControlRejectionReason, ControlRequestRejectedV1, InputRef, JournalEvent,
        JournalEventV1, PolicyRef, RunAcceptedV1, WorkChunkCompletedV1, WorkPlannedV1,
    };
    use crate::orchestrator::ids::{
        derive_attempt_id, CanonicalIntegrationId, EffectId, EventId, RequestDigest, RequestId,
        RunId, StateVersionId, TenantNamespace, WorkId,
    };
    use crate::orchestrator::inbox::{CachePublication, ControlInbox, DiscoveredControlRequest};
    use crate::orchestrator::registry::DurableRecord;
    use crate::orchestrator::routing::{self, Keyspace, Shard};
    use crate::orchestrator::work::{
        ApplyWorkV1, DesiredProjectionRef, ReconcileWorkV1, StatePhase, StatePhaseV1, StateVersion,
        StateVersionRef, StateVersionV1, WorkKind, WorkManifest, WorkManifestV1,
    };

    struct TestPrefix {
        _root: TempDir,
        location: ShardLogLocation,
    }

    impl TestPrefix {
        fn new(shard: u16) -> Self {
            let root = tempfile::tempdir().expect("create object-store root");
            let tenant = TenantNamespace::parse("alice").expect("valid tenant");
            let shard = Shard::try_from(shard).expect("valid shard");
            let path = Keyspace::for_tenant(&tenant).shard_log(shard);
            let location = ShardLogLocation {
                shard,
                read_timeout: super::super::DURABILITY_TIMEOUT,
                durability_timeout: super::super::DURABILITY_TIMEOUT,
                storage: StorageConfig::SlateDb(SlateDbStorageConfig {
                    path,
                    object_store: ObjectStoreConfig::Local(LocalObjectStoreConfig {
                        path: root.path().display().to_string(),
                    }),
                    settings_path: None,
                    block_cache: None,
                    meta_cache: None,
                }),
            };
            Self {
                _root: root,
                location,
            }
        }

        fn artifact_store(&self, cache_root: &TempDir) -> ArtifactStore {
            ArtifactStore::local(self._root.path(), cache_root.path())
                .expect("open test artifact store")
        }
    }

    fn config(capacity: usize, retries: u32) -> ShardCommandConfig {
        ShardCommandConfig::new(
            NonZeroUsize::new(capacity).expect("positive channel capacity"),
            retries,
        )
        .allow_local_reopen()
    }

    fn blob(key: &str, digest: char) -> BlobRef {
        BlobRef::V1(BlobRefV1 {
            key: key.to_owned(),
            sha256: digest.to_string().repeat(64),
            size: 10,
            media_type: "application/json".to_owned(),
            e_tag: None,
            provider_version: None,
        })
    }

    fn integration_on_shard(shard: u16, label: &str) -> CanonicalIntegrationId {
        let expected_shard = Shard::try_from(shard).expect("valid shard");
        (0_u32..)
            .find_map(|suffix| {
                let id = CanonicalIntegrationId::parse(format!("alice:{label}-{suffix}"))
                    .expect("valid integration ID");
                (routing::shard(&id) == expected_shard).then_some(id)
            })
            .expect("one connector suffix routes to the test shard")
    }

    fn accepted(shard: u16, label: &str, run: u32) -> JournalRecordV1 {
        let integration = integration_on_shard(shard, label);
        accepted_for(integration, run)
    }

    fn accepted_for(integration: CanonicalIntegrationId, run: u32) -> JournalRecordV1 {
        let run_id =
            RunId::parse(format!("{run:08x}-0000-4000-8000-000000000001")).expect("valid run ID");
        JournalRecordV1::new(
            integration,
            JournalEvent::V1(JournalEventV1::RunAccepted(RunAcceptedV1 {
                run_id,
                immutable_input: InputRef {
                    artifact: blob("inputs/definition.json", 'a'),
                    definition_digest: "b".repeat(64),
                    definition_digest_encoding_version: 1,
                    planner_version: 1,
                },
                policy: PolicyRef {
                    artifact: blob("inputs/policy.json", 'c'),
                    policy_digest: "d".repeat(64),
                },
                submitted_at: "2026-07-22T00:00:00Z".to_owned(),
            })),
        )
        .expect("valid RunAccepted record")
    }

    fn apply_work_records(shard: u16) -> (Vec<JournalRecordV1>, WorkId, EffectId) {
        let integration = integration_on_shard(shard, "live-work");
        let run = 7;
        let run_id =
            RunId::parse(format!("{run:08x}-0000-4000-8000-000000000001")).expect("valid run ID");
        let state = StateVersionV1::new(
            "actor:owner".to_owned(),
            None,
            StatePhase::V1(StatePhaseV1::SourcesCommitted),
            StateSnapshot::V1(StateSnapshotV1 {
                generation: 1,
                duckdb: blob("states/candidate.duckdb", '5'),
                accepted_batches: Vec::new(),
                created_at: "2026-07-21T10:00:00Z".to_owned(),
            }),
            DesiredProjectionRef {
                artifact: blob("states/desired.json", '6'),
            },
            "7".repeat(64),
            1,
            1,
            1,
            1,
        )
        .expect("valid candidate state");
        let state_record = StateVersion::V1(state.clone());
        let state_bytes = state_record.encode().expect("encode candidate state");
        let mut state_artifact = blob("states/candidate.json", '0');
        let BlobRef::V1(state_artifact) = &mut state_artifact;
        state_artifact.sha256 = hex::encode(Sha256::digest(&state_bytes));
        state_artifact.size = u64::try_from(state_bytes.len()).expect("state size fits u64");
        let candidate = StateVersionRef {
            id: state.id,
            artifact: BlobRef::V1(state_artifact.clone()),
        };

        let manifest = WorkManifestV1::new(
            &integration,
            "actor:owner".to_owned(),
            WorkKind::Apply(ApplyWorkV1 {
                run_id: run_id.clone(),
                candidate: candidate.clone(),
            }),
            blob("work/effects.ndjson", '8'),
            3,
            1,
            1,
            "2026-07-21T10:01:00Z".to_owned(),
        )
        .expect("valid work manifest");
        let work_id = manifest.work_id.clone();
        let manifest_record = WorkManifest::V1(manifest.clone());
        let manifest_bytes = manifest_record.encode().expect("encode work manifest");
        let manifest_digest = hex::encode(Sha256::digest(&manifest_bytes));
        let mut manifest_artifact = blob("work/manifest.json", '0');
        let BlobRef::V1(manifest_artifact) = &mut manifest_artifact;
        manifest_artifact.sha256 = manifest_digest.clone();
        manifest_artifact.size =
            u64::try_from(manifest_bytes.len()).expect("manifest size fits u64");
        let manifest_ref = WorkManifestRef {
            work_id: work_id.clone(),
            artifact: BlobRef::V1(manifest_artifact.clone()),
            manifest_digest: manifest_digest.clone(),
        };
        let last_effect = EffectId::parse("9".repeat(64)).expect("valid effect ID");
        let record = |event| {
            JournalRecordV1::new(integration.clone(), JournalEvent::V1(event))
                .expect("valid work journal record")
        };
        (
            vec![
                accepted_for(integration.clone(), run),
                record(JournalEventV1::AttemptStarted(AttemptStartedV1 {
                    run_id: run_id.clone(),
                    attempt_id: derive_attempt_id(&run_id, 1),
                    attempt: 1,
                })),
                record(JournalEventV1::WorkPlanned(WorkPlannedV1 {
                    manifest: manifest_ref,
                    manifest_record,
                    candidate_state_record: Some(state_record),
                })),
                record(JournalEventV1::WorkChunkCompleted(WorkChunkCompletedV1 {
                    work_id: work_id.clone(),
                    manifest_digest,
                    completed_effect_count: 2,
                    last_effect_id: last_effect.clone(),
                })),
            ],
            work_id,
            last_effect,
        )
    }

    fn conflicting_control_outcomes(shard: u16) -> (JournalRecordV1, JournalRecordV1) {
        let integration = integration_on_shard(shard, "control-conflict");
        let request = ControlRequestContextV1 {
            request_id: RequestId::parse("1".repeat(64)).expect("valid request ID"),
            request_digest: RequestDigest::parse("2".repeat(64)).expect("valid request digest"),
            expected_revision: Some(EventId::parse("3".repeat(64)).expect("valid revision")),
        };
        let target =
            ControlRequestTargetV1::Work(WorkId::parse("4".repeat(64)).expect("valid work ID"));
        let make = |reason_code| {
            JournalRecordV1::new(
                integration.clone(),
                JournalEvent::V1(JournalEventV1::ControlRequestRejected(
                    ControlRequestRejectedV1 {
                        request: request.clone(),
                        target: target.clone(),
                        reason_code,
                        observed_revision: None,
                    },
                )),
            )
            .expect("valid control outcome")
        };
        let not_found = make(ControlRejectionReason::NotFound);
        let conflict = make(ControlRejectionReason::Conflict);
        assert_eq!(not_found.event_id, conflict.event_id);
        assert_ne!(
            not_found.digest().expect("not-found digest"),
            conflict.digest().expect("conflict digest")
        );
        (not_found, conflict)
    }

    async fn start(
        prefix: &TestPrefix,
        config: ShardCommandConfig,
        harness: TestHarness,
    ) -> (
        ShardCommandHandle,
        tokio::task::JoinHandle<Result<(), ShardCommandError>>,
    ) {
        let (handle, _startup, _state_changes, task) =
            CommandLoop::start(prefix.location.clone(), config, harness)
                .await
                .expect("start command loop");
        (handle, task)
    }

    async fn stop(
        handle: &ShardCommandHandle,
        task: tokio::task::JoinHandle<Result<(), ShardCommandError>>,
    ) {
        handle.shutdown().await.expect("request clean shutdown");
        task.await
            .expect("command loop task joins")
            .expect("command loop stops cleanly");
    }

    async fn durable_records(prefix: &TestPrefix) -> Vec<(u64, JournalRecord)> {
        let reader = ShardLogRecovery::open(&prefix.location)
            .await
            .expect("open recovery reader");
        let records = reader.scan().await.expect("scan durable records");
        reader.close().await;
        records
    }

    #[tokio::test]
    async fn recovery_window_honors_inclusive_cursor_and_exclusive_end_boundaries() {
        let prefix = TestPrefix::new(45);
        let writer = ShardLogWriter::open(&prefix.location)
            .await
            .expect("open seed writer");
        for value in 1..=3 {
            writer
                .append(&JournalRecord::V1(accepted(
                    45,
                    &format!("window-{value}"),
                    value,
                )))
                .await
                .expect("append seed record");
        }
        let durable_end_exclusive = writer.durable_end_exclusive();
        assert_eq!(durable_end_exclusive, 3);
        writer.close().await.expect("close seed writer");

        let reader = ShardLogRecovery::open(&prefix.location)
            .await
            .expect("open bounded reader");
        assert!(reader
            .scan_suffix(None, 0)
            .await
            .expect("empty window")
            .is_empty());
        assert_eq!(
            reader
                .scan_suffix(None, 1)
                .await
                .expect("one-record window")
                .iter()
                .map(|(sequence, _record)| *sequence)
                .collect::<Vec<_>>(),
            vec![0]
        );
        assert_eq!(
            reader
                .scan_suffix(Some(0), durable_end_exclusive)
                .await
                .expect("snapshot suffix")
                .iter()
                .map(|(sequence, _record)| *sequence)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert!(reader
            .scan_suffix(Some(0), 1)
            .await
            .expect("empty suffix after inclusive cursor")
            .is_empty());
        assert!(reader.scan_suffix(Some(1), 1).await.is_err());
        reader.close().await;
    }

    #[tokio::test]
    async fn startup_replays_the_captured_prefix_before_publishing_the_handle() {
        let prefix = TestPrefix::new(46);
        let record = accepted(46, "startup-existing", 1);
        let writer = ShardLogWriter::open(&prefix.location)
            .await
            .expect("open seed writer");
        writer
            .append(&JournalRecord::V1(record.clone()))
            .await
            .expect("append seed record");
        writer.close().await.expect("close seed writer");

        let StartedShard {
            handle,
            recovery: startup,
            state_changes: _,
            task,
        } = start_recovered(prefix.location.clone(), config(1, 1))
            .await
            .expect("start recovered command loop");
        assert!(startup.durable_end_exclusive > 0);
        assert!(startup.live_work.is_empty());
        assert!(matches!(
            handle
                .propose(record)
                .await
                .expect("existing event is already projected"),
            ShardCommandOutcome::AlreadyDurable { .. }
        ));

        stop(&handle, task).await;
        assert_eq!(durable_records(&prefix).await.len(), 1);
    }

    #[tokio::test]
    async fn startup_returns_live_work_with_the_exact_durable_resume_cursor() {
        let prefix = TestPrefix::new(47);
        let (records, work_id, last_effect) = apply_work_records(47);
        let writer = ShardLogWriter::open(&prefix.location)
            .await
            .expect("open seed writer");
        for record in records {
            writer
                .append(&JournalRecord::V1(record))
                .await
                .expect("append work history");
        }
        writer.close().await.expect("close seed writer");

        let StartedShard {
            handle,
            recovery: startup,
            state_changes: _,
            task,
        } = start_recovered(prefix.location.clone(), config(1, 1))
            .await
            .expect("start recovered command loop");
        assert!(startup.durable_end_exclusive > 3);
        assert_eq!(startup.live_work.len(), 1);
        let intent = &startup.live_work[0];
        assert_eq!(intent.work_id, work_id);
        assert_eq!(intent.status, WorkStatus::Planned);
        assert_eq!(intent.effect_count, 3);
        assert_eq!(intent.completed_effect_count, 2);
        assert_eq!(intent.last_completed_effect.as_ref(), Some(&last_effect));

        stop(&handle, task).await;
    }

    #[tokio::test]
    async fn control_resolution_is_serialized_and_recovers_before_revalidation() {
        let prefix = TestPrefix::new(48);
        let accepted = accepted(48, "control-resolution", 1);
        let integration = accepted.integration_id.clone();
        let JournalEvent::V1(JournalEventV1::RunAccepted(accepted_event)) = &accepted.event else {
            panic!("fixture must be RunAccepted");
        };
        let run_id = accepted_event.run_id.clone();
        let initial_revision = accepted.event_id.clone();
        let request = ControlRequestV1::new(
            TenantNamespace::parse("alice").expect("valid tenant"),
            integration.clone(),
            "actor:alice".to_owned(),
            ControlCommandV1::CancelRun(CancelRunV1 {
                run_id: run_id.clone(),
                expected_run_revision: initial_revision.clone(),
                expected_failed_work: None,
            }),
        )
        .expect("valid cancellation request");
        let (handle, task) = start(&prefix, config(4, 1), TestHarness::default()).await;
        handle
            .propose(accepted)
            .await
            .expect("accept run before cancellation");

        let resolved = handle
            .resolve_control(request.clone(), None)
            .await
            .expect("resolve cancellation");
        assert!(matches!(
            resolved.append,
            ShardCommandOutcome::Applied { .. }
        ));
        assert!(matches!(
            resolved.outcome.outcome,
            crate::orchestrator::projection::ControlRequestOutcomeKindV1::Accepted { .. }
        ));

        // A restart or lost delete must adopt the durable outcome before the
        // cancellation's own event has made its expected revision stale.
        let recovered = handle
            .resolve_control(request.clone(), Some(ControlRejectionReason::Unauthorized))
            .await
            .expect("durable outcome wins over later validation");
        assert!(matches!(
            recovered.append,
            ShardCommandOutcome::AlreadyDurable { .. }
        ));
        assert_eq!(recovered.outcome, resolved.outcome);
        assert_eq!(
            handle
                .inspect_control(request)
                .await
                .expect("inspect durable outcome")
                .outcome,
            Some(resolved.outcome)
        );

        let stale = ControlRequestV1::new(
            TenantNamespace::parse("alice").expect("valid tenant"),
            integration,
            "actor:stale-reader".to_owned(),
            ControlCommandV1::CancelRun(CancelRunV1 {
                run_id,
                expected_run_revision: initial_revision,
                expected_failed_work: None,
            }),
        )
        .expect("valid stale cancellation request");
        let stale_outcome = handle
            .resolve_control(stale, None)
            .await
            .expect("journal stale-revision rejection");
        assert!(matches!(
            stale_outcome.outcome.outcome,
            crate::orchestrator::projection::ControlRequestOutcomeKindV1::Rejected {
                reason_code: ControlRejectionReason::StaleRevision,
                observed_revision: Some(_),
                ..
            }
        ));

        stop(&handle, task).await;
        assert_eq!(durable_records(&prefix).await.len(), 3);
    }

    #[tokio::test]
    async fn post_append_crash_rebuilds_cache_and_deletes_only_from_projection() {
        let prefix = TestPrefix::new(49);
        let cache = tempfile::tempdir().expect("create artifact cache");
        let store = prefix.artifact_store(&cache);
        let accepted = accepted(49, "control-cache-recovery", 1);
        let integration = accepted.integration_id.clone();
        let JournalEvent::V1(JournalEventV1::RunAccepted(accepted_event)) = &accepted.event else {
            panic!("fixture must be RunAccepted");
        };
        let tenant = TenantNamespace::parse("alice").expect("valid tenant");
        let request = ControlRequestV1::new(
            tenant.clone(),
            integration,
            "actor:alice".to_owned(),
            ControlCommandV1::CancelRun(CancelRunV1 {
                run_id: accepted_event.run_id.clone(),
                expected_run_revision: accepted.event_id.clone(),
                expected_failed_work: None,
            }),
        )
        .expect("valid cancellation request");
        let request_key = Keyspace::for_tenant(&tenant).request(
            Shard::try_from(49).expect("valid shard"),
            &request.request_id,
        );
        store
            .create_cas_document(
                &request_key,
                ControlRequest::V1(request.clone())
                    .encode()
                    .expect("encode request"),
            )
            .await
            .expect("create request object");

        let (handle, task) = start(&prefix, config(4, 1), TestHarness::default()).await;
        handle
            .propose(accepted)
            .await
            .expect("accept run before cancellation");
        handle
            .resolve_control(request.clone(), None)
            .await
            .expect("append authoritative outcome before simulated crash");

        let mut inbox = ControlInbox::new(
            store.clone(),
            tenant.clone(),
            Shard::try_from(49).expect("valid shard"),
            handle.clone(),
            Arc::new(|_request: &ControlRequestV1| -> bool {
                panic!("authorization must not rerun after a durable outcome")
            }),
            NonZeroUsize::new(4).expect("nonzero batch"),
        );
        let discovered = inbox.discover_batch().await.expect("rediscover request");
        assert_eq!(discovered.len(), 1);
        let processed = inbox
            .process_one(DiscoveredControlRequest {
                key: request_key.clone(),
                request: discovered[0].request.clone(),
            })
            .await
            .expect("rebuild cache from authoritative projection");
        assert_eq!(processed.cache, CachePublication::Created);
        assert!(matches!(
            store
                .get_cas_document_bounded(&request_key, 64 * 1024)
                .await
                .expect("inspect deleted request"),
            BoundedCasDocument::Missing
        ));
        let result_key = Keyspace::for_tenant(&tenant).request_result(
            Shard::try_from(49).expect("valid shard"),
            &request.request_id,
        );
        assert!(matches!(
            store
                .get_cas_document_bounded(&result_key, 16 * 1024)
                .await
                .expect("inspect rebuilt cache"),
            BoundedCasDocument::Present(_, _)
        ));

        stop(&handle, task).await;
    }

    #[tokio::test]
    async fn cancellation_promotes_the_exact_admitted_receipt_before_resolving() {
        let prefix = TestPrefix::new(50);
        let cache = tempfile::tempdir().expect("create artifact cache");
        let store = prefix.artifact_store(&cache);
        let tenant = TenantNamespace::parse("alice").expect("valid tenant");
        let integration = integration_on_shard(50, "cancel-before-acceptance");
        let submitted = crate::orchestrator::submission::submit_durable(
            &store,
            &tenant,
            integration.clone(),
            InputRef {
                artifact: blob("inputs/definition.json", 'a'),
                definition_digest: "b".repeat(64),
                definition_digest_encoding_version: 1,
                planner_version: 1,
            },
            PolicyRef {
                artifact: blob("inputs/policy.json", 'c'),
                policy_digest: "d".repeat(64),
            },
            "2026-07-22T10:00:00Z".to_owned(),
        )
        .await
        .expect("submit admitted ready receipt");
        let request = ControlRequestV1::new(
            tenant.clone(),
            integration,
            "actor:alice".to_owned(),
            ControlCommandV1::CancelRun(CancelRunV1 {
                run_id: submitted.run_id.clone(),
                expected_run_revision: submitted.initial_revision,
                expected_failed_work: None,
            }),
        )
        .expect("valid cancellation request");
        let shard = Shard::try_from(50).expect("valid shard");
        let paths = Keyspace::for_tenant(&tenant);
        let request_key = paths.request(shard, &request.request_id);
        store
            .create_cas_document(
                &request_key,
                ControlRequest::V1(request.clone())
                    .encode()
                    .expect("encode request"),
            )
            .await
            .expect("create cancellation request");

        let (handle, task) = start(&prefix, config(4, 1), TestHarness::default()).await;
        let inbox = ControlInbox::new(
            store.clone(),
            tenant,
            shard,
            handle.clone(),
            Arc::new(|_request: &ControlRequestV1| true),
            NonZeroUsize::new(4).expect("nonzero batch"),
        );
        let processed = inbox
            .process_one(DiscoveredControlRequest {
                key: request_key,
                request,
            })
            .await
            .expect("promote admitted receipt then cancel it");
        assert!(matches!(
            processed.outcome.outcome,
            crate::orchestrator::projection::ControlRequestOutcomeKindV1::Accepted { .. }
        ));
        assert!(matches!(
            store
                .get_cas_document_bounded(
                    &paths.ready_receipt(shard, &submitted.run_id),
                    256 * 1024,
                )
                .await
                .expect("inspect promoted receipt"),
            BoundedCasDocument::Missing
        ));

        stop(&handle, task).await;
        let records = durable_records(&prefix).await;
        assert_eq!(records.len(), 2);
        assert!(matches!(
            &records[0].1,
            JournalRecord::V1(JournalRecordV1 {
                event: JournalEvent::V1(JournalEventV1::RunAccepted(_)),
                ..
            })
        ));
        assert!(matches!(
            &records[1].1,
            JournalRecord::V1(JournalRecordV1 {
                event: JournalEvent::V1(JournalEventV1::RunTerminated(_)),
                ..
            })
        ));
    }

    #[tokio::test]
    async fn cancellation_is_not_found_only_when_run_and_exact_admission_are_both_absent() {
        let prefix = TestPrefix::new(52);
        let cache = tempfile::tempdir().expect("create artifact cache");
        let store = prefix.artifact_store(&cache);
        let tenant = TenantNamespace::parse("alice").expect("valid tenant");
        let shard = Shard::try_from(52).expect("valid shard");
        let request = ControlRequestV1::new(
            tenant.clone(),
            integration_on_shard(52, "missing-cancel-target"),
            "actor:alice".to_owned(),
            ControlCommandV1::CancelRun(CancelRunV1 {
                run_id: RunId::parse("00000000-0000-4000-8000-000000000052").expect("valid run ID"),
                expected_run_revision: EventId::parse("7".repeat(64))
                    .expect("valid expected revision"),
                expected_failed_work: None,
            }),
        )
        .expect("valid cancellation request");
        let request_key = Keyspace::for_tenant(&tenant).request(shard, &request.request_id);
        store
            .create_cas_document(
                &request_key,
                ControlRequest::V1(request.clone())
                    .encode()
                    .expect("encode request"),
            )
            .await
            .expect("create cancellation request");

        let (handle, task) = start(&prefix, config(4, 1), TestHarness::default()).await;
        let inbox = ControlInbox::new(
            store,
            tenant,
            shard,
            handle.clone(),
            Arc::new(|_request: &ControlRequestV1| true),
            NonZeroUsize::new(4).expect("nonzero batch"),
        );
        let processed = inbox
            .process_one(DiscoveredControlRequest {
                key: request_key,
                request,
            })
            .await
            .expect("journal NotFound outcome");
        assert!(matches!(
            processed.outcome.outcome,
            crate::orchestrator::projection::ControlRequestOutcomeKindV1::Rejected {
                reason_code: ControlRejectionReason::NotFound,
                observed_revision: None,
                ..
            }
        ));
        stop(&handle, task).await;
        assert_eq!(durable_records(&prefix).await.len(), 1);
    }

    #[tokio::test]
    async fn unsafe_definition_is_durably_rejected_without_persisting_secret_bytes() {
        let prefix = TestPrefix::new(51);
        let cache = tempfile::tempdir().expect("create artifact cache");
        let store = prefix.artifact_store(&cache);
        let tenant = TenantNamespace::parse("alice").expect("valid tenant");
        let shard = Shard::try_from(51).expect("valid shard");
        let integration = integration_on_shard(51, "secret-rejection");
        let definition = br#"{"connector":{"apiKey":"literal-secret"}}"#.to_vec();
        let definition_key = "tenants/alice/integrations/unsafe/definition.json";
        store
            .create_cas_document(definition_key, definition.clone())
            .await
            .expect("create immutable definition");
        let definition_ref = BlobRef::V1(BlobRefV1 {
            key: definition_key.to_owned(),
            sha256: hex::encode(Sha256::digest(&definition)),
            size: u64::try_from(definition.len()).expect("definition size fits u64"),
            media_type: "application/json".to_owned(),
            e_tag: None,
            provider_version: None,
        });
        let request = ControlRequestV1::new(
            tenant.clone(),
            integration,
            "actor:alice".to_owned(),
            ControlCommandV1::SetIntegrationDesiredState(SetIntegrationDesiredStateV1 {
                desired: IntegrationDesiredState::Enabled,
                definition_ref,
                expected_desired_revision: None,
            }),
        )
        .expect("valid desired-state request envelope");
        let request_key = Keyspace::for_tenant(&tenant).request(shard, &request.request_id);
        store
            .create_cas_document(
                &request_key,
                ControlRequest::V1(request.clone())
                    .encode()
                    .expect("encode request"),
            )
            .await
            .expect("create desired-state request");

        let (handle, task) = start(&prefix, config(4, 1), TestHarness::default()).await;
        let inbox = ControlInbox::new(
            store,
            tenant,
            shard,
            handle.clone(),
            Arc::new(|_request: &ControlRequestV1| true),
            NonZeroUsize::new(4).expect("nonzero batch"),
        );
        let processed = inbox
            .process_one(DiscoveredControlRequest {
                key: request_key,
                request,
            })
            .await
            .expect("journal safe rejection");
        assert!(matches!(
            processed.outcome.outcome,
            crate::orchestrator::projection::ControlRequestOutcomeKindV1::Rejected {
                reason_code: ControlRejectionReason::Malformed,
                ..
            }
        ));
        stop(&handle, task).await;

        let records = durable_records(&prefix).await;
        assert_eq!(records.len(), 1);
        let encoded = records[0].1.encode().expect("encode rejection");
        assert!(!String::from_utf8_lossy(&encoded).contains("literal-secret"));
    }

    #[tokio::test]
    async fn startup_fails_before_handle_publication_on_corrupt_shard_history() {
        let prefix = TestPrefix::new(48);
        let writer = ShardLogWriter::open(&prefix.location)
            .await
            .expect("open seed writer");
        writer
            .append(&JournalRecord::V1(accepted(49, "misrouted-durable", 1)))
            .await
            .expect("seed deliberately corrupt history");
        writer.close().await.expect("close seed writer");

        let error = start_recovered(prefix.location.clone(), config(1, 1))
            .await
            .expect_err("misrouted durable history prevents startup");
        assert_eq!(error.kind, ShardCommandErrorKind::Recovery);
    }

    #[tokio::test]
    async fn two_tasks_from_one_projection_revision_serialize_to_one_append() {
        let prefix = TestPrefix::new(30);
        let (handle, task) = start(&prefix, config(2, 1), TestHarness::default()).await;
        let first = accepted(30, "one-slot", 1);
        let second = accepted(30, "one-slot", 2);

        let (left, right) = tokio::join!(handle.propose(first), handle.propose(second));
        let outcomes: [_; 2] = (left, right).into();
        assert_eq!(outcomes.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            outcomes
                .iter()
                .filter(|result| {
                    result
                        .as_ref()
                        .err()
                        .is_some_and(|error| error.kind == ShardCommandErrorKind::InvalidCandidate)
                })
                .count(),
            1
        );

        stop(&handle, task).await;
        assert_eq!(durable_records(&prefix).await.len(), 1);
    }

    #[tokio::test]
    async fn duplicate_is_answered_from_projection_without_a_second_append() {
        let prefix = TestPrefix::new(31);
        let (handle, task) = start(&prefix, config(1, 1), TestHarness::default()).await;
        let record = accepted(31, "duplicate", 1);
        let event_id = record.event_id.clone();

        assert!(matches!(
            handle.propose(record.clone()).await.expect("first append"),
            ShardCommandOutcome::Applied { .. }
        ));
        assert_eq!(
            handle.propose(record).await.expect("duplicate result"),
            ShardCommandOutcome::AlreadyDurable { event_id }
        );

        stop(&handle, task).await;
        assert_eq!(durable_records(&prefix).await.len(), 1);
    }

    #[tokio::test]
    async fn misrouted_candidate_is_rejected_before_append() {
        let prefix = TestPrefix::new(40);
        let (handle, task) = start(&prefix, config(1, 1), TestHarness::default()).await;

        let error = handle
            .propose(accepted(41, "wrong-shard", 1))
            .await
            .expect_err("misrouted record must fail locally");
        assert_eq!(error.kind, ShardCommandErrorKind::InvalidCandidate);
        assert!(matches!(
            handle
                .propose(accepted(40, "right-shard", 2))
                .await
                .expect("correctly routed record applies"),
            ShardCommandOutcome::Applied { .. }
        ));

        stop(&handle, task).await;
        assert_eq!(durable_records(&prefix).await.len(), 1);
    }

    #[tokio::test]
    async fn definitely_not_committed_retries_are_bounded_and_loop_remains_usable() {
        let prefix = TestPrefix::new(32);
        let harness = TestHarness {
            faults: VecDeque::from([
                super::super::AppendFault::DefinitelyNotCommitted,
                super::super::AppendFault::DefinitelyNotCommitted,
                super::super::AppendFault::DefinitelyNotCommitted,
            ]),
            ..TestHarness::default()
        };
        let (handle, task) = start(&prefix, config(1, 2), harness).await;
        let error = handle
            .propose(accepted(32, "safe-retry-exhausted", 1))
            .await
            .expect_err("third safe failure exhausts two retries");
        assert_eq!(error.kind, ShardCommandErrorKind::DefinitelyNotCommitted);

        assert!(matches!(
            handle
                .propose(accepted(32, "after-safe-failure", 2))
                .await
                .expect("loop remains usable"),
            ShardCommandOutcome::Applied { .. }
        ));
        stop(&handle, task).await;
        assert_eq!(durable_records(&prefix).await.len(), 1);
    }

    #[tokio::test]
    async fn every_commit_unknown_boundary_recovers_to_exactly_one_record() {
        for (shard, fault) in [
            (33, super::super::AppendFault::AfterInvocation),
            (34, super::super::AppendFault::AfterAppend),
            (35, super::super::AppendFault::AfterFlush),
        ] {
            let prefix = TestPrefix::new(shard);
            let harness = TestHarness {
                faults: VecDeque::from([fault]),
                ..TestHarness::default()
            };
            let (handle, task) = start(&prefix, config(1, 1), harness).await;
            let record = accepted(shard, &format!("unknown-{shard}"), 1);
            let event_id = record.event_id.clone();

            let outcome = handle
                .propose(record.clone())
                .await
                .expect("ambiguity resolves");
            assert_eq!(
                match outcome {
                    ShardCommandOutcome::Applied { event_id, .. }
                    | ShardCommandOutcome::AlreadyDurable { event_id } => event_id,
                },
                event_id
            );
            assert!(matches!(
                handle
                    .propose(record)
                    .await
                    .expect("duplicate after recovery"),
                ShardCommandOutcome::AlreadyDurable { .. }
            ));

            stop(&handle, task).await;
            assert_eq!(durable_records(&prefix).await.len(), 1);
        }
    }

    #[tokio::test]
    async fn leased_mode_never_reopens_without_a_new_acquisition_handshake() {
        let prefix = TestPrefix::new(57);
        let harness = TestHarness {
            faults: VecDeque::from([super::super::AppendFault::AfterInvocation]),
            ..TestHarness::default()
        };
        let leased = config(1, 1).require_full_lease_handshake();
        let (handle, task) = start(&prefix, leased, harness).await;

        let error = handle
            .propose(accepted(57, "lease-reacquisition", 1))
            .await
            .expect_err("ambiguous append must terminate leased ownership");
        assert_eq!(error.kind, ShardCommandErrorKind::CommitUnknown);
        let terminal = task
            .await
            .expect("command loop task joins")
            .expect_err("leased command loop stops for external reacquisition");
        assert_eq!(terminal.kind, ShardCommandErrorKind::CommitUnknown);
        assert!(terminal.message.contains("lease acquisition handshake"));
        assert!(durable_records(&prefix).await.is_empty());
    }

    #[tokio::test]
    async fn post_append_finalize_failure_recovers_instead_of_continuing_stale() {
        let prefix = TestPrefix::new(42);
        let harness = TestHarness {
            faults: VecDeque::from([
                super::super::AppendFault::None,
                super::super::AppendFault::WrongSequence,
            ]),
            ..TestHarness::default()
        };
        let (handle, task) = start(&prefix, config(1, 1), harness).await;
        handle
            .propose(accepted(42, "first-sequence", 1))
            .await
            .expect("first event applies");
        assert!(matches!(
            handle
                .propose(accepted(42, "wrong-returned-sequence", 2))
                .await
                .expect("durable second event is adopted through recovery"),
            ShardCommandOutcome::AlreadyDurable { .. }
        ));
        handle
            .propose(accepted(42, "after-recovered-finalize", 3))
            .await
            .expect("later event sees recovered projection");

        stop(&handle, task).await;
        assert_eq!(durable_records(&prefix).await.len(), 3);
    }

    #[tokio::test]
    async fn commit_unknown_blocks_later_candidates_until_prefix_recovery_finishes() {
        let prefix = TestPrefix::new(36);
        let recovery = TestGate::armed();
        let harness = TestHarness {
            faults: VecDeque::from([super::super::AppendFault::AfterInvocation]),
            before_recovery: Some(recovery.clone()),
            ..TestHarness::default()
        };
        let (handle, task) = start(&prefix, config(2, 1), harness).await;
        let first_handle = handle.clone();
        let first =
            tokio::spawn(
                async move { first_handle.propose(accepted(36, "unknown-first", 1)).await },
            );
        recovery.entered.notified().await;
        let second_handle = handle.clone();
        let mut second = tokio::spawn(async move {
            second_handle
                .propose(accepted(36, "unknown-second", 2))
                .await
        });

        assert!(tokio::time::timeout(Duration::from_millis(25), &mut second)
            .await
            .is_err());
        recovery.release.notify_one();
        first
            .await
            .expect("first task joins")
            .expect("first proposal resolves");
        second
            .await
            .expect("second task joins")
            .expect("second proposal runs after recovery");

        stop(&handle, task).await;
        assert_eq!(durable_records(&prefix).await.len(), 2);
    }

    #[tokio::test]
    async fn ambiguity_recovery_fails_closed_on_same_event_id_with_different_content() {
        let prefix = TestPrefix::new(44);
        let recovery = TestGate::armed();
        let harness = TestHarness {
            faults: VecDeque::from([super::super::AppendFault::AfterInvocation]),
            before_recovery: Some(recovery.clone()),
            ..TestHarness::default()
        };
        let (handle, task) = start(&prefix, config(1, 1), harness).await;
        let (candidate, competing) = conflicting_control_outcomes(44);
        let proposal_handle = handle.clone();
        let proposal = tokio::spawn(async move { proposal_handle.propose(candidate).await });
        recovery.entered.notified().await;

        let competing_writer = ShardLogWriter::open(&prefix.location)
            .await
            .expect("open competing writer");
        competing_writer
            .append(&JournalRecord::V1(competing))
            .await
            .expect("append competing outcome");
        recovery.release.notify_one();

        assert_eq!(
            proposal
                .await
                .expect("proposal task joins")
                .expect_err("same event ID with different digest fails closed")
                .kind,
            ShardCommandErrorKind::InvalidCandidate
        );
        handle
            .propose(accepted(44, "after-control-conflict", 1))
            .await
            .expect("resolved candidate conflict does not corrupt durable history");

        stop(&handle, task).await;
        let _ = competing_writer.close().await;
        assert_eq!(durable_records(&prefix).await.len(), 2);
    }

    #[tokio::test]
    async fn shutdown_waits_for_ambiguous_append_resolution_and_stops_admission() {
        let prefix = TestPrefix::new(43);
        let recovery = TestGate::armed();
        let harness = TestHarness {
            faults: VecDeque::from([super::super::AppendFault::AfterInvocation]),
            before_recovery: Some(recovery.clone()),
            ..TestHarness::default()
        };
        let (handle, task) = start(&prefix, config(1, 1), harness).await;
        let proposal_handle = handle.clone();
        let proposal = tokio::spawn(async move {
            proposal_handle
                .propose(accepted(43, "shutdown-ambiguity", 1))
                .await
        });
        recovery.entered.notified().await;

        let shutdown_handle = handle.clone();
        let mut shutdown = tokio::spawn(async move { shutdown_handle.shutdown().await });
        tokio::task::yield_now().await;
        assert_eq!(
            handle
                .propose(accepted(43, "after-shutdown", 2))
                .await
                .expect_err("shutdown closes admission immediately")
                .kind,
            ShardCommandErrorKind::Closed
        );
        assert!(
            tokio::time::timeout(Duration::from_millis(25), &mut shutdown)
                .await
                .is_err()
        );

        recovery.release.notify_one();
        proposal
            .await
            .expect("proposal task joins")
            .expect("ambiguous append resolves before shutdown");
        shutdown
            .await
            .expect("shutdown task joins")
            .expect("shutdown completes");
        task.await
            .expect("loop task joins")
            .expect("loop exits cleanly");
        assert_eq!(durable_records(&prefix).await.len(), 1);
    }

    #[tokio::test]
    async fn bounded_channel_backpressures_and_dropped_caller_does_not_cancel_append() {
        let prefix = TestPrefix::new(37);
        let append = TestGate::armed();
        let harness = TestHarness {
            before_append: Some(append.clone()),
            ..TestHarness::default()
        };
        let (handle, task) = start(&prefix, config(1, 1), harness).await;

        let abandoned_handle = handle.clone();
        let abandoned_record = accepted(37, "abandoned-caller", 1);
        let abandoned_event = abandoned_record.event_id.clone();
        let abandoned =
            tokio::spawn(async move { abandoned_handle.propose(abandoned_record).await });
        append.entered.notified().await;
        abandoned.abort();

        let queued_handle = handle.clone();
        let queued =
            tokio::spawn(async move { queued_handle.propose(accepted(37, "queued", 2)).await });
        tokio::time::timeout(Duration::from_secs(1), async {
            while handle.sender.capacity() != 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("second proposal fills the one-command channel");

        let blocked_handle = handle.clone();
        let mut blocked = tokio::spawn(async move {
            blocked_handle
                .propose(accepted(37, "backpressured", 3))
                .await
        });
        assert!(
            tokio::time::timeout(Duration::from_millis(25), &mut blocked)
                .await
                .is_err()
        );

        append.release.notify_one();
        queued
            .await
            .expect("queued task joins")
            .expect("queued proposal applies");
        blocked
            .await
            .expect("blocked task joins")
            .expect("backpressured proposal eventually applies");
        stop(&handle, task).await;
        let records = durable_records(&prefix).await;
        assert_eq!(records.len(), 3);
        assert!(records.iter().any(|(_, record)| record
            .try_current()
            .expect("valid record")
            .event_id
            == abandoned_event));
    }

    #[tokio::test]
    async fn storage_fence_terminates_loop_and_rejects_queued_commands() {
        let prefix = TestPrefix::new(38);
        let append = TestGate::armed();
        let harness = TestHarness {
            before_append: Some(append.clone()),
            ..TestHarness::default()
        };
        let (handle, task) = start(&prefix, config(2, 1), harness).await;

        let first_handle = handle.clone();
        let first =
            tokio::spawn(
                async move { first_handle.propose(accepted(38, "fenced-first", 1)).await },
            );
        append.entered.notified().await;

        let newer = ShardLogWriter::open(&prefix.location)
            .await
            .expect("open newer writer");
        newer
            .append(&JournalRecord::V1(accepted(38, "new-owner", 2)))
            .await
            .expect("new owner appends");

        let second_handle = handle.clone();
        let second = tokio::spawn(async move {
            second_handle
                .propose(accepted(38, "fenced-queued", 3))
                .await
        });
        append.release.notify_one();

        assert_eq!(
            first
                .await
                .expect("first task joins")
                .expect_err("old writer is fenced")
                .kind,
            ShardCommandErrorKind::Fenced
        );
        assert_eq!(
            second
                .await
                .expect("second task joins")
                .expect_err("queued proposal is rejected")
                .kind,
            ShardCommandErrorKind::Fenced
        );
        assert_eq!(
            task.await
                .expect("loop task joins")
                .expect_err("fence terminates loop")
                .kind,
            ShardCommandErrorKind::Fenced
        );
        newer.close().await.expect("close newer writer");
    }

    #[tokio::test]
    async fn lease_loss_before_append_rejects_the_inflight_and_queued_records() {
        let prefix = TestPrefix::new(54);
        let append = TestGate::armed();
        let harness = TestHarness {
            before_append: Some(append.clone()),
            ..TestHarness::default()
        };
        let (handle, task) = start(&prefix, config(2, 1), harness).await;

        let first_handle = handle.clone();
        let first = tokio::spawn(async move {
            first_handle
                .propose(accepted(54, "lease-lost-inflight", 1))
                .await
        });
        append.entered.notified().await;
        let second_handle = handle.clone();
        let second = tokio::spawn(async move {
            second_handle
                .propose(accepted(54, "lease-lost-queued", 2))
                .await
        });
        tokio::task::yield_now().await;

        handle.stop_admission();
        handle.cancel_owned_writer();
        append.release.notify_one();

        assert_eq!(
            first
                .await
                .expect("first task joins")
                .expect_err("inflight proposal is rejected before append")
                .kind,
            ShardCommandErrorKind::Fenced
        );
        assert_eq!(
            second
                .await
                .expect("second task joins")
                .expect_err("queued proposal is rejected")
                .kind,
            ShardCommandErrorKind::Fenced
        );
        assert_eq!(
            task.await
                .expect("command task joins")
                .expect_err("lease loss is terminal")
                .kind,
            ShardCommandErrorKind::Fenced
        );
        assert!(durable_records(&prefix).await.is_empty());
    }

    #[test]
    fn background_reconcile_and_blocked_work_do_not_globally_stop_accepted_runs() {
        let accepted = accepted(55, "accepted-beside-background", 1);
        let accepted_run_id = match &accepted.event {
            JournalEvent::V1(JournalEventV1::RunAccepted(event)) => event.run_id.clone(),
            JournalEvent::V1(_) => unreachable!("fixture is RunAccepted"),
        };
        let mut projection = Projection::default();
        apply(
            &mut projection,
            SequencedJournalRecord::try_new(0, JournalRecord::V1(accepted))
                .expect("sequenced accepted run"),
        )
        .expect("project accepted run");

        let work_id = WorkId::parse("1".repeat(64)).expect("work ID");
        let target = StateVersionRef {
            id: StateVersionId::parse("2".repeat(64)).expect("state ID"),
            artifact: blob("states/background.json", '3'),
        };
        let mut background = crate::orchestrator::projection_types::WorkProjection {
            integration_id: integration_on_shard(55, "background-reconcile"),
            manifest: WorkManifestRef {
                work_id: work_id.clone(),
                artifact: blob("work/background.json", '4'),
                manifest_digest: "5".repeat(64),
            },
            kind: WorkKind::Reconcile(ReconcileWorkV1 {
                target: target.clone(),
                applied_incarnation: None,
                cycle: 1,
            }),
            effect_count: 1,
            completed_effect_count: 0,
            status: WorkStatus::Planned,
            last_completed_effect: None,
            failure: None,
            settings_revision: None,
            revision: EventId::parse("6".repeat(64)).expect("revision"),
        };
        projection.work.insert(work_id.clone(), background.clone());
        let QueryResult::NextRun(Some(run)) = query_projection(&projection, CommandQuery::NextRun)
        else {
            panic!("background Reconcile must yield to accepted foreground work")
        };
        assert_eq!(run.run_id, accepted_run_id);

        background.kind = WorkKind::Apply(ApplyWorkV1 {
            run_id: RunId::generate(),
            candidate: target.clone(),
        });
        projection.work.insert(work_id.clone(), background.clone());
        assert!(matches!(
            query_projection(&projection, CommandQuery::NextRun),
            QueryResult::NextRun(None)
        ));

        background.status = WorkStatus::Blocked;
        projection.work.insert(work_id, background);
        assert!(matches!(
            query_projection(&projection, CommandQuery::NextRun),
            QueryResult::NextRun(Some(_))
        ));
    }

    #[test]
    fn restore_required_without_live_work_is_a_schedulable_obligation() {
        let integration_id = integration_on_shard(55, "restore-obligation");
        let mut projection = Projection::default();
        projection
            .integrations
            .entry(integration_id.clone())
            .or_default()
            .maintenance = crate::orchestrator::projection::MaintenanceStatus::RestoreRequired;

        assert!(matches!(
            query_projection(&projection, CommandQuery::NextRestore),
            QueryResult::NextRestore(Some(observed)) if observed == integration_id
        ));

        projection
            .integrations
            .get_mut(&integration_id)
            .expect("integration exists")
            .foreground_work = Some(WorkId::parse("7".repeat(64)).expect("work ID"));
        assert!(matches!(
            query_projection(&projection, CommandQuery::NextRestore),
            QueryResult::NextRestore(None)
        ));
    }

    #[test]
    fn recovery_cannot_roll_back_an_acknowledged_projection() {
        let record = accepted(39, "acknowledged", 1);
        let mut previous = Projection::default();
        let input = SequencedJournalRecord::try_new(0, JournalRecord::V1(record))
            .expect("valid sequenced record");
        assert_eq!(
            apply(&mut previous, input).expect("apply acknowledged record"),
            crate::orchestrator::projection::ApplyOutcome::Applied
        );

        let error =
            IntegrationsDomain::validate_recovered_prefix(&previous, &Projection::default())
                .map_err(recovery)
                .expect_err("empty recovery cannot erase an acknowledged record");
        assert_eq!(error.kind, ShardCommandErrorKind::Recovery);
    }

    #[tokio::test]
    async fn recovery_uses_newest_valid_snapshot_then_falls_back_to_older_and_full_replay() {
        let prefix = TestPrefix::new(60);
        let tenant = TenantNamespace::parse("alice").expect("tenant");
        let first_cache = tempfile::tempdir().expect("first cache");
        let store = prefix.artifact_store(&first_cache);
        let (handle, _recovery, _states, task) = CommandLoop::start(
            prefix.location.clone(),
            config(8, 1),
            TestHarness::default(),
        )
        .await
        .expect("start shard");

        let first = accepted(60, "snapshot-first", 1);
        let first_run = match &first.event {
            JournalEvent::V1(JournalEventV1::RunAccepted(value)) => value.run_id.clone(),
            JournalEvent::V1(_) => unreachable!("fixture is RunAccepted"),
        };
        let duplicate_first = first.clone();
        let first_sequence = match handle.propose(first).await.expect("append first run") {
            ShardCommandOutcome::Applied { shard_sequence, .. } => shard_sequence,
            ShardCommandOutcome::AlreadyDurable { .. } => panic!("fresh run was already durable"),
        };
        assert!(handle
            .publish_projection_snapshot(
                &store,
                &tenant,
                chrono::DateTime::parse_from_rfc3339("2026-07-22T09:59:00Z")
                    .unwrap()
                    .with_timezone(&chrono::Utc),
                first_sequence.saturating_add(2),
            )
            .await
            .expect("check snapshot threshold")
            .is_none());
        let older = handle
            .publish_projection_snapshot(
                &store,
                &tenant,
                chrono::DateTime::parse_from_rfc3339("2026-07-22T10:00:00Z")
                    .unwrap()
                    .with_timezone(&chrono::Utc),
                1,
            )
            .await
            .expect("publish older snapshot")
            .expect("nonempty projection has a snapshot");

        let second = accepted(60, "snapshot-second", 2);
        let second_run = match &second.event {
            JournalEvent::V1(JournalEventV1::RunAccepted(value)) => value.run_id.clone(),
            JournalEvent::V1(_) => unreachable!("fixture is RunAccepted"),
        };
        handle.propose(second).await.expect("append second run");
        let newer = handle
            .publish_projection_snapshot(
                &store,
                &tenant,
                chrono::DateTime::parse_from_rfc3339("2026-07-22T10:01:00Z")
                    .unwrap()
                    .with_timezone(&chrono::Utc),
                1,
            )
            .await
            .expect("publish newer snapshot")
            .expect("advanced projection has a snapshot");
        assert!(handle
            .publish_projection_snapshot(
                &store,
                &tenant,
                chrono::DateTime::parse_from_rfc3339("2026-07-22T10:02:00Z")
                    .unwrap()
                    .with_timezone(&chrono::Utc),
                1,
            )
            .await
            .expect("unchanged snapshot trigger")
            .is_none());
        handle.shutdown().await.expect("stop first owner");
        task.await.expect("join first owner").expect("clean stop");

        std::fs::write(
            prefix
                ._root
                .path()
                .join(&newer.current().payload.current().key),
            b"corrupt",
        )
        .expect("corrupt newest payload");
        let second_cache = tempfile::tempdir().expect("second cache");
        let second_store = prefix.artifact_store(&second_cache);
        let recovered = OpenedShard::open(prefix.location.clone())
            .await
            .expect("reopen after newest corruption")
            .recover_with_snapshots(&second_store, &tenant)
            .await
            .expect("older snapshot plus suffix recovers");
        assert_eq!(
            recovered.recovery.snapshot_through_log_sequence,
            Some(first_sequence)
        );
        let started = recovered.enable(config(8, 1));
        assert!(started
            .handle
            .inspect_run(first_run.clone())
            .await
            .expect("query first run")
            .is_some());
        assert!(started
            .handle
            .inspect_run(second_run.clone())
            .await
            .expect("query suffix run")
            .is_some());
        let duplicate = started
            .handle
            .propose(duplicate_first)
            .await
            .expect("snapshot must retain pre-boundary event digests");
        assert!(matches!(
            duplicate,
            ShardCommandOutcome::AlreadyDurable { .. }
        ));
        started.handle.shutdown().await.expect("stop second owner");
        started
            .task
            .await
            .expect("join second owner")
            .expect("clean second stop");

        std::fs::write(
            prefix
                ._root
                .path()
                .join(&older.current().payload.current().key),
            b"also-corrupt",
        )
        .expect("corrupt older payload");
        let third_cache = tempfile::tempdir().expect("third cache");
        let third_store = prefix.artifact_store(&third_cache);
        let recovered = OpenedShard::open(prefix.location.clone())
            .await
            .expect("reopen after all snapshot corruption")
            .recover_with_snapshots(&third_store, &tenant)
            .await
            .expect("full journal replay recovers");
        assert_eq!(recovered.recovery.snapshot_through_log_sequence, None);
        let started = recovered.enable(config(8, 1));
        assert!(started
            .handle
            .inspect_run(first_run)
            .await
            .expect("query first run after full replay")
            .is_some());
        assert!(started
            .handle
            .inspect_run(second_run)
            .await
            .expect("query second run after full replay")
            .is_some());
        started.handle.shutdown().await.expect("stop third owner");
        started
            .task
            .await
            .expect("join third owner")
            .expect("clean third stop");
    }
}
