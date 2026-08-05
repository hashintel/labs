//! Dispatch from one leased scheduler turn into the durable planning and
//! delivery lifecycles.
//!
//! This layer owns no journal writer and no Graph-specific recovery protocol.
//! It composes fenced capabilities and reports actual request charges so the
//! process-wide scheduler can settle an admitted lane honestly.
use std::fmt;
use std::sync::Arc;

use async_trait::async_trait;
use error_stack::{Report, ResultExt as _};

use super::events::{
    FailureSummary, JournalEvent, JournalEventV1, JournalRecordV1, RunCompletedV1,
};
use super::ids::{CanonicalIntegrationId, RunId, TenantNamespace, WorkId};
use super::planning::{PlanningAttempt, RunPlanner, RunPlanningError};
use super::run_input::load_run_policy;
use super::shard::{SchedulerAction, SchedulerTurn};
use super::shard_log::ShardCommandHandle;
use super::shard_log::WorkRecoveryIntent;
use super::state::StateAuthority;
use super::work::WorkKind;
use crate::blob::{ArtifactStore, BlobNamespace};
use crate::graph::apply::{ApplyLifecycle, ApplyTurnOutcome, PlanningFailureDisposition};
use crate::graph::artifacts::{ArtifactEffectRepository, EffectRepository};
use crate::graph::executor::{BoundedEffectExecutor, ChunkBudget, EffectTurnPermit};
use crate::graph::reconcile::{ReconcileLifecycle, ReconcileLifecycleError, ReconcileTurnOutcome};
use crate::graph::restore::{RestoreLifecycle, RestoreTurnOutcome};
use crate::orchestrator::routing;
use crate::throttle::GraphRequestCharge as _;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorkerDispatchError {
    StartAttempt,
    RecordPlanningFailure,
    BuildLifecycles,
    PlanApply,
    PlanRestore,
    PlanReconcile,
    FinalizeRun,
    ExecuteApply,
    ExecuteRestore,
    ExecuteReconcile,
}

impl fmt::Display for WorkerDispatchError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::StartAttempt => "start accepted run attempt failed",
            Self::RecordPlanningFailure => "record accepted run planning failure failed",
            Self::BuildLifecycles => "construct integration-scoped delivery lifecycles failed",
            Self::PlanApply => "publish durable Apply work failed",
            Self::PlanRestore => "publish durable Restore work failed",
            Self::PlanReconcile => "publish durable Reconcile work failed",
            Self::FinalizeRun => "finalize completed Apply run failed",
            Self::ExecuteApply => "execute bounded Apply turn failed",
            Self::ExecuteRestore => "execute bounded Restore turn failed",
            Self::ExecuteReconcile => "execute bounded Reconcile turn failed",
        })
    }
}

impl std::error::Error for WorkerDispatchError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum WorkerDispatchOutcome {
    Idle,
    ReceiptPromoted,
    PlanningFailed,
    WorkPlanned(WorkId),
    RunFinalized,
}

/// The lane state a settled delivery turn reports back to the process-wide
/// fair scheduler.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LaneDisposition {
    /// More effects remain and the lane may be admitted again immediately.
    Runnable,
    /// The turn gave the lane up voluntarily (provider backoff, foreground
    /// preference); it stays runnable behind its peers.
    Yielded {
        retry_after: Option<std::time::Duration>,
    },
    /// Completed, blocked, terminated, or superseded: the lane leaves the
    /// runnable set until the projection produces new planned work.
    Settled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AdmittedWorkTurn {
    pub(crate) work_id: WorkId,
    pub(crate) graph_requests_used: u32,
    pub(crate) lane_after: LaneDisposition,
}

/// Kernel-facing execution seam from the durable-kernel split: the scheduler
/// loop plans and delivers only through this trait, so a future domain can
/// supply its own planner and effect executor. `WorkerDispatcher` is the
/// integrations implementation.
#[async_trait]
pub(crate) trait Executor: Send + Sync {
    /// Settles one scheduler turn: plan an accepted run, restore, or
    /// reconcile cycle; finalize a delivered run; or report idleness.
    async fn dispatch(
        &self,
        turn: SchedulerTurn,
    ) -> Result<WorkerDispatchOutcome, Report<WorkerDispatchError>>;

    /// Executes exactly one bounded turn for a DRR-admitted work item. The
    /// caller settles the admitted lane with the returned authoritative
    /// request count; on an error return it settles with the charge attached
    /// to the report and keeps the lane runnable.
    async fn execute_admitted_work(
        &self,
        work: &WorkRecoveryIntent,
        permit: &dyn EffectTurnPermit,
    ) -> Result<AdmittedWorkTurn, Report<WorkerDispatchError>>;

