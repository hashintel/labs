//! Pure, I/O-free materialization of the authoritative shard journal.

use std::collections::BTreeMap;
use std::fmt;

use super::control::{ControlRequestContextV1, ControlRequestTargetV1};
use super::events::{
    dlq_entry_id, ControlRejectionReason, JournalEvent, JournalEventV1, JournalRecordV1,
    SequencedJournalRecord, TerminalOutcome,
};
use super::ids::{CanonicalIntegrationId, EventId, RunId, WorkId};
pub use super::projection_types::{
    ControlRequestOutcomeKindV1, ControlRequestOutcomeV1, DlqEntryV1, IntegrationProjection,
    MaintenanceStatus, PoisonedProjection, Projection, ProjectionDelta, RestoreEvidence,
    RunProjection, RunStatus, WorkProjection, WorkStatus,
};
use super::work::WorkKind;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PreparedTransition {
    Noop,
    Mutation(ProjectionDelta),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplyOutcome {
    Applied,
    Duplicate,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidTransition {
    pub event_id: EventId,
    pub reason: String,
}

impl fmt::Display for InvalidTransition {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "invalid transition for event {}: {}",
            self.event_id, self.reason
        )
    }
}

impl std::error::Error for InvalidTransition {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidDurableHistory {
    pub sequence: u64,
    pub event_id: EventId,
    pub reason: String,
}

impl fmt::Display for InvalidDurableHistory {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "invalid durable history at sequence {} event {}: {}",
            self.sequence, self.event_id, self.reason
        )
    }
}

impl std::error::Error for InvalidDurableHistory {}

