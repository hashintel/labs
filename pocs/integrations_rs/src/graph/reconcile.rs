//! Capacity-bounded reconciliation of journal-applied Graph truth.
//!
//! Reconcile force-applies one immutable desired projection. It shares the
//! ordinary work manifest, cursor, effect lane, and fenced journal path with
//! Apply and Restore; no reconciliation-specific checkpoint protocol exists.
use std::fmt;
use std::sync::Arc;

use error_stack::{Report, ResultExt};

use super::artifacts::EffectRepository;
use super::effects::{EFFECT_ENCODING_VERSION, EFFECT_IDENTITY_VERSION};
use super::executor::{
    BoundedEffectExecutor, ChunkBudget, EffectExecutorError, EffectTurnPermit, ExecutionPlanLoader,
    TurnOutcomeV1,
};
use super::planner::plan_reconcile_effects;
use crate::blob::{ArtifactStore, BlobNamespace};
use crate::orchestrator::events::{
    FailureSummary, JournalEvent, JournalEventV1, JournalRecordV1, WorkBlockedV1, WorkCompletedV1,
    WorkManifestRef, WorkPlannedV1,
};
use crate::orchestrator::ids::{CanonicalIntegrationId, EventId, TenantNamespace, WorkId};
use crate::orchestrator::projection::{MaintenanceStatus, WorkStatus};
use crate::orchestrator::routing;
use crate::orchestrator::shard_log::{
    ShardCommandErrorKind, ShardCommandHandle, ShardCommandOutcome, WorkRecoveryIntent,
};
use crate::orchestrator::state::StateAuthority;
use crate::orchestrator::work::{
    ReconcileWorkV1, WorkKind, WorkManifest, WorkManifestV1, MAX_WORK_MANIFEST_BYTES,
};
use crate::throttle::{GraphRequestCharge, GraphRequestsUsed};

const WORK_MANIFEST_MEDIA_TYPE: &str = "application/vnd.integrations.work-manifest+json";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReconcileLifecycleError {
    NoAppliedState,
    NotEligible,
    EvidenceConflict,
    ArtifactPublication,
    ArtifactIntegrity,
    JournalMutation,
    EffectExecution,
}

impl fmt::Display for ReconcileLifecycleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::NoAppliedState => "integration has no applied state to reconcile",
            Self::NotEligible => "integration is not eligible for reconciliation",
            Self::EvidenceConflict => "Reconcile evidence is inconsistent",
            Self::ArtifactPublication => "Reconcile artifact publication failed",
            Self::ArtifactIntegrity => "Reconcile artifact integrity validation failed",
            Self::JournalMutation => "Reconcile journal mutation failed",
            Self::EffectExecution => "Reconcile effect execution failed",
        })
    }
}

impl std::error::Error for ReconcileLifecycleError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReconcilePlanDisposition {
    Planned,
    Recovered,
}

