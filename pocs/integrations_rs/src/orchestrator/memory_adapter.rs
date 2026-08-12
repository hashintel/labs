//! In-memory reference implementation of the typed orchestration capabilities.
//!
//! This is an executable model and makes no production durability claim.
//! It is independent of the projection fold, so the shared conformance
//! suite can expose semantic drift instead of reproducing shared bugs. Clones
//! share state so worker-process loss can be simulated without backend concepts.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, MutexGuard};

use async_trait::async_trait;
use serde::Serialize;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

use super::control::IntegrationDesiredState;
use super::events::{control_outcome_event_id, ControlRejectionReason, FailureSummary};
use super::ids::{
    canonical_digest, derive_attempt_id, AttemptId, CanonicalIntegrationId, EventId, RequestId,
    RunId,
};
use super::port::{
    CheckpointCommand, CheckpointName, CheckpointValue, ControlCommand, ControlCommandKind,
    ControlCommands, ExecutionContext, ExecutionError, IntegrationDefinition, OrchestratorError,
    RequestHandle, RequestOutcome, RunInput, RunOutput, RunQuery, RunState, RunStatus,
    RunSubmission, SharedExecutionContext, SharedRunHandler, SubmitOutcome, SubmitRun, WorkerHost,
};

#[derive(Clone, Default)]
pub struct InMemoryOrchestrator {
    inner: Arc<Inner>,
}

#[derive(Default)]
struct Inner {
    state: Mutex<MemoryState>,
    changed: Notify,
}

#[derive(Default)]
struct MemoryState {
    runs: BTreeMap<RunId, MemoryRun>,
    admissions: BTreeMap<CanonicalIntegrationId, RunId>,
    desired: BTreeMap<CanonicalIntegrationId, DesiredState>,
    request_outcomes: BTreeMap<RequestId, (ControlCommand, RequestHandle)>,
}

struct MemoryRun {
    submission: SubmitRun,
    state: RunState,
    attempt: u64,
    handler_failures: u32,
    attempt_id: Option<AttemptId>,
    revision: EventId,
    output: Option<RunOutput>,
    failure: Option<FailureSummary>,
    checkpoints: BTreeMap<CheckpointName, CheckpointValue>,
    claimed: bool,
}

struct DesiredState {
    desired: IntegrationDesiredState,
    _definition: IntegrationDefinition,
    revision: EventId,
}

struct Claim {
    run_id: RunId,
    input: RunInput,
    context: SharedExecutionContext,
    guard: ClaimGuard,
}

struct ClaimGuard {
    backend: InMemoryOrchestrator,
    run_id: RunId,
    attempt_id: AttemptId,
    finished: bool,
}

struct MemoryExecutionContext {
    backend: InMemoryOrchestrator,
    run_id: RunId,
    attempt_id: AttemptId,
    attempt: u64,
}