pub fn prepare(
    state: &Projection,
    record: &JournalRecordV1,
) -> Result<PreparedTransition, InvalidTransition> {
    if let Some(poisoned) = &state.poisoned {
        return invalid(
            record,
            format!(
                "projection is quarantined by sequence {} event {}: {}",
                poisoned.sequence, poisoned.event_id, poisoned.reason
            ),
        );
    }
    record
        .verify()
        .map_err(|error| transition_error(record, error.to_string()))?;
    let digest = record
        .digest()
        .map_err(|error| transition_error(record, error.to_string()))?;
    if let Some(seen) = state.seen_event_digests.get(&record.event_id) {
        return if *seen == digest {
            Ok(PreparedTransition::Noop)
        } else {
            invalid(record, "event ID was reused with different content")
        };
    }

    let mut delta = ProjectionDelta::for_record(record, digest);
    let JournalEvent::V1(event) = &record.event;
    match event {
        JournalEventV1::RunAccepted(value) => {
            if state.runs.contains_key(&value.run_id) {
                return invalid(record, format!("run {} already exists", value.run_id));
            }
            let mut integration = integration_for(state, &record.integration_id);
            if integration.active_run.is_some() || integration.queued_run.is_some() {
                return invalid(record, "depth-one admission slot is occupied");
            }
            let activates = integration.maintenance == MaintenanceStatus::Healthy
                && integration.execution_eligible();
            if activates {
                integration.active_run = Some(value.run_id.clone());
            } else {
                integration.queued_run = Some(value.run_id.clone());
            }
            delta.runs.insert(
                value.run_id.clone(),
                RunProjection {
                    integration_id: record.integration_id.clone(),
                    status: RunStatus::Accepted,
                    attempt: 0,
                    handler_failures: 0,
                    attempt_id: None,
                    immutable_input: value.immutable_input.clone(),
                    policy: value.policy.clone(),
                    submitted_at: value.submitted_at.clone(),
                    artifacts: BTreeMap::new(),
                    steps: BTreeMap::new(),
                    result: None,
                    outcome: None,
                    failure: None,
                    revision: record.event_id.clone(),
                },
            );
            delta
                .integrations
                .insert(record.integration_id.clone(), integration);
        }
        JournalEventV1::AttemptStarted(value) => {
            let mut run = run_for(state, record, &value.run_id)?;
            let integration = integration_existing(state, record)?;
            let next_attempt = run
                .attempt
                .checked_add(1)
                .ok_or_else(|| transition_error(record, "attempt counter overflow"))?;
            if !matches!(run.status, RunStatus::Accepted | RunStatus::Running)
                || integration.active_run.as_ref() != Some(&value.run_id)
                || value.attempt != next_attempt
            {
                return invalid(
                    record,
                    "attempt does not start the active run's next attempt",
                );
            }
            run.status = RunStatus::Running;
            run.attempt = value.attempt;
            run.attempt_id = Some(value.attempt_id.clone());
            run.revision = record.event_id.clone();
            delta.runs.insert(value.run_id.clone(), run);
        }
        JournalEventV1::AttemptFailed(value) => {
            let mut run = run_for(state, record, &value.run_id)?;
            if run.status != RunStatus::Running
                || run.attempt != value.attempt
                || run.attempt_id.as_ref() != Some(&value.attempt_id)
                || !value.failure.retryable
            {
                return invalid(
                    record,
                    "retryable failure does not bind the current running attempt",
                );
            }
            run.handler_failures = run
                .handler_failures
                .checked_add(1)
                .ok_or_else(|| transition_error(record, "handler-failure counter overflow"))?;
            run.status = RunStatus::Accepted;
            run.failure = Some(value.failure.clone());
            run.revision = record.event_id.clone();
            delta.runs.insert(value.run_id.clone(), run);
        }
        JournalEventV1::ArtifactPublished(value) => {
            let mut run = run_for(state, record, &value.run_id)?;
            require_nonterminal(record, &run)?;
            match run.artifacts.get(&value.role) {
                Some(existing) if existing == &value.reference => {}
                Some(_) => return invalid(record, "artifact role already names different content"),
                None => {
                    run.artifacts
                        .insert(value.role.clone(), value.reference.clone());
                    run.revision = record.event_id.clone();
                    delta.runs.insert(value.run_id.clone(), run);
                }
            }
        }
        JournalEventV1::StreamBatchAccepted(_) => {
            return invalid(
                record,
                "continuous stream events are reserved in protocol v1",
            );
        }
        JournalEventV1::StateCheckpointCommitted(value) => {
            let run = run_for(state, record, &value.run_id)?;
            require_nonterminal(record, &run)?;
            let mut integration = integration_existing(state, record)?;
            if integration.active_run.as_ref() != Some(&value.run_id) {
                return invalid(record, "checkpoint run is not active");
            }
            let state_record = value
                .state_record
                .try_current()
                .map_err(|error| transition_error(record, error.to_string()))?;
            if state_record.parent != integration.checkpoint_state {
                return invalid(record, "state checkpoint does not extend checkpoint_state");
            }
            integration.checkpoint_state = Some(value.state_version.clone());
            delta.pending_checkpoint_state_sequence = Some(record.integration_id.clone());
            delta
                .integrations
                .insert(record.integration_id.clone(), integration);
        }
        JournalEventV1::StepCommitted(value) => {
            let mut run = run_for(state, record, &value.run_id)?;
            require_nonterminal(record, &run)?;
            match run.steps.get(&value.name) {
                Some(existing) if existing == &value.checkpoint => {}
                Some(_) => {
                    return invalid(record, "step name already names a different checkpoint")
                }
                None => {
                    run.steps
                        .insert(value.name.clone(), value.checkpoint.clone());
                    run.revision = record.event_id.clone();
                    delta.runs.insert(value.run_id.clone(), run);
                }
            }
        }
        JournalEventV1::IntegrationDesiredStateSet(value) => {
            if state
                .control_request_outcomes
                .contains_key(&value.request.request_id)
            {
                return invalid(record, "control request already has an outcome");
            }
            let mut integration = integration_for(state, &record.integration_id);
            if value.request.expected_revision != integration.desired_revision {
                return invalid(record, "desired-state revision is stale");
            }
            integration.desired = Some(value.desired);
            integration.desired_definition = Some(value.definition_ref.clone());
            integration.desired_revision = Some(record.event_id.clone());
            promote_if_eligible(&mut integration);
            delta
                .integrations
                .insert(record.integration_id.clone(), integration);
            accept_request(&mut delta, &value.request, &record.event_id);
        }
        JournalEventV1::WorkPlanned(value) => {
            if state.work.contains_key(&value.manifest.work_id) {
                return invalid(
                    record,
                    format!("work {} already exists", value.manifest.work_id),
                );
            }
            let manifest = value
                .manifest_record
                .try_current_for(&record.integration_id)
                .map_err(|error| transition_error(record, error.to_string()))?;
            let mut integration = integration_existing(state, record)?;
            let work = WorkProjection {
                integration_id: record.integration_id.clone(),
                manifest: value.manifest.clone(),
                kind: manifest.kind.clone(),
                effect_count: manifest.effect_count,
                completed_effect_count: 0,
                status: WorkStatus::Planned,
                last_completed_effect: None,
                failure: None,
                settings_revision: None,
                revision: record.event_id.clone(),
            };
            match &manifest.kind {
                WorkKind::Apply(apply) => {
                    let mut run = run_for(state, record, &apply.run_id)?;
                    if integration.active_run.as_ref() != Some(&apply.run_id)
                        || run.status != RunStatus::Running
                        || integration.foreground_work.is_some()
                        || integration.maintenance != MaintenanceStatus::Healthy
                    {
                        return invalid(
                            record,
                            "Apply work is not legal in the current foreground state",
                        );
                    }
                    let candidate = value
                        .candidate_state_record
                        .as_ref()
                        .ok_or_else(|| {
                            transition_error(record, "Apply work lacks candidate state evidence")
                        })?
                        .try_current()
                        .map_err(|error| transition_error(record, error.to_string()))?;
                    if candidate.parent != integration.checkpoint_state {
                        return invalid(record, "Apply candidate does not extend checkpoint_state");
                    }
                    integration.checkpoint_state = Some(apply.candidate.clone());
                    delta.pending_checkpoint_state_sequence = Some(record.integration_id.clone());
                    integration.foreground_work = Some(manifest.work_id.clone());
                    run.revision = record.event_id.clone();
                    delta.runs.insert(apply.run_id.clone(), run);
                }
                WorkKind::Restore(restore) => {
                    let evidence = integration.restore_evidence.as_ref();
                    if integration.maintenance != MaintenanceStatus::RestoreRequired
                        || integration.foreground_work.is_some()
                        || !evidence.is_some_and(|evidence| {
                            evidence.failed_run_id == restore.failed_run_id
                                && evidence.failed_work_id == restore.failed_work_id
                                && evidence.target == restore.target
                                && evidence.contaminated == restore.contaminated
                        })
                    {
                        return invalid(
                            record,
                            "Restore work does not bind projected recovery evidence",
                        );
                    }
                    integration.foreground_work = Some(manifest.work_id.clone());
                    integration.maintenance = MaintenanceStatus::Restoring;
                }
                WorkKind::Reconcile(reconcile) => {
                    let replaceable = match integration.reconciliation_work.as_ref() {
                        None => true,
                        Some(id) => state.work.get(id).is_some_and(|work| {
                            matches!(work.status, WorkStatus::Completed | WorkStatus::Superseded)
                        }),
                    };
                    let next_cycle = integration
                        .reconciliation_cycle
                        .checked_add(1)
                        .ok_or_else(|| transition_error(record, "reconciliation cycle overflow"))?;
                    if !replaceable
                        || integration.applied_state.as_ref() != Some(&reconcile.target)
                        || integration.applied_incarnation != reconcile.applied_incarnation
                        || reconcile.cycle != next_cycle
                    {
                        return invalid(
                            record,
                            "Reconcile work does not target the next applied-state cycle",
                        );
                    }
                    integration.reconciliation_work = Some(manifest.work_id.clone());
                }
            }
            delta.work.insert(manifest.work_id.clone(), work);
            delta
                .integrations
                .insert(record.integration_id.clone(), integration);
        }
        JournalEventV1::WorkChunkCompleted(value) => {
            let mut work = work_for(state, record, &value.work_id)?;
            // The executor must verify that `last_effect_id` occupies this
            // prefix position in the immutable effects artifact. The pure fold
            // proves monotonicity and bounds without reading that artifact.
            if work.status != WorkStatus::Planned
                || work.manifest.manifest_digest != value.manifest_digest
                || value.completed_effect_count <= work.completed_effect_count
                || value.completed_effect_count > work.effect_count
            {
                return invalid(
                    record,
                    "work cursor is stale, out of range, or bound to another manifest",
                );
            }
            work.completed_effect_count = value.completed_effect_count;
            work.last_completed_effect = Some(value.last_effect_id.clone());
            work.revision = record.event_id.clone();
            delta.work.insert(value.work_id.clone(), work);
        }
        JournalEventV1::WorkCompleted(value) => {
            let mut work = work_for(state, record, &value.work_id)?;
            if work.status != WorkStatus::Planned
                || work.manifest.manifest_digest != value.manifest_digest
                || work.completed_effect_count != work.effect_count
            {
                return invalid(record, "work is not at the final durable cursor");
            }
            let mut integration = integration_existing(state, record)?;
            work.status = WorkStatus::Completed;
            work.revision = record.event_id.clone();
            match &work.kind {
                WorkKind::Apply(apply) => {
                    if integration.foreground_work.as_ref() != Some(&value.work_id) {
                        return invalid(record, "completed Apply is not foreground work");
                    }
                    integration.applied_state = Some(apply.candidate.clone());
                    integration.applied_incarnation = Some(record.event_id.clone());
                    integration.foreground_work = None;
                    let mut run = run_for(state, record, &apply.run_id)?;
                    run.revision = record.event_id.clone();
                    delta.runs.insert(apply.run_id.clone(), run);
                    // Every successful Apply creates a new state incarnation,
                    // even when its content-addressed state digest recurs.
                    supersede_old_reconcile(state, &mut delta, &integration, record)?;
                }
                WorkKind::Restore(restore) => {
                    if integration.foreground_work.as_ref() != Some(&value.work_id)
                        || !matches!(integration.maintenance, MaintenanceStatus::Restoring)
                    {
                        return invalid(record, "completed Restore is not the active restore");
                    }
                    integration.maintenance = MaintenanceStatus::Healthy;
                    integration.restore_evidence = None;
                    integration.checkpoint_state = restore.target.clone();
                    delta.pending_checkpoint_state_sequence = Some(record.integration_id.clone());
                    integration.foreground_work = None;
                    promote_if_eligible(&mut integration);
                }
                WorkKind::Reconcile(reconcile) => {
                    let next_cycle = integration
                        .reconciliation_cycle
                        .checked_add(1)
                        .ok_or_else(|| transition_error(record, "reconciliation cycle overflow"))?;
                    if integration.reconciliation_work.as_ref() != Some(&value.work_id)
                        || reconcile.cycle != next_cycle
                    {
                        return invalid(
                            record,
                            "completed Reconcile is not the projected next cycle",
                        );
                    }
                    integration.reconciliation_cycle = reconcile.cycle;
                    integration.reconciliation_work = None;
                }
            }
            delta.work.insert(value.work_id.clone(), work);
            delta
                .integrations
                .insert(record.integration_id.clone(), integration);
        }
        JournalEventV1::WorkBlocked(value) => {
            let mut work = work_for(state, record, &value.work_id)?;
            if work.status != WorkStatus::Planned
                || work.manifest.manifest_digest != value.manifest_digest
            {
                return invalid(
                    record,
                    "blocked work is not a planned item of this manifest",
                );
            }
            let mut integration = integration_existing(state, record)?;
            match &work.kind {
                WorkKind::Apply(_) => return invalid(record, "Apply work cannot be blocked"),
                WorkKind::Restore(_) => {
                    if integration.foreground_work.as_ref() != Some(&value.work_id) {
                        return invalid(record, "blocked Restore is not foreground work");
                    }
                    integration.maintenance = MaintenanceStatus::Blocked;
                    if let Some(entry_id) = integration
                        .restore_evidence
                        .as_ref()
                        .and_then(|evidence| evidence.dlq_entry_id.as_ref())
                    {
                        if let Some(entry) = integration.dlq.get_mut(entry_id) {
                            entry.maintenance_failure = Some(value.failure.clone());
                        }
                    }
                }
                WorkKind::Reconcile(_) => {
                    if integration.reconciliation_work.as_ref() != Some(&value.work_id) {
                        return invalid(
                            record,
                            "blocked Reconcile is not current reconciliation work",
                        );
                    }
                }
            }
            work.status = WorkStatus::Blocked;
            work.failure = Some(value.failure.clone());
            work.revision = record.event_id.clone();
            delta.work.insert(value.work_id.clone(), work);
            delta
                .integrations
                .insert(record.integration_id.clone(), integration);
        }
        JournalEventV1::RetryRequested(value) => {
            if state
                .control_request_outcomes
                .contains_key(&value.request.request_id)
            {
                return invalid(record, "control request already has an outcome");
            }
            let mut work = work_for(state, record, &value.work_id)?;
            if work.status != WorkStatus::Blocked
                || value.request.expected_revision.as_ref() != Some(&work.revision)
            {
                return invalid(
                    record,
                    "retry does not name the blocked work's current revision",
                );
            }
            let mut integration = integration_existing(state, record)?;
            if matches!(work.kind, WorkKind::Restore(_)) {
                if integration.foreground_work.as_ref() != Some(&value.work_id)
                    || integration.maintenance != MaintenanceStatus::Blocked
                {
                    return invalid(
                        record,
                        "retry does not resume the projected blocked Restore",
                    );
                }
                integration.maintenance = MaintenanceStatus::Restoring;
            }
            work.status = WorkStatus::Planned;
            work.failure = None;
            work.settings_revision = Some(value.settings_revision);
            work.revision = record.event_id.clone();
            delta.work.insert(value.work_id.clone(), work);
            delta
                .integrations
                .insert(record.integration_id.clone(), integration);
            accept_request(&mut delta, &value.request, &record.event_id);
        }
        JournalEventV1::RunCompleted(value) => {
            let mut run = run_for(state, record, &value.run_id)?;
            let mut integration = integration_existing(state, record)?;
            if run.status != RunStatus::Running
                || integration.active_run.as_ref() != Some(&value.run_id)
                || integration.foreground_work.is_some()
            {
                return invalid(
                    record,
                    "run is not active, running, and free of required work",
                );
            }
            run.status = RunStatus::Completed;
            run.result = Some(value.result.clone());
            run.revision = record.event_id.clone();
            integration.active_run = None;
            promote_if_eligible(&mut integration);
            delta.runs.insert(value.run_id.clone(), run);
            delta
                .integrations
                .insert(record.integration_id.clone(), integration);
        }
        JournalEventV1::RunTerminated(value) => {
            let mut run = run_for(state, record, &value.run_id)?;
            require_nonterminal(record, &run)?;
            let mut integration = integration_existing(state, record)?;
            let is_active = integration.active_run.as_ref() == Some(&value.run_id);
            let is_queued = integration.queued_run.as_ref() == Some(&value.run_id);
            if !is_active && !is_queued {
                return invalid(record, "terminated run occupies neither admission slot");
            }
            if is_queued
                && (value.outcome != TerminalOutcome::Cancelled || value.failed_work.is_some())
            {
                return invalid(
                    record,
                    "queued runs may only be cancelled before activation",
                );
            }
            validate_control_context(state, record, value.request.as_ref(), Some(&run.revision))?;

            let live_apply = live_apply_for_run(state, &integration, &value.run_id);
            match (&value.failed_work, live_apply.as_ref()) {
                (None, None) => {}
                (Some(given), Some((expected, _))) if given == expected => {}
                _ => {
                    return invalid(
                        record,
                        "failed_work does not name the run's exact live Apply work",
                    )
                }
            }

            run.status = RunStatus::Terminated;
            run.outcome = Some(value.outcome);
            run.failure = value.failure.clone();
            run.revision = record.event_id.clone();
            if is_active {
                integration.active_run = None;
            } else {
                integration.queued_run = None;
            }

            if let Some((work_id, mut failed_work)) = live_apply {
                failed_work.status = WorkStatus::Terminated;
                failed_work.failure = value.failure.clone();
                failed_work.revision = record.event_id.clone();
                let WorkKind::Apply(apply) = &failed_work.kind else {
                    unreachable!("live_apply_for_run returns only Apply")
                };
                let contaminated = apply.candidate.clone();
                let entry_id = dlq_entry_id(&record.event_id);
                integration.maintenance = MaintenanceStatus::RestoreRequired;
                integration.restore_evidence = Some(RestoreEvidence {
                    failed_run_id: value.run_id.clone(),
                    failed_work_id: work_id.clone(),
                    target: integration.applied_state.clone(),
                    contaminated: contaminated.clone(),
                    dlq_entry_id: (value.outcome != TerminalOutcome::Cancelled)
                        .then_some(entry_id.clone()),
                });
                integration.foreground_work = None;
                delta.work.insert(work_id.clone(), failed_work);
                if value.outcome != TerminalOutcome::Cancelled {
                    let failure = value.failure.clone().ok_or_else(|| {
                        transition_error(record, "DLQ termination requires a failure summary")
                    })?;
                    let mut evidence: Vec<_> = run.artifacts.values().cloned().collect();
                    evidence.push(contaminated.artifact.clone());
                    evidence.sort_by(|left, right| left.current().key.cmp(&right.current().key));
                    evidence.dedup();
                    integration.dlq.insert(
                        entry_id.clone(),
                        DlqEntryV1 {
                            entry_id: entry_id.clone(),
                            run_id: value.run_id.clone(),
                            attempt_id: run.attempt_id.clone(),
                            failed_work: Some(work_id),
                            failure,
                            evidence,
                            entered_at_sequence: 0,
                            maintenance_failure: None,
                        },
                    );
                    delta.pending_dlq_sequence = Some((record.integration_id.clone(), entry_id));
                }
            } else if value.outcome != TerminalOutcome::Cancelled {
                let failure = value.failure.clone().ok_or_else(|| {
                    transition_error(record, "DLQ termination requires a failure summary")
                })?;
                let entry_id = dlq_entry_id(&record.event_id);
                let mut evidence: Vec<_> = run.artifacts.values().cloned().collect();
                evidence.sort_by(|left, right| left.current().key.cmp(&right.current().key));
                evidence.dedup();
                integration.dlq.insert(
                    entry_id.clone(),
                    DlqEntryV1 {
                        entry_id: entry_id.clone(),
                        run_id: value.run_id.clone(),
                        attempt_id: run.attempt_id.clone(),
                        failed_work: None,
                        failure,
                        evidence,
                        entered_at_sequence: 0,
                        maintenance_failure: None,
                    },
                );
                delta.pending_dlq_sequence = Some((record.integration_id.clone(), entry_id));
            }
            promote_if_eligible(&mut integration);
            if let Some(request) = &value.request {
                accept_request(&mut delta, request, &record.event_id);
            }
            delta.runs.insert(value.run_id.clone(), run);
            delta
                .integrations
                .insert(record.integration_id.clone(), integration);
        }
        JournalEventV1::ControlRequestRejected(value) => {
            if state
                .control_request_outcomes
                .contains_key(&value.request.request_id)
            {
                return invalid(record, "control request already has an outcome");
            }
            let observed = observed_revision(state, &value.target, &record.integration_id);
            match value.reason_code {
                ControlRejectionReason::StaleRevision => {
                    if value.observed_revision != observed
                        || value.request.expected_revision == observed
                    {
                        return invalid(
                            record,
                            "stale rejection does not match the projected revision",
                        );
                    }
                }
                ControlRejectionReason::NotFound => {
                    if target_exists(state, &value.target, &record.integration_id) {
                        return invalid(record, "NotFound rejection target exists");
                    }
                }
                ControlRejectionReason::Unauthorized
                | ControlRejectionReason::Conflict
                | ControlRejectionReason::Malformed => {}
            }
            delta.control_request_outcomes.insert(
                value.request.request_id.clone(),
                ControlRequestOutcomeV1 {
                    request_digest: value.request.request_digest.clone(),
                    outcome: ControlRequestOutcomeKindV1::Rejected {
                        reason_code: value.reason_code,
                        expected_revision: value.request.expected_revision.clone(),
                        observed_revision: value.observed_revision.clone(),
                    },
                },
            );
        }
        JournalEventV1::DlqEntryExpired(value) => {
            let mut integration = integration_existing(state, record)?;
            if integration.dlq.remove(&value.entry_id).is_none() {
                return invalid(record, "DLQ entry is not active");
            }
            delta
                .integrations
                .insert(record.integration_id.clone(), integration);
        }
    }
    Ok(PreparedTransition::Mutation(delta))
}

