//! Deterministic Restore planning and lifecycle composition.
//!
//! Restore is derived only from journal-projected failure evidence and
//! immutable desired projections. It never attempts to invert individual
//! external calls.
use std::fmt;
use std::sync::Arc;

use error_stack::{Report, ResultExt};

use super::artifacts::EffectRepository;
use super::effects::{EFFECT_ENCODING_VERSION, EFFECT_IDENTITY_VERSION};
use super::executor::{
    BoundedEffectExecutor, ChunkBudget, EffectExecutorError, EffectTurnPermit, ExecutionPlanLoader,
    TurnOutcomeV1,
};
use super::planner::plan_restore_effects;
use crate::blob::{ArtifactStore, BlobNamespace};
use crate::orchestrator::events::{
    FailureSummary, JournalEvent, JournalEventV1, JournalRecordV1, WorkBlockedV1, WorkCompletedV1,
    WorkManifestRef, WorkPlannedV1,
};
use crate::orchestrator::ids::{CanonicalIntegrationId, EventId, TenantNamespace, WorkId};
use crate::orchestrator::projection::{MaintenanceStatus, RestoreEvidence, WorkStatus};
use crate::orchestrator::routing;
use crate::orchestrator::shard_log::{
    ShardCommandErrorKind, ShardCommandHandle, ShardCommandOutcome, WorkRecoveryIntent,
};
use crate::orchestrator::state::StateAuthority;
use crate::orchestrator::work::{
    RestoreWorkV1, StateVersionRef, WorkKind, WorkManifest, WorkManifestV1, MAX_WORK_MANIFEST_BYTES,
};
use crate::throttle::{GraphRequestCharge, GraphRequestsUsed};

const WORK_MANIFEST_MEDIA_TYPE: &str = "application/vnd.integrations.work-manifest+json";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RestoreLifecycleError {
    NoRestoreRequired,
    EvidenceConflict,
    ArtifactPublication,
    ArtifactIntegrity,
    JournalMutation,
    EffectExecution,
}

impl fmt::Display for RestoreLifecycleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::NoRestoreRequired => "integration has no runnable Restore obligation",
            Self::EvidenceConflict => "Restore evidence is inconsistent",
            Self::ArtifactPublication => "Restore artifact publication failed",
            Self::ArtifactIntegrity => "Restore artifact integrity validation failed",
            Self::JournalMutation => "Restore journal mutation failed",
            Self::EffectExecution => "Restore effect execution failed",
        })
    }
}

impl std::error::Error for RestoreLifecycleError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RestorePlanDisposition {
    Planned,
    Recovered,
}

#[derive(Debug, Clone)]
pub(crate) struct RestorePlanOutcome {
    pub(crate) disposition: RestorePlanDisposition,
    pub(crate) work: WorkRecoveryIntent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RestoreTurnOutcome {
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
    Blocked {
        work_id: WorkId,
        blocked_revision: EventId,
        requests_used: u32,
    },
    NoLongerRunnable {
        work_id: WorkId,
    },
}

impl GraphRequestCharge for RestoreTurnOutcome {
    fn graph_requests_used(&self) -> u32 {
        match self {
            Self::Pending { requests_used, .. }
            | Self::Completed { requests_used, .. }
            | Self::Blocked { requests_used, .. } => *requests_used,
            Self::NoLongerRunnable { .. } => 0,
        }
    }
}

pub(crate) struct RestoreLifecycle {
    tenant: TenantNamespace,
    artifacts: ArtifactStore,
    effects: Arc<dyn EffectRepository>,
    state: Arc<dyn StateAuthority>,
    commands: ShardCommandHandle,
    loader: ExecutionPlanLoader,
    executor: Arc<BoundedEffectExecutor>,
}

impl RestoreLifecycle {
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

