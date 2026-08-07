//! Apply planning and delivery lifecycle composition.
//!
//! Planning publishes immutable evidence before proposing `WorkPlanned`.
//! Delivery consumes only journal-selected work and advances state only through
//! `WorkCompleted`. The module owns no append handle outside the serialized
//! shard command loop.
use crate::orchestrator::shard_log::IntegrationsCommandExt as _;
use std::fmt;
use std::sync::Arc;

use error_stack::{Report, ResultExt};

use super::artifacts::EffectRepository;
use super::effects::{EFFECT_ENCODING_VERSION, EFFECT_IDENTITY_VERSION};
use super::executor::{
    BoundedEffectExecutor, ChunkBudget, EffectExecutorError, EffectTurnPermit, ExecutionPlanLoader,
    TurnOutcomeV1,
};
use super::planner::{
    bind_apply_effects, finalize_projection_plan, EffectSelectionV1, GraphPlanV1,
    ProjectionCoverageV1,
};
use crate::blob::{ArtifactStore, BlobNamespace, StateSnapshot};
use crate::orchestrator::events::{
    AttemptFailedV1, FailureSummary, JournalEvent, JournalEventV1, JournalRecordV1,
    RunTerminatedV1, TerminalOutcome, WorkCompletedV1, WorkManifestRef, WorkPlannedV1,
};
use crate::orchestrator::ids::{
    AttemptId, CanonicalIntegrationId, EventId, RunId, TenantNamespace, WorkId,
};
use crate::orchestrator::projection::{RunStatus, WorkStatus};
use crate::orchestrator::routing;
use crate::orchestrator::shard_log::{
    ShardCommandErrorKind, ShardCommandHandle, ShardCommandOutcome, WorkRecoveryIntent,
};
use crate::orchestrator::state::StateAuthority;
use crate::orchestrator::work::{
    ApplyWorkV1, StatePhase, StateVersion, StateVersionV1, WorkKind, WorkManifest, WorkManifestV1,
    MAX_WORK_MANIFEST_BYTES,
};
use crate::throttle::{GraphRequestCharge, GraphRequestsUsed};

const WORK_MANIFEST_MEDIA_TYPE: &str = "application/vnd.integrations.work-manifest+json";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ApplyLifecycleError {
    StaleAttempt,
    InvalidPlan,
    StateAccess,
    ArtifactPublication,
    ArtifactIntegrity,
    JournalMutation,
    EffectExecution,
}

impl fmt::Display for ApplyLifecycleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::StaleAttempt => "Apply planning attempt is no longer current",
            Self::InvalidPlan => "Apply plan is invalid",
            Self::StateAccess => "authoritative Apply state access failed",
            Self::ArtifactPublication => "Apply artifact publication failed",
            Self::ArtifactIntegrity => "Apply artifact integrity validation failed",
            Self::JournalMutation => "Apply journal mutation failed",
            Self::EffectExecution => "Apply effect execution failed",
        })
    }
}

impl std::error::Error for ApplyLifecycleError {}

