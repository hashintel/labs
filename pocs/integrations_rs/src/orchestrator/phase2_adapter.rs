//! Disposable OpenData-backed composition for the Phase-2 integration gate.
//!
//! This is intentionally test-only: it independently implements the V1 port
//! contract for differential conformance.

use std::collections::BTreeMap;
use std::num::NonZeroUsize;
use std::sync::Arc;

use async_trait::async_trait;
use sha2::{Digest as _, Sha256};
use tokio::sync::{Mutex, Notify};
use tokio_util::sync::CancellationToken;

use super::control::{
    CancelRunV1, ControlCommandV1, ControlRequestV1, IntegrationDesiredState, RetryWorkV1,
    SetIntegrationDesiredStateV1,
};
use super::events::{
    AttemptFailedV1, AttemptStartedV1, FailureSummary, InputRef, JournalEvent, JournalEventV1,
    JournalRecordV1, PolicyRef, RunCompletedV1, RunTerminatedV1, StepCommittedV1, TerminalOutcome,
};
use super::ids::{derive_attempt_id, CanonicalIntegrationId, RequestId, RunId, TenantNamespace};
use super::inbox::{publish_control_request, ControlInbox, DiscoveredControlRequest};
use super::internal_metadata::{
    RequestBindingRecord, RunInputRecord, RunLocatorRecord, RunPolicyRecord, StableKeyRecord,
    MAX_REQUEST_BINDING_RECORD_BYTES, MAX_RUN_LOCATOR_RECORD_BYTES,
};
use super::port::{
    CheckpointCommand, CheckpointName, CheckpointValue, ControlCommand, ControlCommandKind,
    ControlCommands, ExecutionContext, ExecutionError, IntegrationDefinition, OrchestratorError,
    RequestHandle, RequestOutcome, RunInput, RunOutput, RunQuery, RunState, RunStatus,
    RunSubmission, RunVariables, SharedExecutionContext, SharedRunHandler, SubmitOutcome,
    SubmitRun, WorkerHost,
};
use super::projection::{ControlRequestOutcomeKindV1, RunStatus as ProjectedRunStatus};
use super::registry::{require_registered, DurableRecord};
use super::routing::{self, Keyspace, Shard};
use super::shard_log::{
    start_recovered, RunView, ShardCommandConfig, ShardCommandHandle, ShardLogLocation,
};
use super::state::{start_state_hint_repairer, JournalStateAuthority, StateAuthority};
use super::submission::{
    admitted_run_record, delete_ready_receipt, discover_ready_receipts, submit_durable_for_run,
};
use crate::blob::{ArtifactStore, BlobRef, BoundedCasDocument, CasWrite};

#[derive(Clone)]
pub(super) struct Phase2OpenDataOrchestrator {
    inner: Arc<Inner>,
}

struct Inner {
    _owned_roots: Option<(tempfile::TempDir, tempfile::TempDir)>,
    remote_root: std::path::PathBuf,
    store: ArtifactStore,
    tenant: TenantNamespace,
    shards: Mutex<BTreeMap<Shard, Arc<ShardRuntime>>>,
    changed: Notify,
}

struct ShardRuntime {
    handle: ShardCommandHandle,
    inbox: Mutex<ControlInbox>,
    _state_hint_task: tokio::task::JoinHandle<()>,
    _task: tokio::task::JoinHandle<Result<(), super::shard_log::ShardCommandError>>,
}

impl Phase2OpenDataOrchestrator {
    pub(super) fn new() -> Result<Self, OrchestratorError> {
        let remote = tempfile::tempdir().map_err(internal)?;
        let cache = tempfile::tempdir().map_err(internal)?;
        let remote_root = remote.path().to_owned();
        let store = ArtifactStore::local(&remote_root, cache.path()).map_err(internal_report)?;
        Ok(Self {
            inner: Arc::new(Inner {
                _owned_roots: Some((remote, cache)),
                remote_root,
                store,
                tenant: TenantNamespace::parse("phase2-conformance").map_err(internal)?,
                shards: Mutex::new(BTreeMap::new()),
                changed: Notify::new(),
            }),
        })
    }

    fn from_roots(
        remote_root: &std::path::Path,
        cache_root: &std::path::Path,
    ) -> Result<Self, OrchestratorError> {
        let store = ArtifactStore::local(remote_root, cache_root).map_err(internal_report)?;
        Ok(Self {
            inner: Arc::new(Inner {
                _owned_roots: None,
                remote_root: remote_root.to_owned(),
                store,
                tenant: TenantNamespace::parse("phase2-conformance").map_err(internal)?,
                shards: Mutex::new(BTreeMap::new()),
                changed: Notify::new(),
            }),
        })
    }