impl InMemoryOrchestrator {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> Result<MutexGuard<'_, MemoryState>, OrchestratorError> {
        self.inner.state.lock().map_err(|error| {
            OrchestratorError::internal(format!("in-memory state poisoned: {error}"))
        })
    }

    fn claim_next(&self) -> Result<Option<Claim>, OrchestratorError> {
        let mut state = self.lock()?;
        let selected = state.runs.iter().find_map(|(run_id, run)| {
            let enabled = state
                .desired
                .get(&run.submission.integration_id)
                .is_none_or(|desired| desired.desired == IntegrationDesiredState::Enabled);
            (enabled && !run.claimed && matches!(run.state, RunState::Accepted | RunState::Running))
                .then(|| run_id.clone())
        });
        let Some(run_id) = selected else {
            return Ok(None);
        };
        let run = state
            .runs
            .get_mut(&run_id)
            .ok_or_else(|| OrchestratorError::internal("selected run disappeared"))?;
        run.attempt = run
            .attempt
            .checked_add(1)
            .ok_or_else(|| OrchestratorError::internal("attempt counter overflow"))?;
        let attempt_id = derive_attempt_id(&run_id, run.attempt);
        run.attempt_id = Some(attempt_id.clone());
        run.state = RunState::Running;
        run.claimed = true;
        run.revision = run_revision(&run_id, "attempt_started", run.attempt, None)?;
        let context: SharedExecutionContext = Arc::new(MemoryExecutionContext {
            backend: self.clone(),
            run_id: run_id.clone(),
            attempt_id: attempt_id.clone(),
            attempt: run.attempt,
        });
        Ok(Some(Claim {
            run_id: run_id.clone(),
            input: run.submission.input.clone(),
            context,
            guard: ClaimGuard {
                backend: self.clone(),
                run_id,
                attempt_id,
                finished: false,
            },
        }))
    }

    fn finish_claim(
        &self,
        run_id: &RunId,
        attempt_id: &AttemptId,
        result: Result<RunOutput, ExecutionError>,
    ) -> Result<(), OrchestratorError> {
        let mut state = self.lock()?;
        let run = state
            .runs
            .get_mut(run_id)
            .ok_or_else(|| OrchestratorError::internal(format!("run {run_id} disappeared")))?;
        if run.attempt_id.as_ref() != Some(attempt_id) || !run.claimed {
            return Ok(());
        }
        run.claimed = false;
        match result {
            Ok(output) => {
                run.state = RunState::Completed;
                run.output = Some(output);
                run.failure = None;
                run.revision = run_revision(run_id, "completed", run.attempt, None)?;
                clear_admission(&mut state, run_id);
            }
            Err(ExecutionError::Retryable(message)) => {
                run.handler_failures = run.handler_failures.checked_add(1).ok_or_else(|| {
                    OrchestratorError::internal("handler-failure counter overflow")
                })?;
                if run.handler_failures < run.submission.policy.max_handler_failures.get() {
                    run.state = RunState::Accepted;
                    run.failure = Some(failure("retryable", message, true));
                    run.revision = run_revision(run_id, "retry_scheduled", run.attempt, None)?;
                    self.inner.changed.notify_one();
                } else {
                    run.state = RunState::Terminated;
                    run.failure = Some(failure("execution_failed", message, false));
                    run.revision = run_revision(run_id, "terminated", run.attempt, None)?;
                    clear_admission(&mut state, run_id);
                }
            }
            Err(ExecutionError::Permanent(message)) => {
                run.state = RunState::Terminated;
                run.failure = Some(failure("execution_failed", message, false));
                run.revision = run_revision(run_id, "terminated", run.attempt, None)?;
                clear_admission(&mut state, run_id);
            }
            Err(ExecutionError::Cancelled | ExecutionError::StaleAttempt) => {
                run.state = RunState::Terminated;
                run.failure = None;
                run.revision = run_revision(run_id, "cancelled", run.attempt, None)?;
                clear_admission(&mut state, run_id);
            }
        }
        Ok(())
    }
}

#[async_trait]
impl RunSubmission for InMemoryOrchestrator {
    async fn submit_run(&self, request: SubmitRun) -> Result<SubmitOutcome, OrchestratorError> {
        let mut state = self.lock()?;
        if let Some(existing) = state.runs.get(&request.run_id) {
            if existing.submission != request {
                return Err(OrchestratorError::conflict(format!(
                    "run ID {} was reused for different input",
                    request.run_id
                )));
            }
            return Ok(SubmitOutcome {
                run_id: request.run_id,
                initial_revision: initial_revision(&existing.submission)?,
                created: false,
            });
        }
        if let Some(winner_id) = state.admissions.get(&request.integration_id).cloned() {
            let winner = state
                .runs
                .get(&winner_id)
                .ok_or_else(|| OrchestratorError::internal("admission references a missing run"))?;
            if !winner.state.is_terminal() {
                return Ok(SubmitOutcome {
                    run_id: winner_id,
                    initial_revision: initial_revision(&winner.submission)?,
                    created: false,
                });
            }
            state.admissions.remove(&request.integration_id);
        }
        let revision = initial_revision(&request)?;
        state
            .admissions
            .insert(request.integration_id.clone(), request.run_id.clone());
        state.runs.insert(
            request.run_id.clone(),
            MemoryRun {
                submission: request.clone(),
                state: RunState::Accepted,
                attempt: 0,
                handler_failures: 0,
                attempt_id: None,
                revision: revision.clone(),
                output: None,
                failure: None,
                checkpoints: BTreeMap::new(),
                claimed: false,
            },
        );
        drop(state);
        self.inner.changed.notify_one();
        Ok(SubmitOutcome {
            run_id: request.run_id,
            initial_revision: revision,
            created: true,
        })
    }
}

