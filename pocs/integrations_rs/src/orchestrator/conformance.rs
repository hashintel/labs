//! Backend-neutral orchestration conformance suite.

#![cfg(test)]
#![allow(clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

use super::control::IntegrationDesiredState;
use super::events::ControlRejectionReason;
use super::ids::{CanonicalIntegrationId, EventId, RequestId, RunId, WorkId};
use super::port::{
    CheckpointCommand, CheckpointName, CheckpointValue, ControlCommand, ControlCommandKind,
    ExecutionError, IntegrationDefinition, Orchestrator, RequestOutcome, RunHandler, RunInput,
    RunOutput, RunPolicy, RunState, RunVariables, SharedExecutionContext, SharedRunHandler,
    SubmitRun,
};

pub(super) async fn run(backend: Arc<dyn Orchestrator>) {
    submission_status_and_controls(backend.clone()).await;
    cancellation_stales_the_execution_context(backend.clone()).await;
    checkpoint_redelivery(backend.clone()).await;
    crash_recovery(backend).await;
}

async fn cancellation_stales_the_execution_context(backend: Arc<dyn Orchestrator>) {
    let request = submission(
        run_id(5),
        integration("alice:conformance-cancel-running"),
        "cancel-running",
    );
    backend
        .submit_run(request.clone())
        .await
        .expect("submit cancellable run");
    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let checked = Arc::new(Notify::new());
    let shutdown = CancellationToken::new();
    let worker = spawn_worker(
        backend.clone(),
        Arc::new(HeldHandler {
            started: started.clone(),
            release: release.clone(),
            checked: checked.clone(),
        }),
        shutdown.clone(),
    );
    started.notified().await;
    let running = backend
        .run_status(&request.run_id)
        .await
        .expect("query running run")
        .expect("running run exists");
    assert_eq!(running.state, RunState::Running);
    let cancelled = backend
        .request(ControlCommand {
            request_id: request_id('b'),
            integration_id: request.integration_id,
            kind: ControlCommandKind::CancelRun {
                run_id: request.run_id.clone(),
                expected_revision: running.revision,
            },
        })
        .await
        .expect("cancel running run");
    assert!(matches!(cancelled.outcome, RequestOutcome::Accepted { .. }));
    release.notify_one();
    checked.notified().await;
    wait_for_state(&backend, &request.run_id, RunState::Terminated).await;
    shutdown.cancel();
    worker
        .await
        .expect("cancel worker joins")
        .expect("cancel worker shuts down");
}

async fn submission_status_and_controls(backend: Arc<dyn Orchestrator>) {
    let integration = integration("alice:conformance-admission");
    let first = submission(run_id(1), integration.clone(), "first");
    let first_outcome = backend
        .submit_run(first.clone())
        .await
        .expect("submit first run");
    assert!(first_outcome.created);
    assert_eq!(first_outcome.run_id, first.run_id);

    let loser = submission(run_id(2), integration.clone(), "loser");
    let attached = backend.submit_run(loser).await.expect("attach to winner");
    assert!(!attached.created);
    assert_eq!(attached.run_id, first.run_id);
    assert_eq!(attached.initial_revision, first_outcome.initial_revision);
    assert_eq!(
        backend
            .run_status(&first.run_id)
            .await
            .expect("query accepted run")
            .expect("accepted run exists")
            .state,
        RunState::Accepted
    );

    let cancel = ControlCommand {
        request_id: request_id('1'),
        integration_id: integration.clone(),
        kind: ControlCommandKind::CancelRun {
            run_id: first.run_id.clone(),
            expected_revision: first_outcome.initial_revision,
        },
    };
    let cancelled = backend.request(cancel.clone()).await.expect("cancel run");
    assert!(matches!(cancelled.outcome, RequestOutcome::Accepted { .. }));
    assert_eq!(
        backend
            .request(cancel.clone())
            .await
            .expect("repeat cancel"),
        cancelled
    );
    let conflicting_request = ControlCommand {
        kind: ControlCommandKind::SetDesiredState {
            desired: IntegrationDesiredState::Enabled,
            definition: IntegrationDefinition::parse("different").expect("valid definition"),
            expected_revision: None,
        },
        ..cancel
    };
    assert!(backend.request(conflicting_request).await.is_err());
    assert_eq!(
        backend
            .run_status(&first.run_id)
            .await
            .expect("query cancelled run")
            .expect("cancelled run exists")
            .state,
        RunState::Terminated
    );

    let desired = ControlCommand {
        request_id: request_id('3'),
        integration_id: integration.clone(),
        kind: ControlCommandKind::SetDesiredState {
            desired: IntegrationDesiredState::Enabled,
            definition: IntegrationDefinition::parse("pipeline: v1").expect("valid definition"),
            expected_revision: None,
        },
    };
    let desired_outcome = backend.request(desired).await.expect("set desired state");
    let RequestOutcome::Accepted {
        revision: desired_revision,
    } = desired_outcome.outcome
    else {
        panic!("initial desired-state command must be accepted");
    };
    let stale = backend
        .request(ControlCommand {
            request_id: request_id('5'),
            integration_id: integration.clone(),
            kind: ControlCommandKind::SetDesiredState {
                desired: IntegrationDesiredState::Disabled,
                definition: IntegrationDefinition::parse("pipeline: v1").expect("valid definition"),
                expected_revision: None,
            },
        })
        .await
        .expect("stale desired request has durable outcome");
    assert_eq!(
        stale.outcome,
        RequestOutcome::Rejected {
            reason: ControlRejectionReason::StaleRevision,
            observed_revision: Some(desired_revision),
        }
    );

    let missing_work = backend
        .request(ControlCommand {
            request_id: request_id('7'),
            integration_id: integration,
            kind: ControlCommandKind::RetryWork {
                work_id: work_id('a'),
                expected_revision: event_id('9'),
                settings_revision: std::num::NonZeroU64::MIN,
            },
        })
        .await
        .expect("missing work has durable rejection");
    assert!(matches!(
        missing_work.outcome,
        RequestOutcome::Rejected {
            reason: ControlRejectionReason::NotFound,
            ..
        }
    ));
}