    /// Drops executor-only retry acceleration for work the authoritative
    /// scheduler determined is no longer runnable before dispatch.
    fn forget_work_conflicts(&self, work_id: &WorkId);
}

pub(crate) struct WorkerDispatcher {
    tenant: TenantNamespace,
    artifacts: ArtifactStore,
    planner: RunPlanner,
    state: Arc<dyn StateAuthority>,
    commands: ShardCommandHandle,
    executor: Arc<BoundedEffectExecutor>,
    chunk_budget: ChunkBudget,
}

impl WorkerDispatcher {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        tenant: TenantNamespace,
        artifacts: ArtifactStore,
        planner: RunPlanner,
        state: Arc<dyn StateAuthority>,
        commands: ShardCommandHandle,
        executor: Arc<BoundedEffectExecutor>,
        chunk_budget: ChunkBudget,
    ) -> Self {
        Self {
            tenant,
            artifacts,
            planner,
            state,
            commands,
            executor,
            chunk_budget,
        }
    }

}

#[async_trait]
impl Executor for WorkerDispatcher {
    async fn dispatch(
        &self,
        turn: SchedulerTurn,
    ) -> Result<WorkerDispatchOutcome, Report<WorkerDispatchError>> {
        match turn.action {
            SchedulerAction::AcceptedRun(run) => self.plan_accepted_run(run).await,
            SchedulerAction::PlanRestore(integration_id) => {
                let (_, restore, _) = self.lifecycles(&integration_id)?;
                let planned = restore
                    .plan_restore(&integration_id, chrono::Utc::now().to_rfc3339())
                    .await
                    .change_context(WorkerDispatchError::PlanRestore)?;
                tracing::debug!(
                    work_id = %planned.work.work_id,
                    disposition = ?planned.disposition,
                    "Restore work is durable"
                );
                Ok(WorkerDispatchOutcome::WorkPlanned(planned.work.work_id))
            }
            SchedulerAction::PlanReconcile(integration_id) => {
                let (_, _, reconcile) = self.lifecycles(&integration_id)?;
                match reconcile
                    .plan_reconcile(&integration_id, chrono::Utc::now().to_rfc3339())
                    .await
                {
                    Ok(planned) => {
                        tracing::debug!(
                            work_id = %planned.work.work_id,
                            disposition = ?planned.disposition,
                            "Reconcile cycle is durable"
                        );
                        Ok(WorkerDispatchOutcome::WorkPlanned(planned.work.work_id))
                    }
                    // The projection can move between candidate selection and
                    // planning; a no-longer-eligible integration is an idle
                    // turn, not a dispatch failure.
                    Err(error)
                        if matches!(
                            error.current_context(),
                            ReconcileLifecycleError::NoAppliedState
                                | ReconcileLifecycleError::NotEligible
                        ) =>
                    {
                        tracing::debug!(
                            integration_id = %integration_id,
                            reason = ?error.current_context(),
                            "Reconcile initiation was superseded before planning"
                        );
                        Ok(WorkerDispatchOutcome::Idle)
                    }
                    Err(error) => Err(error.change_context(WorkerDispatchError::PlanReconcile)),
                }
            }
            SchedulerAction::FinalizeRun {
                integration_id,
                run_id,
                result,
            } => {
                let record = JournalRecordV1::new(
                    integration_id.clone(),
                    JournalEvent::V1(JournalEventV1::RunCompleted(RunCompletedV1 {
                        run_id: run_id.clone(),
                        result,
                    })),
                )
                .change_context(WorkerDispatchError::FinalizeRun)?;
                self.commands
                    .propose(record)
                    .await
                    .change_context(WorkerDispatchError::FinalizeRun)?;
                self.retire_terminal_admission(&integration_id, &run_id)
                    .await;
                Ok(WorkerDispatchOutcome::RunFinalized)
            }
            SchedulerAction::ReceiptPromoted => Ok(WorkerDispatchOutcome::ReceiptPromoted),
            SchedulerAction::Idle => Ok(WorkerDispatchOutcome::Idle),
        }
    }