    async fn shutdown_shards(&self) -> Result<(), OrchestratorError> {
        let runtimes = self
            .inner
            .shards
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for runtime in runtimes {
            runtime.handle.shutdown().await.map_err(internal)?;
        }
        self.inner.shards.lock().await.clear();
        Ok(())
    }

    async fn runtime(&self, shard: Shard) -> Result<Arc<ShardRuntime>, OrchestratorError> {
        let mut shards = self.inner.shards.lock().await;
        if let Some(runtime) = shards.get(&shard) {
            return Ok(runtime.clone());
        }
        let location =
            ShardLogLocation::disposable_local(shard, &self.inner.tenant, &self.inner.remote_root);
        let started = start_recovered(location, ShardCommandConfig::default())
            .await
            .map_err(internal)?;
        // Full replay has already reconstructed `started.recovery.live_work`.
        // The reference adapter does not execute Graph work, but keeps the shard alive so
        // retry/cancel controls can resolve it; the bounded scheduler query
        // prevents fresh run delivery while any such work remains live.
        let state_authority: Arc<dyn StateAuthority> = Arc::new(JournalStateAuthority::new(
            self.inner.store.clone(),
            self.inner.tenant.clone(),
            started.handle.clone(),
        ));
        let state_hint_task = start_state_hint_repairer(
            self.inner.store.clone(),
            self.inner.tenant.clone(),
            state_authority,
            started.state_changes,
        );
        let runtime = Arc::new(ShardRuntime {
            inbox: Mutex::new(ControlInbox::new(
                self.inner.store.clone(),
                self.inner.tenant.clone(),
                shard,
                started.handle.clone(),
                Arc::new(|_request: &ControlRequestV1| true),
                NonZeroUsize::new(16).unwrap_or(NonZeroUsize::MIN),
            )),
            handle: started.handle,
            _state_hint_task: state_hint_task,
            _task: started.task,
        });
        shards.insert(shard, runtime.clone());
        Ok(runtime)
    }

    async fn ensure_known_shards(&self) -> Result<(), OrchestratorError> {
        let paths = Keyspace::for_tenant(&self.inner.tenant);
        let prefix = format!("{}/", paths.known_shards());
        for object in self
            .inner
            .store
            .list(&paths.known_shards())
            .await
            .map_err(internal_report)?
        {
            let Some(component) = object
                .key
                .strip_prefix(&prefix)
                .and_then(|value| value.strip_suffix(".json"))
            else {
                continue;
            };
            if component.len() == 3 {
                if let Ok(value) = u16::from_str_radix(component, 16) {
                    if let Ok(shard) = Shard::try_from(value) {
                        self.runtime(shard).await?;
                    }
                }
            }
        }
        Ok(())
    }

    async fn process_control_before_receipts(&self) -> Result<bool, OrchestratorError> {
        self.ensure_known_shards().await?;
        let runtimes = self
            .inner
            .shards
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut processed = false;
        for runtime in runtimes {
            processed |= !runtime
                .inbox
                .lock()
                .await
                .process_batch()
                .await
                .map_err(internal_report)?
                .is_empty();
        }
        Ok(processed)
    }

    async fn promote_receipts(&self) -> Result<(), OrchestratorError> {
        let receipts = discover_ready_receipts(&self.inner.store, &self.inner.tenant)
            .await
            .map_err(internal_report)?;
        for receipt in receipts {
            let runtime = self.runtime(receipt.shard).await?;
            if let Some(record) =
                admitted_run_record(&self.inner.store, &self.inner.tenant, &receipt)
                    .await
                    .map_err(internal_report)?
            {
                runtime.handle.propose(record).await.map_err(internal)?;
                delete_ready_receipt(
                    &self.inner.store,
                    &self.inner.tenant,
                    receipt.shard,
                    &receipt.receipt.run_id,
                )
                .await
                .map_err(internal_report)?;
            }
        }
        Ok(())
    }

    async fn locate(
        &self,
        run_id: &RunId,
    ) -> Result<Option<CanonicalIntegrationId>, OrchestratorError> {
        let key = run_locator_key(&self.inner.tenant, run_id);
        read_internal_record::<RunLocatorRecord>(
            &self.inner.store,
            &key,
            MAX_RUN_LOCATOR_RECORD_BYTES,
        )
        .await
        .map(|value| value.map(RunLocatorRecord::into_current))
    }

