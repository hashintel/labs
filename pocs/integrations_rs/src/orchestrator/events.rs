//! Authoritative v1 journal vocabulary and sequenced envelope.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest as _, Sha256};

use super::control::{ControlRequestContextV1, ControlRequestTargetV1, IntegrationDesiredState};
use super::ids::{
    canonical_digest, derive_attempt_id, AttemptId, CanonicalIntegrationId, DlqEntryId, EffectId,
    EventId, JournalRecordDigest, RequestId, RunId, WorkId,
};
use super::registry::{
    reject_unknown_fields, AlgorithmVersion, CompatError, DurabilityClass, DurableRecord,
    MigrationPolicy, RecordFamily, UntrimmedJournalRecord, VersionedRecord,
};
use super::work::{StateVersion, StateVersionRef, WorkKind, WorkManifest};
use crate::blob::BlobRef;

const MAX_JOURNAL_RECORD_BYTES: usize = 1024 * 1024;
const MAX_NAME_BYTES: usize = 1024;

pub(crate) static JOURNAL_RECORD_FAMILY: RecordFamily = RecordFamily {
    name: "journal_record",
    owning_module: "orchestrator::events",
    emitted_version: 1,
    supported_versions: &[1],
    algorithm_versions: &[
        AlgorithmVersion {
            name: "control_outcome_event_identity",
            version: 1,
        },
        AlgorithmVersion {
            name: "dlq_entry_identity",
            version: 1,
        },
        AlgorithmVersion {
            name: "event_identity",
            version: 1,
        },
        AlgorithmVersion {
            name: "journal_record_digest",
            version: 1,
        },
    ],
    durability: DurabilityClass::ImmutableJournal,
    migration: MigrationPolicy::NeverRetireWhileUntrimmed,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub enum JournalRecord {
    V1(JournalRecordV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JournalRecordV1 {
    pub event_id: EventId,
    pub integration_id: CanonicalIntegrationId,
    pub event: JournalEvent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub enum JournalEvent {
    V1(JournalEventV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum JournalEventV1 {
    RunAccepted(RunAcceptedV1),
    AttemptStarted(AttemptStartedV1),
    AttemptFailed(AttemptFailedV1),
    ArtifactPublished(ArtifactPublishedV1),
    StreamBatchAccepted(StreamBatchAcceptedV1),
    StateCheckpointCommitted(StateCheckpointCommittedV1),
    StepCommitted(StepCommittedV1),
    IntegrationDesiredStateSet(IntegrationDesiredStateSetV1),
    WorkPlanned(WorkPlannedV1),
    WorkChunkCompleted(WorkChunkCompletedV1),
    WorkCompleted(WorkCompletedV1),
    WorkBlocked(WorkBlockedV1),
    RetryRequested(RetryRequestedV1),
    RunCompleted(RunCompletedV1),
    RunTerminated(RunTerminatedV1),
    ControlRequestRejected(ControlRequestRejectedV1),
    DlqEntryExpired(DlqEntryExpiredV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InputRef {
    pub artifact: BlobRef,
    pub definition_digest: String,
    pub definition_digest_encoding_version: u32,
    pub planner_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyRef {
    pub artifact: BlobRef,
    pub policy_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkManifestRef {
    pub work_id: WorkId,
    pub artifact: BlobRef,
    pub manifest_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FailureSummary {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "kind", content = "name", rename_all = "snake_case")]
pub enum ArtifactRole {
    BronzeCapture(String),
    QualityEvidence(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminalOutcome {
    Failed,
    Cancelled,
    AbandonedByOperator,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ControlRejectionReason {
    StaleRevision,
    NotFound,
    Unauthorized,
    Conflict,
    Malformed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunAcceptedV1 {
    pub run_id: RunId,
    pub immutable_input: InputRef,
    pub policy: PolicyRef,
    /// Durable semantic time for planning provenance. Workers never substitute
    /// their local clock when rebuilding an unplanned accepted run.
    pub submitted_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttemptStartedV1 {
    pub run_id: RunId,
    pub attempt_id: AttemptId,
    pub attempt: u64,
}

/// A handler-reported retryable business failure. Process interruption emits
/// no such record, which keeps delivery attempts distinct from retry-budget
/// consumption across crashes and replay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttemptFailedV1 {
    pub run_id: RunId,
    pub attempt_id: AttemptId,
    pub attempt: u64,
    pub failure: FailureSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactPublishedV1 {
    pub run_id: RunId,
    pub role: ArtifactRole,
    pub reference: BlobRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StreamBatchAcceptedV1 {
    pub run_id: RunId,
    pub source: String,
    pub batch_id: String,
    pub reference: BlobRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StateCheckpointCommittedV1 {
    pub run_id: RunId,
    pub state_version: StateVersionRef,
    /// Self-contained replay evidence for `state_version`. The blob remains the
    /// durable data artifact, but the projector must never perform I/O.
    pub state_record: StateVersion,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StepCommittedV1 {
    pub run_id: RunId,
    pub name: String,
    pub checkpoint: BlobRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntegrationDesiredStateSetV1 {
    pub integration_id: CanonicalIntegrationId,
    pub desired: IntegrationDesiredState,
    pub definition_ref: BlobRef,
    pub actor: String,
    pub request: ControlRequestContextV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkPlannedV1 {
    pub manifest: WorkManifestRef,
    /// Self-contained replay evidence for `manifest`.
    pub manifest_record: WorkManifest,
    /// Present exactly for Apply work, whose candidate first becomes
    /// authoritative in this event.
    pub candidate_state_record: Option<StateVersion>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkChunkCompletedV1 {
    pub work_id: WorkId,
    pub manifest_digest: String,
    /// Length of the acknowledged contiguous effect prefix.
    pub completed_effect_count: u64,
    pub last_effect_id: EffectId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkCompletedV1 {
    pub work_id: WorkId,
    pub manifest_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkBlockedV1 {
    pub work_id: WorkId,
    pub manifest_digest: String,
    pub failure: FailureSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RetryRequestedV1 {
    pub work_id: WorkId,
    pub settings_revision: u64,
    pub request: ControlRequestContextV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunCompletedV1 {
    pub run_id: RunId,
    pub result: BlobRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunTerminatedV1 {
    pub run_id: RunId,
    pub outcome: TerminalOutcome,
    pub failed_work: Option<WorkId>,
    pub failure: Option<FailureSummary>,
    pub request: Option<ControlRequestContextV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlRequestRejectedV1 {
    pub request: ControlRequestContextV1,
    pub target: ControlRequestTargetV1,
    pub reason_code: ControlRejectionReason,
    pub observed_revision: Option<EventId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DlqEntryExpiredV1 {
    pub entry_id: DlqEntryId,
    pub policy_revision: u64,
    pub expired_at: String,
}

impl JournalRecordV1 {
    pub fn new(
        integration_id: CanonicalIntegrationId,
        event: JournalEvent,
    ) -> Result<Self, CompatError> {
        validate_event(&integration_id, &event)?;
        let event_id = derive_event_id(&integration_id, &event)?;
        Ok(Self {
            event_id,
            integration_id,
            event,
        })
    }

    pub fn verify(&self) -> Result<(), CompatError> {
        validate_event(&self.integration_id, &self.event)?;
        let expected = derive_event_id(&self.integration_id, &self.event)?;
        if self.event_id == expected {
            Ok(())
        } else {
            Err(CompatError::Conflict {
                family: JournalRecord::FAMILY.name,
                message: format!(
                    "event ID mismatch: expected {expected}, found {}",
                    self.event_id
                ),
            })
        }
    }

    pub fn digest(&self) -> Result<JournalRecordDigest, CompatError> {
        let projection = json!({
            "event_id": self.event_id,
            "integration_id": self.integration_id,
            "event": event_identity_projection(&self.event),
        });
        canonical_digest("journal-record:v1", &projection)
            .map(JournalRecordDigest::from_digest)
            .map_err(|error| malformed(error.to_string()))
    }
}

impl JournalRecord {
    pub fn into_current(self) -> Result<JournalRecordV1, CompatError> {
        let Self::V1(record) = self;
        record.verify()?;
        Ok(record)
    }

    pub fn try_current(&self) -> Result<&JournalRecordV1, CompatError> {
        let record = self.wire();
        record.verify()?;
        Ok(record)
    }

    fn wire(&self) -> &JournalRecordV1 {
        match self {
            Self::V1(record) => record,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SequencedJournalRecord {
    shard_sequence: u64,
    record: JournalRecordV1,
}

impl SequencedJournalRecord {
    pub fn try_new(shard_sequence: u64, record: JournalRecord) -> Result<Self, CompatError> {
        Ok(Self {
            shard_sequence,
            record: record.into_current()?,
        })
    }

    pub fn shard_sequence(&self) -> u64 {
        self.shard_sequence
    }

    pub fn record(&self) -> &JournalRecordV1 {
        &self.record
    }
}

pub fn control_outcome_event_id(request_id: &RequestId) -> EventId {
    let digest = canonical_digest("control-outcome-event:v1", request_id)
        .expect("serializing a typed request ID cannot fail");
    EventId::from_digest(digest)
}

pub fn dlq_entry_id(termination_event_id: &EventId) -> DlqEntryId {
    let digest = canonical_digest("dlq-entry:v1", termination_event_id)
        .expect("serializing a typed event ID cannot fail");
    DlqEntryId::from_digest(digest)
}

pub fn immutable_input_digest(input: &InputRef) -> Result<String, CompatError> {
    validate_input(input)?;
    canonical_digest("immutable-input:v1", &input_value(input))
        .map_err(|error| malformed(error.to_string()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventReuse {
    IdenticalDuplicate,
    ConflictingReuse,
}

pub fn classify_event_reuse(
    seen: &JournalRecordDigest,
    candidate: &JournalRecordV1,
) -> Result<EventReuse, CompatError> {
    if *seen == candidate.digest()? {
        Ok(EventReuse::IdenticalDuplicate)
    } else {
        Ok(EventReuse::ConflictingReuse)
    }
}

fn derive_event_id(
    integration_id: &CanonicalIntegrationId,
    event: &JournalEvent,
) -> Result<EventId, CompatError> {
    if let Some(request_id) = control_request_id(event) {
        return Ok(control_outcome_event_id(request_id));
    }
    let projection = json!({
        "integration_id": integration_id,
        "event": event_identity_projection(event),
    });
    canonical_digest("journal-event:v1", &projection)
        .map(EventId::from_digest)
        .map_err(|error| malformed(error.to_string()))
}

fn control_request_id(event: &JournalEvent) -> Option<&RequestId> {
    let JournalEvent::V1(event) = event;
    match event {
        JournalEventV1::IntegrationDesiredStateSet(value) => Some(&value.request.request_id),
        JournalEventV1::RetryRequested(value) => Some(&value.request.request_id),
        JournalEventV1::RunTerminated(value) => {
            value.request.as_ref().map(|request| &request.request_id)
        }
        JournalEventV1::ControlRequestRejected(value) => Some(&value.request.request_id),
        _ => None,
    }
}

fn validate_event(
    integration_id: &CanonicalIntegrationId,
    event: &JournalEvent,
) -> Result<(), CompatError> {
    let JournalEvent::V1(event) = event;
    match event {
        JournalEventV1::RunAccepted(value) => {
            validate_input(&value.immutable_input)?;
            validate_policy(&value.policy)?;
            chrono::DateTime::parse_from_rfc3339(&value.submitted_at)
                .map_err(|error| malformed(format!("submitted_at must be RFC 3339: {error}")))?;
        }
        JournalEventV1::AttemptStarted(value) => {
            if value.attempt == 0 {
                return Err(malformed("attempt must be nonzero".to_owned()));
            }
            let expected = derive_attempt_id(&value.run_id, value.attempt);
            if value.attempt_id != expected {
                return Err(conflict(format!(
                    "attempt ID mismatch: expected {expected}, found {}",
                    value.attempt_id
                )));
            }
        }
        JournalEventV1::AttemptFailed(value) => {
            let expected = derive_attempt_id(&value.run_id, value.attempt);
            if value.attempt_id != expected {
                return Err(conflict(format!(
                    "attempt ID mismatch: expected {expected}, found {}",
                    value.attempt_id
                )));
            }
            validate_failure(&value.failure)?;
            if !value.failure.retryable {
                return Err(malformed(
                    "AttemptFailed requires a retryable failure; permanent failures terminate the run"
                        .to_owned(),
                ));
            }
        }
        JournalEventV1::ArtifactPublished(value) => {
            match &value.role {
                ArtifactRole::BronzeCapture(source) => validate_name("bronze source", source)?,
                ArtifactRole::QualityEvidence(name) => validate_name("quality evidence", name)?,
            }
            validate_blob(&value.reference)?;
        }
        JournalEventV1::StreamBatchAccepted(value) => {
            validate_name("source", &value.source)?;
            validate_name("batch_id", &value.batch_id)?;
            validate_blob(&value.reference)?;
        }
        JournalEventV1::StateCheckpointCommitted(value) => {
            validate_state_evidence(&value.state_version, &value.state_record)?;
        }
        JournalEventV1::StepCommitted(value) => {
            validate_name("step name", &value.name)?;
            validate_blob(&value.checkpoint)?;
        }
        JournalEventV1::IntegrationDesiredStateSet(value) => {
            if value.integration_id != *integration_id {
                return Err(conflict(format!(
                    "desired-state payload integration {} disagrees with envelope {integration_id}",
                    value.integration_id
                )));
            }
            validate_name("actor", &value.actor)?;
            validate_blob(&value.definition_ref)?;
        }
        JournalEventV1::WorkPlanned(value) => {
            validate_blob(&value.manifest.artifact)?;
            validate_sha256("manifest_digest", &value.manifest.manifest_digest)?;
            let manifest = value.manifest_record.try_current_for(integration_id)?;
            if manifest.work_id != value.manifest.work_id {
                return Err(conflict(format!(
                    "manifest record work ID {} disagrees with reference {}",
                    manifest.work_id, value.manifest.work_id
                )));
            }
            let (manifest_sha, manifest_size) = durable_record_identity(&value.manifest_record)?;
            if manifest_sha != value.manifest.manifest_digest
                || manifest_sha != value.manifest.artifact.current().sha256
            {
                return Err(conflict(format!(
                    "manifest record digest {manifest_sha} disagrees with manifest/reference digests"
                )));
            }
            if manifest_size != value.manifest.artifact.current().size {
                return Err(conflict(format!(
                    "manifest record size {manifest_size} disagrees with reference size {}",
                    value.manifest.artifact.current().size
                )));
            }
            match (&manifest.kind, &value.candidate_state_record) {
                (WorkKind::Apply(apply), Some(state)) => {
                    validate_state_evidence(&apply.candidate, state)?;
                }
                (WorkKind::Apply(_), None) => {
                    return Err(malformed(
                        "Apply WorkPlanned requires candidate_state_record".to_owned(),
                    ));
                }
                (WorkKind::Restore(_) | WorkKind::Reconcile(_), None) => {}
                (WorkKind::Restore(_) | WorkKind::Reconcile(_), Some(_)) => {
                    return Err(malformed(
                        "only Apply WorkPlanned may carry candidate_state_record".to_owned(),
                    ));
                }
            }
        }
        JournalEventV1::WorkChunkCompleted(value) => {
            validate_sha256("manifest_digest", &value.manifest_digest)?;
            if value.completed_effect_count == 0 {
                return Err(malformed(
                    "completed_effect_count must be nonzero".to_owned(),
                ));
            }
        }
        JournalEventV1::WorkCompleted(value) => {
            validate_sha256("manifest_digest", &value.manifest_digest)?;
        }
        JournalEventV1::WorkBlocked(value) => {
            validate_sha256("manifest_digest", &value.manifest_digest)?;
            validate_failure(&value.failure)?;
        }
        JournalEventV1::RetryRequested(value) => {
            if value.settings_revision == 0 || value.request.expected_revision.is_none() {
                return Err(malformed(
                    "retry requires nonzero settings_revision and an expected revision".to_owned(),
                ));
            }
        }
        JournalEventV1::RunCompleted(value) => validate_blob(&value.result)?,
        JournalEventV1::RunTerminated(value) => {
            if let Some(failure) = &value.failure {
                validate_failure(failure)?;
            }
            if value.request.is_some()
                && value
                    .request
                    .as_ref()
                    .is_some_and(|request| request.expected_revision.is_none())
            {
                return Err(malformed(
                    "request-originated termination requires an expected revision".to_owned(),
                ));
            }
            if value.outcome == TerminalOutcome::Failed && value.failure.is_none() {
                return Err(malformed(
                    "failed termination requires a failure summary".to_owned(),
                ));
            }
            if value.outcome == TerminalOutcome::AbandonedByOperator && value.failure.is_none() {
                return Err(malformed(
                    "operator-abandoned termination requires a failure summary".to_owned(),
                ));
            }
        }
        JournalEventV1::ControlRequestRejected(value) => {
            match (&value.target, &value.request.expected_revision) {
                (ControlRequestTargetV1::Run(_) | ControlRequestTargetV1::Work(_), None) => {
                    return Err(malformed(
                        "run and work rejections require an expected revision".to_owned(),
                    ));
                }
                (ControlRequestTargetV1::DesiredState(target), _) if target != integration_id => {
                    return Err(conflict(format!(
                        "desired-state rejection target {target} disagrees with envelope {integration_id}"
                    )));
                }
                _ => {}
            }
            match (value.reason_code, &value.target, &value.observed_revision) {
                (
                    ControlRejectionReason::StaleRevision,
                    ControlRequestTargetV1::Run(_) | ControlRequestTargetV1::Work(_),
                    None,
                ) => {
                    return Err(malformed(
                        "stale run/work rejection requires observed_revision".to_owned(),
                    ));
                }
                (
                    ControlRejectionReason::NotFound
                    | ControlRejectionReason::Unauthorized
                    | ControlRejectionReason::Conflict
                    | ControlRejectionReason::Malformed,
                    _,
                    Some(_),
                ) => {
                    return Err(malformed(format!(
                        "{:?} rejection must not carry observed_revision",
                        value.reason_code
                    )));
                }
                _ => {}
            }
        }
        JournalEventV1::DlqEntryExpired(value) => {
            if value.policy_revision == 0 {
                return Err(malformed("policy_revision must be nonzero".to_owned()));
            }
            chrono::DateTime::parse_from_rfc3339(&value.expired_at)
                .map_err(|error| malformed(format!("expired_at must be RFC 3339: {error}")))?;
        }
    }
    Ok(())
}

fn event_identity_projection(event: &JournalEvent) -> Value {
    let JournalEvent::V1(event) = event;
    match event {
        // `submitted_at` stays in the stored payload but is audit-only: a
        // lost-ack resubmission of the same run carries a later timestamp and
        // must derive the identical RunAccepted identity, exactly as provider
        // metadata is excluded from every blob identity projection.
        JournalEventV1::RunAccepted(value) => event_value(
            "run_accepted",
            json!({
                "run_id": value.run_id,
                "immutable_input": input_value(&value.immutable_input),
                "policy": policy_value(&value.policy),
            }),
        ),
        JournalEventV1::AttemptStarted(value) => event_value(
            "attempt_started",
            json!({"run_id": value.run_id, "attempt_id": value.attempt_id, "attempt": value.attempt}),
        ),
        JournalEventV1::AttemptFailed(value) => event_value(
            "attempt_failed",
            json!({"run_id": value.run_id, "attempt_id": value.attempt_id, "attempt": value.attempt, "failure": value.failure}),
        ),
        JournalEventV1::ArtifactPublished(value) => event_value(
            "artifact_published",
            json!({"run_id": value.run_id, "role": value.role, "reference": blob_value(&value.reference)}),
        ),
        JournalEventV1::StreamBatchAccepted(value) => event_value(
            "stream_batch_accepted",
            json!({"run_id": value.run_id, "source": value.source, "batch_id": value.batch_id, "reference": blob_value(&value.reference)}),
        ),
        JournalEventV1::StateCheckpointCommitted(value) => event_value(
            "state_checkpoint_committed",
            json!({"run_id": value.run_id, "state_version": state_ref_value(&value.state_version)}),
        ),
        JournalEventV1::StepCommitted(value) => event_value(
            "step_committed",
            json!({"run_id": value.run_id, "name": value.name, "checkpoint": blob_value(&value.checkpoint)}),
        ),
        JournalEventV1::IntegrationDesiredStateSet(value) => event_value(
            "integration_desired_state_set",
            json!({"integration_id": value.integration_id, "desired": value.desired, "definition_ref": blob_value(&value.definition_ref), "actor": value.actor, "request": value.request}),
        ),
        JournalEventV1::WorkPlanned(value) => event_value(
            "work_planned",
            json!({"manifest": manifest_ref_value(&value.manifest)}),
        ),
        JournalEventV1::WorkChunkCompleted(value) => event_value(
            "work_chunk_completed",
            json!({"work_id": value.work_id, "manifest_digest": value.manifest_digest, "completed_effect_count": value.completed_effect_count, "last_effect_id": value.last_effect_id}),
        ),
        JournalEventV1::WorkCompleted(value) => event_value(
            "work_completed",
            json!({"work_id": value.work_id, "manifest_digest": value.manifest_digest}),
        ),
        JournalEventV1::WorkBlocked(value) => event_value(
            "work_blocked",
            json!({"work_id": value.work_id, "manifest_digest": value.manifest_digest, "failure": value.failure}),
        ),
        JournalEventV1::RetryRequested(value) => event_value(
            "retry_requested",
            json!({"work_id": value.work_id, "settings_revision": value.settings_revision, "request": value.request}),
        ),
        JournalEventV1::RunCompleted(value) => event_value(
            "run_completed",
            json!({"run_id": value.run_id, "result": blob_value(&value.result)}),
        ),
        JournalEventV1::RunTerminated(value) => event_value(
            "run_terminated",
            json!({"run_id": value.run_id, "outcome": value.outcome, "failed_work": value.failed_work, "failure": value.failure, "request": value.request}),
        ),
        JournalEventV1::ControlRequestRejected(value) => event_value(
            "control_request_rejected",
            json!({"request": value.request, "target": value.target, "reason_code": value.reason_code, "observed_revision": value.observed_revision}),
        ),
        // `expired_at` is audit-only. Excluding it makes a retry that observes
        // a later wall clock an identical duplicate rather than shard poison.
        JournalEventV1::DlqEntryExpired(value) => event_value(
            "dlq_entry_expired",
            json!({"entry_id": value.entry_id, "policy_revision": value.policy_revision}),
        ),
    }
}

fn event_value(kind: &str, data: Value) -> Value {
    json!({"version": "v1", "data": {"kind": kind, "data": data}})
}

fn input_value(reference: &InputRef) -> Value {
    json!({
        "artifact": blob_value(&reference.artifact),
        "definition_digest": reference.definition_digest,
        "definition_digest_encoding_version": reference.definition_digest_encoding_version,
        "planner_version": reference.planner_version,
    })
}

fn policy_value(reference: &PolicyRef) -> Value {
    json!({"artifact": blob_value(&reference.artifact), "policy_digest": reference.policy_digest})
}

fn manifest_ref_value(reference: &WorkManifestRef) -> Value {
    json!({"work_id": reference.work_id, "artifact": blob_value(&reference.artifact), "manifest_digest": reference.manifest_digest})
}

fn state_ref_value(reference: &StateVersionRef) -> Value {
    json!({"id": reference.id, "artifact": blob_value(&reference.artifact)})
}

fn blob_value(reference: &BlobRef) -> Value {
    let reference = reference.current();
    json!({
        "sha256": reference.sha256,
        "size": reference.size,
        "media_type": reference.media_type,
    })
}

fn validate_input(reference: &InputRef) -> Result<(), CompatError> {
    validate_blob(&reference.artifact)?;
    validate_sha256("definition_digest", &reference.definition_digest)?;
    if reference.definition_digest_encoding_version == 0 || reference.planner_version == 0 {
        return Err(malformed(
            "definition digest encoding and planner versions must be nonzero".to_owned(),
        ));
    }
    Ok(())
}

fn validate_policy(reference: &PolicyRef) -> Result<(), CompatError> {
    validate_blob(&reference.artifact)?;
    validate_sha256("policy_digest", &reference.policy_digest)
}

fn validate_failure(failure: &FailureSummary) -> Result<(), CompatError> {
    validate_name("failure code", &failure.code)?;
    validate_name("failure message", &failure.message)
}

fn validate_name(name: &str, value: &str) -> Result<(), CompatError> {
    if value.is_empty() || value.len() > MAX_NAME_BYTES || value.chars().any(char::is_control) {
        Err(malformed(format!(
            "{name} must be 1..={MAX_NAME_BYTES} UTF-8 bytes without control characters"
        )))
    } else {
        Ok(())
    }
}

fn validate_blob(reference: &BlobRef) -> Result<(), CompatError> {
    let reference = reference.current();
    if reference.key.is_empty() || reference.media_type.is_empty() {
        return Err(malformed(
            "blob key and media_type must be non-empty".to_owned(),
        ));
    }
    validate_sha256("blob sha256", &reference.sha256)
}

fn validate_state_evidence(
    reference: &StateVersionRef,
    record: &StateVersion,
) -> Result<(), CompatError> {
    validate_blob(&reference.artifact)?;
    let state = record.try_current()?;
    if state.id != reference.id {
        return Err(conflict(format!(
            "state record ID {} disagrees with reference {}",
            state.id, reference.id
        )));
    }
    let (record_sha, record_size) = durable_record_identity(record)?;
    if record_sha != reference.artifact.current().sha256 {
        return Err(conflict(format!(
            "state record digest {record_sha} disagrees with reference digest {}",
            reference.artifact.current().sha256
        )));
    }
    if record_size != reference.artifact.current().size {
        return Err(conflict(format!(
            "state record size {record_size} disagrees with reference size {}",
            reference.artifact.current().size
        )));
    }
    Ok(())
}

fn durable_record_identity<T: DurableRecord>(record: &T) -> Result<(String, u64), CompatError> {
    let bytes = record.encode()?;
    let size = u64::try_from(bytes.len())
        .map_err(|error| malformed(format!("durable record length does not fit u64: {error}")))?;
    Ok((hex::encode(Sha256::digest(bytes)), size))
}

fn validate_sha256(name: &str, value: &str) -> Result<(), CompatError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(malformed(format!(
            "{name} must be 64 lowercase hexadecimal characters"
        )))
    }
}

fn malformed(message: String) -> CompatError {
    CompatError::Malformed {
        family: JournalRecord::FAMILY.name,
        message,
    }
}

fn conflict(message: String) -> CompatError {
    CompatError::Conflict {
        family: JournalRecord::FAMILY.name,
        message,
    }
}

impl super::registry::sealed::Sealed for JournalRecord {}

impl DurableRecord for JournalRecord {
    const FAMILY: &'static RecordFamily = &JOURNAL_RECORD_FAMILY;
    const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::NeverRetireWhileUntrimmed;

    fn encode(&self) -> Result<Vec<u8>, CompatError> {
        self.wire().verify()?;
        serde_json::to_vec(self).map_err(|error| malformed(error.to_string()))
    }

    fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
        if bytes.len() > MAX_JOURNAL_RECORD_BYTES {
            return Err(malformed(format!(
                "record is {} bytes; maximum is {MAX_JOURNAL_RECORD_BYTES}",
                bytes.len()
            )));
        }
        let value: Value =
            serde_json::from_slice(bytes).map_err(|error| malformed(error.to_string()))?;
        reject_unknown_fields(Self::FAMILY.name, "", &value, &["version", "data"])?;
        let version = value
            .get("version")
            .and_then(Value::as_str)
            .ok_or_else(|| malformed("version must be a string".to_owned()))?;
        if version != "v1" {
            return Err(CompatError::UnsupportedVersion {
                family: Self::FAMILY.name,
                version: version.to_owned(),
            });
        }
        let record: Self =
            serde_json::from_value(value).map_err(|error| malformed(error.to_string()))?;
        record.wire().verify()?;
        Ok(record)
    }
}

impl VersionedRecord for JournalRecord {
    type Current = JournalRecordV1;

    fn normalize(self) -> Result<Self::Current, CompatError> {
        Self::into_current(self)
    }
}

impl UntrimmedJournalRecord for JournalRecord {}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use crate::blob::BlobRefV1;
    use crate::orchestrator::ids::RequestDigest;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct IdentityGoldens {
        attempt_id: String,
        ordinary_event_id: String,
        attempt_failed_event_id: String,
        control_outcome_event_id: String,
        journal_record_digest: String,
        dlq_entry_id: String,
    }

    fn identities() -> IdentityGoldens {
        serde_json::from_slice(include_bytes!(
            "../../tests/golden/protocol-identities-v1.json"
        ))
        .expect("valid independent identity fixture")
    }

    fn integration() -> CanonicalIntegrationId {
        CanonicalIntegrationId::parse("alice:supply-chain").expect("valid integration")
    }

    fn run_id() -> RunId {
        RunId::parse("00000000-0000-4000-8000-000000000001").expect("valid run ID")
    }

    fn context() -> ControlRequestContextV1 {
        ControlRequestContextV1 {
            request_id: RequestId::parse(
                "2f47eda4b41283057c1471fc03d0379f8840c84fee0aa3d79140b6ea41002e1d",
            )
            .expect("valid request ID"),
            request_digest: RequestDigest::parse(
                "82f7f7bff5923cfef55cd1413b60ff63c38e1e705981e0b0923b7f4b35aaa06c",
            )
            .expect("valid request digest"),
            expected_revision: Some(EventId::parse("4".repeat(64)).expect("valid revision")),
        }
    }

    fn blob(e_tag: &str, provider_version: &str) -> BlobRef {
        BlobRef::V1(BlobRefV1 {
            key: "artifacts/result".to_owned(),
            sha256: "a".repeat(64),
            size: 10,
            media_type: "application/json".to_owned(),
            e_tag: Some(e_tag.to_owned()),
            provider_version: Some(provider_version.to_owned()),
        })
    }

    #[test]
    fn ordinary_record_wire_ids_digest_and_sequence_match_independent_goldens() {
        let identities = identities();
        let attempt_id = derive_attempt_id(&run_id(), 1);
        assert_eq!(attempt_id.as_str(), identities.attempt_id);
        let record = JournalRecordV1::new(
            integration(),
            JournalEvent::V1(JournalEventV1::AttemptStarted(AttemptStartedV1 {
                run_id: run_id(),
                attempt_id,
                attempt: 1,
            })),
        )
        .expect("valid record");
        assert_eq!(record.event_id.as_str(), identities.ordinary_event_id);
        assert_eq!(
            record.digest().expect("record digest").as_str(),
            identities.journal_record_digest
        );
        assert_eq!(
            dlq_entry_id(&record.event_id).as_str(),
            identities.dlq_entry_id
        );

        let wire = JournalRecord::V1(record.clone());
        assert_eq!(
            wire.encode().expect("encode journal record"),
            include_bytes!("../../tests/golden/journal-record-v1.json")
                .strip_suffix(b"\n")
                .expect("fixture newline")
        );
        assert_eq!(
            JournalRecord::decode(&wire.encode().expect("encode journal record"))
                .expect("decode journal record"),
            wire
        );
        let sequenced = SequencedJournalRecord::try_new(42, wire).expect("validated sequence");
        assert_eq!(sequenced.shard_sequence(), 42);
        assert_eq!(sequenced.record(), &record);
    }

    #[test]
    fn handler_failure_event_identity_matches_independent_golden() {
        let identities = identities();
        let record = JournalRecordV1::new(
            integration(),
            JournalEvent::V1(JournalEventV1::AttemptFailed(AttemptFailedV1 {
                run_id: run_id(),
                attempt_id: derive_attempt_id(&run_id(), 1),
                attempt: 1,
                failure: FailureSummary {
                    code: "retryable".to_owned(),
                    message: "temporary".to_owned(),
                    retryable: true,
                },
            })),
        )
        .expect("valid handler failure event");
        assert_eq!(record.event_id.as_str(), identities.attempt_failed_event_id);
    }

    #[test]
    fn accepted_and_rejected_control_outcomes_share_id_but_conflict_by_digest() {
        let work_id = WorkId::parse("5".repeat(64)).expect("valid work ID");
        let accepted = JournalRecordV1::new(
            integration(),
            JournalEvent::V1(JournalEventV1::RetryRequested(RetryRequestedV1 {
                work_id: work_id.clone(),
                settings_revision: 7,
                request: context(),
            })),
        )
        .expect("valid accepted outcome");
        let rejected = JournalRecordV1::new(
            integration(),
            JournalEvent::V1(JournalEventV1::ControlRequestRejected(
                ControlRequestRejectedV1 {
                    request: context(),
                    target: ControlRequestTargetV1::Work(work_id),
                    reason_code: ControlRejectionReason::StaleRevision,
                    observed_revision: Some(
                        EventId::parse("6".repeat(64)).expect("valid observed revision"),
                    ),
                },
            )),
        )
        .expect("valid rejected outcome");
        assert_eq!(accepted.event_id, rejected.event_id);
        assert_eq!(
            accepted.event_id.as_str(),
            identities().control_outcome_event_id
        );
        let accepted_digest = accepted.digest().expect("accepted digest");
        assert_ne!(accepted_digest, rejected.digest().expect("rejected digest"));
        assert_eq!(
            classify_event_reuse(&accepted_digest, &accepted).expect("classify duplicate"),
            EventReuse::IdenticalDuplicate
        );
        assert_eq!(
            classify_event_reuse(&accepted_digest, &rejected).expect("classify conflict"),
            EventReuse::ConflictingReuse
        );
    }

    #[test]
    fn provider_metadata_does_not_change_event_or_record_identity() {
        let first = JournalRecordV1::new(
            integration(),
            JournalEvent::V1(JournalEventV1::RunCompleted(RunCompletedV1 {
                run_id: run_id(),
                result: blob("etag-a", "provider-a"),
            })),
        )
        .expect("valid first record");
        let second = JournalRecordV1::new(
            integration(),
            JournalEvent::V1(JournalEventV1::RunCompleted(RunCompletedV1 {
                run_id: run_id(),
                result: blob("etag-b", "provider-b"),
            })),
        )
        .expect("valid second record");
        assert_eq!(first.event_id, second.event_id);
        assert_eq!(
            first.digest().expect("first digest"),
            second.digest().expect("second digest")
        );
    }

    #[test]
    fn envelope_disagreement_and_malformed_extra_fields_fail_closed() {
        let request = ControlRequestContextV1 {
            expected_revision: None,
            ..context()
        };
        let mismatch = JournalRecordV1::new(
            integration(),
            JournalEvent::V1(JournalEventV1::IntegrationDesiredStateSet(
                IntegrationDesiredStateSetV1 {
                    integration_id: CanonicalIntegrationId::parse("alice:other")
                        .expect("valid other integration"),
                    desired: IntegrationDesiredState::Enabled,
                    definition_ref: blob("etag", "provider"),
                    actor: "actor:alice".to_owned(),
                    request,
                },
            )),
        );
        assert!(matches!(mismatch, Err(CompatError::Conflict { .. })));

        let mut value = serde_json::from_slice::<Value>(include_bytes!(
            "../../tests/golden/journal-record-v1.json"
        ))
        .expect("valid wire fixture");
        value
            .get_mut("data")
            .and_then(Value::as_object_mut)
            .expect("data object")
            .insert("surprise".to_owned(), Value::Bool(true));
        assert!(JournalRecord::decode(
            &serde_json::to_vec(&value).expect("serialize malformed record")
        )
        .is_err());
    }

    #[test]
    fn rejection_reason_and_observed_revision_are_coherent() {
        let work_id = WorkId::parse("5".repeat(64)).expect("valid work ID");
        for (reason_code, observed_revision) in [
            (ControlRejectionReason::StaleRevision, None),
            (
                ControlRejectionReason::NotFound,
                Some(EventId::parse("6".repeat(64)).expect("valid observed revision")),
            ),
        ] {
            let result = JournalRecordV1::new(
                integration(),
                JournalEvent::V1(JournalEventV1::ControlRequestRejected(
                    ControlRequestRejectedV1 {
                        request: context(),
                        target: ControlRequestTargetV1::Work(work_id.clone()),
                        reason_code,
                        observed_revision,
                    },
                )),
            );
            assert!(matches!(result, Err(CompatError::Malformed { .. })));
        }

        let result = JournalRecordV1::new(
            integration(),
            JournalEvent::V1(JournalEventV1::ControlRequestRejected(
                ControlRequestRejectedV1 {
                    request: ControlRequestContextV1 {
                        expected_revision: None,
                        ..context()
                    },
                    target: ControlRequestTargetV1::DesiredState(
                        CanonicalIntegrationId::parse("alice:other")
                            .expect("valid other integration"),
                    ),
                    reason_code: ControlRejectionReason::NotFound,
                    observed_revision: None,
                },
            )),
        );
        assert!(matches!(result, Err(CompatError::Conflict { .. })));
    }
}