    async fn execute_admitted_work(
        &self,
        work: &WorkRecoveryIntent,
        permit: &dyn EffectTurnPermit,
    ) -> Result<AdmittedWorkTurn, Report<WorkerDispatchError>> {
        let work_id = work.work_id.clone();
        let (apply, restore, reconcile) = self.lifecycles(&work.integration_id)?;
        let turn = match &work.kind {
            WorkKind::Apply(apply_work) => {
                let outcome = apply
                    .execute_permitted_apply_turn(&work_id, self.chunk_budget, permit)
                    .await
                    .change_context(WorkerDispatchError::ExecuteApply)?;
                let lane_after = match &outcome {
                    ApplyTurnOutcome::Pending {
                        retry_after: Some(retry_after),
                        ..
                    } => LaneDisposition::Yielded {
                        retry_after: Some(*retry_after),
                    },
                    ApplyTurnOutcome::Pending { .. } => LaneDisposition::Runnable,
                    ApplyTurnOutcome::Completed { .. }
                    | ApplyTurnOutcome::Terminated { .. }
                    | ApplyTurnOutcome::NoLongerRunnable { .. } => LaneDisposition::Settled,
                };
                if matches!(&outcome, ApplyTurnOutcome::Terminated { .. }) {
                    self.retire_terminal_admission(&work.integration_id, &apply_work.run_id)
                        .await;
                }
                AdmittedWorkTurn {
                    work_id: work_id.clone(),
                    graph_requests_used: outcome.graph_requests_used(),
                    lane_after,
                }
            }
            WorkKind::Restore(_) => {
                let outcome = restore
                    .execute_permitted_restore_turn(&work_id, self.chunk_budget, permit)
                    .await
                    .change_context(WorkerDispatchError::ExecuteRestore)?;
                let lane_after = match &outcome {
                    RestoreTurnOutcome::Pending {
                        retry_after: Some(retry_after),
                        ..
                    } => LaneDisposition::Yielded {
                        retry_after: Some(*retry_after),
                    },
                    RestoreTurnOutcome::Pending { .. } => LaneDisposition::Runnable,
                    RestoreTurnOutcome::Completed { .. }
                    | RestoreTurnOutcome::Blocked { .. }
                    | RestoreTurnOutcome::NoLongerRunnable { .. } => LaneDisposition::Settled,
                };
                AdmittedWorkTurn {
                    work_id: work_id.clone(),
                    graph_requests_used: outcome.graph_requests_used(),
                    lane_after,
                }
            }
            WorkKind::Reconcile(_) => {
                let outcome = reconcile
                    .execute_permitted_reconcile_turn(&work_id, self.chunk_budget, permit)
                    .await
                    .change_context(WorkerDispatchError::ExecuteReconcile)?;
                let lane_after = match &outcome {
                    ReconcileTurnOutcome::Pending {
                        retry_after: Some(retry_after),
                        ..
                    } => LaneDisposition::Yielded {
                        retry_after: Some(*retry_after),
                    },
                    ReconcileTurnOutcome::YieldedToForeground { .. } => {
                        LaneDisposition::Yielded { retry_after: None }
                    }
                    ReconcileTurnOutcome::Pending { .. } => LaneDisposition::Runnable,
                    ReconcileTurnOutcome::Completed { .. }
                    | ReconcileTurnOutcome::Blocked { .. }
                    | ReconcileTurnOutcome::NoLongerRunnable { .. } => LaneDisposition::Settled,
                };
                AdmittedWorkTurn {
                    work_id: work_id.clone(),
                    graph_requests_used: outcome.graph_requests_used(),
                    lane_after,
                }
            }
        };
        if matches!(turn.lane_after, LaneDisposition::Settled) {
            self.executor.forget_work_conflicts(&work_id);
        }
        Ok(turn)
    }

    fn forget_work_conflicts(&self, work_id: &WorkId) {
        self.executor.forget_work_conflicts(work_id);
    }
}

impl WorkerDispatcher {
    /// Best effort: the run is already durably terminal, and the scheduler's
    /// startup sweep repairs any admission this call fails to retire.
    async fn retire_terminal_admission(
        &self,
        integration_id: &CanonicalIntegrationId,
        run_id: &RunId,
    ) {
        let terminal = std::iter::once(run_id.clone()).collect();
        if let Err(error) = super::submission::retire_admission_for_terminal_runs(
            &self.artifacts,
            &self.tenant,
            integration_id,
            &terminal,
        )
        .await
        {
            tracing::warn!(
                integration_id = %integration_id,
                run_id = %run_id,
                error = ?error,
                "terminal admission retirement failed; the startup sweep will repair it"
            );
        }
    }