    async fn view(&self, run_id: &RunId) -> Result<Option<RunView>, OrchestratorError> {
        let Some(integration) = self.locate(run_id).await? else {
            return Ok(None);
        };
        Box::pin(self.promote_receipts()).await?;
        self.runtime(routing::shard(&integration))
            .await?
            .handle
            .inspect_run(run_id.clone())
            .await
            .map_err(internal)
    }

    async fn publish(
        &self,
        bytes: &[u8],
        suffix: &str,
        media_type: &str,
    ) -> Result<BlobRef, OrchestratorError> {
        self.inner
            .store
            .publish_bytes(
                bytes,
                suffix,
                &format!("tenants/{}/phase2-artifacts", self.inner.tenant),
                media_type,
            )
            .await
            .map_err(internal_report)
    }

    async fn read_blob(&self, reference: &BlobRef) -> Result<Vec<u8>, OrchestratorError> {
        let path = self
            .inner
            .store
            .materialize(reference)
            .await
            .map_err(internal_report)?;
        tokio::fs::read(path).await.map_err(internal)
    }
}

#[async_trait]
impl RunSubmission for Phase2OpenDataOrchestrator {
    async fn submit_run(&self, request: SubmitRun) -> Result<SubmitOutcome, OrchestratorError> {
        let input_wire = RunInputRecord::current(
            request.input.definition.as_str().to_owned(),
            request.input.public_variables.as_map().clone(),
            "phase2-test-owner".to_owned(),
            hex::encode(Sha256::digest(request.input.definition.as_str().as_bytes())),
        );
        require_registered::<RunInputRecord>().map_err(internal)?;
        let input_bytes = input_wire.encode().map_err(internal)?;
        let input_artifact = self
            .publish(&input_bytes, ".json", "application/json")
            .await?;
        let policy_wire = RunPolicyRecord::current(request.policy.max_handler_failures.get());
        require_registered::<RunPolicyRecord>().map_err(internal)?;
        let policy_bytes = policy_wire.encode().map_err(internal)?;
        let policy_artifact = self
            .publish(&policy_bytes, ".json", "application/json")
            .await?;
        let input = InputRef {
            artifact: input_artifact,
            definition_digest: hex::encode(Sha256::digest(
                request.input.definition.as_str().as_bytes(),
            )),
            definition_digest_encoding_version: 1,
            planner_version: 1,
        };
        let policy = PolicyRef {
            policy_digest: hex::encode(Sha256::digest(&policy_bytes)),
            artifact: policy_artifact,
        };
        let outcome = submit_durable_for_run(
            &self.inner.store,
            &self.inner.tenant,
            request.integration_id.clone(),
            request.run_id.clone(),
            input,
            policy,
            "2026-07-22T00:00:00Z".to_owned(),
        )
        .await
        .map_err(internal_report)?;
        create_identical(
            &self.inner.store,
            &run_locator_key(&self.inner.tenant, &outcome.run_id),
            &RunLocatorRecord::current(request.integration_id),
            MAX_RUN_LOCATOR_RECORD_BYTES,
        )
        .await?;
        self.inner.changed.notify_waiters();
        Ok(SubmitOutcome {
            run_id: outcome.run_id,
            initial_revision: outcome.initial_revision,
            created: outcome.created,
        })
    }
}

#[async_trait]
impl RunQuery for Phase2OpenDataOrchestrator {
    async fn run_status(&self, run_id: &RunId) -> Result<Option<RunStatus>, OrchestratorError> {
        let Some(view) = Box::pin(self.view(run_id)).await? else {
            return Ok(None);
        };
        let output = match &view.result {
            Some(reference) => {
                let bytes = self.read_blob(reference).await?;
                Some(RunOutput::new(
                    reference.current().media_type.clone(),
                    bytes,
                )?)
            }
            None => None,
        };
        Ok(Some(RunStatus {
            run_id: view.run_id,
            integration_id: view.integration_id,
            state: map_run_state(view.status),
            attempt: view.attempt,
            attempt_id: view.attempt_id,
            active_work_id: view.active_work_id,
            revision: view.revision,
            output,
            failure: view.failure,
        }))
    }
}