    pub(crate) async fn plan_restore(
        &self,
        integration_id: &CanonicalIntegrationId,
        created_at: String,
    ) -> Result<RestorePlanOutcome, Report<RestoreLifecycleError>> {
        let view = self
            .commands
            .inspect_delivery(integration_id.clone())
            .await
            .change_context(RestoreLifecycleError::JournalMutation)?
            .ok_or_else(|| Report::new(RestoreLifecycleError::NoRestoreRequired))?;
        if let Some(work_id) = view.foreground_work {
            let work = self
                .commands
                .inspect_work(work_id)
                .await
                .change_context(RestoreLifecycleError::JournalMutation)?
                .ok_or_else(|| Report::new(RestoreLifecycleError::EvidenceConflict))?;
            if restore_matches_evidence(&work, view.restore_evidence.as_ref()) {
                return Ok(RestorePlanOutcome {
                    disposition: RestorePlanDisposition::Recovered,
                    work,
                });
            }
            return Err(Report::new(RestoreLifecycleError::EvidenceConflict)
                .attach_printable("foreground work does not match Restore evidence"));
        }
        if view.maintenance != MaintenanceStatus::RestoreRequired {
            return Err(Report::new(RestoreLifecycleError::NoRestoreRequired));
        }
        let evidence = view
            .restore_evidence
            .ok_or_else(|| Report::new(RestoreLifecycleError::EvidenceConflict))?;
        if view.applied_state != evidence.target
            || view.checkpoint_state != Some(evidence.contaminated.clone())
        {
            return Err(Report::new(RestoreLifecycleError::EvidenceConflict)
                .attach_printable("Restore evidence disagrees with projected A or G"));
        }
        let owner_actor_id = self
            .state
            .load(integration_id, &evidence.contaminated)
            .await
            .change_context(RestoreLifecycleError::ArtifactIntegrity)?
            .into_current()
            .change_context(RestoreLifecycleError::ArtifactIntegrity)?
            .owner_actor_id;
        let target_desired = self
            .load_desired(integration_id, evidence.target.as_ref())
            .await?;
        let contaminated_desired = self
            .load_desired(integration_id, Some(&evidence.contaminated))
            .await?;
        let target_digest = evidence
            .target
            .as_ref()
            .map_or("", |target| target.id.as_str());
        let effects = plan_restore_effects(target_digest, &target_desired, &contaminated_desired)
            .change_context(RestoreLifecycleError::EvidenceConflict)?;
        let effect_count = u64::try_from(effects.len())
            .change_context(RestoreLifecycleError::EvidenceConflict)
            .attach_printable("Restore effect count does not fit the durable manifest")?;
        let effect_index = self
            .effects
            .publish_effect_index(target_digest, effects)
            .await
            .change_context(RestoreLifecycleError::ArtifactPublication)?;
        let manifest = WorkManifest::V1(
            WorkManifestV1::new(
                integration_id,
                owner_actor_id,
                WorkKind::Restore(RestoreWorkV1 {
                    failed_run_id: evidence.failed_run_id,
                    failed_work_id: evidence.failed_work_id,
                    target: evidence.target,
                    contaminated: evidence.contaminated,
                }),
                effect_index,
                effect_count,
                EFFECT_IDENTITY_VERSION,
                EFFECT_ENCODING_VERSION,
                created_at,
            )
            .change_context(RestoreLifecycleError::EvidenceConflict)?,
        );
        let manifest_value = manifest
            .try_current_for(integration_id)
            .change_context(RestoreLifecycleError::EvidenceConflict)?
            .clone();
        let prefix = BlobNamespace::v1(&self.tenant, &routing::integration_path(integration_id))
            .key("work-manifests")
            .change_context(RestoreLifecycleError::ArtifactPublication)?;
        let artifact = self
            .artifacts
            .publish_record(
                &manifest,
                MAX_WORK_MANIFEST_BYTES,
                &prefix,
                WORK_MANIFEST_MEDIA_TYPE,
            )
            .await
            .change_context(RestoreLifecycleError::ArtifactPublication)?;
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
        .change_context(RestoreLifecycleError::EvidenceConflict)?;
        let revision = record.event_id.clone();
        let disposition = match self
            .commands
            .propose(record)
            .await
            .change_context(RestoreLifecycleError::JournalMutation)?
        {
            ShardCommandOutcome::Applied { .. } => RestorePlanDisposition::Planned,
            ShardCommandOutcome::AlreadyDurable { .. } => RestorePlanDisposition::Recovered,
        };
        Ok(RestorePlanOutcome {
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
    pub(crate) async fn execute_restore_turn(
        &self,
        work_id: &WorkId,
        budget: ChunkBudget,
    ) -> Result<RestoreTurnOutcome, Report<RestoreLifecycleError>> {
        self.execute_restore_turn_with_permit(work_id, budget, None)
            .await
    }

    pub(crate) async fn execute_permitted_restore_turn(
        &self,
        work_id: &WorkId,
        budget: ChunkBudget,
        permit: &dyn EffectTurnPermit,
    ) -> Result<RestoreTurnOutcome, Report<RestoreLifecycleError>> {
        self.execute_restore_turn_with_permit(work_id, budget, Some(permit))
            .await
    }

    async fn execute_restore_turn_with_permit(
        &self,
        work_id: &WorkId,
        budget: ChunkBudget,
        permit: Option<&dyn EffectTurnPermit>,
    ) -> Result<RestoreTurnOutcome, Report<RestoreLifecycleError>> {
        let Some(work) = self
            .commands
            .inspect_work(work_id.clone())
            .await
            .change_context(RestoreLifecycleError::JournalMutation)?
        else {
            return Ok(RestoreTurnOutcome::NoLongerRunnable {
                work_id: work_id.clone(),
            });
        };
        if !matches!(work.kind, WorkKind::Restore(_)) {
            return Err(Report::new(RestoreLifecycleError::EvidenceConflict)
                .attach_printable("Restore lifecycle received non-Restore work"));
        }
        if work.status != WorkStatus::Planned {
            return Ok(RestoreTurnOutcome::NoLongerRunnable {
                work_id: work_id.clone(),
            });
        }
        let prepared = match self.loader.load(&work, budget).await {
            Ok(prepared) => prepared,
            Err(error) if error.current_context() == &EffectExecutorError::ArtifactIntegrity => {
                tracing::error!(
                    work_id = %work.work_id,
                    error = ?error,
                    "immutable Restore artifact failed integrity validation"
                );
                return self
                    .block_restore(
                        &work,
                        "artifact_integrity",
                        "immutable Restore artifact failed integrity validation".to_owned(),
                        0,
                    )
                    .await;
            }
            Err(error) => {
                return Err(error.change_context(RestoreLifecycleError::EffectExecution));
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
            }) => Ok(RestoreTurnOutcome::Pending {
                completed_effect_count,
                requests_used,
                retry_after: None,
            }),
            Ok(TurnOutcomeV1::Yielded {
                completed_effect_count,
                requests_used,
                retry_after,
            }) => Ok(RestoreTurnOutcome::Pending {
                completed_effect_count,
                requests_used,
                retry_after,
            }),
            Ok(TurnOutcomeV1::Progressed {
                work_exhausted: true,
                requests_used,
                ..
            }) => self.complete_restore(&work, requests_used).await,
            Ok(TurnOutcomeV1::PermanentFailure {
                failed_effect_id,
                status,
                diagnostic,
                requests_used,
                ..
            }) => {
                self.block_restore(
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
                Err(error.change_context(RestoreLifecycleError::EffectExecution))
            }
        }
    }

    async fn load_desired(
        &self,
        integration_id: &CanonicalIntegrationId,
        reference: Option<&StateVersionRef>,
    ) -> Result<Vec<super::artifacts::ResolvedDesiredObjectV1>, Report<RestoreLifecycleError>> {
        let Some(reference) = reference else {
            return Ok(vec![]);
        };
        let state = self
            .state
            .load(integration_id, reference)
            .await
            .change_context(RestoreLifecycleError::ArtifactIntegrity)?;
        let desired = state
            .into_current()
            .change_context(RestoreLifecycleError::ArtifactIntegrity)?
            .desired_projection;
        self.effects
            .load_desired_projection(&desired)
            .await
            .change_context(RestoreLifecycleError::ArtifactIntegrity)
    }

    async fn complete_restore(
        &self,
        work: &WorkRecoveryIntent,
        requests_used: u32,
    ) -> Result<RestoreTurnOutcome, Report<RestoreLifecycleError>> {
        let record = JournalRecordV1::new(
            work.integration_id.clone(),
            JournalEvent::V1(JournalEventV1::WorkCompleted(WorkCompletedV1 {
                work_id: work.work_id.clone(),
                manifest_digest: work.manifest.manifest_digest.clone(),
            })),
        )
        .change_context(RestoreLifecycleError::EvidenceConflict)?;
        let completion_revision = record.event_id.clone();
        if let Err(error) = self.commands.propose(record).await {
            if error.kind == ShardCommandErrorKind::InvalidCandidate {
                if let Some(outcome) = self.adopt_stale_work(&work.work_id, requests_used).await? {
                    return Ok(outcome);
                }
            }
            return Err(error)
                .change_context(RestoreLifecycleError::JournalMutation)
                .attach(GraphRequestsUsed::new(requests_used));
        }
        self.artifacts.telemetry().clear_blocked_work(
            &crate::orchestrator::routing::integration_path(&work.integration_id).to_string(),
            &work.work_id.to_string(),
        );
        Ok(RestoreTurnOutcome::Completed {
            work_id: work.work_id.clone(),
            completion_revision,
            requests_used,
        })
    }

    async fn block_restore(
        &self,
        work: &WorkRecoveryIntent,
        code: &str,
        message: String,
        requests_used: u32,
    ) -> Result<RestoreTurnOutcome, Report<RestoreLifecycleError>> {
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
        .change_context(RestoreLifecycleError::EvidenceConflict)?;
        let blocked_revision = record.event_id.clone();
        if let Err(error) = self.commands.propose(record).await {
            if error.kind == ShardCommandErrorKind::InvalidCandidate {
                if let Some(outcome) = self.adopt_stale_work(&work.work_id, requests_used).await? {
                    return Ok(outcome);
                }
            }
            return Err(error)
                .change_context(RestoreLifecycleError::JournalMutation)
                .attach(GraphRequestsUsed::new(requests_used));
        }
        self.artifacts.telemetry().observe_blocked_work(
            &crate::orchestrator::routing::integration_path(&work.integration_id).to_string(),
            &work.work_id.to_string(),
            chrono::Utc::now(),
        );
        Ok(RestoreTurnOutcome::Blocked {
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
    ) -> Result<Option<RestoreTurnOutcome>, Report<RestoreLifecycleError>> {
        let current = self
            .commands
            .inspect_work(work_id.clone())
            .await
            .change_context(RestoreLifecycleError::JournalMutation)
            .map_err(|error| error.attach(GraphRequestsUsed::new(requests_used)))?;
        Ok(match current {
            Some(work) if work.status == WorkStatus::Planned => None,
            Some(work) if work.status == WorkStatus::Completed => {
                Some(RestoreTurnOutcome::Completed {
                    work_id: work.work_id,
                    completion_revision: work.revision,
                    requests_used,
                })
            }
            Some(work) if work.status == WorkStatus::Blocked => Some(RestoreTurnOutcome::Blocked {
                work_id: work.work_id,
                blocked_revision: work.revision,
                requests_used,
            }),
            _ => Some(RestoreTurnOutcome::NoLongerRunnable {
                work_id: work_id.clone(),
            }),
        })
    }
}

fn restore_matches_evidence(work: &WorkRecoveryIntent, evidence: Option<&RestoreEvidence>) -> bool {
    matches!(
        (&work.kind, evidence),
        (WorkKind::Restore(restore), Some(evidence))
            if restore.failed_run_id == evidence.failed_run_id
                && restore.failed_work_id == evidence.failed_work_id
                && restore.target == evidence.target
                && restore.contaminated == evidence.contaminated
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
    use crate::graph::apply::{ApplyCandidateV1, ApplyLifecycle};
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
    use crate::orchestrator::control::ControlRequestContextV1;
    use crate::orchestrator::events::{
        AttemptStartedV1, InputRef, PolicyRef, RetryRequestedV1, RunAcceptedV1, RunTerminatedV1,
        TerminalOutcome,
    };
    use crate::orchestrator::ids::{derive_attempt_id, AttemptId, RequestDigest, RequestId, RunId};
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
                .unwrap_or(EffectResponseV1::Transport(TransportFailureV1::Request))
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
        let tenant = TenantNamespace::parse("restore-tests").expect("tenant");
        let integration =
            CanonicalIntegrationId::parse("alice:restore-lifecycle").expect("integration");
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
        let run_id = RunId::parse("00000088-0000-4000-8000-000000000001").expect("run ID");
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
        transport: Arc<ScriptedTransport>,
    ) -> Arc<BoundedEffectExecutor> {
        Arc::new(BoundedEffectExecutor::new(
            transport,
            Arc::new(ShardWorkCursorCommitter::new(handle.clone())),
            Arc::new(NoDelay),
            Arc::new(EffectLaneRegistry::default()),
        ))
    }

    fn apply_lifecycle(rig: &Rig) -> ApplyLifecycle {
        ApplyLifecycle::new(
            rig.tenant.clone(),
            rig.store.clone(),
            Arc::clone(&rig.effects),
            Arc::clone(&rig.state),
            rig.handle.clone(),
            executor(&rig.handle, Arc::new(ScriptedTransport::default())),
        )
    }

    fn restore_lifecycle(rig: &Rig, transport: Arc<ScriptedTransport>) -> RestoreLifecycle {
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

    async fn seed_restore_required(rig: &Rig, identities: &[&str]) -> WorkId {
        seed_running(rig).await;
        let planned = apply_lifecycle(rig)
            .plan_apply(candidate(rig, identities))
            .await
            .expect("plan contaminated Apply");
        rig.handle
            .propose(
                JournalRecordV1::new(
                    rig.integration.clone(),
                    JournalEvent::V1(JournalEventV1::RunTerminated(RunTerminatedV1 {
                        run_id: rig.run_id.clone(),
                        outcome: TerminalOutcome::Failed,
                        failed_work: Some(planned.work.work_id.clone()),
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
        planned.work.work_id
    }

    fn candidate(rig: &Rig, identities: &[&str]) -> ApplyCandidateV1 {
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
            owner_actor_id: "actor:owner".to_owned(),
            run_id: rig.run_id.clone(),
            attempt_id: rig.attempt_id.clone(),
            attempt: 1,
            phase: StatePhase::V1(StatePhaseV1::LinksCommitted),
            snapshot: StateSnapshot::V1(StateSnapshotV1 {
                generation: 1,
                duckdb: blob(
                    &namespace
                        .key("snapshots/contaminated.duckdb")
                        .expect("snapshot key"),
                    'd',
                    "application/vnd.duckdb",
                ),
                accepted_batches: vec![],
                created_at: "2026-07-22T18:00:00Z".to_owned(),
            }),
            definition_digest: "e".repeat(64),
            definition_digest_encoding_version: 1,
            planner_version: 1,
            state_schema_version: 1,
            desired_projection_schema_version: 1,
            graph,
            selection: EffectSelectionV1::ChangesOnly,
            coverage: ProjectionCoverageV1::Complete,
            created_at: "2026-07-22T18:00:01Z".to_owned(),
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
    async fn restore_to_initial_empty_archives_g_and_clears_maintenance() {
        let remote = tempfile::tempdir().expect("remote");
        let cache = tempfile::tempdir().expect("cache");
        let rig = open_rig(remote.path(), cache.path()).await;
        seed_restore_required(&rig, &["entity:contaminated"]).await;
        let transport = Arc::new(ScriptedTransport::with(vec![EffectResponseV1::Success]));
        let lifecycle = restore_lifecycle(&rig, Arc::clone(&transport));
        let planned = lifecycle
            .plan_restore(&rig.integration, "2026-07-22T18:01:00Z".to_owned())
            .await
            .expect("plan Restore");
        assert_eq!(planned.work.effect_count, 1);
        assert!(matches!(
            planned.work.kind,
            WorkKind::Restore(RestoreWorkV1 { target: None, .. })
        ));
        assert!(matches!(
            lifecycle
                .execute_restore_turn(&planned.work.work_id, ChunkBudget::new(2).expect("budget"))
                .await
                .expect("execute Restore"),
            RestoreTurnOutcome::Completed { .. }
        ));
        assert!(matches!(
            transport.requests().await.as_slice(),
            [EffectRequestV1::Archive(_)]
        ));
        let view = rig
            .handle
            .inspect_delivery(rig.integration.clone())
            .await
            .expect("delivery view")
            .expect("integration");
        assert_eq!(view.maintenance, MaintenanceStatus::Healthy);
        assert!(view.checkpoint_state.is_none());
        assert!(view.applied_state.is_none());
        assert!(view.foreground_work.is_none());
        assert!(view.restore_evidence.is_none());
        close(rig).await;
    }

    #[tokio::test]
    async fn durable_restore_is_adopted_before_regenerating_effect_artifacts() {
        let remote = tempfile::tempdir().expect("remote");
        let cache = tempfile::tempdir().expect("cache");
        let rig = open_rig(remote.path(), cache.path()).await;
        seed_restore_required(&rig, &["entity:contaminated"]).await;
        let lifecycle = restore_lifecycle(&rig, Arc::new(ScriptedTransport::default()));
        let first = lifecycle
            .plan_restore(&rig.integration, "2026-07-22T18:01:00Z".to_owned())
            .await
            .expect("first Restore plan");
        let recovered = lifecycle
            .plan_restore(&rig.integration, "2026-07-22T19:55:00Z".to_owned())
            .await
            .expect("recover Restore plan");
        assert_eq!(recovered.disposition, RestorePlanDisposition::Recovered);
        assert_eq!(recovered.work.work_id, first.work.work_id);
        assert_eq!(recovered.work.manifest, first.work.manifest);
        close(rig).await;
    }

    #[tokio::test]
    async fn blocked_restore_retries_the_same_manifest_after_its_durable_cursor() {
        let remote = tempfile::tempdir().expect("remote");
        let cache = tempfile::tempdir().expect("cache");
        let rig = open_rig(remote.path(), cache.path()).await;
        seed_restore_required(&rig, &["entity:a", "entity:b"]).await;
        let first_transport = Arc::new(ScriptedTransport::with(vec![
            EffectResponseV1::Success,
            EffectResponseV1::Http {
                status: 422,
                retry_after: None,
                diagnostic: "invalid".to_owned(),
            },
        ]));
        let first = restore_lifecycle(&rig, Arc::clone(&first_transport));
        let planned = first
            .plan_restore(&rig.integration, "2026-07-22T18:01:00Z".to_owned())
            .await
            .expect("plan Restore");
        let RestoreTurnOutcome::Blocked {
            blocked_revision, ..
        } = first
            .execute_restore_turn(&planned.work.work_id, ChunkBudget::new(2).expect("budget"))
            .await
            .expect("block Restore")
        else {
            panic!("Restore must block")
        };
        let blocked = rig
            .handle
            .inspect_work(planned.work.work_id.clone())
            .await
            .expect("work query")
            .expect("work");
        assert_eq!(blocked.status, WorkStatus::Blocked);
        assert_eq!(blocked.completed_effect_count, 1);
        assert_eq!(blocked.revision, blocked_revision);
        let integration_path =
            crate::orchestrator::routing::integration_path(&rig.integration).to_string();
        let observation = rig.store.telemetry().snapshot(chrono::Utc::now());
        assert!(observation
            .integrations
            .iter()
            .find(|lane| lane.integration_path == integration_path)
            .expect("blocked Restore lane")
            .blocked_age_ms
            .is_some());

        rig.handle
            .propose(
                JournalRecordV1::new(
                    rig.integration.clone(),
                    JournalEvent::V1(JournalEventV1::RetryRequested(RetryRequestedV1 {
                        work_id: planned.work.work_id.clone(),
                        settings_revision: 7,
                        request: ControlRequestContextV1 {
                            request_id: RequestId::parse("a".repeat(64)).expect("request ID"),
                            request_digest: RequestDigest::parse("b".repeat(64))
                                .expect("request digest"),
                            expected_revision: Some(blocked_revision),
                        },
                    })),
                )
                .expect("RetryRequested"),
            )
            .await
            .expect("retry Restore");
        let retry_transport = Arc::new(ScriptedTransport::with(vec![EffectResponseV1::Success]));
        let retry = restore_lifecycle(&rig, Arc::clone(&retry_transport));
        assert!(matches!(
            retry
                .execute_restore_turn(&planned.work.work_id, ChunkBudget::new(2).expect("budget"))
                .await
                .expect("resume Restore"),
            RestoreTurnOutcome::Completed { .. }
        ));
        assert_eq!(retry_transport.requests().await.len(), 1);
        let completed = rig
            .handle
            .inspect_work(planned.work.work_id)
            .await
            .expect("work query")
            .expect("work");
        assert_eq!(completed.status, WorkStatus::Completed);
        assert_eq!(completed.completed_effect_count, 2);
        let observation = rig.store.telemetry().snapshot(chrono::Utc::now());
        assert_eq!(
            observation
                .integrations
                .iter()
                .find(|lane| lane.integration_path == integration_path)
                .expect("completed Restore lane")
                .blocked_age_ms,
            None
        );
        close(rig).await;
    }
}