/// Planner output that is still non-authoritative. The DuckDB snapshot is
/// already an immutable blob; this boundary publishes its desired projection,
/// state record, effect index, and work manifest before one journal proposal.
#[derive(Debug, Clone)]
pub(crate) struct ApplyCandidateV1 {
    pub(crate) integration_id: CanonicalIntegrationId,
    pub(crate) owner_actor_id: String,
    pub(crate) run_id: RunId,
    pub(crate) attempt_id: AttemptId,
    pub(crate) attempt: u64,
    pub(crate) phase: StatePhase,
    pub(crate) snapshot: StateSnapshot,
    pub(crate) definition_digest: String,
    pub(crate) definition_digest_encoding_version: u32,
    pub(crate) planner_version: u32,
    pub(crate) state_schema_version: u32,
    pub(crate) desired_projection_schema_version: u32,
    pub(crate) graph: GraphPlanV1,
    pub(crate) selection: EffectSelectionV1,
    pub(crate) coverage: ProjectionCoverageV1,
    pub(crate) created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ApplyPlanDisposition {
    Planned,
    Recovered,
}

#[derive(Debug, Clone)]
pub(crate) struct ApplyPlanOutcome {
    pub(crate) disposition: ApplyPlanDisposition,
    pub(crate) work: WorkRecoveryIntent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ApplyTurnOutcome {
    Pending {
        completed_effect_count: u64,
        requests_used: u32,
        retry_after: Option<std::time::Duration>,
    },
    Completed {
        work_id: WorkId,
        completion_revision: EventId,
        requests_used: u32,
    },
    Terminated {
        work_id: WorkId,
        termination_revision: EventId,
        requests_used: u32,
    },
    NoLongerRunnable {
        work_id: WorkId,
    },
}

impl GraphRequestCharge for ApplyTurnOutcome {
    fn graph_requests_used(&self) -> u32 {
        match self {
            Self::Pending { requests_used, .. }
            | Self::Completed { requests_used, .. }
            | Self::Terminated { requests_used, .. } => *requests_used,
            Self::NoLongerRunnable { .. } => 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PlanningFailureDisposition {
    RetryScheduled,
    RunTerminated,
    NoLongerCurrent,
}

pub(crate) struct ApplyLifecycle {
    tenant: TenantNamespace,
    artifacts: ArtifactStore,
    effects: Arc<dyn EffectRepository>,
    state: Arc<dyn StateAuthority>,
    commands: ShardCommandHandle,
    loader: ExecutionPlanLoader,
    executor: Arc<BoundedEffectExecutor>,
    #[cfg(test)]
    faults: Arc<tokio::sync::Mutex<std::collections::VecDeque<ApplyFault>>>,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ApplyFault {
    DesiredPublished,
    StatePublished,
    EffectsPublished,
    ManifestPublished,
    WorkPlanned,
    CursorCommitted,
    WorkCompleted,
}

impl ApplyLifecycle {
    pub(crate) fn new(
        tenant: TenantNamespace,
        artifacts: ArtifactStore,
        effects: Arc<dyn EffectRepository>,
        state: Arc<dyn StateAuthority>,
        commands: ShardCommandHandle,
        executor: Arc<BoundedEffectExecutor>,
    ) -> Self {
        Self {
            tenant,
            loader: ExecutionPlanLoader::new(artifacts.clone(), Arc::clone(&effects)),
            artifacts,
            effects,
            state,
            commands,
            executor,
            #[cfg(test)]
            faults: Arc::new(tokio::sync::Mutex::new(std::collections::VecDeque::new())),
        }
    }

    #[cfg(test)]
    async fn inject_fault(&self, fault: ApplyFault) {
        self.faults.lock().await.push_back(fault);
    }

    #[cfg(test)]
    async fn fail_after(&self, boundary: ApplyFault) -> Result<(), Report<ApplyLifecycleError>> {
        let mut faults = self.faults.lock().await;
        if faults.front() == Some(&boundary) {
            faults.pop_front();
            return Err(Report::new(ApplyLifecycleError::JournalMutation)
                .attach_printable(format!("injected process loss after {boundary:?}")));
        }
        Ok(())
    }

    /// Re-entry first adopts durable work for this run. Replanning after a lost
    /// `WorkPlanned` response would otherwise use the candidate as its own
    /// parent and violate the authoritative checkpoint chain.
    pub(crate) async fn plan_apply(
        &self,
        candidate: ApplyCandidateV1,
    ) -> Result<ApplyPlanOutcome, Report<ApplyLifecycleError>> {
        let run = self
            .commands
            .inspect_run(candidate.run_id.clone())
            .await
            .change_context(ApplyLifecycleError::JournalMutation)?
            .ok_or_else(|| Report::new(ApplyLifecycleError::StaleAttempt))?;
        if run.integration_id != candidate.integration_id {
            return Err(Report::new(ApplyLifecycleError::InvalidPlan)
                .attach_printable("candidate integration disagrees with the accepted run"));
        }
        if let Some(work_id) = run.active_work_id {
            let work = self
                .commands
                .inspect_work(work_id)
                .await
                .change_context(ApplyLifecycleError::JournalMutation)?
                .ok_or_else(|| Report::new(ApplyLifecycleError::ArtifactIntegrity))?;
            if matches!(&work.kind, WorkKind::Apply(apply) if apply.run_id == candidate.run_id) {
                return Ok(ApplyPlanOutcome {
                    disposition: ApplyPlanDisposition::Recovered,
                    work,
                });
            }
            return Err(Report::new(ApplyLifecycleError::StaleAttempt)
                .attach_printable("accepted run already owns different foreground work"));
        }
        if run.status != RunStatus::Running
            || run.attempt != candidate.attempt
            || run.attempt_id.as_ref() != Some(&candidate.attempt_id)
        {
            return Err(Report::new(ApplyLifecycleError::StaleAttempt));
        }

        let cursor = self
            .state
            .current(&candidate.integration_id)
            .await
            .change_context(ApplyLifecycleError::StateAccess)?
            .ok_or_else(|| Report::new(ApplyLifecycleError::StateAccess))?;
        let applied = match &cursor.state {
            Some(reference) => {
                let state = self
                    .state
                    .load(&candidate.integration_id, reference)
                    .await
                    .change_context(ApplyLifecycleError::ArtifactIntegrity)?;
                let desired = state
                    .into_current()
                    .change_context(ApplyLifecycleError::ArtifactIntegrity)?
                    .desired_projection;
                self.effects
                    .load_desired_projection(&desired)
                    .await
                    .change_context(ApplyLifecycleError::ArtifactIntegrity)?
            }
            None => vec![],
        };
        let graph = finalize_projection_plan(
            &applied,
            candidate.graph,
            candidate.selection,
            candidate.coverage,
        )
        .change_context(ApplyLifecycleError::InvalidPlan)?;
        let desired = self
            .effects
            .publish_desired_projection(graph.desired)
            .await
            .change_context(ApplyLifecycleError::ArtifactPublication)?;
        #[cfg(test)]
        self.fail_after(ApplyFault::DesiredPublished).await?;
        let state = StateVersion::V1(
            StateVersionV1::new(
                candidate.owner_actor_id.clone(),
                cursor.state,
                candidate.phase,
                candidate.snapshot,
                desired.reference.clone(),
                candidate.definition_digest,
                candidate.definition_digest_encoding_version,
                candidate.planner_version,
                candidate.state_schema_version,
                candidate.desired_projection_schema_version,
            )
            .change_context(ApplyLifecycleError::InvalidPlan)?,
        );
        let state_reference = self
            .state
            .publish_candidate(&candidate.integration_id, state.clone())
            .await
            .change_context(ApplyLifecycleError::ArtifactPublication)?;
        #[cfg(test)]
        self.fail_after(ApplyFault::StatePublished).await?;
        let effects = bind_apply_effects(state_reference.id.as_str(), &desired, &graph.effects)
            .change_context(ApplyLifecycleError::InvalidPlan)?;
        let effect_count = u64::try_from(effects.len())
            .change_context(ApplyLifecycleError::InvalidPlan)
            .attach_printable("effect count does not fit the durable manifest")?;
        let effect_index = self
            .effects
            .publish_effect_index(state_reference.id.as_str(), effects)
            .await
            .change_context(ApplyLifecycleError::ArtifactPublication)?;
        #[cfg(test)]
        self.fail_after(ApplyFault::EffectsPublished).await?;
        let manifest = WorkManifest::V1(
            WorkManifestV1::new(
                &candidate.integration_id,
                candidate.owner_actor_id,
                WorkKind::Apply(ApplyWorkV1 {
                    run_id: candidate.run_id,
                    candidate: state_reference,
                }),
                effect_index,
                effect_count,
                EFFECT_IDENTITY_VERSION,
                EFFECT_ENCODING_VERSION,
                candidate.created_at,
            )
            .change_context(ApplyLifecycleError::InvalidPlan)?,
        );
        let manifest_value = manifest
            .try_current_for(&candidate.integration_id)
            .change_context(ApplyLifecycleError::InvalidPlan)?
            .clone();
        let prefix = BlobNamespace::v1(
            &self.tenant,
            &routing::integration_path(&candidate.integration_id),
        )
        .key("work-manifests")
        .change_context(ApplyLifecycleError::ArtifactPublication)?;
        let artifact = self
            .artifacts
            .publish_record(
                &manifest,
                MAX_WORK_MANIFEST_BYTES,
                &prefix,
                WORK_MANIFEST_MEDIA_TYPE,
            )
            .await
            .change_context(ApplyLifecycleError::ArtifactPublication)?;
        #[cfg(test)]
        self.fail_after(ApplyFault::ManifestPublished).await?;
        let manifest_reference = WorkManifestRef {
            work_id: manifest_value.work_id.clone(),
            manifest_digest: artifact.current().sha256.clone(),
            artifact,
        };
        let record = JournalRecordV1::new(
            candidate.integration_id.clone(),
            JournalEvent::V1(JournalEventV1::WorkPlanned(WorkPlannedV1 {
                manifest: manifest_reference.clone(),
                manifest_record: manifest,
                candidate_state_record: Some(state),
            })),
        )
        .change_context(ApplyLifecycleError::InvalidPlan)?;
        let revision = record.event_id.clone();
        let disposition = match self
            .commands
            .propose(record)
            .await
            .change_context(ApplyLifecycleError::JournalMutation)?
        {
            ShardCommandOutcome::Applied { .. } => ApplyPlanDisposition::Planned,
            ShardCommandOutcome::AlreadyDurable { .. } => ApplyPlanDisposition::Recovered,
        };
        #[cfg(test)]
        self.fail_after(ApplyFault::WorkPlanned).await?;
        Ok(ApplyPlanOutcome {
            disposition,
            work: WorkRecoveryIntent {
                integration_id: candidate.integration_id,
                work_id: manifest_value.work_id.clone(),
                manifest: manifest_reference,
                kind: manifest_value.kind.clone(),
                status: WorkStatus::Planned,
                effect_count: manifest_value.effect_count,
                completed_effect_count: 0,
                last_completed_effect: None,
                failure: None,
                settings_revision: None,
                revision,
            },
        })
    }

    /// Executes from the latest serialized cursor, never from a caller-held
    /// snapshot. Cancellation or another terminal transition therefore wins
    /// cleanly before any new Graph request is admitted.
    ///
    /// Permit-free entry point for lifecycle reference tests. Production
    /// dispatch always executes through a lease chunk permit.
    #[cfg(test)]
    pub(crate) async fn execute_apply_turn(
        &self,
        work_id: &WorkId,
        budget: ChunkBudget,
    ) -> Result<ApplyTurnOutcome, Report<ApplyLifecycleError>> {
        self.execute_apply_turn_with_permit(work_id, budget, None)
            .await
    }

    pub(crate) async fn execute_permitted_apply_turn(
        &self,
        work_id: &WorkId,
        budget: ChunkBudget,
        permit: &dyn EffectTurnPermit,
    ) -> Result<ApplyTurnOutcome, Report<ApplyLifecycleError>> {
        self.execute_apply_turn_with_permit(work_id, budget, Some(permit))
            .await
    }

    async fn execute_apply_turn_with_permit(
        &self,
        work_id: &WorkId,
        budget: ChunkBudget,
        permit: Option<&dyn EffectTurnPermit>,
    ) -> Result<ApplyTurnOutcome, Report<ApplyLifecycleError>> {
        let Some(work) = self
            .commands
            .inspect_work(work_id.clone())
            .await
            .change_context(ApplyLifecycleError::JournalMutation)?
        else {
            return Ok(ApplyTurnOutcome::NoLongerRunnable {
                work_id: work_id.clone(),
            });
        };
        let WorkKind::Apply(_apply) = &work.kind else {
            return Err(Report::new(ApplyLifecycleError::InvalidPlan)
                .attach_printable("Apply lifecycle received non-Apply work"));
        };
        if work.status != WorkStatus::Planned {
            return Ok(ApplyTurnOutcome::NoLongerRunnable {
                work_id: work_id.clone(),
            });
        }
        tracing::trace!(work_id = %work_id, "loading Apply turn inputs");
        let prepared = match self.loader.load(&work, budget).await {
            Ok(prepared) => prepared,
            Err(error) if error.current_context() == &EffectExecutorError::ArtifactIntegrity => {
                tracing::error!(
                    work_id = %work.work_id,
                    error = ?error,
                    "immutable Apply artifact failed integrity validation"
                );
                return self
                    .terminate_apply(
                        &work,
                        "artifact_integrity",
                        "immutable Apply artifact failed integrity validation".to_owned(),
                        0,
                    )
                    .await;
            }
            Err(error) => return Err(error.change_context(ApplyLifecycleError::EffectExecution)),
        };
        let execution = match permit {
            Some(permit) => {
                self.executor
                    .execute_permitted_turn(&prepared, budget, permit)
                    .await
            }
            None => self.executor.execute_turn(&prepared, budget).await,
        };
        match execution {
            Ok(TurnOutcomeV1::Progressed {
                completed_effect_count,
                work_exhausted: false,
                requests_used,
            }) => Ok(ApplyTurnOutcome::Pending {
                completed_effect_count,
                requests_used,
                retry_after: None,
            }),
            Ok(TurnOutcomeV1::Yielded {
                completed_effect_count,
                requests_used,
                retry_after,
            }) => Ok(ApplyTurnOutcome::Pending {
                completed_effect_count,
                requests_used,
                retry_after,
            }),
            Ok(TurnOutcomeV1::Progressed {
                work_exhausted: true,
                requests_used,
                ..
            }) => {
                #[cfg(test)]
                self.fail_after(ApplyFault::CursorCommitted).await?;
                let record = JournalRecordV1::new(
                    work.integration_id.clone(),
                    JournalEvent::V1(JournalEventV1::WorkCompleted(WorkCompletedV1 {
                        work_id: work.work_id.clone(),
                        manifest_digest: work.manifest.manifest_digest.clone(),
                    })),
                )
                .change_context(ApplyLifecycleError::InvalidPlan)
                .map_err(|error| error.attach(GraphRequestsUsed::new(requests_used)))?;
                let completion_revision = record.event_id.clone();
                if let Err(error) = self.commands.propose(record).await {
                    if error.kind == ShardCommandErrorKind::InvalidCandidate {
                        if let Some(outcome) =
                            self.adopt_stale_work(&work.work_id, requests_used).await?
                        {
                            return Ok(outcome);
                        }
                    }
                    return Err(error)
                        .change_context(ApplyLifecycleError::JournalMutation)
                        .attach(GraphRequestsUsed::new(requests_used));
                }
                #[cfg(test)]
                self.fail_after(ApplyFault::WorkCompleted).await?;
                Ok(ApplyTurnOutcome::Completed {
                    work_id: work.work_id,
                    completion_revision,
                    requests_used,
                })
            }
            Ok(TurnOutcomeV1::PermanentFailure {
                failed_effect_id,
                status,
                diagnostic,
                requests_used,
                ..
            }) => {
                let message = format!(
                    "Graph effect {failed_effect_id} failed permanently (status {status:?}): {diagnostic}"
                );
                self.terminate_apply(&work, "graph_permanent", message, requests_used)
                    .await
            }
            Err(error) => {
                if error.current_context() == &EffectExecutorError::CursorCommit {
                    let requests_used = error.graph_requests_used();
                    if let Some(outcome) =
                        self.adopt_stale_work(&work.work_id, requests_used).await?
                    {
                        return Ok(outcome);
                    }
                }
                Err(error.change_context(ApplyLifecycleError::EffectExecution))
            }
        }
    }

    /// Converts a planner/handler failure before `WorkPlanned` into the
    /// existing attempt lifecycle. Once Apply work exists, executor failures
    /// use the work-aware terminal path instead.
    pub(crate) async fn record_planning_failure(
        &self,
        run_id: &RunId,
        attempt_id: &AttemptId,
        attempt: u64,
        max_handler_failures: u32,
        failure: FailureSummary,
    ) -> Result<PlanningFailureDisposition, Report<ApplyLifecycleError>> {
        let Some(run) = self
            .commands
            .inspect_run(run_id.clone())
            .await
            .change_context(ApplyLifecycleError::JournalMutation)?
        else {
            return Ok(PlanningFailureDisposition::NoLongerCurrent);
        };
        if run.status != RunStatus::Running
            || run.attempt != attempt
            || run.attempt_id.as_ref() != Some(attempt_id)
            || run.active_work_id.is_some()
        {
            return Ok(PlanningFailureDisposition::NoLongerCurrent);
        }
        let retry = failure.retryable
            && run
                .handler_failures
                .checked_add(1)
                .is_some_and(|next| next < max_handler_failures);
        let event = if retry {
            JournalEventV1::AttemptFailed(AttemptFailedV1 {
                run_id: run_id.clone(),
                attempt_id: attempt_id.clone(),
                attempt,
                failure,
            })
        } else {
            JournalEventV1::RunTerminated(RunTerminatedV1 {
                run_id: run_id.clone(),
                outcome: TerminalOutcome::Failed,
                failed_work: None,
                failure: Some(FailureSummary {
                    code: failure.code,
                    message: failure.message,
                    retryable: false,
                }),
                request: None,
            })
        };
        self.commands
            .propose(
                JournalRecordV1::new(run.integration_id, JournalEvent::V1(event))
                    .change_context(ApplyLifecycleError::InvalidPlan)?,
            )
            .await
            .change_context(ApplyLifecycleError::JournalMutation)?;
        Ok(if retry {
            PlanningFailureDisposition::RetryScheduled
        } else {
            PlanningFailureDisposition::RunTerminated
        })
    }

    async fn terminate_apply(
        &self,
        work: &WorkRecoveryIntent,
        code: &str,
        message: String,
        requests_used: u32,
    ) -> Result<ApplyTurnOutcome, Report<ApplyLifecycleError>> {
        let WorkKind::Apply(apply) = &work.kind else {
            return Err(Report::new(ApplyLifecycleError::InvalidPlan));
        };
        let record = JournalRecordV1::new(
            work.integration_id.clone(),
            JournalEvent::V1(JournalEventV1::RunTerminated(RunTerminatedV1 {
                run_id: apply.run_id.clone(),
                outcome: TerminalOutcome::Failed,
                failed_work: Some(work.work_id.clone()),
                failure: Some(FailureSummary {
                    code: code.to_owned(),
                    message,
                    retryable: false,
                }),
                request: None,
            })),
        )
        .change_context(ApplyLifecycleError::InvalidPlan)?;
        let termination_revision = record.event_id.clone();
        if let Err(error) = self.commands.propose(record).await {
            if error.kind == ShardCommandErrorKind::InvalidCandidate {
                if let Some(outcome) = self.adopt_stale_work(&work.work_id, requests_used).await? {
                    return Ok(outcome);
                }
            }
            return Err(error)
                .change_context(ApplyLifecycleError::JournalMutation)
                .attach(GraphRequestsUsed::new(requests_used));
        }
        Ok(ApplyTurnOutcome::Terminated {
            work_id: work.work_id.clone(),
            termination_revision,
            requests_used,
        })
    }

    /// Errors from adoption itself still carry the turn's actual request
    /// charge, so the caller's settlement never under-reports.
    async fn adopt_stale_work(
        &self,
        work_id: &WorkId,
        requests_used: u32,
    ) -> Result<Option<ApplyTurnOutcome>, Report<ApplyLifecycleError>> {
        let current = self
            .commands
            .inspect_work(work_id.clone())
            .await
            .change_context(ApplyLifecycleError::JournalMutation)
            .map_err(|error| error.attach(GraphRequestsUsed::new(requests_used)))?;
        Ok(match current {
            Some(work) if work.status == WorkStatus::Planned => None,
            Some(work) if work.status == WorkStatus::Completed => {
                Some(ApplyTurnOutcome::Completed {
                    work_id: work.work_id,
                    completion_revision: work.revision,
                    requests_used,
                })
            }
            _ => Some(ApplyTurnOutcome::NoLongerRunnable {
                work_id: work_id.clone(),
            }),
        })
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use std::collections::VecDeque;
    use std::path::Path;

    use async_trait::async_trait;
    use tokio::sync::Mutex;

    use super::*;
    use crate::blob::{BlobRef, BlobRefV1, StateSnapshotV1};
    use crate::graph::artifacts::{
        ArtifactEffectRepository, DesiredObjectInputDispositionV1, DesiredObjectInputV1,
        GraphObjectKindV1,
    };
    use crate::graph::effects::GraphOperationV1;
    use crate::graph::executor::{
        EffectLaneRegistry, EffectRequestV1, EffectResponseV1, GraphEffectTransport, RetryDelay,
        ShardWorkCursorCommitter, WorkCursorCommitter,
    };
    use crate::graph::planner::{GraphDeliveryPayload, GraphDeliveryPayloadV1, PlannedEffectV1};
    use crate::orchestrator::events::{InputRef, PolicyRef, RunAcceptedV1, WorkChunkCompletedV1};
    use crate::orchestrator::ids::derive_attempt_id;
    use crate::orchestrator::projection::MaintenanceStatus;
    use crate::orchestrator::registry::DurableRecord;
    use crate::orchestrator::shard_log::{start_recovered, ShardCommandConfig, StartedShard};
    use crate::orchestrator::state::JournalStateAuthority;
    use crate::orchestrator::work::StatePhaseV1;

    #[derive(Default)]
    struct ScriptedTransport {
        responses: Mutex<VecDeque<EffectResponseV1>>,
        requests: Mutex<Vec<EffectRequestV1>>,
    }

    impl ScriptedTransport {
        fn with(responses: Vec<EffectResponseV1>) -> Self {
            Self {
                responses: Mutex::new(responses.into()),
                requests: Mutex::new(vec![]),
            }
        }

        async fn requests(&self) -> Vec<EffectRequestV1> {
            self.requests.lock().await.clone()
        }
    }

    #[async_trait]
    impl GraphEffectTransport for ScriptedTransport {
        async fn send(&self, request: EffectRequestV1) -> EffectResponseV1 {
            self.requests.lock().await.push(request);
            self.responses
                .lock()
                .await
                .pop_front()
                .unwrap_or(EffectResponseV1::Transport(
                    super::super::executor::TransportFailureV1::Request,
                ))
        }
    }

    struct NoDelay;

    #[async_trait]
    impl RetryDelay for NoDelay {
        async fn wait(&self, _delay: std::time::Duration) {}
    }

    struct RejectCursor;

    #[async_trait]
    impl WorkCursorCommitter for RejectCursor {
        async fn commit(
            &self,
            _integration_id: &CanonicalIntegrationId,
            _cursor: WorkChunkCompletedV1,
        ) -> Result<(), Report<EffectExecutorError>> {
            Err(Report::new(EffectExecutorError::CursorCommit)
                .attach_printable("injected process loss before cursor durability"))
        }
    }

    struct Rig {
        lifecycle: ApplyLifecycle,
        handle: ShardCommandHandle,
        started: StartedShard,
        integration: CanonicalIntegrationId,
        run_id: RunId,
        attempt_id: AttemptId,
    }

    async fn open_rig(
        remote: &Path,
        cache: &Path,
        transport: Arc<ScriptedTransport>,
        reject_cursor: bool,
    ) -> Rig {
        let tenant = TenantNamespace::parse("apply-tests").expect("tenant");
        let integration =
            CanonicalIntegrationId::parse("alice:apply-lifecycle").expect("integration");
        let location = crate::orchestrator::shard_log::disposable_local(
            routing::shard(&integration),
            &tenant,
            remote,
        );
        let started = start_recovered(location, ShardCommandConfig::default())
            .await
            .expect("start shard");
        let handle = started.handle.clone();
        let store = ArtifactStore::local(remote, cache).expect("artifact store");
        let namespace = BlobNamespace::v1(&tenant, &routing::integration_path(&integration));
        let repository: Arc<dyn EffectRepository> = Arc::new(
            ArtifactEffectRepository::new(store.clone(), namespace.root())
                .expect("effect repository"),
        );
        let state: Arc<dyn StateAuthority> = Arc::new(JournalStateAuthority::new(
            store.clone(),
            tenant.clone(),
            handle.clone(),
        ));
        let committer: Arc<dyn WorkCursorCommitter> = if reject_cursor {
            Arc::new(RejectCursor)
        } else {
            Arc::new(ShardWorkCursorCommitter::new(handle.clone()))
        };
        let executor = Arc::new(BoundedEffectExecutor::new(
            transport,
            committer,
            Arc::new(NoDelay),
            Arc::new(EffectLaneRegistry::default()),
        ));
        Rig {
            lifecycle: ApplyLifecycle::new(
                tenant,
                store,
                repository,
                state,
                handle.clone(),
                executor,
            ),
            handle,
            started,
            integration,
            run_id: RunId::parse("00000077-0000-4000-8000-000000000001").expect("run ID"),
            attempt_id: derive_attempt_id(
                &RunId::parse("00000077-0000-4000-8000-000000000001").expect("run ID"),
                1,
            ),
        }
    }

    async fn seed_running(rig: &Rig) {
        if rig
            .handle
            .inspect_run(rig.run_id.clone())
            .await
            .expect("inspect run before seeding")
            .is_some()
        {
            return;
        }
        rig.handle
            .propose(
                JournalRecordV1::new(
                    rig.integration.clone(),
                    JournalEvent::V1(JournalEventV1::RunAccepted(RunAcceptedV1 {
                        run_id: rig.run_id.clone(),
                        immutable_input: InputRef {
                            artifact: blob("inputs/run.json", 'a', "application/json"),
                            definition_digest: "b".repeat(64),
                            definition_digest_encoding_version: 1,
                            planner_version: 1,
                        },
                        policy: PolicyRef {
                            policy_digest: "c".repeat(64),
                            artifact: blob("policies/run.json", 'c', "application/json"),
                        },
                        submitted_at: "2026-07-22T00:00:00Z".to_owned(),
                    })),
                )
                .expect("RunAccepted"),
            )
            .await
            .expect("append RunAccepted");
        rig.handle
            .propose(
                JournalRecordV1::new(
                    rig.integration.clone(),
                    JournalEvent::V1(JournalEventV1::AttemptStarted(
                        crate::orchestrator::events::AttemptStartedV1 {
                            run_id: rig.run_id.clone(),
                            attempt_id: rig.attempt_id.clone(),
                            attempt: 1,
                        },
                    )),
                )
                .expect("AttemptStarted"),
            )
            .await
            .expect("append AttemptStarted");
    }

    fn blob(key: &str, digest: char, media_type: &str) -> BlobRef {
        BlobRef::V1(BlobRefV1 {
            key: key.to_owned(),
            sha256: digest.to_string().repeat(64),
            size: 1,
            media_type: media_type.to_owned(),
            e_tag: None,
            provider_version: None,
        })
    }

    fn candidate(rig: &Rig, with_effect: bool) -> ApplyCandidateV1 {
        let namespace = BlobNamespace::v1(
            &TenantNamespace::parse("apply-tests").expect("tenant"),
            &routing::integration_path(&rig.integration),
        );
        let graph_identity = "entity:apply-test".to_owned();
        let graph = if with_effect {
            let payload = GraphDeliveryPayload::V1(
                GraphDeliveryPayloadV1::upsert(
                    graph_identity.clone(),
                    serde_json::json!({"webId": "alice"}),
                    serde_json::json!({"entityId": graph_identity, "archived": false}),
                    serde_json::json!({"entityId": "entity:apply-test", "archived": true}),
                )
                .expect("delivery"),
            )
            .encode()
            .expect("delivery bytes");
            GraphPlanV1 {
                desired: vec![DesiredObjectInputV1 {
                    kind: GraphObjectKindV1::Entity,
                    graph_identity: "entity:apply-test".to_owned(),
                    disposition: DesiredObjectInputDispositionV1::Live(payload),
                }],
                effects: vec![PlannedEffectV1 {
                    operation: GraphOperationV1::UpsertEntity,
                    kind: GraphObjectKindV1::Entity,
                    graph_identity: "entity:apply-test".to_owned(),
                }],
            }
        } else {
            GraphPlanV1::default()
        };
        ApplyCandidateV1 {
            integration_id: rig.integration.clone(),
            owner_actor_id: "actor:owner".to_owned(),
            run_id: rig.run_id.clone(),
            attempt_id: rig.attempt_id.clone(),
            attempt: 1,
            phase: StatePhase::V1(StatePhaseV1::LinksCommitted),
            snapshot: StateSnapshot::V1(StateSnapshotV1 {
                generation: 1,
                duckdb: blob(
                    &namespace
                        .key("snapshots/fixture.duckdb")
                        .expect("snapshot key"),
                    'd',
                    "application/vnd.duckdb",
                ),
                accepted_batches: vec![],
                created_at: "2026-07-22T16:00:00Z".to_owned(),
            }),
            definition_digest: "e".repeat(64),
            definition_digest_encoding_version: 1,
            planner_version: 1,
            state_schema_version: 1,
            desired_projection_schema_version: 1,
            graph,
            selection: EffectSelectionV1::ChangesOnly,
            coverage: ProjectionCoverageV1::Complete,
            created_at: "2026-07-22T16:00:01Z".to_owned(),
        }
    }

    fn add_entity_effect(candidate: &mut ApplyCandidateV1, identity: &str) {
        let payload = GraphDeliveryPayload::V1(
            GraphDeliveryPayloadV1::upsert(
                identity.to_owned(),
                serde_json::json!({"webId": "alice"}),
                serde_json::json!({"entityId": identity, "archived": false}),
                serde_json::json!({"entityId": identity, "archived": true}),
            )
            .expect("delivery"),
        )
        .encode()
        .expect("delivery bytes");
        candidate.graph.desired.push(DesiredObjectInputV1 {
            kind: GraphObjectKindV1::Entity,
            graph_identity: identity.to_owned(),
            disposition: DesiredObjectInputDispositionV1::Live(payload),
        });
        candidate.graph.effects.push(PlannedEffectV1 {
            operation: GraphOperationV1::UpsertEntity,
            kind: GraphObjectKindV1::Entity,
            graph_identity: identity.to_owned(),
        });
    }

    async fn close(rig: Rig) {
        rig.handle.shutdown().await.expect("shutdown shard");
        rig.started.task.await.expect("join shard").expect("shard");
    }

    #[tokio::test]
    async fn apply_advances_applied_state_only_after_final_cursor_and_completion() {
        let remote = tempfile::tempdir().expect("remote");
        let cache = tempfile::tempdir().expect("cache");
        let transport = Arc::new(ScriptedTransport::with(vec![EffectResponseV1::Success]));
        let rig = open_rig(remote.path(), cache.path(), Arc::clone(&transport), false).await;
        seed_running(&rig).await;
        let planned = rig
            .lifecycle
            .plan_apply(candidate(&rig, true))
            .await
            .expect("plan Apply");
        let before = rig
            .handle
            .inspect_delivery(rig.integration.clone())
            .await
            .expect("delivery view")
            .expect("integration");
        assert!(before.applied_state.is_none());
        assert_eq!(before.foreground_work.as_ref(), Some(&planned.work.work_id));
        assert!(before.checkpoint_state.is_some());

        let outcome = rig
            .lifecycle
            .execute_apply_turn(&planned.work.work_id, ChunkBudget::new(2).expect("budget"))
            .await
            .expect("execute Apply");
        let ApplyTurnOutcome::Completed {
            completion_revision,
            requests_used,
            ..
        } = outcome
        else {
            panic!("Apply must complete")
        };
        let after = rig
            .handle
            .inspect_delivery(rig.integration.clone())
            .await
            .expect("delivery view")
            .expect("integration");
        assert_eq!(after.applied_state, after.checkpoint_state);
        assert_eq!(after.applied_incarnation, Some(completion_revision));
        assert!(after.foreground_work.is_none());
        assert_eq!(requests_used, 1);
        assert_eq!(transport.requests().await.len(), 1);
        close(rig).await;
    }

    #[tokio::test]
    async fn durable_work_is_adopted_before_replanning_after_a_lost_response() {
        let remote = tempfile::tempdir().expect("remote");
        let cache = tempfile::tempdir().expect("cache");
        let rig = open_rig(
            remote.path(),
            cache.path(),
            Arc::new(ScriptedTransport::default()),
            false,
        )
        .await;
        seed_running(&rig).await;
        let first = rig
            .lifecycle
            .plan_apply(candidate(&rig, true))
            .await
            .expect("first plan");
        let mut drifted = candidate(&rig, false);
        drifted.created_at = "2026-07-22T17:00:00Z".to_owned();
        let recovered = rig
            .lifecycle
            .plan_apply(drifted)
            .await
            .expect("recover durable plan");
        assert_eq!(recovered.disposition, ApplyPlanDisposition::Recovered);
        assert_eq!(recovered.work.work_id, first.work.work_id);
        assert_eq!(recovered.work.effect_count, 1);
        close(rig).await;
    }

    #[tokio::test]
    async fn every_apply_publication_boundary_recovers_without_a_second_work_item() {
        for boundary in [
            ApplyFault::DesiredPublished,
            ApplyFault::StatePublished,
            ApplyFault::EffectsPublished,
            ApplyFault::ManifestPublished,
            ApplyFault::WorkPlanned,
        ] {
            let remote = tempfile::tempdir().expect("remote");
            let first_cache = tempfile::tempdir().expect("first cache");
            let first = open_rig(
                remote.path(),
                first_cache.path(),
                Arc::new(ScriptedTransport::default()),
                false,
            )
            .await;
            seed_running(&first).await;
            first.lifecycle.inject_fault(boundary).await;
            let _error = first
                .lifecycle
                .plan_apply(candidate(&first, true))
                .await
                .expect_err("injected publication boundary must interrupt planning");
            close(first).await;
            drop(first_cache);

            let second_cache = tempfile::tempdir().expect("second cache");
            let second = open_rig(
                remote.path(),
                second_cache.path(),
                Arc::new(ScriptedTransport::default()),
                false,
            )
            .await;
            let recovered = second
                .lifecycle
                .plan_apply(candidate(&second, true))
                .await
                .expect("recover interrupted publication");
            assert_eq!(recovered.work.effect_count, 1, "boundary {boundary:?}");
            assert_eq!(
                second
                    .handle
                    .next_runnable_work()
                    .await
                    .expect("work query")
                    .expect("one runnable work")
                    .work_id,
                recovered.work.work_id,
                "boundary {boundary:?}"
            );
            close(second).await;
        }
    }

    #[tokio::test]
    async fn apply_remains_unapplied_between_durable_chunks() {
        let remote = tempfile::tempdir().expect("remote");
        let cache = tempfile::tempdir().expect("cache");
        let transport = Arc::new(ScriptedTransport::with(vec![
            EffectResponseV1::Success,
            EffectResponseV1::Success,
        ]));
        let rig = open_rig(remote.path(), cache.path(), transport, false).await;
        seed_running(&rig).await;
        let mut input = candidate(&rig, true);
        add_entity_effect(&mut input, "entity:second");
        let planned = rig
            .lifecycle
            .plan_apply(input)
            .await
            .expect("plan two-effect Apply");
        assert_eq!(planned.work.effect_count, 2);
        assert!(matches!(
            rig.lifecycle
                .execute_apply_turn(&planned.work.work_id, ChunkBudget::new(2).expect("budget"))
                .await
                .expect("first chunk"),
            ApplyTurnOutcome::Pending {
                completed_effect_count: 1,
                requests_used: 1,
                ..
            }
        ));
        let middle = rig
            .handle
            .inspect_delivery(rig.integration.clone())
            .await
            .expect("delivery view")
            .expect("integration");
        assert!(middle.applied_state.is_none());
        assert_eq!(middle.foreground_work.as_ref(), Some(&planned.work.work_id));
        assert!(matches!(
            rig.lifecycle
                .execute_apply_turn(&planned.work.work_id, ChunkBudget::new(2).expect("budget"))
                .await
                .expect("second chunk"),
            ApplyTurnOutcome::Completed { .. }
        ));
        let final_view = rig
            .handle
            .inspect_delivery(rig.integration.clone())
            .await
            .expect("delivery view")
            .expect("integration");
        assert_eq!(final_view.applied_state, final_view.checkpoint_state);
        close(rig).await;
    }

    #[tokio::test]
    async fn zero_effect_apply_still_completes_without_a_graph_request_or_cursor() {
        let remote = tempfile::tempdir().expect("remote");
        let cache = tempfile::tempdir().expect("cache");
        let transport = Arc::new(ScriptedTransport::default());
        let rig = open_rig(remote.path(), cache.path(), Arc::clone(&transport), false).await;
        seed_running(&rig).await;
        let planned = rig
            .lifecycle
            .plan_apply(candidate(&rig, false))
            .await
            .expect("plan empty Apply");
        assert_eq!(planned.work.effect_count, 0);
        assert!(matches!(
            rig.lifecycle
                .execute_apply_turn(&planned.work.work_id, ChunkBudget::new(2).expect("budget"))
                .await
                .expect("complete empty Apply"),
            ApplyTurnOutcome::Completed { .. }
        ));
        assert!(transport.requests().await.is_empty());
        let work = rig
            .handle
            .inspect_work(planned.work.work_id)
            .await
            .expect("work query")
            .expect("work");
        assert_eq!(work.status, WorkStatus::Completed);
        assert_eq!(work.completed_effect_count, 0);
        close(rig).await;
    }

    #[tokio::test]
    async fn local_loss_after_send_before_cursor_recovers_by_create_409_patch() {
        let remote = tempfile::tempdir().expect("remote");
        let first_cache = tempfile::tempdir().expect("first cache");
        let first_transport = Arc::new(ScriptedTransport::with(vec![EffectResponseV1::Success]));
        let first = open_rig(
            remote.path(),
            first_cache.path(),
            Arc::clone(&first_transport),
            true,
        )
        .await;
        seed_running(&first).await;
        let planned = first
            .lifecycle
            .plan_apply(candidate(&first, true))
            .await
            .expect("plan Apply");
        let error = first
            .lifecycle
            .execute_apply_turn(&planned.work.work_id, ChunkBudget::new(2).expect("budget"))
            .await
            .expect_err("cursor loss must interrupt the turn");
        assert_eq!(
            error.current_context(),
            &ApplyLifecycleError::EffectExecution
        );
        assert!(format!("{error:?}").contains("Graph effect cursor commit failed"));
        let work_id = planned.work.work_id;
        close(first).await;
        drop(first_cache);

        let second_cache = tempfile::tempdir().expect("second cache");
        let second_transport = Arc::new(ScriptedTransport::with(vec![
            EffectResponseV1::Http {
                status: 409,
                retry_after: None,
                diagnostic: "already exists".to_owned(),
            },
            EffectResponseV1::Success,
        ]));
        let second = open_rig(
            remote.path(),
            second_cache.path(),
            Arc::clone(&second_transport),
            false,
        )
        .await;
        let recovered = second
            .handle
            .next_runnable_work()
            .await
            .expect("recovery work query")
            .expect("durable work must be runnable");
        assert_eq!(recovered.work_id, work_id);
        assert_eq!(recovered.completed_effect_count, 0);
        assert!(matches!(
            second
                .lifecycle
                .execute_apply_turn(&recovered.work_id, ChunkBudget::new(2).expect("budget"))
                .await
                .expect("recover Apply"),
            ApplyTurnOutcome::Completed { .. }
        ));
        assert!(matches!(
            second_transport.requests().await.as_slice(),
            [EffectRequestV1::Create(_), EffectRequestV1::Patch(_)]
        ));
        let delivery = second
            .handle
            .inspect_delivery(second.integration.clone())
            .await
            .expect("delivery view")
            .expect("integration");
        assert_eq!(delivery.applied_state, delivery.checkpoint_state);
        close(second).await;
    }

    #[tokio::test]
    async fn cursor_and_completion_response_loss_recover_without_resending_graph() {
        let remote = tempfile::tempdir().expect("remote");
        let first_cache = tempfile::tempdir().expect("first cache");
        let first_transport = Arc::new(ScriptedTransport::with(vec![EffectResponseV1::Success]));
        let first = open_rig(
            remote.path(),
            first_cache.path(),
            Arc::clone(&first_transport),
            false,
        )
        .await;
        seed_running(&first).await;
        let planned = first
            .lifecycle
            .plan_apply(candidate(&first, true))
            .await
            .expect("plan Apply");
        first
            .lifecycle
            .inject_fault(ApplyFault::CursorCommitted)
            .await;
        let _cursor_error = first
            .lifecycle
            .execute_apply_turn(&planned.work.work_id, ChunkBudget::new(2).expect("budget"))
            .await
            .expect_err("loss after cursor must interrupt completion");
        let work_id = planned.work.work_id;
        close(first).await;
        drop(first_cache);

        let second_cache = tempfile::tempdir().expect("second cache");
        let second_transport = Arc::new(ScriptedTransport::default());
        let second = open_rig(
            remote.path(),
            second_cache.path(),
            Arc::clone(&second_transport),
            false,
        )
        .await;
        let recovered = second
            .handle
            .inspect_work(work_id.clone())
            .await
            .expect("work query")
            .expect("work");
        assert_eq!(recovered.completed_effect_count, 1);
        second
            .lifecycle
            .inject_fault(ApplyFault::WorkCompleted)
            .await;
        let _completion_error = second
            .lifecycle
            .execute_apply_turn(&work_id, ChunkBudget::new(2).expect("budget"))
            .await
            .expect_err("loss after WorkCompleted must hide its response");
        assert!(second_transport.requests().await.is_empty());
        close(second).await;
        drop(second_cache);

        let third_cache = tempfile::tempdir().expect("third cache");
        let third_transport = Arc::new(ScriptedTransport::default());
        let third = open_rig(
            remote.path(),
            third_cache.path(),
            Arc::clone(&third_transport),
            false,
        )
        .await;
        assert!(matches!(
            third
                .lifecycle
                .execute_apply_turn(&work_id, ChunkBudget::new(2).expect("budget"))
                .await
                .expect("adopt completed work"),
            ApplyTurnOutcome::NoLongerRunnable { .. }
        ));
        assert!(third_transport.requests().await.is_empty());
        let completion = third
            .handle
            .next_runnable_run()
            .await
            .expect("query incomplete run finalization")
            .expect("completed Apply still needs RunCompleted");
        assert!(
            completion.completion_result.is_some(),
            "recovery must finalize the completed Apply instead of planning another attempt"
        );
        let delivery = third
            .handle
            .inspect_delivery(third.integration.clone())
            .await
            .expect("delivery view")
            .expect("integration");
        assert_eq!(delivery.applied_state, delivery.checkpoint_state);
        assert!(delivery.applied_incarnation.is_some());
        close(third).await;
    }

    #[tokio::test]
    async fn permanent_graph_failure_terminates_apply_and_requires_restore() {
        let remote = tempfile::tempdir().expect("remote");
        let cache = tempfile::tempdir().expect("cache");
        let rig = open_rig(
            remote.path(),
            cache.path(),
            Arc::new(ScriptedTransport::with(vec![EffectResponseV1::Http {
                status: 422,
                retry_after: None,
                diagnostic: "validation body omitted".to_owned(),
            }])),
            false,
        )
        .await;
        seed_running(&rig).await;
        let planned = rig
            .lifecycle
            .plan_apply(candidate(&rig, true))
            .await
            .expect("plan Apply");
        let terminated = rig
            .lifecycle
            .execute_apply_turn(&planned.work.work_id, ChunkBudget::new(2).expect("budget"))
            .await
            .expect("terminate Apply");
        assert_eq!(terminated.graph_requests_used(), 1);
        assert!(matches!(terminated, ApplyTurnOutcome::Terminated { .. }));
        let delivery = rig
            .handle
            .inspect_delivery(rig.integration.clone())
            .await
            .expect("delivery view")
            .expect("integration");
        assert_eq!(delivery.maintenance, MaintenanceStatus::RestoreRequired);
        assert!(delivery.applied_state.is_none());
        assert!(delivery.foreground_work.is_none());
        let work = rig
            .handle
            .inspect_work(planned.work.work_id)
            .await
            .expect("work query")
            .expect("work");
        assert_eq!(work.status, WorkStatus::Terminated);
        close(rig).await;
    }

    #[tokio::test]
    async fn cancellation_before_a_turn_prevents_any_new_graph_request() {
        let remote = tempfile::tempdir().expect("remote");
        let cache = tempfile::tempdir().expect("cache");
        let transport = Arc::new(ScriptedTransport::default());
        let rig = open_rig(remote.path(), cache.path(), Arc::clone(&transport), false).await;
        seed_running(&rig).await;
        let planned = rig
            .lifecycle
            .plan_apply(candidate(&rig, true))
            .await
            .expect("plan Apply");
        rig.handle
            .propose(
                JournalRecordV1::new(
                    rig.integration.clone(),
                    JournalEvent::V1(JournalEventV1::RunTerminated(RunTerminatedV1 {
                        run_id: rig.run_id.clone(),
                        outcome: TerminalOutcome::Cancelled,
                        failed_work: Some(planned.work.work_id.clone()),
                        failure: None,
                        request: None,
                    })),
                )
                .expect("cancellation"),
            )
            .await
            .expect("append cancellation");
        assert!(matches!(
            rig.lifecycle
                .execute_apply_turn(&planned.work.work_id, ChunkBudget::new(2).expect("budget"))
                .await
                .expect("observe cancellation"),
            ApplyTurnOutcome::NoLongerRunnable { .. }
        ));
        assert!(transport.requests().await.is_empty());
        close(rig).await;
    }

    #[tokio::test]
    async fn retryable_planning_failure_consumes_only_the_handler_failure_budget() {
        let remote = tempfile::tempdir().expect("remote");
        let cache = tempfile::tempdir().expect("cache");
        let rig = open_rig(
            remote.path(),
            cache.path(),
            Arc::new(ScriptedTransport::default()),
            false,
        )
        .await;
        seed_running(&rig).await;
        assert_eq!(
            rig.lifecycle
                .record_planning_failure(
                    &rig.run_id,
                    &rig.attempt_id,
                    1,
                    2,
                    FailureSummary {
                        code: "temporary_source".to_owned(),
                        message: "source unavailable".to_owned(),
                        retryable: true,
                    },
                )
                .await
                .expect("record retryable failure"),
            PlanningFailureDisposition::RetryScheduled
        );
        let run = rig
            .handle
            .inspect_run(rig.run_id.clone())
            .await
            .expect("run query")
            .expect("run");
        assert_eq!(run.status, RunStatus::Accepted);
        assert_eq!(run.handler_failures, 1);
        assert!(rig
            .handle
            .next_runnable_work()
            .await
            .expect("work query")
            .is_none());
        close(rig).await;
    }
}