async fn checkpoint_redelivery(backend: Arc<dyn Orchestrator>) {
    let request = submission(
        run_id(3),
        integration("alice:conformance-checkpoint"),
        "checkpoint",
    );
    backend
        .submit_run(request.clone())
        .await
        .expect("submit checkpoint run");
    let shutdown = CancellationToken::new();
    let worker = spawn_worker(
        backend.clone(),
        Arc::new(CheckpointRetryHandler),
        shutdown.clone(),
    );
    let status = wait_for_state(&backend, &request.run_id, RunState::Completed).await;
    assert_eq!(status.attempt, 2);
    assert_eq!(
        status.output,
        Some(RunOutput::new("text/plain", b"checkpoint-resumed".to_vec()).expect("valid output"))
    );
    shutdown.cancel();
    worker
        .await
        .expect("worker task joins")
        .expect("worker shuts down");
}

async fn crash_recovery(backend: Arc<dyn Orchestrator>) {
    let mut request = submission(run_id(4), integration("alice:conformance-crash"), "crash");
    // Process loss is not a handler failure and must not consume the retry
    // budget, even when the configured budget permits no handler retry.
    request.policy.max_handler_failures = std::num::NonZeroU32::MIN;
    backend
        .submit_run(request.clone())
        .await
        .expect("submit crash run");
    for _ in 0..3 {
        let crashed = spawn_worker(
            backend.clone(),
            Arc::new(CrashWorker),
            CancellationToken::new(),
        );
        assert!(crashed.await.expect_err("worker must crash").is_panic());
    }

    let shutdown = CancellationToken::new();
    let recovered = spawn_worker(backend.clone(), Arc::new(SuccessHandler), shutdown.clone());
    let status = wait_for_state(&backend, &request.run_id, RunState::Completed).await;
    assert_eq!(status.attempt, 4);
    shutdown.cancel();
    recovered
        .await
        .expect("recovery worker joins")
        .expect("recovery worker shuts down");
}

fn spawn_worker(
    backend: Arc<dyn Orchestrator>,
    handler: SharedRunHandler,
    shutdown: CancellationToken,
) -> tokio::task::JoinHandle<Result<(), super::port::OrchestratorError>> {
    tokio::spawn(async move { backend.run(handler, shutdown).await })
}