#[async_trait]
impl ControlCommands for Phase2OpenDataOrchestrator {
    async fn request(&self, command: ControlCommand) -> Result<RequestHandle, OrchestratorError> {
        let protocol_command = match &command.kind {
            ControlCommandKind::CancelRun {
                run_id,
                expected_revision,
            } => ControlCommandV1::CancelRun(CancelRunV1 {
                run_id: run_id.clone(),
                expected_run_revision: expected_revision.clone(),
                expected_failed_work: None,
            }),
            ControlCommandKind::RetryWork {
                work_id,
                expected_revision,
                settings_revision,
            } => ControlCommandV1::RetryWork(RetryWorkV1 {
                work_id: work_id.clone(),
                expected_work_revision: expected_revision.clone(),
                settings_revision: settings_revision.get(),
            }),
            ControlCommandKind::SetDesiredState {
                desired,
                definition,
                expected_revision,
            } => {
                let bytes = serde_json::to_vec(definition.as_str()).map_err(internal)?;
                let definition_ref = self.publish(&bytes, ".json", "application/json").await?;
                ControlCommandV1::SetIntegrationDesiredState(SetIntegrationDesiredStateV1 {
                    desired: *desired,
                    definition_ref,
                    expected_desired_revision: expected_revision.clone(),
                })
            }
        };
        let request = ControlRequestV1::new(
            self.inner.tenant.clone(),
            command.integration_id.clone(),
            format!("port-request:{}", command.request_id),
            protocol_command,
        )
        .map_err(internal)?;
        let fingerprint = port_command_fingerprint(&command)?;
        create_identical(
            &self.inner.store,
            &port_binding_key(&self.inner.tenant, &command.request_id),
            &RequestBindingRecord::current(fingerprint, request.request_id.clone()),
            MAX_REQUEST_BINDING_RECORD_BYTES,
        )
        .await?;
        let key = publish_control_request(&self.inner.store, &request)
            .await
            .map_err(internal_report)?;
        let shard = routing::shard(&command.integration_id);
        let runtime = self.runtime(shard).await?;
        let inbox = ControlInbox::new(
            self.inner.store.clone(),
            self.inner.tenant.clone(),
            shard,
            runtime.handle.clone(),
            Arc::new(|_request: &ControlRequestV1| true),
            NonZeroUsize::MIN,
        );
        let processed = inbox
            .process_one(DiscoveredControlRequest { key, request })
            .await
            .map_err(internal_report)?;
        let outcome = match processed.outcome.outcome {
            ControlRequestOutcomeKindV1::Accepted { promoted_event_id } => {
                RequestOutcome::Accepted {
                    revision: promoted_event_id,
                }
            }
            ControlRequestOutcomeKindV1::Rejected {
                reason_code,
                observed_revision,
                ..
            } => RequestOutcome::Rejected {
                reason: reason_code,
                observed_revision,
            },
        };
        self.inner.changed.notify_waiters();
        Ok(RequestHandle {
            request_id: command.request_id,
            outcome,
        })
    }
}

#[async_trait]
impl WorkerHost for Phase2OpenDataOrchestrator {
    async fn run(
        &self,
        handler: SharedRunHandler,
        shutdown: CancellationToken,
    ) -> Result<(), OrchestratorError> {
        loop {
            // Startup replay is completed by runtime construction. Live work
            // blocks `next_runnable_run`; control recovery then precedes fresh
            // receipt promotion, matching the normative recovery priority.
            if Box::pin(self.process_control_before_receipts()).await? {
                continue;
            }
            Box::pin(self.promote_receipts()).await?;
            let runtimes = self
                .inner
                .shards
                .lock()
                .await
                .values()
                .cloned()
                .collect::<Vec<_>>();
            let mut selected = None;
            for runtime in runtimes {
                if let Some(run) = runtime.handle.next_runnable_run().await.map_err(internal)? {
                    selected = Some((runtime, run));
                    break;
                }
            }
            let Some((runtime, run)) = selected else {
                tokio::select! {
                    () = shutdown.cancelled() => return Ok(()),
                    () = self.inner.changed.notified() => continue,
                    () = tokio::time::sleep(std::time::Duration::from_millis(10)) => continue,
                }
            };
            let attempt = run
                .attempt
                .checked_add(1)
                .ok_or_else(|| OrchestratorError::internal("attempt overflow"))?;
            let attempt_id = derive_attempt_id(&run.run_id, attempt);
            runtime
                .handle
                .propose(
                    JournalRecordV1::new(
                        run.integration_id.clone(),
                        JournalEvent::V1(JournalEventV1::AttemptStarted(AttemptStartedV1 {
                            run_id: run.run_id.clone(),
                            attempt_id: attempt_id.clone(),
                            attempt,
                        })),
                    )
                    .map_err(internal)?,
                )
                .await
                .map_err(internal)?;
            let input =
                RunInputRecord::decode(&self.read_blob(&run.immutable_input.artifact).await?)
                    .map_err(internal)?
                    .into_current();
            let policy = RunPolicyRecord::decode(&self.read_blob(&run.policy.artifact).await?)
                .map_err(internal)?;
            let context: SharedExecutionContext = Arc::new(Phase2ExecutionContext {
                backend: self.clone(),
                handle: runtime.handle.clone(),
                run_id: run.run_id.clone(),
                attempt_id: attempt_id.clone(),
                attempt,
            });
            let execution = handler.execute(
                RunInput {
                    definition: IntegrationDefinition::parse(input.definition)?,
                    public_variables: RunVariables::new(input.public_variables)?,
                },
                context,
            );
            tokio::pin!(execution);
            let result = tokio::select! {
                () = shutdown.cancelled() => return Ok(()),
                result = &mut execution => result,
            };
            finish_execution(
                self,
                &runtime.handle,
                &run,
                attempt_id,
                attempt,
                policy,
                result,
            )
            .await?;
            self.inner.changed.notify_waiters();
        }
    }
}