pub fn finalize(
    state: &mut Projection,
    transition: PreparedTransition,
    shard_sequence: u64,
) -> Result<ApplyOutcome, InvalidTransition> {
    if state
        .through_log_sequence
        .is_some_and(|through| shard_sequence <= through)
    {
        let event_id = match &transition {
            PreparedTransition::Noop => {
                EventId::parse("0".repeat(64)).expect("zero digest is a valid typed event ID")
            }
            PreparedTransition::Mutation(delta) => delta.event_id.clone(),
        };
        return Err(InvalidTransition {
            event_id,
            reason: format!(
                "shard sequence {shard_sequence} does not advance {:?}",
                state.through_log_sequence
            ),
        });
    }
    let outcome = match transition {
        PreparedTransition::Noop => ApplyOutcome::Duplicate,
        PreparedTransition::Mutation(mut delta) => {
            if let Some(integration_id) = &delta.pending_checkpoint_state_sequence {
                let integration = delta.integrations.get_mut(integration_id).ok_or_else(|| {
                    InvalidTransition {
                        event_id: delta.event_id.clone(),
                        reason: "prepared checkpoint-state transition is missing from its integration delta"
                            .to_owned(),
                    }
                })?;
                integration.checkpoint_state_sequence = Some(shard_sequence);
            }
            if let Some((integration_id, entry_id)) = &delta.pending_dlq_sequence {
                let entry = delta
                    .integrations
                    .get_mut(integration_id)
                    .and_then(|integration| integration.dlq.get_mut(entry_id))
                    .ok_or_else(|| InvalidTransition {
                        event_id: delta.event_id.clone(),
                        reason: "prepared DLQ entry is missing from its integration delta"
                            .to_owned(),
                    })?;
                entry.entered_at_sequence = shard_sequence;
            }
            state.integrations.extend(delta.integrations);
            state.runs.extend(delta.runs);
            state.work.extend(delta.work);
            state
                .control_request_outcomes
                .extend(delta.control_request_outcomes);
            state
                .seen_event_digests
                .insert(delta.event_id, delta.event_digest);
            ApplyOutcome::Applied
        }
    };
    state.through_log_sequence = Some(shard_sequence);
    Ok(outcome)
}