async fn wait_for_state(
    backend: &Arc<dyn Orchestrator>,
    run_id: &RunId,
    expected: RunState,
) -> super::port::RunStatus {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let status = backend
                .run_status(run_id)
                .await
                .expect("query run")
                .expect("run exists");
            if status.state == expected {
                return status;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("run reaches expected state")
}

struct CheckpointRetryHandler;

struct HeldHandler {
    started: Arc<Notify>,
    release: Arc<Notify>,
    checked: Arc<Notify>,
}

#[async_trait]
impl RunHandler for HeldHandler {
    async fn execute(
        &self,
        _input: RunInput,
        context: SharedExecutionContext,
    ) -> Result<RunOutput, ExecutionError> {
        self.started.notify_one();
        self.release.notified().await;
        assert_eq!(
            context.ensure_current().await,
            Err(ExecutionError::StaleAttempt)
        );
        self.checked.notify_one();
        Err(ExecutionError::Cancelled)
    }
}

#[async_trait]
impl RunHandler for CheckpointRetryHandler {
    async fn execute(
        &self,
        _input: RunInput,
        context: SharedExecutionContext,
    ) -> Result<RunOutput, ExecutionError> {
        let name = CheckpointName::parse("source-boundary").expect("valid checkpoint name");
        if context.attempt() == 1 {
            assert!(context
                .load_checkpoint(&name)
                .await
                .expect("load empty checkpoint")
                .is_none());
            let value = CheckpointValue::new("application/octet-stream", b"committed".to_vec())
                .expect("valid checkpoint");
            context
                .commit_checkpoint(CheckpointCommand {
                    name: name.clone(),
                    value: value.clone(),
                })
                .await
                .expect("commit checkpoint");
            context
                .commit_checkpoint(CheckpointCommand {
                    name: name.clone(),
                    value,
                })
                .await
                .expect("identical checkpoint commit is idempotent");
            assert!(matches!(
                context
                    .commit_checkpoint(CheckpointCommand {
                        name,
                        value: CheckpointValue::new(
                            "application/octet-stream",
                            b"different".to_vec(),
                        )
                        .expect("valid checkpoint"),
                    })
                    .await,
                Err(ExecutionError::Permanent(_))
            ));
            return Err(ExecutionError::retryable("inject redelivery"));
        }
        let checkpoint = context
            .load_checkpoint(&name)
            .await
            .expect("load durable checkpoint")
            .expect("checkpoint survives redelivery");
        assert_eq!(checkpoint.bytes(), b"committed");
        RunOutput::new("text/plain", b"checkpoint-resumed".to_vec())
            .map_err(|error| ExecutionError::permanent(error.to_string()))
    }
}

struct CrashWorker;

#[async_trait]
impl RunHandler for CrashWorker {
    async fn execute(
        &self,
        _input: RunInput,
        _context: SharedExecutionContext,
    ) -> Result<RunOutput, ExecutionError> {
        panic!("injected worker-process loss");
    }
}

struct SuccessHandler;

#[async_trait]
impl RunHandler for SuccessHandler {
    async fn execute(
        &self,
        _input: RunInput,
        context: SharedExecutionContext,
    ) -> Result<RunOutput, ExecutionError> {
        context.ensure_current().await?;
        RunOutput::new("text/plain", b"recovered".to_vec())
            .map_err(|error| ExecutionError::permanent(error.to_string()))
    }
}

fn submission(run_id: RunId, integration_id: CanonicalIntegrationId, marker: &str) -> SubmitRun {
    SubmitRun {
        run_id,
        integration_id,
        input: RunInput {
            definition: IntegrationDefinition::parse(format!("pipeline: {marker}"))
                .expect("valid definition"),
            public_variables: RunVariables::new(BTreeMap::from([(
                "marker".to_owned(),
                marker.to_owned(),
            )]))
            .expect("valid public variables"),
        },
        policy: RunPolicy {
            max_handler_failures: std::num::NonZeroU32::new(3).expect("three is nonzero"),
        },
    }
}

fn integration(value: &str) -> CanonicalIntegrationId {
    CanonicalIntegrationId::parse(value).expect("valid integration ID")
}

fn run_id(value: u32) -> RunId {
    RunId::parse(format!("{value:08x}-0000-4000-8000-000000000001")).expect("valid run ID")
}

fn request_id(value: char) -> RequestId {
    RequestId::parse(value.to_string().repeat(64)).expect("valid request ID")
}

fn event_id(value: char) -> EventId {
    EventId::parse(value.to_string().repeat(64)).expect("valid event ID")
}

fn work_id(value: char) -> WorkId {
    WorkId::parse(value.to_string().repeat(64)).expect("valid work ID")
}