#[async_trait]
impl RunQuery for InMemoryOrchestrator {
    async fn run_status(&self, run_id: &RunId) -> Result<Option<RunStatus>, OrchestratorError> {
        let state = self.lock()?;
        Ok(state.runs.get(run_id).map(|run| RunStatus {
            run_id: run_id.clone(),
            integration_id: run.submission.integration_id.clone(),
            state: run.state,
            attempt: run.attempt,
            attempt_id: run.attempt_id.clone(),
            active_work_id: None,
            revision: run.revision.clone(),
            output: run.output.clone(),
            failure: run.failure.clone(),
        }))
    }
}

#[async_trait]
impl ControlCommands for InMemoryOrchestrator {
    async fn request(&self, command: ControlCommand) -> Result<RequestHandle, OrchestratorError> {
        let mut state = self.lock()?;
        if let Some((existing, outcome)) = state.request_outcomes.get(&command.request_id) {
            if existing != &command {
                return Err(OrchestratorError::conflict(format!(
                    "request ID {} was reused with different content",
                    command.request_id
                )));
            }
            return Ok(outcome.clone());
        }
        let revision = control_outcome_event_id(&command.request_id);
        let outcome = match &command.kind {
            ControlCommandKind::CancelRun {
                run_id,
                expected_revision,
            } => {
                let Some(run) = state.runs.get(run_id) else {
                    return Ok(record_rejection(
                        &mut state,
                        command,
                        ControlRejectionReason::NotFound,
                        None,
                    ));
                };
                if run.submission.integration_id != command.integration_id {
                    return Ok(record_rejection(
                        &mut state,
                        command,
                        ControlRejectionReason::NotFound,
                        None,
                    ));
                }
                if expected_revision != &run.revision {
                    let observed = Some(run.revision.clone());
                    return Ok(record_rejection(
                        &mut state,
                        command,
                        ControlRejectionReason::StaleRevision,
                        observed,
                    ));
                }
                if run.state.is_terminal() {
                    return Ok(record_rejection(
                        &mut state,
                        command,
                        ControlRejectionReason::Conflict,
                        None,
                    ));
                }
                let run = state
                    .runs
                    .get_mut(run_id)
                    .ok_or_else(|| OrchestratorError::internal("cancelled run disappeared"))?;
                run.state = RunState::Terminated;
                run.claimed = false;
                run.output = None;
                run.failure = None;
                run.revision = revision.clone();
                clear_admission(&mut state, run_id);
                RequestOutcome::Accepted {
                    revision: revision.clone(),
                }
            }
            ControlCommandKind::RetryWork { .. } => {
                return Ok(record_rejection(
                    &mut state,
                    command,
                    ControlRejectionReason::NotFound,
                    None,
                ));
            }
            ControlCommandKind::SetDesiredState {
                desired,
                definition,
                expected_revision,
            } => {
                let observed = state
                    .desired
                    .get(&command.integration_id)
                    .map(|desired| desired.revision.clone());
                if expected_revision != &observed {
                    return Ok(record_rejection(
                        &mut state,
                        command,
                        ControlRejectionReason::StaleRevision,
                        observed,
                    ));
                }
                state.desired.insert(
                    command.integration_id.clone(),
                    DesiredState {
                        desired: *desired,
                        _definition: definition.clone(),
                        revision: revision.clone(),
                    },
                );
                self.inner.changed.notify_one();
                RequestOutcome::Accepted {
                    revision: revision.clone(),
                }
            }
        };
        let handle = RequestHandle {
            request_id: command.request_id.clone(),
            outcome,
        };
        state
            .request_outcomes
            .insert(command.request_id.clone(), (command, handle.clone()));
        Ok(handle)
    }
}