struct Phase2ExecutionContext {
    backend: Phase2OpenDataOrchestrator,
    handle: ShardCommandHandle,
    run_id: RunId,
    attempt_id: super::ids::AttemptId,
    attempt: u64,
}

#[async_trait]
impl ExecutionContext for Phase2ExecutionContext {
    fn run_id(&self) -> RunId {
        self.run_id.clone()
    }
    fn attempt_id(&self) -> super::ids::AttemptId {
        self.attempt_id.clone()
    }
    fn attempt(&self) -> u64 {
        self.attempt
    }
    fn active_work_id(&self) -> Option<super::ids::WorkId> {
        None
    }

    async fn load_checkpoint(
        &self,
        name: &CheckpointName,
    ) -> Result<Option<CheckpointValue>, ExecutionError> {
        self.ensure_current().await?;
        let reference = self
            .handle
            .checkpoint(self.run_id.clone(), name.as_str().to_owned())
            .await
            .map_err(exec_internal)?;
        match reference {
            Some(reference) => {
                let bytes = self
                    .backend
                    .read_blob(&reference)
                    .await
                    .map_err(exec_internal)?;
                CheckpointValue::new(reference.current().media_type.clone(), bytes)
                    .map(Some)
                    .map_err(exec_internal)
            }
            None => Ok(None),
        }
    }

    async fn commit_checkpoint(&self, command: CheckpointCommand) -> Result<(), ExecutionError> {
        self.ensure_current().await?;
        if let Some(existing) = self
            .handle
            .checkpoint(self.run_id.clone(), command.name.as_str().to_owned())
            .await
            .map_err(exec_internal)?
        {
            let bytes = self
                .backend
                .read_blob(&existing)
                .await
                .map_err(exec_internal)?;
            if existing.current().media_type == command.value.media_type()
                && bytes == command.value.bytes()
            {
                return Ok(());
            }
            return Err(ExecutionError::permanent(format!(
                "checkpoint {} already names different content",
                command.name
            )));
        }
        let reference = self
            .backend
            .publish(command.value.bytes(), ".bin", command.value.media_type())
            .await
            .map_err(exec_internal)?;
        let record = JournalRecordV1::new(
            self.handle
                .inspect_run(self.run_id.clone())
                .await
                .map_err(exec_internal)?
                .ok_or(ExecutionError::StaleAttempt)?
                .integration_id,
            JournalEvent::V1(JournalEventV1::StepCommitted(StepCommittedV1 {
                run_id: self.run_id.clone(),
                name: command.name.as_str().to_owned(),
                checkpoint: reference,
            })),
        )
        .map_err(exec_internal)?;
        self.handle.propose(record).await.map_err(exec_internal)?;
        Ok(())
    }

    async fn ensure_current(&self) -> Result<(), ExecutionError> {
        self.handle
            .attempt_is_current(self.run_id.clone(), self.attempt_id.clone())
            .await
            .map_err(exec_internal)
            .and_then(|current| current.then_some(()).ok_or(ExecutionError::StaleAttempt))
    }
}