pub fn apply(
    state: &mut Projection,
    input: SequencedJournalRecord,
) -> Result<ApplyOutcome, InvalidDurableHistory> {
    let sequence = input.shard_sequence();
    let record = input.record();
    let event_id = record.event_id.clone();
    let result =
        prepare(state, record).and_then(|transition| finalize(state, transition, sequence));
    result.map_err(|error| {
        let poison = PoisonedProjection {
            sequence,
            event_id: event_id.clone(),
            reason: error.reason.clone(),
        };
        state.poisoned = Some(poison);
        InvalidDurableHistory {
            sequence,
            event_id,
            reason: error.reason,
        }
    })
}

fn integration_for(state: &Projection, id: &CanonicalIntegrationId) -> IntegrationProjection {
    state.integrations.get(id).cloned().unwrap_or_default()
}

fn integration_existing(
    state: &Projection,
    record: &JournalRecordV1,
) -> Result<IntegrationProjection, InvalidTransition> {
    state
        .integrations
        .get(&record.integration_id)
        .cloned()
        .ok_or_else(|| transition_error(record, "integration has no projected state"))
}

fn run_for(
    state: &Projection,
    record: &JournalRecordV1,
    run_id: &RunId,
) -> Result<RunProjection, InvalidTransition> {
    let run = state
        .runs
        .get(run_id)
        .cloned()
        .ok_or_else(|| transition_error(record, format!("run {run_id} does not exist")))?;
    if run.integration_id != record.integration_id {
        return invalid(
            record,
            format!("run {run_id} belongs to another integration"),
        );
    }
    Ok(run)
}

fn work_for(
    state: &Projection,
    record: &JournalRecordV1,
    work_id: &WorkId,
) -> Result<WorkProjection, InvalidTransition> {
    let work = state
        .work
        .get(work_id)
        .cloned()
        .ok_or_else(|| transition_error(record, format!("work {work_id} does not exist")))?;
    if work.integration_id != record.integration_id {
        return invalid(
            record,
            format!("work {work_id} belongs to another integration"),
        );
    }
    Ok(work)
}

fn require_nonterminal(
    record: &JournalRecordV1,
    run: &RunProjection,
) -> Result<(), InvalidTransition> {
    if run.status.is_terminal() {
        invalid(record, "run is terminal")
    } else {
        Ok(())
    }
}

fn promote_if_eligible(integration: &mut IntegrationProjection) {
    if integration.active_run.is_none()
        && integration.maintenance == MaintenanceStatus::Healthy
        && integration.execution_eligible()
    {
        integration.active_run = integration.queued_run.take();
    }
}

fn accept_request(
    delta: &mut ProjectionDelta,
    request: &ControlRequestContextV1,
    event_id: &EventId,
) {
    delta.control_request_outcomes.insert(
        request.request_id.clone(),
        ControlRequestOutcomeV1 {
            request_digest: request.request_digest.clone(),
            outcome: ControlRequestOutcomeKindV1::Accepted {
                promoted_event_id: event_id.clone(),
            },
        },
    );
}

fn validate_control_context(
    state: &Projection,
    record: &JournalRecordV1,
    request: Option<&ControlRequestContextV1>,
    expected: Option<&EventId>,
) -> Result<(), InvalidTransition> {
    let Some(request) = request else {
        return Ok(());
    };
    if state
        .control_request_outcomes
        .contains_key(&request.request_id)
    {
        return invalid(record, "control request already has an outcome");
    }
    if request.expected_revision.as_ref() != expected {
        return invalid(record, "control request expected revision is stale");
    }
    Ok(())
}

fn live_apply_for_run(
    state: &Projection,
    integration: &IntegrationProjection,
    run_id: &RunId,
) -> Option<(WorkId, WorkProjection)> {
    let work_id = integration.foreground_work.as_ref()?;
    let work = state.work.get(work_id)?;
    match &work.kind {
        WorkKind::Apply(apply) if &apply.run_id == run_id && work.status.is_live() => {
            Some((work_id.clone(), work.clone()))
        }
        _ => None,
    }
}

fn supersede_old_reconcile(
    state: &Projection,
    delta: &mut ProjectionDelta,
    integration: &IntegrationProjection,
    record: &JournalRecordV1,
) -> Result<(), InvalidTransition> {
    let Some(work_id) = integration.reconciliation_work.clone() else {
        return Ok(());
    };
    let mut reconcile = work_for(state, record, &work_id)?;
    if reconcile.status.is_live() {
        reconcile.status = WorkStatus::Superseded;
        reconcile.revision = record.event_id.clone();
        delta.work.insert(work_id, reconcile);
    }
    Ok(())
}

fn observed_revision(
    state: &Projection,
    target: &ControlRequestTargetV1,
    integration_id: &CanonicalIntegrationId,
) -> Option<EventId> {
    match target {
        ControlRequestTargetV1::Run(id) => state
            .runs
            .get(id)
            .filter(|run| &run.integration_id == integration_id)
            .map(|run| run.revision.clone()),
        ControlRequestTargetV1::Work(id) => state
            .work
            .get(id)
            .filter(|work| &work.integration_id == integration_id)
            .map(|work| work.revision.clone()),
        ControlRequestTargetV1::DesiredState(id) => state
            .integrations
            .get(id)
            .and_then(|integration| integration.desired_revision.clone()),
    }
}

fn target_exists(
    state: &Projection,
    target: &ControlRequestTargetV1,
    integration_id: &CanonicalIntegrationId,
) -> bool {
    match target {
        ControlRequestTargetV1::Run(id) => state
            .runs
            .get(id)
            .is_some_and(|run| &run.integration_id == integration_id),
        ControlRequestTargetV1::Work(id) => state
            .work
            .get(id)
            .is_some_and(|work| &work.integration_id == integration_id),
        ControlRequestTargetV1::DesiredState(id) => {
            id == integration_id && state.integrations.contains_key(id)
        }
    }
}

fn transition_error(record: &JournalRecordV1, reason: impl Into<String>) -> InvalidTransition {
    InvalidTransition {
        event_id: record.event_id.clone(),
        reason: reason.into(),
    }
}