#[async_trait]
impl WorkerHost for InMemoryOrchestrator {
    async fn run(
        &self,
        handler: SharedRunHandler,
        shutdown: CancellationToken,
    ) -> Result<(), OrchestratorError> {
        loop {
            let Some(mut claim) = self.claim_next()? else {
                tokio::select! {
                    () = shutdown.cancelled() => return Ok(()),
                    () = self.inner.changed.notified() => continue,
                }
            };
            let execution = handler.execute(claim.input, claim.context);
            tokio::pin!(execution);
            let result = tokio::select! {
                () = shutdown.cancelled() => return Ok(()),
                result = &mut execution => result,
            };
            self.finish_claim(&claim.run_id, &claim.guard.attempt_id, result)?;
            claim.guard.finished = true;
        }
    }
}

#[async_trait]
impl ExecutionContext for MemoryExecutionContext {
    fn run_id(&self) -> RunId {
        self.run_id.clone()
    }

    fn attempt_id(&self) -> AttemptId {
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
        let state = self.backend.inner.state.lock().map_err(|error| {
            ExecutionError::Permanent(format!("in-memory state lock is poisoned: {error}"))
        })?;
        let run = current_attempt(&state, &self.run_id, &self.attempt_id)?;
        Ok(run.checkpoints.get(name).cloned())
    }

    async fn commit_checkpoint(&self, command: CheckpointCommand) -> Result<(), ExecutionError> {
        let mut state = self.backend.inner.state.lock().map_err(|error| {
            ExecutionError::Permanent(format!("in-memory state lock is poisoned: {error}"))
        })?;
        let run = current_attempt_mut(&mut state, &self.run_id, &self.attempt_id)?;
        match run.checkpoints.get(&command.name) {
            Some(existing) if existing == &command.value => Ok(()),
            Some(_) => Err(ExecutionError::Permanent(format!(
                "checkpoint {} already names different content",
                command.name
            ))),
            None => {
                run.revision =
                    checkpoint_revision(&self.run_id, self.attempt, &command.name, &command.value)
                        .map_err(|error| ExecutionError::Permanent(error.to_string()))?;
                run.checkpoints.insert(command.name, command.value);
                Ok(())
            }
        }
    }

    async fn ensure_current(&self) -> Result<(), ExecutionError> {
        let state = self.backend.inner.state.lock().map_err(|error| {
            ExecutionError::Permanent(format!("in-memory state lock is poisoned: {error}"))
        })?;
        current_attempt(&state, &self.run_id, &self.attempt_id).map(|_| ())
    }
}

impl Drop for ClaimGuard {
    fn drop(&mut self) {
        if self.finished {
            return;
        }
        if let Ok(mut state) = self.backend.inner.state.lock() {
            if let Some(run) = state.runs.get_mut(&self.run_id) {
                if run.attempt_id.as_ref() == Some(&self.attempt_id) {
                    run.claimed = false;
                }
            }
        }
        self.backend.inner.changed.notify_one();
    }
}

fn current_attempt<'a>(
    state: &'a MemoryState,
    run_id: &RunId,
    attempt_id: &AttemptId,
) -> Result<&'a MemoryRun, ExecutionError> {
    let run = state.runs.get(run_id).ok_or(ExecutionError::StaleAttempt)?;
    if run.state != RunState::Running || !run.claimed || run.attempt_id.as_ref() != Some(attempt_id)
    {
        Err(ExecutionError::StaleAttempt)
    } else {
        Ok(run)
    }
}