async fn finish_execution(
    backend: &Phase2OpenDataOrchestrator,
    handle: &ShardCommandHandle,
    run: &RunView,
    attempt_id: super::ids::AttemptId,
    attempt: u64,
    policy: RunPolicyRecord,
    result: Result<RunOutput, ExecutionError>,
) -> Result<(), OrchestratorError> {
    let event = match result {
        Ok(output) => {
            let reference = backend
                .publish(output.bytes(), ".bin", output.media_type())
                .await?;
            JournalEventV1::RunCompleted(RunCompletedV1 {
                run_id: run.run_id.clone(),
                result: reference,
            })
        }
        Err(ExecutionError::Retryable(message))
            if run.handler_failures.saturating_add(1) < policy.max_handler_failures() =>
        {
            JournalEventV1::AttemptFailed(AttemptFailedV1 {
                run_id: run.run_id.clone(),
                attempt_id,
                attempt,
                failure: FailureSummary {
                    code: "retryable".to_owned(),
                    message,
                    retryable: true,
                },
            })
        }
        Err(ExecutionError::Retryable(message) | ExecutionError::Permanent(message)) => {
            JournalEventV1::RunTerminated(RunTerminatedV1 {
                run_id: run.run_id.clone(),
                outcome: TerminalOutcome::Failed,
                failed_work: None,
                failure: Some(FailureSummary {
                    code: "execution_failed".to_owned(),
                    message,
                    retryable: false,
                }),
                request: None,
            })
        }
        Err(ExecutionError::Cancelled | ExecutionError::StaleAttempt) => return Ok(()),
    };
    handle
        .propose(
            JournalRecordV1::new(run.integration_id.clone(), JournalEvent::V1(event))
                .map_err(internal)?,
        )
        .await
        .map_err(internal)?;
    Ok(())
}

fn map_run_state(status: ProjectedRunStatus) -> RunState {
    match status {
        ProjectedRunStatus::Accepted => RunState::Accepted,
        ProjectedRunStatus::Running => RunState::Running,
        ProjectedRunStatus::Completed => RunState::Completed,
        ProjectedRunStatus::Terminated => RunState::Terminated,
    }
}

fn run_locator_key(tenant: &TenantNamespace, run_id: &RunId) -> String {
    format!(
        "{}/port-run-locators/{run_id}.json",
        Keyspace::for_tenant(tenant).control_root()
    )
}

fn port_binding_key(tenant: &TenantNamespace, request_id: &RequestId) -> String {
    format!(
        "{}/port-request-bindings/{request_id}.json",
        Keyspace::for_tenant(tenant).control_root()
    )
}

async fn create_identical<T>(
    store: &ArtifactStore,
    key: &str,
    expected: &T,
    maximum: usize,
) -> Result<(), OrchestratorError>
where
    T: StableKeyRecord,
{
    require_registered::<T>().map_err(internal)?;
    let bytes = expected.encode().map_err(internal)?;
    match store
        .create_cas_document(key, bytes)
        .await
        .map_err(internal_report)?
    {
        CasWrite::Written(_) => Ok(()),
        CasWrite::Conflict => {
            let actual = read_internal_record::<T>(store, key, maximum)
                .await?
                .ok_or_else(|| {
                    OrchestratorError::internal("immutable binding disappeared after conflict")
                })?;
            if actual.same_current_value(expected) {
                Ok(())
            } else {
                Err(OrchestratorError::conflict(
                    "immutable port identity was reused with different content",
                ))
            }
        }
    }
}

async fn read_internal_record<T: DurableRecord>(
    store: &ArtifactStore,
    key: &str,
    maximum: usize,
) -> Result<Option<T>, OrchestratorError> {
    require_registered::<T>().map_err(internal)?;
    match store
        .get_cas_document_bounded(key, maximum)
        .await
        .map_err(internal_report)?
    {
        BoundedCasDocument::Missing => Ok(None),
        BoundedCasDocument::Present(bytes, _version) => {
            T::decode(&bytes).map(Some).map_err(internal)
        }
        BoundedCasDocument::TooLarge {
            actual_bytes,
            max_bytes,
        } => Err(OrchestratorError::internal(format!(
            "internal record {key:?} is {actual_bytes} bytes; maximum is {max_bytes}"
        ))),
    }
}