#[derive(Debug, Clone)]
pub(crate) struct ReconcilePlanOutcome {
    pub(crate) disposition: ReconcilePlanDisposition,
    pub(crate) work: WorkRecoveryIntent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ReconcileTurnOutcome {
    Pending {
        completed_effect_count: u64,
        requests_used: u32,
        retry_after: Option<std::time::Duration>,
    },
    YieldedToForeground {
        work_id: WorkId,
    },
    Completed {
        work_id: WorkId,
        completion_revision: EventId,
        requests_used: u32,
    },
    Blocked {
        work_id: WorkId,
        blocked_revision: EventId,
        requests_used: u32,
    },
    NoLongerRunnable {
        work_id: WorkId,
    },
}

impl GraphRequestCharge for ReconcileTurnOutcome {
    fn graph_requests_used(&self) -> u32 {
        match self {
            Self::Pending { requests_used, .. }
            | Self::Completed { requests_used, .. }
            | Self::Blocked { requests_used, .. } => *requests_used,
            Self::YieldedToForeground { .. } | Self::NoLongerRunnable { .. } => 0,
        }
    }
}

pub(crate) struct ReconcileLifecycle {
    tenant: TenantNamespace,
    artifacts: ArtifactStore,
    effects: Arc<dyn EffectRepository>,
    state: Arc<dyn StateAuthority>,
    commands: ShardCommandHandle,
    loader: ExecutionPlanLoader,
    executor: Arc<BoundedEffectExecutor>,
}

impl ReconcileLifecycle {
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
        }
    }

    pub(crate) async fn plan_reconcile(
        &self,
        integration_id: &CanonicalIntegrationId,
        created_at: String,
    ) -> Result<ReconcilePlanOutcome, Report<ReconcileLifecycleError>> {
        let view = self
            .commands
            .inspect_delivery(integration_id.clone())
            .await
            .change_context(ReconcileLifecycleError::JournalMutation)?
            .ok_or_else(|| Report::new(ReconcileLifecycleError::NoAppliedState))?;
        let target = view
            .applied_state
            .clone()
            .ok_or_else(|| Report::new(ReconcileLifecycleError::NoAppliedState))?;
        let cycle = view
            .reconciliation_cycle
            .checked_add(1)
            .ok_or_else(|| Report::new(ReconcileLifecycleError::EvidenceConflict))?;
        if let Some(work_id) = view.reconciliation_work {
            let work = self
                .commands
                .inspect_work(work_id)
                .await
                .change_context(ReconcileLifecycleError::JournalMutation)?
                .ok_or_else(|| Report::new(ReconcileLifecycleError::EvidenceConflict))?;
            if reconcile_matches(&work, &target, view.applied_incarnation.as_ref(), cycle)
                && matches!(work.status, WorkStatus::Planned | WorkStatus::Blocked)
            {
                return Ok(ReconcilePlanOutcome {
                    disposition: ReconcilePlanDisposition::Recovered,
                    work,
                });
            }
            if !matches!(work.status, WorkStatus::Completed | WorkStatus::Superseded) {
                return Err(Report::new(ReconcileLifecycleError::EvidenceConflict)
                    .attach_printable("live Reconcile work does not match applied evidence"));
            }
        }
        if !view.execution_eligible {
            return Err(Report::new(ReconcileLifecycleError::NotEligible));
        }
        // The candidates query filters foreground at discovery, but the
        // projection can move between selection and planning. A new cycle is
        // never created while foreground work exists or maintenance is
        // pending; recovery of an already durable cycle above stays allowed
        // because execution will yield it anyway.
        if view.foreground_work.is_some() || view.maintenance != MaintenanceStatus::Healthy {
            return Err(Report::new(ReconcileLifecycleError::NotEligible)
                .attach_printable("foreground or maintenance work preempts a new cycle"));
        }
        let state = self
            .state
            .load(integration_id, &target)
            .await
            .change_context(ReconcileLifecycleError::ArtifactIntegrity)?;
        let desired_reference = state
            .into_current()
            .change_context(ReconcileLifecycleError::ArtifactIntegrity)?
            .desired_projection;
        let desired = self
            .effects
            .load_desired_projection(&desired_reference)
            .await
            .change_context(ReconcileLifecycleError::ArtifactIntegrity)?;
        let effects = plan_reconcile_effects(target.id.as_str(), &desired)
            .change_context(ReconcileLifecycleError::EvidenceConflict)?;
        let effect_count = u64::try_from(effects.len())
            .change_context(ReconcileLifecycleError::EvidenceConflict)
            .attach_printable("Reconcile effect count does not fit the durable manifest")?;
        let effect_index = self
            .effects
            .publish_effect_index(target.id.as_str(), effects)
            .await
            .change_context(ReconcileLifecycleError::ArtifactPublication)?;
        let manifest = WorkManifest::V1(
            WorkManifestV1::new(
                integration_id,
                WorkKind::Reconcile(ReconcileWorkV1 {
                    target,
                    applied_incarnation: view.applied_incarnation,
                    cycle,
                }),
                effect_index,
                effect_count,
                EFFECT_IDENTITY_VERSION,
                EFFECT_ENCODING_VERSION,
                created_at,
            )
            .change_context(ReconcileLifecycleError::EvidenceConflict)?,
        );
        let manifest_value = manifest
            .try_current_for(integration_id)
            .change_context(ReconcileLifecycleError::EvidenceConflict)?
            .clone();
        let prefix = BlobNamespace::v1(&self.tenant, &routing::integration_path(integration_id))
            .key("work-manifests")
            .change_context(ReconcileLifecycleError::ArtifactPublication)?;
        let artifact = self
            .artifacts
            .publish_record(
                &manifest,
                MAX_WORK_MANIFEST_BYTES,
                &prefix,
                WORK_MANIFEST_MEDIA_TYPE,
            )
            .await
            .change_context(ReconcileLifecycleError::ArtifactPublication)?;
        let manifest_reference = WorkManifestRef {
            work_id: manifest_value.work_id.clone(),
            manifest_digest: artifact.current().sha256.clone(),
            artifact,
        };
        let record = JournalRecordV1::new(
            integration_id.clone(),
            JournalEvent::V1(JournalEventV1::WorkPlanned(WorkPlannedV1 {
                manifest: manifest_reference.clone(),
                manifest_record: manifest,
                candidate_state_record: None,
            })),
        )
        .change_context(ReconcileLifecycleError::EvidenceConflict)?;
        let revision = record.event_id.clone();
        let disposition = match self
            .commands
            .propose(record)
            .await
            .change_context(ReconcileLifecycleError::JournalMutation)?
        {
            ShardCommandOutcome::Applied { .. } => ReconcilePlanDisposition::Planned,
            ShardCommandOutcome::AlreadyDurable { .. } => ReconcilePlanDisposition::Recovered,
        };
        Ok(ReconcilePlanOutcome {
            disposition,
            work: WorkRecoveryIntent {
                integration_id: integration_id.clone(),
                work_id: manifest_value.work_id,
                manifest: manifest_reference,
                kind: manifest_value.kind,
                status: WorkStatus::Planned,
                effect_count,
                completed_effect_count: 0,
                last_completed_effect: None,
                failure: None,
                settings_revision: None,
                revision,
            },
        })
    }

    /// Permit-free entry point for lifecycle reference tests. Production
    /// dispatch always executes through a lease chunk permit.
    #[cfg(test)]
    pub(crate) async fn execute_reconcile_turn(
        &self,
        work_id: &WorkId,
        budget: ChunkBudget,
    ) -> Result<ReconcileTurnOutcome, Report<ReconcileLifecycleError>> {
        self.execute_reconcile_turn_with_permit(work_id, budget, None)
            .await
    }

    pub(crate) async fn execute_permitted_reconcile_turn(
        &self,
        work_id: &WorkId,
        budget: ChunkBudget,
        permit: &dyn EffectTurnPermit,
    ) -> Result<ReconcileTurnOutcome, Report<ReconcileLifecycleError>> {
        self.execute_reconcile_turn_with_permit(work_id, budget, Some(permit))
            .await
    }

    async fn execute_reconcile_turn_with_permit(
        &self,
        work_id: &WorkId,
        budget: ChunkBudget,
        permit: Option<&dyn EffectTurnPermit>,
    ) -> Result<ReconcileTurnOutcome, Report<ReconcileLifecycleError>> {
        let Some(work) = self
            .commands
            .inspect_work(work_id.clone())
            .await
            .change_context(ReconcileLifecycleError::JournalMutation)?
        else {
            return Ok(ReconcileTurnOutcome::NoLongerRunnable {
                work_id: work_id.clone(),
            });
        };
        let WorkKind::Reconcile(reconcile) = &work.kind else {
            return Err(Report::new(ReconcileLifecycleError::EvidenceConflict)
                .attach_printable("Reconcile lifecycle received non-Reconcile work"));
        };
        if work.status != WorkStatus::Planned {
            return Ok(ReconcileTurnOutcome::NoLongerRunnable {
                work_id: work_id.clone(),
            });
        }
        let view = self
            .commands
            .inspect_delivery(work.integration_id.clone())
            .await
            .change_context(ReconcileLifecycleError::JournalMutation)?
            .ok_or_else(|| Report::new(ReconcileLifecycleError::EvidenceConflict))?;
        if view.foreground_work.is_some() || view.maintenance != MaintenanceStatus::Healthy {
            return Ok(ReconcileTurnOutcome::YieldedToForeground {
                work_id: work_id.clone(),
            });
        }
        if view.applied_state.as_ref() != Some(&reconcile.target)
            || view.applied_incarnation != reconcile.applied_incarnation
            || view.reconciliation_work.as_ref() != Some(work_id)
        {
            return Ok(ReconcileTurnOutcome::NoLongerRunnable {
                work_id: work_id.clone(),
            });
        }
        let prepared = match self.loader.load(&work, budget).await {
            Ok(prepared) => prepared,
            Err(error) if error.current_context() == &EffectExecutorError::ArtifactIntegrity => {
                tracing::error!(
                    work_id = %work.work_id,
                    error = ?error,
                    "immutable Reconcile artifact failed integrity validation"
                );
                return self
                    .block_reconcile(
                        &work,
                        "artifact_integrity",
                        "immutable Reconcile artifact failed integrity validation".to_owned(),
                        0,
                    )
                    .await;
            }
            Err(error) => {
                return Err(error.change_context(ReconcileLifecycleError::EffectExecution));
            }
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
            }) => Ok(ReconcileTurnOutcome::Pending {
                completed_effect_count,
                requests_used,
                retry_after: None,
            }),
            Ok(TurnOutcomeV1::Yielded {
                completed_effect_count,
                requests_used,
                retry_after,
            }) => Ok(ReconcileTurnOutcome::Pending {
                completed_effect_count,
                requests_used,
                retry_after,
            }),
            Ok(TurnOutcomeV1::Progressed {
                work_exhausted: true,
                requests_used,
                ..
            }) => self.complete_reconcile(&work, requests_used).await,
            Ok(TurnOutcomeV1::PermanentFailure {
                failed_effect_id,
                status,
                diagnostic,
                requests_used,
                ..
            }) => {
                self.block_reconcile(
                    &work,
                    "graph_permanent",
                    format!(
                        "Graph effect {failed_effect_id} failed permanently (status {status:?}): {diagnostic}"
                    ),
                    requests_used,
                )
                .await
            }
            Err(error) => {
                if error.current_context() == &EffectExecutorError::CursorCommit {
                    let requests_used = error.graph_requests_used();
                    if let Some(outcome) = self.adopt_stale_work(&work.work_id, requests_used).await? {
                        return Ok(outcome);
                    }
                }
                Err(error.change_context(ReconcileLifecycleError::EffectExecution))
            }
        }
    }

    async fn complete_reconcile(
        &self,
        work: &WorkRecoveryIntent,
        requests_used: u32,
    ) -> Result<ReconcileTurnOutcome, Report<ReconcileLifecycleError>> {
        let record = JournalRecordV1::new(
            work.integration_id.clone(),
            JournalEvent::V1(JournalEventV1::WorkCompleted(WorkCompletedV1 {
                work_id: work.work_id.clone(),
                manifest_digest: work.manifest.manifest_digest.clone(),
            })),
        )
        .change_context(ReconcileLifecycleError::EvidenceConflict)?;
        let completion_revision = record.event_id.clone();
        if let Err(error) = self.commands.propose(record).await {
            if error.kind == ShardCommandErrorKind::InvalidCandidate {
                if let Some(outcome) = self.adopt_stale_work(&work.work_id, requests_used).await? {
                    return Ok(outcome);
                }
            }
            return Err(error)
                .change_context(ReconcileLifecycleError::JournalMutation)
                .attach(GraphRequestsUsed::new(requests_used));
        }
        self.artifacts.telemetry().clear_blocked_work(
            &crate::orchestrator::routing::integration_path(&work.integration_id).to_string(),
            &work.work_id.to_string(),
        );
        self.artifacts.telemetry().record_reconciliation_completed(
            &crate::orchestrator::routing::integration_path(&work.integration_id).to_string(),
            chrono::Utc::now(),
        );
        Ok(ReconcileTurnOutcome::Completed {
            work_id: work.work_id.clone(),
            completion_revision,
            requests_used,
        })
    }

    async fn block_reconcile(
        &self,
        work: &WorkRecoveryIntent,
        code: &str,
        message: String,
        requests_used: u32,
    ) -> Result<ReconcileTurnOutcome, Report<ReconcileLifecycleError>> {
        let record = JournalRecordV1::new(
            work.integration_id.clone(),
            JournalEvent::V1(JournalEventV1::WorkBlocked(WorkBlockedV1 {
                work_id: work.work_id.clone(),
                manifest_digest: work.manifest.manifest_digest.clone(),
                failure: FailureSummary {
                    code: code.to_owned(),
                    message,
                    retryable: false,
                },
            })),
        )
        .change_context(ReconcileLifecycleError::EvidenceConflict)?;
        let blocked_revision = record.event_id.clone();
        if let Err(error) = self.commands.propose(record).await {
            if error.kind == ShardCommandErrorKind::InvalidCandidate {
                if let Some(outcome) = self.adopt_stale_work(&work.work_id, requests_used).await? {
                    return Ok(outcome);
                }
            }
            return Err(error)
                .change_context(ReconcileLifecycleError::JournalMutation)
                .attach(GraphRequestsUsed::new(requests_used));
        }
        self.artifacts.telemetry().observe_blocked_work(
            &crate::orchestrator::routing::integration_path(&work.integration_id).to_string(),
            &work.work_id.to_string(),
            chrono::Utc::now(),
        );
        Ok(ReconcileTurnOutcome::Blocked {
            work_id: work.work_id.clone(),
            blocked_revision,
            requests_used,
        })
    }

    /// Errors from adoption itself still carry the turn's actual request
    /// charge, so the caller's settlement never under-reports.
    async fn adopt_stale_work(
        &self,
        work_id: &WorkId,
        requests_used: u32,
    ) -> Result<Option<ReconcileTurnOutcome>, Report<ReconcileLifecycleError>> {
        let current = self
            .commands
            .inspect_work(work_id.clone())
            .await
            .change_context(ReconcileLifecycleError::JournalMutation)
            .map_err(|error| error.attach(GraphRequestsUsed::new(requests_used)))?;
        Ok(match current {
            Some(work) if work.status == WorkStatus::Planned => None,
            Some(work) if work.status == WorkStatus::Completed => {
                Some(ReconcileTurnOutcome::Completed {
                    work_id: work.work_id,
                    completion_revision: work.revision,
                    requests_used,
                })
            }
            Some(work) if work.status == WorkStatus::Blocked => {
                Some(ReconcileTurnOutcome::Blocked {
                    work_id: work.work_id,
                    blocked_revision: work.revision,
                    requests_used,
                })
            }
            _ => Some(ReconcileTurnOutcome::NoLongerRunnable {
                work_id: work_id.clone(),
            }),
        })
    }
}