    async fn plan_accepted_run(
        &self,
        run: super::shard_log::RunView,
    ) -> Result<WorkerDispatchOutcome, Report<WorkerDispatchError>> {
        let attempt = self
            .planner
            .start_attempt(run)
            .await
            .change_context(WorkerDispatchError::StartAttempt)?;
        let maximum_failures =
            match load_run_policy(&self.artifacts, &self.tenant, &attempt.run.policy).await {
                Ok(maximum_failures) => maximum_failures,
                Err(_policy_error) => {
                    self.record_failure(
                        &attempt,
                        1,
                        FailureSummary {
                            code: "invalid_run_policy".to_owned(),
                            message: "immutable run retry policy failed validation".to_owned(),
                            retryable: false,
                        },
                    )
                    .await?;
                    return Ok(WorkerDispatchOutcome::PlanningFailed);
                }
            };
        let candidate = match self.planner.build_candidate(attempt.clone()).await {
            Ok(candidate) => candidate,
            Err(error) => {
                let context = *error.current_context();
                tracing::warn!(
                    run_id = %attempt.run.run_id,
                    attempt = attempt.attempt,
                    error = ?error,
                    "accepted run planning failed"
                );
                self.record_failure(&attempt, maximum_failures, planning_failure(context))
                    .await?;
                return Ok(WorkerDispatchOutcome::PlanningFailed);
            }
        };
        let (apply, _, _) = self.lifecycles(&candidate.integration_id)?;
        tracing::debug!(
            run_id = %candidate.run_id,
            attempt = candidate.attempt,
            "accepted run candidate is remotely published"
        );
        let planned = apply
            .plan_apply(candidate)
            .await
            .change_context(WorkerDispatchError::PlanApply)?;
        tracing::debug!(
            work_id = %planned.work.work_id,
            disposition = ?planned.disposition,
            "Apply work is durable"
        );
        Ok(WorkerDispatchOutcome::WorkPlanned(planned.work.work_id))
    }

    async fn record_failure(
        &self,
        attempt: &PlanningAttempt,
        maximum_failures: u32,
        failure: FailureSummary,
    ) -> Result<(), Report<WorkerDispatchError>> {
        let (apply, _, _) = self.lifecycles(&attempt.run.integration_id)?;
        let disposition = apply
            .record_planning_failure(
                &attempt.run.run_id,
                &attempt.attempt_id,
                attempt.attempt,
                maximum_failures,
                failure,
            )
            .await
            .change_context(WorkerDispatchError::RecordPlanningFailure)?;
        if disposition == PlanningFailureDisposition::RunTerminated {
            self.retire_terminal_admission(&attempt.run.integration_id, &attempt.run.run_id)
                .await;
        }
        Ok(())
    }

    fn lifecycles(
        &self,
        integration_id: &CanonicalIntegrationId,
    ) -> Result<(ApplyLifecycle, RestoreLifecycle, ReconcileLifecycle), Report<WorkerDispatchError>>
    {
        let namespace = BlobNamespace::v1(&self.tenant, &routing::integration_path(integration_id));
        let effects: Arc<dyn EffectRepository> = Arc::new(
            ArtifactEffectRepository::new(self.artifacts.clone(), namespace.root())
                .change_context(WorkerDispatchError::BuildLifecycles)?,
        );
        Ok((
            ApplyLifecycle::new(
                self.tenant.clone(),
                self.artifacts.clone(),
                Arc::clone(&effects),
                Arc::clone(&self.state),
                self.commands.clone(),
                Arc::clone(&self.executor),
            ),
            RestoreLifecycle::new(
                self.tenant.clone(),
                self.artifacts.clone(),
                Arc::clone(&effects),
                Arc::clone(&self.state),
                self.commands.clone(),
                Arc::clone(&self.executor),
            ),
            ReconcileLifecycle::new(
                self.tenant.clone(),
                self.artifacts.clone(),
                effects,
                Arc::clone(&self.state),
                self.commands.clone(),
                Arc::clone(&self.executor),
            ),
        ))
    }
}

fn planning_failure(context: RunPlanningError) -> FailureSummary {
    let retryable = matches!(
        context,
        RunPlanningError::State
            | RunPlanningError::Disk
            | RunPlanningError::Workspace
            | RunPlanningError::Sources
            | RunPlanningError::Snapshot
            | RunPlanningError::Cleanup
    );
    FailureSummary {
        code: match context {
            RunPlanningError::StaleRun => "stale_run",
            RunPlanningError::StartAttempt => "start_attempt",
            RunPlanningError::Input => "invalid_run_input",
            RunPlanningError::State => "state_access",
            RunPlanningError::Disk => "local_disk",
            RunPlanningError::Workspace => "candidate_workspace",
            RunPlanningError::Sources => "source_capture",
            RunPlanningError::Candidate => "invalid_candidate",
            RunPlanningError::Snapshot => "snapshot_publication",
            RunPlanningError::Cleanup => "workspace_cleanup",
        }
        .to_owned(),
        message: context.to_string(),
        retryable,
    }
}