fn port_command_fingerprint(command: &ControlCommand) -> Result<String, OrchestratorError> {
    let value = match &command.kind {
        ControlCommandKind::CancelRun {
            run_id,
            expected_revision,
        } => {
            serde_json::json!({"integration": command.integration_id, "kind": "cancel", "run": run_id, "expected": expected_revision})
        }
        ControlCommandKind::RetryWork {
            work_id,
            expected_revision,
            settings_revision,
        } => {
            serde_json::json!({"integration": command.integration_id, "kind": "retry", "work": work_id, "expected": expected_revision, "settings": settings_revision.get()})
        }
        ControlCommandKind::SetDesiredState {
            desired,
            definition,
            expected_revision,
        } => {
            serde_json::json!({"integration": command.integration_id, "kind": "desired", "desired": desired, "definition": definition.as_str(), "expected": expected_revision})
        }
    };
    serde_json::to_vec(&value)
        .map(|bytes| hex::encode(Sha256::digest(bytes)))
        .map_err(internal)
}

fn internal(error: impl std::fmt::Display) -> OrchestratorError {
    OrchestratorError::internal(error.to_string())
}
fn internal_report<C: std::fmt::Debug>(error: error_stack::Report<C>) -> OrchestratorError {
    OrchestratorError::internal(format!("{error:?}"))
}
fn exec_internal(error: impl std::fmt::Display) -> ExecutionError {
    ExecutionError::permanent(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::num::NonZeroU32;

    struct RecoveredHandler;
    struct CheckpointCrashHandler;
    struct MustNotRunHandler;

    #[async_trait]
    impl super::super::port::RunHandler for RecoveredHandler {
        async fn execute(
            &self,
            _input: RunInput,
            context: SharedExecutionContext,
        ) -> Result<RunOutput, ExecutionError> {
            context.ensure_current().await?;
            let checkpoint = context
                .load_checkpoint(&CheckpointName::parse("process-boundary").map_err(exec_internal)?)
                .await?
                .ok_or_else(|| ExecutionError::permanent("durable checkpoint is missing"))?;
            if checkpoint.bytes() != b"committed-before-crash" {
                return Err(ExecutionError::permanent("durable checkpoint changed"));
            }
            RunOutput::new("text/plain", b"recovered-from-remote-prefix".to_vec())
                .map_err(exec_internal)
        }
    }

    #[async_trait]
    impl super::super::port::RunHandler for CheckpointCrashHandler {
        async fn execute(
            &self,
            _input: RunInput,
            context: SharedExecutionContext,
        ) -> Result<RunOutput, ExecutionError> {
            context
                .commit_checkpoint(CheckpointCommand {
                    name: CheckpointName::parse("process-boundary").map_err(exec_internal)?,
                    value: CheckpointValue::new(
                        "application/octet-stream",
                        b"committed-before-crash".to_vec(),
                    )
                    .map_err(exec_internal)?,
                })
                .await?;
            panic!("injected process loss after durable checkpoint")
        }
    }

    #[async_trait]
    impl super::super::port::RunHandler for MustNotRunHandler {
        async fn execute(
            &self,
            _input: RunInput,
            _context: SharedExecutionContext,
        ) -> Result<RunOutput, ExecutionError> {
            panic!("control recovery must run before the newly admitted receipt")
        }
    }

    #[tokio::test]
    async fn satisfies_backend_neutral_conformance_suite() {
        let backend = Phase2OpenDataOrchestrator::new().expect("create disposable Phase-2 adapter");
        super::super::conformance::run(Arc::new(backend)).await;
    }

    #[test]
    fn engine_state_authority_is_journal_only() {
        for (module, source) in [
            ("state", include_str!("state.rs")),
            ("shard log", include_str!("shard_log/command_loop.rs")),
            ("inbox", include_str!("inbox.rs")),
            ("phase2 adapter", include_str!("phase2_adapter.rs")),
        ] {
            assert!(
                !source.contains(concat!("crate::", "durable_state")),
                "{module} must keep state authority in the journal"
            );
        }
    }

    #[tokio::test]
    async fn empty_prefix_reopens_after_total_local_loss_and_finishes_from_remote_history() {
        let remote = tempfile::tempdir().expect("remote prefix");
        let cache = tempfile::tempdir().expect("first local cache");
        let first = Phase2OpenDataOrchestrator::from_roots(remote.path(), cache.path())
            .expect("open empty prefix");
        let run_id = RunId::parse("00000099-0000-4000-8000-000000000001").expect("valid run ID");
        let submission = SubmitRun {
            run_id: run_id.clone(),
            integration_id: CanonicalIntegrationId::parse("alice:phase2-process-recovery")
                .expect("valid integration"),
            input: RunInput {
                definition: IntegrationDefinition::parse("pipeline: recovery")
                    .expect("valid definition"),
                public_variables: RunVariables::new(BTreeMap::new()).expect("valid variables"),
            },
            policy: super::super::port::RunPolicy {
                max_handler_failures: NonZeroU32::MIN,
            },
        };
        first.submit_run(submission).await.expect("submit receipt");
        Box::pin(first.promote_receipts())
            .await
            .expect("durable RunAccepted");
        first.shutdown_shards().await.expect("close first writer");
        drop(first);
        drop(cache);

        let crash_cache = tempfile::tempdir().expect("post-acceptance cache");
        let crash_backend =
            Phase2OpenDataOrchestrator::from_roots(remote.path(), crash_cache.path())
                .expect("reopen only from remote prefix");
        let crashed = tokio::spawn({
            let backend = crash_backend.clone();
            async move {
                backend
                    .run(Arc::new(CheckpointCrashHandler), CancellationToken::new())
                    .await
            }
        });
        assert!(crashed.await.expect_err("worker must crash").is_panic());
        crash_backend
            .shutdown_shards()
            .await
            .expect("close writer after crash");
        drop(crash_backend);
        drop(crash_cache);

        let replacement_cache = tempfile::tempdir().expect("replacement cache");
        let recovered =
            Phase2OpenDataOrchestrator::from_roots(remote.path(), replacement_cache.path())
                .expect("reopen after checkpoint crash");
        let shutdown = CancellationToken::new();
        let worker_backend = recovered.clone();
        let worker_shutdown = shutdown.clone();
        let worker = tokio::spawn(async move {
            worker_backend
                .run(Arc::new(RecoveredHandler), worker_shutdown)
                .await
        });
        let status = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                if let Some(status) = recovered.run_status(&run_id).await.expect("query run") {
                    if status.state == RunState::Completed {
                        break status;
                    }
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("recovered run completes");
        assert_eq!(status.attempt, 2);
        assert_eq!(
            status.output.expect("durable output").bytes(),
            b"recovered-from-remote-prefix"
        );
        shutdown.cancel();
        worker.await.expect("worker joins").expect("worker exits");
        recovered
            .shutdown_shards()
            .await
            .expect("close recovered writer");
    }

    #[tokio::test]
    async fn recovered_control_is_resolved_before_a_new_receipt_can_start() {
        let backend = Phase2OpenDataOrchestrator::new().expect("create adapter");
        let run_id = RunId::parse("00000100-0000-4000-8000-000000000001").expect("valid run ID");
        let integration =
            CanonicalIntegrationId::parse("alice:phase2-priority").expect("valid integration");
        backend
            .submit_run(SubmitRun {
                run_id: run_id.clone(),
                integration_id: integration.clone(),
                input: RunInput {
                    definition: IntegrationDefinition::parse("pipeline: priority")
                        .expect("valid definition"),
                    public_variables: RunVariables::new(BTreeMap::new()).expect("valid variables"),
                },
                policy: super::super::port::RunPolicy {
                    max_handler_failures: NonZeroU32::MIN,
                },
            })
            .await
            .expect("submit pending receipt");
        let definition = backend
            .publish(b"\"pipeline: disabled\"", ".json", "application/json")
            .await
            .expect("publish desired definition");
        let request = ControlRequestV1::new(
            backend.inner.tenant.clone(),
            integration,
            "priority-test".to_owned(),
            ControlCommandV1::SetIntegrationDesiredState(SetIntegrationDesiredStateV1 {
                desired: IntegrationDesiredState::Disabled,
                definition_ref: definition,
                expected_desired_revision: None,
            }),
        )
        .expect("valid disable request");
        publish_control_request(&backend.inner.store, &request)
            .await
            .expect("publish pending control request");

        let shutdown = CancellationToken::new();
        let worker_backend = backend.clone();
        let worker_shutdown = shutdown.clone();
        let worker = tokio::spawn(async move {
            worker_backend
                .run(Arc::new(MustNotRunHandler), worker_shutdown)
                .await
        });
        let status = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                if let Some(status) = backend.run_status(&run_id).await.expect("query run") {
                    if status.state == RunState::Accepted {
                        break status;
                    }
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("disabled receipt becomes queued");
        assert_eq!(status.attempt, 0);
        shutdown.cancel();
        worker.await.expect("worker joins").expect("worker exits");
        backend.shutdown_shards().await.expect("close writer");
    }
}