fn reconcile_matches(
    work: &WorkRecoveryIntent,
    target: &crate::orchestrator::work::StateVersionRef,
    applied_incarnation: Option<&EventId>,
    cycle: u64,
) -> bool {
    matches!(
        &work.kind,
        WorkKind::Reconcile(reconcile)
            if &reconcile.target == target
                && reconcile.applied_incarnation.as_ref() == applied_incarnation
                && reconcile.cycle == cycle
    )
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use std::collections::VecDeque;
    use std::path::Path;

    use async_trait::async_trait;
    use tokio::sync::Mutex;

    use super::*;
    use crate::blob::{BlobRef, BlobRefV1, StateSnapshot, StateSnapshotV1};
    use crate::graph::apply::{ApplyCandidateV1, ApplyLifecycle, ApplyTurnOutcome};
    use crate::graph::artifacts::{
        ArtifactEffectRepository, DesiredObjectInputDispositionV1, DesiredObjectInputV1,
        GraphObjectKindV1,
    };
    use crate::graph::effects::GraphOperationV1;
    use crate::graph::executor::{
        EffectLaneRegistry, EffectRequestV1, EffectResponseV1, GraphEffectTransport, RetryDelay,
        ShardWorkCursorCommitter, TransportFailureV1,
    };
    use crate::graph::planner::{
        EffectSelectionV1, GraphDeliveryPayload, GraphDeliveryPayloadV1, GraphPlanV1,
        PlannedEffectV1, ProjectionCoverageV1,
    };
    use crate::graph::restore::{RestoreLifecycle, RestoreTurnOutcome};
    use crate::orchestrator::events::{
        AttemptStartedV1, InputRef, PolicyRef, RunAcceptedV1, RunTerminatedV1, TerminalOutcome,
        WorkChunkCompletedV1,
    };
    use crate::orchestrator::ids::{derive_attempt_id, AttemptId, EffectId, RunId};
    use crate::orchestrator::registry::DurableRecord;
    use crate::orchestrator::shard_log::{
        start_recovered, ShardCommandConfig, ShardLogLocation, StartedShard,
    };
    use crate::orchestrator::state::JournalStateAuthority;
    use crate::orchestrator::work::{StatePhase, StatePhaseV1};

    #[derive(Default)]
    struct ScriptedTransport {
        responses: Mutex<VecDeque<EffectResponseV1>>,
        requests: Mutex<Vec<EffectRequestV1>>,
    }

    impl ScriptedTransport {
        fn successes(count: usize) -> Self {
            Self {
                responses: Mutex::new(
                    std::iter::repeat_n(EffectResponseV1::Success, count).collect(),
                ),
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
                .unwrap_or(EffectResponseV1::Transport(TransportFailureV1::Request))
        }
    }

    struct SupersedingTransport {
        requests: Mutex<Vec<EffectRequestV1>>,
        apply: ApplyLifecycle,
        candidate: Mutex<Option<ApplyCandidateV1>>,
        handle: ShardCommandHandle,
    }

    #[async_trait]
    impl GraphEffectTransport for SupersedingTransport {
        async fn send(&self, request: EffectRequestV1) -> EffectResponseV1 {
            self.requests.lock().await.push(request);
            let candidate = self.candidate.lock().await.take();
            if let Some(candidate) = candidate {
                let planned = self
                    .apply
                    .plan_apply(candidate)
                    .await
                    .expect("plan superseding Apply");
                assert_eq!(planned.work.effect_count, 0);
                self.handle
                    .propose(
                        JournalRecordV1::new(
                            planned.work.integration_id.clone(),
                            JournalEvent::V1(JournalEventV1::WorkCompleted(WorkCompletedV1 {
                                work_id: planned.work.work_id,
                                manifest_digest: planned.work.manifest.manifest_digest,
                            })),
                        )
                        .expect("superseding WorkCompleted"),
                    )
                    .await
                    .expect("complete superseding Apply");
            }
            EffectResponseV1::Success
        }
    }

    struct NoDelay;

    #[async_trait]
    impl RetryDelay for NoDelay {
        async fn wait(&self, _delay: std::time::Duration) {}
    }

    struct Rig {
        tenant: TenantNamespace,
        store: ArtifactStore,
        effects: Arc<dyn EffectRepository>,
        state: Arc<dyn StateAuthority>,
        handle: ShardCommandHandle,
        started: StartedShard,
        integration: CanonicalIntegrationId,
        run_id: RunId,
        attempt_id: AttemptId,
    }

    async fn open_rig(remote: &Path, cache: &Path) -> Rig {
        let tenant = TenantNamespace::parse("reconcile-tests").expect("tenant");
        let integration =
            CanonicalIntegrationId::parse("alice:reconcile-lifecycle").expect("integration");
        let started = start_recovered(
            ShardLogLocation::disposable_local(routing::shard(&integration), &tenant, remote),
            ShardCommandConfig::default(),
        )
        .await
        .expect("start shard");
        let handle = started.handle.clone();
        let store = ArtifactStore::local(remote, cache).expect("artifact store");
        let namespace = BlobNamespace::v1(&tenant, &routing::integration_path(&integration));
        let effects: Arc<dyn EffectRepository> = Arc::new(
            ArtifactEffectRepository::new(store.clone(), namespace.root())
                .expect("effect repository"),
        );
        let state: Arc<dyn StateAuthority> = Arc::new(JournalStateAuthority::new(
            store.clone(),
            tenant.clone(),
            handle.clone(),
        ));
        let run_id = RunId::parse("00000099-0000-4000-8000-000000000001").expect("run ID");
        Rig {
            tenant,
            store,
            effects,
            state,
            handle,
            started,
            integration,
            attempt_id: derive_attempt_id(&run_id, 1),
            run_id,
        }
    }

    fn executor(
        handle: &ShardCommandHandle,
        transport: Arc<dyn GraphEffectTransport>,
    ) -> Arc<BoundedEffectExecutor> {
        Arc::new(BoundedEffectExecutor::new(
            transport,
            Arc::new(ShardWorkCursorCommitter::new(handle.clone())),
            Arc::new(NoDelay),
            Arc::new(EffectLaneRegistry::default()),
        ))
    }

    fn apply_lifecycle(rig: &Rig, transport: Arc<dyn GraphEffectTransport>) -> ApplyLifecycle {
        ApplyLifecycle::new(
            rig.tenant.clone(),
            rig.store.clone(),
            Arc::clone(&rig.effects),
            Arc::clone(&rig.state),
            rig.handle.clone(),
            executor(&rig.handle, transport),
        )
    }

    fn reconcile_lifecycle(
        rig: &Rig,
        transport: Arc<dyn GraphEffectTransport>,
    ) -> ReconcileLifecycle {
        ReconcileLifecycle::new(
            rig.tenant.clone(),
            rig.store.clone(),
            Arc::clone(&rig.effects),
            Arc::clone(&rig.state),
            rig.handle.clone(),
            executor(&rig.handle, transport),
        )
    }

    fn restore_lifecycle(rig: &Rig, transport: Arc<dyn GraphEffectTransport>) -> RestoreLifecycle {
        RestoreLifecycle::new(
            rig.tenant.clone(),
            rig.store.clone(),
            Arc::clone(&rig.effects),
            Arc::clone(&rig.state),
            rig.handle.clone(),
            executor(&rig.handle, transport),
        )
    }

    async fn seed_running(rig: &Rig) {
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
                    JournalEvent::V1(JournalEventV1::AttemptStarted(AttemptStartedV1 {
                        run_id: rig.run_id.clone(),
                        attempt_id: rig.attempt_id.clone(),
                        attempt: 1,
                    })),
                )
                .expect("AttemptStarted"),
            )
            .await
            .expect("append AttemptStarted");
    }

    async fn establish_applied(rig: &Rig, identities: &[&str]) {
        seed_running(rig).await;
        let transport = Arc::new(ScriptedTransport::successes(identities.len()));
        let apply = apply_lifecycle(rig, transport);
        let planned = apply
            .plan_apply(candidate(
                rig,
                identities,
                1,
                ProjectionCoverageV1::Complete,
            ))
            .await
            .expect("plan initial Apply");
        assert!(matches!(
            apply
                .execute_apply_turn(&planned.work.work_id, ChunkBudget::new(16).expect("budget"))
                .await
                .expect("complete initial Apply"),
            ApplyTurnOutcome::Completed { .. }
        ));
    }

    fn candidate(
        rig: &Rig,
        identities: &[&str],
        generation: u64,
        coverage: ProjectionCoverageV1,
    ) -> ApplyCandidateV1 {
        let mut graph = GraphPlanV1::default();
        for identity in identities {
            let payload = GraphDeliveryPayload::V1(
                GraphDeliveryPayloadV1::upsert(
                    (*identity).to_owned(),
                    serde_json::json!({"webId": "alice"}),
                    serde_json::json!({"entityId": identity, "archived": false}),
                    serde_json::json!({"entityId": identity, "archived": true}),
                )
                .expect("delivery"),
            )
            .encode()
            .expect("delivery bytes");
            graph.desired.push(DesiredObjectInputV1 {
                kind: GraphObjectKindV1::Entity,
                graph_identity: (*identity).to_owned(),
                disposition: DesiredObjectInputDispositionV1::Live(payload),
            });
            graph.effects.push(PlannedEffectV1 {
                operation: GraphOperationV1::UpsertEntity,
                kind: GraphObjectKindV1::Entity,
                graph_identity: (*identity).to_owned(),
            });
        }
        let namespace =
            BlobNamespace::v1(&rig.tenant, &routing::integration_path(&rig.integration));
        ApplyCandidateV1 {
            integration_id: rig.integration.clone(),
            run_id: rig.run_id.clone(),
            attempt_id: rig.attempt_id.clone(),
            attempt: 1,
            phase: StatePhase::V1(StatePhaseV1::LinksCommitted),
            snapshot: StateSnapshot::V1(StateSnapshotV1 {
                generation,
                duckdb: blob(
                    &namespace
                        .key(&format!("snapshots/{generation}.duckdb"))
                        .expect("snapshot key"),
                    'd',
                    "application/vnd.duckdb",
                ),
                accepted_batches: vec![],
                created_at: format!("2026-07-22T18:{generation:02}:00Z"),
            }),
            definition_digest: "e".repeat(64),
            definition_digest_encoding_version: 1,
            planner_version: 1,
            state_schema_version: 1,
            desired_projection_schema_version: 1,
            graph,
            selection: EffectSelectionV1::ChangesOnly,
            coverage,
            created_at: format!("2026-07-22T18:{generation:02}:01Z"),
        }
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

    async fn close(rig: Rig) {
        rig.handle.shutdown().await.expect("shutdown shard");
        rig.started.task.await.expect("join shard").expect("shard");
    }

    #[tokio::test]
    async fn force_cycle_completes_and_the_next_cycle_has_a_new_work_identity() {
        let remote = tempfile::tempdir().expect("remote");
        let cache = tempfile::tempdir().expect("cache");
        let rig = open_rig(remote.path(), cache.path()).await;
        establish_applied(&rig, &["entity:a", "entity:b"]).await;
        let transport = Arc::new(ScriptedTransport::successes(2));
        let reconcile = reconcile_lifecycle(&rig, transport);
        let first = reconcile
            .plan_reconcile(&rig.integration, "2026-07-22T19:00:00Z".to_owned())
            .await
            .expect("plan Reconcile");
        assert_eq!(first.disposition, ReconcilePlanDisposition::Planned);
        assert_eq!(first.work.effect_count, 2);
        assert!(matches!(
            reconcile
                .execute_reconcile_turn(&first.work.work_id, ChunkBudget::new(8).expect("budget"))
                .await
                .expect("complete Reconcile"),
            ReconcileTurnOutcome::Completed { .. }
        ));
        let second = reconcile
            .plan_reconcile(&rig.integration, "2026-07-22T20:00:00Z".to_owned())
            .await
            .expect("plan next cycle");
        assert_ne!(second.work.work_id, first.work.work_id);
        let WorkKind::Reconcile(kind) = second.work.kind else {
            panic!("Reconcile work")
        };
        assert_eq!(kind.cycle, 2);
        close(rig).await;
    }

    #[tokio::test]
    async fn durable_reconcile_is_adopted_before_regenerating_its_manifest() {
        let remote = tempfile::tempdir().expect("remote");
        let cache = tempfile::tempdir().expect("cache");
        let rig = open_rig(remote.path(), cache.path()).await;
        establish_applied(&rig, &["entity:a"]).await;
        let lifecycle = reconcile_lifecycle(&rig, Arc::new(ScriptedTransport::default()));
        let first = lifecycle
            .plan_reconcile(&rig.integration, "2026-07-22T19:00:00Z".to_owned())
            .await
            .expect("plan Reconcile");
        let recovered = lifecycle
            .plan_reconcile(&rig.integration, "2026-07-22T23:59:00Z".to_owned())
            .await
            .expect("recover Reconcile");
        assert_eq!(recovered.disposition, ReconcilePlanDisposition::Recovered);
        assert_eq!(recovered.work.work_id, first.work.work_id);
        assert_eq!(recovered.work.manifest, first.work.manifest);
        close(rig).await;
    }

    #[tokio::test]
    async fn corrupt_durable_cursor_blocks_reconcile_without_sending() {
        let remote = tempfile::tempdir().expect("remote");
        let cache = tempfile::tempdir().expect("cache");
        let rig = open_rig(remote.path(), cache.path()).await;
        establish_applied(&rig, &["entity:a", "entity:b"]).await;
        let transport = Arc::new(ScriptedTransport::successes(2));
        let lifecycle = reconcile_lifecycle(&rig, transport.clone());
        let planned = lifecycle
            .plan_reconcile(&rig.integration, "2026-07-22T19:00:00Z".to_owned())
            .await
            .expect("plan Reconcile");
        rig.handle
            .propose(
                JournalRecordV1::new(
                    rig.integration.clone(),
                    JournalEvent::V1(JournalEventV1::WorkChunkCompleted(WorkChunkCompletedV1 {
                        work_id: planned.work.work_id.clone(),
                        manifest_digest: planned.work.manifest.manifest_digest.clone(),
                        completed_effect_count: 1,
                        last_effect_id: EffectId::parse("f".repeat(64)).expect("forged effect ID"),
                    })),
                )
                .expect("forged cursor"),
            )
            .await
            .expect("append projection-valid forged cursor");
        assert!(matches!(
            lifecycle
                .execute_reconcile_turn(&planned.work.work_id, ChunkBudget::new(2).expect("budget"))
                .await
                .expect("block corrupt Reconcile"),
            ReconcileTurnOutcome::Blocked { .. }
        ));
        assert!(transport.requests().await.is_empty());
        let blocked = rig
            .handle
            .inspect_work(planned.work.work_id)
            .await
            .expect("work query")
            .expect("work");
        assert_eq!(blocked.status, WorkStatus::Blocked);
        assert_eq!(blocked.completed_effect_count, 1);
        assert_eq!(blocked.failure.expect("failure").code, "artifact_integrity");
        close(rig).await;
    }

    #[tokio::test]
    async fn reconcile_yields_without_sending_when_foreground_becomes_runnable() {
        let remote = tempfile::tempdir().expect("remote");
        let cache = tempfile::tempdir().expect("cache");
        let rig = open_rig(remote.path(), cache.path()).await;
        establish_applied(&rig, &["entity:a"]).await;
        let transport = Arc::new(ScriptedTransport::successes(1));
        let reconcile = reconcile_lifecycle(&rig, transport.clone());
        let planned = reconcile
            .plan_reconcile(&rig.integration, "2026-07-22T19:00:00Z".to_owned())
            .await
            .expect("plan Reconcile");
        let foreground = apply_lifecycle(&rig, Arc::new(ScriptedTransport::default()))
            .plan_apply(candidate(&rig, &[], 2, ProjectionCoverageV1::Partial))
            .await
            .expect("plan foreground Apply");
        assert_eq!(foreground.work.effect_count, 0);
        assert!(matches!(
            reconcile
                .execute_reconcile_turn(&planned.work.work_id, ChunkBudget::new(2).expect("budget"))
                .await
                .expect("yield Reconcile"),
            ReconcileTurnOutcome::YieldedToForeground { .. }
        ));
        assert!(transport.requests().await.is_empty());
        close(rig).await;
    }

    #[tokio::test]
    async fn apply_completion_during_send_supersedes_cursor_without_poisoning_the_shard() {
        let remote = tempfile::tempdir().expect("remote");
        let cache = tempfile::tempdir().expect("cache");
        let rig = open_rig(remote.path(), cache.path()).await;
        establish_applied(&rig, &["entity:a", "entity:b"]).await;
        let initial = reconcile_lifecycle(&rig, Arc::new(ScriptedTransport::default()))
            .plan_reconcile(&rig.integration, "2026-07-22T19:00:00Z".to_owned())
            .await
            .expect("plan Reconcile");
        let transport = Arc::new(SupersedingTransport {
            requests: Mutex::new(vec![]),
            apply: apply_lifecycle(&rig, Arc::new(ScriptedTransport::default())),
            candidate: Mutex::new(Some(candidate(&rig, &[], 2, ProjectionCoverageV1::Partial))),
            handle: rig.handle.clone(),
        });
        let reconcile = reconcile_lifecycle(&rig, transport.clone());
        assert!(matches!(
            reconcile
                .execute_reconcile_turn(&initial.work.work_id, ChunkBudget::new(2).expect("budget"))
                .await
                .expect("superseded turn"),
            ReconcileTurnOutcome::NoLongerRunnable { .. }
        ));
        assert_eq!(transport.requests.lock().await.len(), 1);
        let superseded = rig
            .handle
            .inspect_work(initial.work.work_id.clone())
            .await
            .expect("work query")
            .expect("work");
        assert_eq!(superseded.status, WorkStatus::Superseded);
        assert_eq!(superseded.completed_effect_count, 0);

        let replacement = reconcile
            .plan_reconcile(&rig.integration, "2026-07-22T20:00:00Z".to_owned())
            .await
            .expect("plan replacement cycle");
        assert_ne!(replacement.work.work_id, initial.work.work_id);
        close(rig).await;
    }

    #[tokio::test]
    async fn restore_to_the_same_target_resumes_the_existing_cycle_and_cursor() {
        let remote = tempfile::tempdir().expect("remote");
        let cache = tempfile::tempdir().expect("cache");
        let rig = open_rig(remote.path(), cache.path()).await;
        establish_applied(&rig, &["entity:a", "entity:b"]).await;
        let before = rig
            .handle
            .inspect_delivery(rig.integration.clone())
            .await
            .expect("delivery view")
            .expect("integration");
        let applied = before.applied_state.clone();
        let incarnation = before.applied_incarnation.clone();

        let first_lifecycle = reconcile_lifecycle(&rig, Arc::new(ScriptedTransport::successes(1)));
        let reconcile = first_lifecycle
            .plan_reconcile(&rig.integration, "2026-07-22T19:00:00Z".to_owned())
            .await
            .expect("plan Reconcile");
        assert!(matches!(
            first_lifecycle
                .execute_reconcile_turn(
                    &reconcile.work.work_id,
                    ChunkBudget::new(2).expect("budget")
                )
                .await
                .expect("first Reconcile chunk"),
            ReconcileTurnOutcome::Pending {
                completed_effect_count: 1,
                ..
            }
        ));

        let failed_apply = apply_lifecycle(&rig, Arc::new(ScriptedTransport::default()))
            .plan_apply(candidate(
                &rig,
                &["entity:a", "entity:b", "entity:g-only"],
                2,
                ProjectionCoverageV1::Complete,
            ))
            .await
            .expect("plan contaminated Apply");
        rig.handle
            .propose(
                JournalRecordV1::new(
                    rig.integration.clone(),
                    JournalEvent::V1(JournalEventV1::RunTerminated(RunTerminatedV1 {
                        run_id: rig.run_id.clone(),
                        outcome: TerminalOutcome::Failed,
                        failed_work: Some(failed_apply.work.work_id),
                        failure: Some(FailureSummary {
                            code: "apply_failed".to_owned(),
                            message: "Apply delivery failed permanently".to_owned(),
                            retryable: false,
                        }),
                        request: None,
                    })),
                )
                .expect("RunTerminated"),
            )
            .await
            .expect("terminate Apply");
        let restore = restore_lifecycle(&rig, Arc::new(ScriptedTransport::successes(3)));
        let restore_work = restore
            .plan_restore(&rig.integration, "2026-07-22T19:10:00Z".to_owned())
            .await
            .expect("plan Restore");
        assert!(matches!(
            restore
                .execute_restore_turn(
                    &restore_work.work.work_id,
                    ChunkBudget::new(8).expect("budget")
                )
                .await
                .expect("complete Restore"),
            RestoreTurnOutcome::Completed { .. }
        ));

        let after = rig
            .handle
            .inspect_delivery(rig.integration.clone())
            .await
            .expect("delivery view")
            .expect("integration");
        assert_eq!(after.applied_state, applied);
        assert_eq!(after.applied_incarnation, incarnation);
        let resumed = rig
            .handle
            .inspect_work(reconcile.work.work_id.clone())
            .await
            .expect("work query")
            .expect("work");
        assert_eq!(resumed.status, WorkStatus::Planned);
        assert_eq!(resumed.completed_effect_count, 1);
        assert_eq!(
            rig.handle
                .next_runnable_work()
                .await
                .expect("next work")
                .expect("Reconcile work")
                .work_id,
            reconcile.work.work_id
        );

        let final_lifecycle = reconcile_lifecycle(&rig, Arc::new(ScriptedTransport::successes(1)));
        assert!(matches!(
            final_lifecycle
                .execute_reconcile_turn(
                    &reconcile.work.work_id,
                    ChunkBudget::new(2).expect("budget")
                )
                .await
                .expect("finish resumed Reconcile"),
            ReconcileTurnOutcome::Completed { .. }
        ));
        close(rig).await;
    }
}