fn current_attempt_mut<'a>(
    state: &'a mut MemoryState,
    run_id: &RunId,
    attempt_id: &AttemptId,
) -> Result<&'a mut MemoryRun, ExecutionError> {
    let run = state
        .runs
        .get_mut(run_id)
        .ok_or(ExecutionError::StaleAttempt)?;
    if run.state != RunState::Running || !run.claimed || run.attempt_id.as_ref() != Some(attempt_id)
    {
        Err(ExecutionError::StaleAttempt)
    } else {
        Ok(run)
    }
}

fn record_rejection(
    state: &mut MemoryState,
    command: ControlCommand,
    reason: ControlRejectionReason,
    observed_revision: Option<EventId>,
) -> RequestHandle {
    let handle = RequestHandle {
        request_id: command.request_id.clone(),
        outcome: RequestOutcome::Rejected {
            reason,
            observed_revision,
        },
    };
    state
        .request_outcomes
        .insert(command.request_id.clone(), (command, handle.clone()));
    handle
}

fn clear_admission(state: &mut MemoryState, run_id: &RunId) {
    state
        .admissions
        .retain(|_, admitted_run_id| admitted_run_id != run_id);
}

fn failure(code: &str, message: String, retryable: bool) -> FailureSummary {
    FailureSummary {
        code: code.to_owned(),
        message,
        retryable,
    }
}

fn initial_revision(request: &SubmitRun) -> Result<EventId, OrchestratorError> {
    #[derive(Serialize)]
    struct InitialRevision<'a> {
        run_id: &'a RunId,
        integration_id: &'a CanonicalIntegrationId,
        definition: &'a str,
        public_variables: &'a BTreeMap<String, String>,
        max_handler_failures: u32,
    }
    canonical_digest(
        "reference-run-accepted:v1",
        &InitialRevision {
            run_id: &request.run_id,
            integration_id: &request.integration_id,
            definition: request.input.definition.as_str(),
            public_variables: request.input.public_variables.as_map(),
            max_handler_failures: request.policy.max_handler_failures.get(),
        },
    )
    .map(EventId::from_digest)
    .map_err(|error| OrchestratorError::internal(error.to_string()))
}

fn checkpoint_revision(
    run_id: &RunId,
    attempt: u64,
    name: &CheckpointName,
    value: &CheckpointValue,
) -> Result<EventId, OrchestratorError> {
    #[derive(Serialize)]
    struct CheckpointRevision<'a> {
        run_id: &'a RunId,
        attempt: u64,
        name: &'a str,
        media_type: &'a str,
        bytes: &'a [u8],
    }
    canonical_digest(
        "reference-checkpoint-revision:v1",
        &CheckpointRevision {
            run_id,
            attempt,
            name: name.as_str(),
            media_type: value.media_type(),
            bytes: value.bytes(),
        },
    )
    .map(EventId::from_digest)
    .map_err(|error| OrchestratorError::internal(error.to_string()))
}

fn run_revision(
    run_id: &RunId,
    transition: &str,
    attempt: u64,
    work_id: Option<&super::ids::WorkId>,
) -> Result<EventId, OrchestratorError> {
    #[derive(Serialize)]
    struct Revision<'a> {
        run_id: &'a RunId,
        transition: &'a str,
        attempt: u64,
        work_id: Option<&'a super::ids::WorkId>,
    }
    canonical_digest(
        "reference-run-revision:v1",
        &Revision {
            run_id,
            transition,
            attempt,
            work_id,
        },
    )
    .map(EventId::from_digest)
    .map_err(|error| OrchestratorError::internal(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn satisfies_backend_neutral_conformance_suite() {
        super::super::conformance::run(Arc::new(InMemoryOrchestrator::new())).await;
    }
}