fn invalid<T>(record: &JournalRecordV1, reason: impl Into<String>) -> Result<T, InvalidTransition> {
    Err(transition_error(record, reason))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use sha2::{Digest as _, Sha256};

    use crate::blob::{BlobRef, BlobRefV1, StateSnapshot, StateSnapshotV1};
    use crate::orchestrator::control::IntegrationDesiredState;
    use crate::orchestrator::events::{
        ArtifactPublishedV1, ArtifactRole, AttemptFailedV1, AttemptStartedV1,
        ControlRequestRejectedV1, DlqEntryExpiredV1, FailureSummary, InputRef,
        IntegrationDesiredStateSetV1, JournalRecord, PolicyRef, RunAcceptedV1, RunCompletedV1,
        RunTerminatedV1, StateCheckpointCommittedV1, StepCommittedV1, StreamBatchAcceptedV1,
        WorkBlockedV1, WorkChunkCompletedV1, WorkCompletedV1, WorkManifestRef, WorkPlannedV1,
    };
    use crate::orchestrator::ids::{
        derive_attempt_id, DlqEntryId, EffectId, JournalRecordDigest, RequestDigest, RequestId,
        StateVersionId,
    };
    use crate::orchestrator::registry::DurableRecord;
    use crate::orchestrator::work::{
        ApplyWorkV1, DesiredProjectionRef, ReconcileWorkV1, RestoreWorkV1, StatePhase,
        StatePhaseV1, StateVersion, StateVersionRef, StateVersionV1, WorkManifest, WorkManifestV1,
    };

    fn integration() -> CanonicalIntegrationId {
        CanonicalIntegrationId::parse("alice:supply-chain").expect("valid integration")
    }

    fn run_id(value: u128) -> RunId {
        RunId::parse(format!("{value:08x}-0000-4000-8000-000000000001")).expect("valid run ID")
    }

    fn digest_id<T>(
        value: char,
        parse: impl FnOnce(String) -> Result<T, super::super::ids::InvalidId>,
    ) -> T {
        parse(value.to_string().repeat(64)).expect("valid digest ID")
    }

    fn blob_with_sha(key: &str, sha256: String, media_type: &str) -> BlobRef {
        BlobRef::V1(BlobRefV1 {
            key: key.to_owned(),
            sha256,
            size: 10,
            media_type: media_type.to_owned(),
            e_tag: None,
            provider_version: None,
        })
    }

    fn blob(key: &str, value: char, media_type: &str) -> BlobRef {
        blob_with_sha(key, value.to_string().repeat(64), media_type)
    }

    fn build_state(
        parent: Option<StateVersionRef>,
        phase: StatePhaseV1,
        suffix: &str,
    ) -> (StateVersionRef, StateVersion) {
        let current = StateVersionV1::new(
            parent,
            StatePhase::V1(phase),
            StateSnapshot::V1(StateSnapshotV1 {
                generation: 1,
                duckdb: blob(
                    &format!("artifacts/{suffix}.duckdb"),
                    'a',
                    "application/vnd.duckdb",
                ),
                accepted_batches: Vec::new(),
                created_at: "2026-07-21T10:00:00Z".to_owned(),
            }),
            DesiredProjectionRef {
                artifact: blob(
                    &format!("artifacts/{suffix}.desired.json"),
                    'b',
                    "application/json",
                ),
            },
            "c".repeat(64),
            1,
            1,
            1,
            1,
        )
        .expect("valid state");
        let record = StateVersion::V1(current.clone());
        let bytes = record.encode().expect("encode state");
        let sha = hex::encode(Sha256::digest(&bytes));
        let mut artifact = blob_with_sha(
            &format!("artifacts/{suffix}.state.json"),
            sha,
            "application/json",
        );
        let BlobRef::V1(artifact_value) = &mut artifact;
        artifact_value.size = u64::try_from(bytes.len()).expect("fixture size fits u64");
        let reference = StateVersionRef {
            id: current.id,
            artifact,
        };
        (reference, record)
    }

    fn manifest(kind: WorkKind, count: u64, suffix: &str) -> (WorkManifestRef, WorkManifest) {
        let current = WorkManifestV1::new(
            &integration(),
            kind,
            blob(
                &format!("artifacts/{suffix}.effects.ndjson"),
                'd',
                "application/x-ndjson",
            ),
            count,
            1,
            1,
            "2026-07-21T10:01:00Z".to_owned(),
        )
        .expect("valid manifest");
        let record = WorkManifest::V1(current.clone());
        let bytes = record.encode().expect("encode manifest");
        let sha = hex::encode(Sha256::digest(&bytes));
        let mut artifact = blob_with_sha(
            &format!("artifacts/{suffix}.manifest.json"),
            sha.clone(),
            "application/json",
        );
        let BlobRef::V1(artifact_value) = &mut artifact;
        artifact_value.size = u64::try_from(bytes.len()).expect("fixture size fits u64");
        let reference = WorkManifestRef {
            work_id: current.work_id,
            artifact,
            manifest_digest: sha,
        };
        (reference, record)
    }

    fn accepted(run_id: RunId) -> JournalEventV1 {
        JournalEventV1::RunAccepted(RunAcceptedV1 {
            run_id,
            immutable_input: InputRef {
                artifact: blob("inputs/definition.json", 'e', "application/json"),
                definition_digest: "f".repeat(64),
                definition_digest_encoding_version: 1,
                planner_version: 1,
            },
            policy: PolicyRef {
                artifact: blob("inputs/policy.json", '1', "application/json"),
                policy_digest: "2".repeat(64),
            },
            submitted_at: "2026-07-22T00:00:00Z".to_owned(),
        })
    }

    fn request(value: char, expected_revision: Option<EventId>) -> ControlRequestContextV1 {
        ControlRequestContextV1 {
            request_id: digest_id(value, RequestId::parse),
            request_digest: digest_id(
                char::from_u32(value as u32 + 1).expect("adjacent fixture character"),
                RequestDigest::parse,
            ),
            expected_revision,
        }
    }

    fn record(event: JournalEventV1) -> JournalRecordV1 {
        JournalRecordV1::new(integration(), JournalEvent::V1(event)).expect("valid journal record")
    }

    fn sequenced(sequence: u64, record: JournalRecordV1) -> SequencedJournalRecord {
        SequencedJournalRecord::try_new(sequence, JournalRecord::V1(record))
            .expect("valid sequenced record")
    }

    fn append(state: &mut Projection, sequence: u64, event: JournalEventV1) -> JournalRecordV1 {
        let record = record(event);
        assert_eq!(
            apply(state, sequenced(sequence, record.clone())).expect("valid transition"),
            ApplyOutcome::Applied
        );
        record
    }

    fn start_run(state: &mut Projection, run: &RunId) {
        append(state, 0, accepted(run.clone()));
        append(
            state,
            1,
            JournalEventV1::AttemptStarted(AttemptStartedV1 {
                run_id: run.clone(),
                attempt_id: derive_attempt_id(run, 1),
                attempt: 1,
            }),
        );
    }

    fn plan_apply(
        state: &mut Projection,
        sequence: u64,
        run: &RunId,
        parent: Option<StateVersionRef>,
        suffix: &str,
        effect_count: u64,
    ) -> (WorkManifestRef, StateVersionRef) {
        let (candidate, candidate_record) =
            build_state(parent, StatePhaseV1::LinksCommitted, suffix);
        let (manifest, manifest_record) = manifest(
            WorkKind::Apply(ApplyWorkV1 {
                run_id: run.clone(),
                candidate: candidate.clone(),
            }),
            effect_count,
            suffix,
        );
        append(
            state,
            sequence,
            JournalEventV1::WorkPlanned(WorkPlannedV1 {
                manifest: manifest.clone(),
                manifest_record,
                candidate_state_record: Some(candidate_record),
            }),
        );
        (manifest, candidate)
    }

    #[test]
    fn happy_path_projects_revisions_state_and_terminal_result() {
        let run = run_id(1);
        let mut projection = Projection::default();
        start_run(&mut projection, &run);
        let (work, candidate) = plan_apply(&mut projection, 2, &run, None, "apply", 2);
        assert_eq!(
            projection.integrations[&integration()].checkpoint_state_sequence,
            Some(2)
        );
        let cursor = append(
            &mut projection,
            3,
            JournalEventV1::WorkChunkCompleted(WorkChunkCompletedV1 {
                work_id: work.work_id.clone(),
                manifest_digest: work.manifest_digest.clone(),
                completed_effect_count: 2,
                last_effect_id: digest_id('3', EffectId::parse),
            }),
        );
        assert_eq!(projection.work[&work.work_id].revision, cursor.event_id);
        let completed = append(
            &mut projection,
            4,
            JournalEventV1::WorkCompleted(WorkCompletedV1 {
                work_id: work.work_id.clone(),
                manifest_digest: work.manifest_digest,
            }),
        );
        append(
            &mut projection,
            5,
            JournalEventV1::RunCompleted(RunCompletedV1 {
                run_id: run.clone(),
                result: blob("artifacts/result.json", '4', "application/json"),
            }),
        );
        assert_eq!(
            projection.integrations[&integration()].applied_state,
            Some(candidate)
        );
        assert_eq!(
            projection.integrations[&integration()].applied_incarnation,
            Some(completed.event_id)
        );
        assert_eq!(projection.runs[&run].status, RunStatus::Completed);
        assert_eq!(projection.work[&work.work_id].status, WorkStatus::Completed);
    }

    #[test]
    fn empty_work_completes_without_a_synthetic_cursor() {
        let run = run_id(2);
        let mut projection = Projection::default();
        start_run(&mut projection, &run);
        let (work, _) = plan_apply(&mut projection, 2, &run, None, "empty", 0);
        append(
            &mut projection,
            3,
            JournalEventV1::WorkCompleted(WorkCompletedV1 {
                work_id: work.work_id.clone(),
                manifest_digest: work.manifest_digest,
            }),
        );
        assert_eq!(projection.work[&work.work_id].status, WorkStatus::Completed);
    }

    #[test]
    fn handler_failure_is_durable_but_process_interruption_is_not_inferred() {
        let run = run_id(20);
        let mut projection = Projection::default();
        start_run(&mut projection, &run);
        append(
            &mut projection,
            2,
            JournalEventV1::AttemptFailed(AttemptFailedV1 {
                run_id: run.clone(),
                attempt_id: derive_attempt_id(&run, 1),
                attempt: 1,
                failure: FailureSummary {
                    code: "retryable".to_owned(),
                    message: "transient handler failure".to_owned(),
                    retryable: true,
                },
            }),
        );
        assert_eq!(projection.runs[&run].handler_failures, 1);
        assert_eq!(projection.runs[&run].status, RunStatus::Accepted);

        append(
            &mut projection,
            3,
            JournalEventV1::AttemptStarted(AttemptStartedV1 {
                run_id: run.clone(),
                attempt_id: derive_attempt_id(&run, 2),
                attempt: 2,
            }),
        );
        assert_eq!(projection.runs[&run].attempt, 2);
        assert_eq!(projection.runs[&run].handler_failures, 1);
    }

    #[test]
    fn duplicate_is_noop_and_sequence_still_advances() {
        let candidate = record(accepted(run_id(3)));
        let mut projection = Projection::default();
        assert_eq!(
            apply(&mut projection, sequenced(10, candidate.clone())).expect("first apply"),
            ApplyOutcome::Applied
        );
        let before = projection.clone();
        assert_eq!(
            apply(&mut projection, sequenced(11, candidate)).expect("duplicate apply"),
            ApplyOutcome::Duplicate
        );
        assert_eq!(projection.runs, before.runs);
        assert_eq!(projection.integrations, before.integrations);
        assert_eq!(projection.through_log_sequence, Some(11));
    }

    #[test]
    fn duplicate_checkpoint_advances_watermark_without_rewriting_state_provenance() {
        let run = run_id(31);
        let mut projection = Projection::default();
        start_run(&mut projection, &run);
        let (state, state_record) =
            build_state(None, StatePhaseV1::SourcesCommitted, "duplicate-state");
        let checkpoint = record(JournalEventV1::StateCheckpointCommitted(
            StateCheckpointCommittedV1 {
                run_id: run,
                state_version: state,
                state_record,
            },
        ));
        assert_eq!(
            apply(&mut projection, sequenced(2, checkpoint.clone())).expect("commit checkpoint"),
            ApplyOutcome::Applied
        );
        assert_eq!(
            apply(&mut projection, sequenced(3, checkpoint)).expect("adopt duplicate"),
            ApplyOutcome::Duplicate
        );
        let integration = &projection.integrations[&integration()];
        assert_eq!(integration.checkpoint_state_sequence, Some(2));
        assert_eq!(projection.through_log_sequence, Some(3));
    }

    #[test]
    fn conflicting_event_identity_and_invalid_order_poison_durable_history() {
        let candidate = record(accepted(run_id(4)));
        let mut conflict = Projection::default();
        conflict.seen_event_digests.insert(
            candidate.event_id.clone(),
            JournalRecordDigest::parse("9".repeat(64)).expect("valid alternate digest"),
        );
        assert!(prepare(&conflict, &candidate).is_err());

        let run = run_id(5);
        let mut invalid_order = Projection::default();
        append(&mut invalid_order, 0, accepted(run.clone()));
        let invalid = record(JournalEventV1::RunCompleted(RunCompletedV1 {
            run_id: run.clone(),
            result: blob("artifacts/result.json", '4', "application/json"),
        }));
        let error = apply(&mut invalid_order, sequenced(1, invalid.clone()))
            .expect_err("accepted run cannot complete before starting");
        assert_eq!(error.event_id, invalid.event_id);
        assert!(invalid_order.poisoned.is_some());
        assert!(prepare(&invalid_order, &record(accepted(run_id(6)))).is_err());
    }

    #[test]
    fn snapshot_plus_suffix_matches_full_replay() {
        let run = run_id(7);
        let accepted = record(accepted(run.clone()));
        let started = record(JournalEventV1::AttemptStarted(AttemptStartedV1 {
            run_id: run.clone(),
            attempt_id: derive_attempt_id(&run, 1),
            attempt: 1,
        }));
        let (candidate, candidate_record) =
            build_state(None, StatePhaseV1::LinksCommitted, "snapshot");
        let (manifest, manifest_record) = manifest(
            WorkKind::Apply(ApplyWorkV1 {
                run_id: run.clone(),
                candidate,
            }),
            0,
            "snapshot",
        );
        let planned = record(JournalEventV1::WorkPlanned(WorkPlannedV1 {
            manifest: manifest.clone(),
            manifest_record,
            candidate_state_record: Some(candidate_record),
        }));
        let completed = record(JournalEventV1::WorkCompleted(WorkCompletedV1 {
            work_id: manifest.work_id,
            manifest_digest: manifest.manifest_digest,
        }));
        let records = [accepted, started, planned, completed];

        let mut full = Projection::default();
        for (sequence, record) in records.iter().cloned().enumerate() {
            apply(&mut full, sequenced(sequence as u64, record)).expect("full replay");
        }
        let mut snapshot = Projection::default();
        for (sequence, record) in records[..2].iter().cloned().enumerate() {
            apply(&mut snapshot, sequenced(sequence as u64, record)).expect("snapshot prefix");
        }
        let mut restored = snapshot.clone();
        for (sequence, record) in records[2..].iter().cloned().enumerate() {
            apply(&mut restored, sequenced((sequence + 2) as u64, record)).expect("suffix");
        }
        assert_eq!(restored, full);
    }

    #[test]
    fn terminal_run_and_work_states_are_monotonic() {
        let run = run_id(71);
        let mut projection = Projection::default();
        start_run(&mut projection, &run);
        let (work, _) = plan_apply(&mut projection, 2, &run, None, "terminal", 0);
        let work_completed = append(
            &mut projection,
            3,
            JournalEventV1::WorkCompleted(WorkCompletedV1 {
                work_id: work.work_id.clone(),
                manifest_digest: work.manifest_digest.clone(),
            }),
        );
        append(
            &mut projection,
            4,
            JournalEventV1::RunCompleted(RunCompletedV1 {
                run_id: run.clone(),
                result: blob("result", '4', "application/json"),
            }),
        );

        let (checkpoint, checkpoint_record) = build_state(
            projection.integrations[&integration()]
                .checkpoint_state
                .clone(),
            StatePhaseV1::LinksCommitted,
            "after-terminal",
        );
        let invalid_run_events = [
            JournalEventV1::AttemptStarted(AttemptStartedV1 {
                run_id: run.clone(),
                attempt_id: derive_attempt_id(&run, 2),
                attempt: 2,
            }),
            JournalEventV1::ArtifactPublished(ArtifactPublishedV1 {
                run_id: run.clone(),
                role: ArtifactRole::QualityEvidence("late".to_owned()),
                reference: blob("evidence", '5', "application/json"),
            }),
            JournalEventV1::StateCheckpointCommitted(StateCheckpointCommittedV1 {
                run_id: run.clone(),
                state_version: checkpoint,
                state_record: checkpoint_record,
            }),
            JournalEventV1::StepCommitted(StepCommittedV1 {
                run_id: run.clone(),
                name: "late".to_owned(),
                checkpoint: blob("late", '6', "application/json"),
            }),
            JournalEventV1::RunTerminated(RunTerminatedV1 {
                run_id: run,
                outcome: TerminalOutcome::Cancelled,
                failed_work: None,
                failure: None,
                request: None,
            }),
        ];
        for event in invalid_run_events {
            assert!(prepare(&projection, &record(event)).is_err());
        }
        for event in [
            JournalEventV1::WorkChunkCompleted(WorkChunkCompletedV1 {
                work_id: work.work_id.clone(),
                manifest_digest: work.manifest_digest.clone(),
                completed_effect_count: 1,
                last_effect_id: digest_id('7', EffectId::parse),
            }),
            JournalEventV1::WorkBlocked(WorkBlockedV1 {
                work_id: work.work_id.clone(),
                manifest_digest: work.manifest_digest.clone(),
                failure: FailureSummary {
                    code: "late".to_owned(),
                    message: "late".to_owned(),
                    retryable: true,
                },
            }),
        ] {
            assert!(prepare(&projection, &record(event)).is_err());
        }
        assert_eq!(
            prepare(&projection, &work_completed).expect("terminal duplicate is legal"),
            PreparedTransition::Noop
        );
    }

    #[test]
    fn failed_apply_requires_exact_work_and_restore_retries_from_cursor() {
        let run = run_id(8);
        let mut projection = Projection::default();
        start_run(&mut projection, &run);
        let (apply_work, contaminated) =
            plan_apply(&mut projection, 2, &run, None, "failed-apply", 2);
        assert_eq!(
            projection.integrations[&integration()].checkpoint_state_sequence,
            Some(2)
        );
        let failure = FailureSummary {
            code: "graph_rejected".to_owned(),
            message: "permanent Graph rejection".to_owned(),
            retryable: false,
        };
        let terminated = append(
            &mut projection,
            3,
            JournalEventV1::RunTerminated(RunTerminatedV1 {
                run_id: run.clone(),
                outcome: TerminalOutcome::Failed,
                failed_work: Some(apply_work.work_id.clone()),
                failure: Some(failure),
                request: None,
            }),
        );
        let integration_projection = &projection.integrations[&integration()];
        assert_eq!(
            integration_projection.maintenance,
            MaintenanceStatus::RestoreRequired
        );
        assert_eq!(
            integration_projection.dlq[&dlq_entry_id(&terminated.event_id)].entered_at_sequence,
            3
        );

        let (restore, restore_record) = manifest(
            WorkKind::Restore(RestoreWorkV1 {
                failed_run_id: run,
                failed_work_id: apply_work.work_id,
                target: None,
                contaminated,
            }),
            1,
            "restore",
        );
        append(
            &mut projection,
            4,
            JournalEventV1::WorkPlanned(WorkPlannedV1 {
                manifest: restore.clone(),
                manifest_record: restore_record,
                candidate_state_record: None,
            }),
        );
        let blocked = append(
            &mut projection,
            5,
            JournalEventV1::WorkBlocked(WorkBlockedV1 {
                work_id: restore.work_id.clone(),
                manifest_digest: restore.manifest_digest.clone(),
                failure: FailureSummary {
                    code: "temporarily_unavailable".to_owned(),
                    message: "Graph is unavailable".to_owned(),
                    retryable: true,
                },
            }),
        );
        let request = ControlRequestContextV1 {
            request_id: digest_id('5', RequestId::parse),
            request_digest: digest_id('6', RequestDigest::parse),
            expected_revision: Some(blocked.event_id),
        };
        append(
            &mut projection,
            6,
            JournalEventV1::RetryRequested(super::super::events::RetryRequestedV1 {
                work_id: restore.work_id.clone(),
                settings_revision: 2,
                request: request.clone(),
            }),
        );
        assert_eq!(projection.work[&restore.work_id].settings_revision, Some(2));
        let mut conflicting_outcome = projection.clone();
        let rejection = record(JournalEventV1::ControlRequestRejected(
            ControlRequestRejectedV1 {
                request,
                target: ControlRequestTargetV1::Work(restore.work_id.clone()),
                reason_code: ControlRejectionReason::StaleRevision,
                observed_revision: Some(projection.work[&restore.work_id].revision.clone()),
            },
        ));
        assert!(apply(&mut conflicting_outcome, sequenced(7, rejection)).is_err());
        assert!(conflicting_outcome.poisoned.is_some());
        append(
            &mut projection,
            7,
            JournalEventV1::WorkChunkCompleted(WorkChunkCompletedV1 {
                work_id: restore.work_id.clone(),
                manifest_digest: restore.manifest_digest.clone(),
                completed_effect_count: 1,
                last_effect_id: digest_id('7', EffectId::parse),
            }),
        );
        append(
            &mut projection,
            8,
            JournalEventV1::WorkCompleted(WorkCompletedV1 {
                work_id: restore.work_id,
                manifest_digest: restore.manifest_digest,
            }),
        );
        let integration_projection = &projection.integrations[&integration()];
        assert_eq!(
            integration_projection.maintenance,
            MaintenanceStatus::Healthy
        );
        assert!(integration_projection.restore_evidence.is_none());
        assert_eq!(integration_projection.checkpoint_state, None);
        assert_eq!(integration_projection.checkpoint_state_sequence, Some(8));
    }

    #[test]
    fn prepared_delta_scales_with_touched_entities_not_projection_size() {
        let candidate = record(accepted(run_id(9)));
        let mut projection = Projection::default();
        for value in 10..1010 {
            let integration = CanonicalIntegrationId::parse(format!("tenant:integration-{value}"))
                .expect("valid integration");
            projection
                .integrations
                .insert(integration, IntegrationProjection::default());
            projection.runs.insert(
                run_id(value),
                RunProjection {
                    integration_id: CanonicalIntegrationId::parse(format!("tenant:run-{value}"))
                        .expect("valid integration"),
                    status: RunStatus::Completed,
                    attempt: 1,
                    handler_failures: 0,
                    attempt_id: None,
                    immutable_input: match accepted(run_id(value)) {
                        JournalEventV1::RunAccepted(value) => value.immutable_input,
                        _ => unreachable!(),
                    },
                    policy: match accepted(run_id(value)) {
                        JournalEventV1::RunAccepted(value) => value.policy,
                        _ => unreachable!(),
                    },
                    submitted_at: "2026-07-22T00:00:00Z".to_owned(),
                    artifacts: BTreeMap::new(),
                    steps: BTreeMap::new(),
                    result: None,
                    outcome: None,
                    failure: None,
                    revision: digest_id('8', EventId::parse),
                },
            );
        }
        let PreparedTransition::Mutation(delta) =
            prepare(&projection, &candidate).expect("valid candidate")
        else {
            panic!("new run mutates projection");
        };
        assert_eq!(delta.integrations.len(), 1);
        assert_eq!(delta.runs.len(), 1);
        assert!(delta.work.is_empty());
    }

    #[test]
    fn state_evidence_cannot_disagree_with_its_content_address() {
        let run = run_id(1011);
        let mut projection = Projection::default();
        start_run(&mut projection, &run);
        let (candidate, candidate_record) =
            build_state(None, StatePhaseV1::LinksCommitted, "forged");
        let (manifest, manifest_record) = manifest(
            WorkKind::Apply(ApplyWorkV1 {
                run_id: run,
                candidate,
            }),
            0,
            "forged",
        );
        let mut wrong_state = candidate_record;
        let StateVersion::V1(state) = &mut wrong_state;
        state.id = StateVersionId::parse("a".repeat(64)).expect("typed wrong state ID");
        assert!(JournalRecordV1::new(
            integration(),
            JournalEvent::V1(JournalEventV1::WorkPlanned(WorkPlannedV1 {
                manifest,
                manifest_record,
                candidate_state_record: Some(wrong_state),
            })),
        )
        .is_err());
    }

    #[test]
    fn desired_state_holds_then_promotes_the_single_queued_run() {
        let run = run_id(1012);
        let mut projection = Projection::default();
        let disabled = append(
            &mut projection,
            0,
            JournalEventV1::IntegrationDesiredStateSet(IntegrationDesiredStateSetV1 {
                integration_id: integration(),
                desired: IntegrationDesiredState::Disabled,
                definition_ref: blob("definitions/integration.json", 'a', "application/json"),
                actor: "actor:alice".to_owned(),
                request: request('1', None),
            }),
        );
        append(&mut projection, 1, accepted(run.clone()));
        let held = &projection.integrations[&integration()];
        assert_eq!(held.active_run, None);
        assert_eq!(held.queued_run.as_ref(), Some(&run));

        append(
            &mut projection,
            2,
            JournalEventV1::IntegrationDesiredStateSet(IntegrationDesiredStateSetV1 {
                integration_id: integration(),
                desired: IntegrationDesiredState::Enabled,
                definition_ref: blob("definitions/integration.json", 'a', "application/json"),
                actor: "actor:alice".to_owned(),
                request: request('3', Some(disabled.event_id)),
            }),
        );
        let promoted = &projection.integrations[&integration()];
        assert_eq!(promoted.active_run.as_ref(), Some(&run));
        assert_eq!(promoted.queued_run, None);
        assert_eq!(projection.control_request_outcomes.len(), 2);
        assert_eq!(
            promoted
                .desired_definition
                .as_ref()
                .map(|reference| reference.current().key.as_str()),
            Some("definitions/integration.json")
        );
    }

    #[test]
    fn stale_desired_request_can_observe_the_explicit_initial_revision() {
        let expected = digest_id('a', EventId::parse);
        let rejected = record(JournalEventV1::ControlRequestRejected(
            ControlRequestRejectedV1 {
                request: request('1', Some(expected)),
                target: ControlRequestTargetV1::DesiredState(integration()),
                reason_code: ControlRejectionReason::StaleRevision,
                observed_revision: None,
            },
        ));
        let mut projection = Projection::default();
        apply(&mut projection, sequenced(0, rejected)).expect("initial stale rejection is valid");
        assert_eq!(projection.control_request_outcomes.len(), 1);
    }

    #[test]
    fn checkpoint_artifact_and_cursor_conflicts_do_not_mutate_candidate_state() {
        let run = run_id(1013);
        let mut projection = Projection::default();
        start_run(&mut projection, &run);
        append(
            &mut projection,
            2,
            JournalEventV1::ArtifactPublished(ArtifactPublishedV1 {
                run_id: run.clone(),
                role: ArtifactRole::BronzeCapture("orders".to_owned()),
                reference: blob("artifacts/bronze.parquet", 'a', "application/x-parquet"),
            }),
        );
        let artifact_conflict = record(JournalEventV1::ArtifactPublished(ArtifactPublishedV1 {
            run_id: run.clone(),
            role: ArtifactRole::BronzeCapture("orders".to_owned()),
            reference: blob("artifacts/other.parquet", 'b', "application/x-parquet"),
        }));
        assert!(prepare(&projection, &artifact_conflict).is_err());
        assert_eq!(projection.runs[&run].artifacts.len(), 1);

        let (checkpoint, checkpoint_record) =
            build_state(None, StatePhaseV1::SourcesCommitted, "checkpoint-a");
        append(
            &mut projection,
            3,
            JournalEventV1::StateCheckpointCommitted(StateCheckpointCommittedV1 {
                run_id: run.clone(),
                state_version: checkpoint.clone(),
                state_record: checkpoint_record,
            }),
        );
        assert_eq!(
            projection.integrations[&integration()].checkpoint_state_sequence,
            Some(3)
        );
        let (non_chaining, non_chaining_record) =
            build_state(None, StatePhaseV1::SourcesCommitted, "checkpoint-b");
        let invalid_checkpoint = record(JournalEventV1::StateCheckpointCommitted(
            StateCheckpointCommittedV1 {
                run_id: run.clone(),
                state_version: non_chaining,
                state_record: non_chaining_record,
            },
        ));
        assert!(prepare(&projection, &invalid_checkpoint).is_err());
        assert_eq!(
            projection.integrations[&integration()].checkpoint_state,
            Some(checkpoint.clone())
        );

        let (work, _) = plan_apply(&mut projection, 4, &run, Some(checkpoint), "cursor", 3);
        append(
            &mut projection,
            5,
            JournalEventV1::WorkChunkCompleted(WorkChunkCompletedV1 {
                work_id: work.work_id.clone(),
                manifest_digest: work.manifest_digest.clone(),
                completed_effect_count: 2,
                last_effect_id: digest_id('5', EffectId::parse),
            }),
        );
        let regression = record(JournalEventV1::WorkChunkCompleted(WorkChunkCompletedV1 {
            work_id: work.work_id.clone(),
            manifest_digest: work.manifest_digest.clone(),
            completed_effect_count: 1,
            last_effect_id: digest_id('6', EffectId::parse),
        }));
        let early_completion = record(JournalEventV1::WorkCompleted(WorkCompletedV1 {
            work_id: work.work_id.clone(),
            manifest_digest: work.manifest_digest,
        }));
        assert!(prepare(&projection, &regression).is_err());
        assert!(prepare(&projection, &early_completion).is_err());
        assert_eq!(projection.work[&work.work_id].completed_effect_count, 2);
        assert_eq!(projection.integrations[&integration()].applied_state, None);
    }

    #[test]
    fn a_new_apply_incarnation_supersedes_live_reconciliation() {
        let run = run_id(1014);
        let mut projection = Projection::default();
        start_run(&mut projection, &run);
        let (first_apply, first_state) = plan_apply(&mut projection, 2, &run, None, "first", 0);
        let first_completion = append(
            &mut projection,
            3,
            JournalEventV1::WorkCompleted(WorkCompletedV1 {
                work_id: first_apply.work_id,
                manifest_digest: first_apply.manifest_digest,
            }),
        );
        let (reconcile, reconcile_record) = manifest(
            WorkKind::Reconcile(ReconcileWorkV1 {
                target: first_state.clone(),
                applied_incarnation: Some(first_completion.event_id),
                cycle: 1,
            }),
            2,
            "reconcile",
        );
        append(
            &mut projection,
            4,
            JournalEventV1::WorkPlanned(WorkPlannedV1 {
                manifest: reconcile.clone(),
                manifest_record: reconcile_record,
                candidate_state_record: None,
            }),
        );
        let (second_apply, _) =
            plan_apply(&mut projection, 5, &run, Some(first_state), "second", 0);
        append(
            &mut projection,
            6,
            JournalEventV1::WorkCompleted(WorkCompletedV1 {
                work_id: second_apply.work_id,
                manifest_digest: second_apply.manifest_digest,
            }),
        );
        assert_eq!(
            projection.work[&reconcile.work_id].status,
            WorkStatus::Superseded
        );
    }

    #[test]
    fn empty_projection_transition_table_covers_every_event_variant() {
        let run = run_id(1015);
        let (state_ref, state_record) = build_state(None, StatePhaseV1::SourcesCommitted, "table");
        let (work_ref, work_record) = manifest(
            WorkKind::Apply(ApplyWorkV1 {
                run_id: run.clone(),
                candidate: state_ref.clone(),
            }),
            1,
            "table",
        );
        let work_id = work_ref.work_id.clone();
        let work_digest = work_ref.manifest_digest.clone();
        let missing_revision = digest_id('a', EventId::parse);
        let failure = FailureSummary {
            code: "failure".to_owned(),
            message: "failure".to_owned(),
            retryable: false,
        };
        let events = vec![
            ("run_accepted", accepted(run.clone()), true),
            (
                "attempt_started",
                JournalEventV1::AttemptStarted(AttemptStartedV1 {
                    run_id: run.clone(),
                    attempt_id: derive_attempt_id(&run, 1),
                    attempt: 1,
                }),
                false,
            ),
            (
                "attempt_failed",
                JournalEventV1::AttemptFailed(AttemptFailedV1 {
                    run_id: run.clone(),
                    attempt_id: derive_attempt_id(&run, 1),
                    attempt: 1,
                    failure: FailureSummary {
                        code: "retryable".to_owned(),
                        message: "retryable".to_owned(),
                        retryable: true,
                    },
                }),
                false,
            ),
            (
                "artifact_published",
                JournalEventV1::ArtifactPublished(ArtifactPublishedV1 {
                    run_id: run.clone(),
                    role: ArtifactRole::QualityEvidence("fixture".to_owned()),
                    reference: blob("artifact", '1', "application/json"),
                }),
                false,
            ),
            (
                "stream_batch_accepted",
                JournalEventV1::StreamBatchAccepted(StreamBatchAcceptedV1 {
                    run_id: run.clone(),
                    source: "source".to_owned(),
                    batch_id: "batch".to_owned(),
                    reference: blob("batch", '2', "application/octet-stream"),
                }),
                false,
            ),
            (
                "state_checkpoint_committed",
                JournalEventV1::StateCheckpointCommitted(StateCheckpointCommittedV1 {
                    run_id: run.clone(),
                    state_version: state_ref.clone(),
                    state_record: state_record.clone(),
                }),
                false,
            ),
            (
                "step_committed",
                JournalEventV1::StepCommitted(StepCommittedV1 {
                    run_id: run.clone(),
                    name: "step".to_owned(),
                    checkpoint: blob("checkpoint", '3', "application/json"),
                }),
                false,
            ),
            (
                "integration_desired_state_set",
                JournalEventV1::IntegrationDesiredStateSet(IntegrationDesiredStateSetV1 {
                    integration_id: integration(),
                    desired: IntegrationDesiredState::Enabled,
                    definition_ref: blob("definition", '4', "application/json"),
                    actor: "actor".to_owned(),
                    request: request('b', None),
                }),
                true,
            ),
            (
                "work_planned",
                JournalEventV1::WorkPlanned(WorkPlannedV1 {
                    manifest: work_ref,
                    manifest_record: work_record,
                    candidate_state_record: Some(state_record),
                }),
                false,
            ),
            (
                "work_chunk_completed",
                JournalEventV1::WorkChunkCompleted(WorkChunkCompletedV1 {
                    work_id: work_id.clone(),
                    manifest_digest: work_digest.clone(),
                    completed_effect_count: 1,
                    last_effect_id: digest_id('c', EffectId::parse),
                }),
                false,
            ),
            (
                "work_completed",
                JournalEventV1::WorkCompleted(WorkCompletedV1 {
                    work_id: work_id.clone(),
                    manifest_digest: work_digest.clone(),
                }),
                false,
            ),
            (
                "work_blocked",
                JournalEventV1::WorkBlocked(WorkBlockedV1 {
                    work_id: work_id.clone(),
                    manifest_digest: work_digest,
                    failure: failure.clone(),
                }),
                false,
            ),
            (
                "retry_requested",
                JournalEventV1::RetryRequested(super::super::events::RetryRequestedV1 {
                    work_id: work_id.clone(),
                    settings_revision: 1,
                    request: request('d', Some(missing_revision.clone())),
                }),
                false,
            ),
            (
                "run_completed",
                JournalEventV1::RunCompleted(RunCompletedV1 {
                    run_id: run.clone(),
                    result: blob("result", '5', "application/json"),
                }),
                false,
            ),
            (
                "run_terminated",
                JournalEventV1::RunTerminated(RunTerminatedV1 {
                    run_id: run.clone(),
                    outcome: TerminalOutcome::Cancelled,
                    failed_work: None,
                    failure: None,
                    request: None,
                }),
                false,
            ),
            (
                "control_request_rejected",
                JournalEventV1::ControlRequestRejected(ControlRequestRejectedV1 {
                    request: request('8', Some(missing_revision)),
                    target: ControlRequestTargetV1::Run(run),
                    reason_code: ControlRejectionReason::NotFound,
                    observed_revision: None,
                }),
                true,
            ),
            (
                "dlq_entry_expired",
                JournalEventV1::DlqEntryExpired(DlqEntryExpiredV1 {
                    entry_id: digest_id('e', DlqEntryId::parse),
                    policy_revision: 1,
                    expired_at: "2026-07-21T10:00:00Z".to_owned(),
                }),
                false,
            ),
        ];
        assert_eq!(
            events.len(),
            17,
            "new event variants must extend this table"
        );
        for (name, event, expected_valid) in events {
            let result = prepare(&Projection::default(), &record(event));
            assert_eq!(
                result.is_ok(),
                expected_valid,
                "empty-state outcome for {name}"
            );
        }
    }
}
