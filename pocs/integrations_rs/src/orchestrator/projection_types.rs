//! Materialized shard state and transition deltas.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::control::IntegrationDesiredState;
use super::events::{
    ArtifactRole, ControlRejectionReason, FailureSummary, InputRef, JournalRecordV1, PolicyRef,
    TerminalOutcome, WorkManifestRef,
};
use super::ids::{
    AttemptId, CanonicalIntegrationId, DlqEntryId, EffectId, EventId, JournalRecordDigest,
    RequestDigest, RequestId, RunId, WorkId,
};
use super::work::{StateVersionRef, WorkKind};
use crate::blob::BlobRef;

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Projection {
    pub integrations: BTreeMap<CanonicalIntegrationId, IntegrationProjection>,
    pub runs: BTreeMap<RunId, RunProjection>,
    pub work: BTreeMap<WorkId, WorkProjection>,
    pub control_request_outcomes: BTreeMap<RequestId, ControlRequestOutcomeV1>,
    pub seen_event_digests: BTreeMap<EventId, JournalRecordDigest>,
    pub through_log_sequence: Option<u64>,
    /// Protocol v1 quarantines the whole shard: event identity and
    /// log order are shard-scoped, so continuing past invalid durable history
    /// would require a separately specified per-integration skip protocol.
    pub poisoned: Option<PoisonedProjection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PoisonedProjection {
    pub sequence: u64,
    pub event_id: EventId,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Accepted,
    Running,
    Completed,
    Terminated,
}

impl RunStatus {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Terminated)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunProjection {
    pub integration_id: CanonicalIntegrationId,
    pub status: RunStatus,
    pub attempt: u64,
    /// Handler-reported retryable failures only. Attempt numbers also advance
    /// after process interruption, which does not change this.
    pub handler_failures: u32,
    pub attempt_id: Option<AttemptId>,
    pub immutable_input: InputRef,
    pub policy: PolicyRef,
    pub submitted_at: String,
    #[serde(with = "artifact_map")]
    pub artifacts: BTreeMap<ArtifactRole, BlobRef>,
    pub steps: BTreeMap<String, BlobRef>,
    pub result: Option<BlobRef>,
    pub outcome: Option<TerminalOutcome>,
    pub failure: Option<FailureSummary>,
    pub revision: EventId,
}

mod artifact_map {
    use std::collections::BTreeMap;

    use serde::de::Error as _;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    use super::ArtifactRole;
    use crate::blob::BlobRef;

    #[derive(Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Entry {
        role: ArtifactRole,
        reference: BlobRef,
    }

    pub(super) fn serialize<S>(
        value: &BTreeMap<ArtifactRole, BlobRef>,
        serializer: S,
    ) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        value
            .iter()
            .map(|(role, reference)| Entry {
                role: role.clone(),
                reference: reference.clone(),
            })
            .collect::<Vec<_>>()
            .serialize(serializer)
    }

    pub(super) fn deserialize<'de, D>(
        deserializer: D,
    ) -> Result<BTreeMap<ArtifactRole, BlobRef>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let entries = Vec::<Entry>::deserialize(deserializer)?;
        let mut value = BTreeMap::new();
        for entry in entries {
            if value.insert(entry.role, entry.reference).is_some() {
                return Err(D::Error::custom("duplicate artifact role"));
            }
        }
        Ok(value)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkStatus {
    Planned,
    Blocked,
    Completed,
    Terminated,
    Superseded,
}

impl WorkStatus {
    pub fn is_live(self) -> bool {
        matches!(self, Self::Planned | Self::Blocked)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkProjection {
    pub integration_id: CanonicalIntegrationId,
    pub manifest: WorkManifestRef,
    pub kind: WorkKind,
    pub effect_count: u64,
    pub completed_effect_count: u64,
    pub status: WorkStatus,
    pub last_completed_effect: Option<EffectId>,
    pub failure: Option<FailureSummary>,
    pub settings_revision: Option<u64>,
    pub revision: EventId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MaintenanceStatus {
    Healthy,
    RestoreRequired,
    Restoring,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RestoreEvidence {
    pub failed_run_id: RunId,
    pub failed_work_id: WorkId,
    pub target: Option<StateVersionRef>,
    pub contaminated: StateVersionRef,
    pub dlq_entry_id: Option<DlqEntryId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DlqEntryV1 {
    pub entry_id: DlqEntryId,
    pub run_id: RunId,
    pub attempt_id: Option<AttemptId>,
    pub failed_work: Option<WorkId>,
    pub failure: FailureSummary,
    pub evidence: Vec<BlobRef>,
    pub entered_at_sequence: u64,
    pub maintenance_failure: Option<FailureSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntegrationProjection {
    pub desired: Option<IntegrationDesiredState>,
    pub desired_definition: Option<BlobRef>,
    pub desired_revision: Option<EventId>,
    pub checkpoint_state: Option<StateVersionRef>,
    /// Sequence of the journal event that most recently established
    /// `checkpoint_state`. `None` with no sequence is the untouched initial
    /// empty state; Restore may establish empty state at a concrete sequence.
    pub checkpoint_state_sequence: Option<u64>,
    pub applied_state: Option<StateVersionRef>,
    pub applied_incarnation: Option<EventId>,
    pub active_run: Option<RunId>,
    pub queued_run: Option<RunId>,
    pub foreground_work: Option<WorkId>,
    pub reconciliation_work: Option<WorkId>,
    pub reconciliation_cycle: u64,
    pub maintenance: MaintenanceStatus,
    pub restore_evidence: Option<RestoreEvidence>,
    pub dlq: BTreeMap<DlqEntryId, DlqEntryV1>,
}

impl Default for IntegrationProjection {
    fn default() -> Self {
        Self {
            desired: None,
            desired_definition: None,
            desired_revision: None,
            checkpoint_state: None,
            checkpoint_state_sequence: None,
            applied_state: None,
            applied_incarnation: None,
            active_run: None,
            queued_run: None,
            foreground_work: None,
            reconciliation_work: None,
            reconciliation_cycle: 0,
            maintenance: MaintenanceStatus::Healthy,
            restore_evidence: None,
            dlq: BTreeMap::new(),
        }
    }
}

impl IntegrationProjection {
    pub fn execution_eligible(&self) -> bool {
        self.desired != Some(IntegrationDesiredState::Disabled)
    }

    pub fn covers_checkpoint(&self, projection: &Projection) -> bool {
        self.foreground_work
            .as_ref()
            .and_then(|work_id| projection.work.get(work_id))
            .is_some_and(|work| work.status.is_live())
    }

    pub fn foreground_runnable(&self, projection: &Projection) -> bool {
        self.foreground_work
            .as_ref()
            .and_then(|work_id| projection.work.get(work_id))
            .is_some_and(|work| work.status == WorkStatus::Planned)
    }

    /// One shared definition of "background delivery may proceed": no
    /// foreground slot in use, healthy maintenance, and execution eligible.
    /// Every scheduler query that admits reconciliation or maintenance work
    /// consults this, so a new eligibility input lands in one place.
    pub fn background_delivery_eligible(&self) -> bool {
        self.foreground_work.is_none()
            && self.maintenance == MaintenanceStatus::Healthy
            && self.execution_eligible()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlRequestOutcomeV1 {
    pub request_digest: RequestDigest,
    pub outcome: ControlRequestOutcomeKindV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum ControlRequestOutcomeKindV1 {
    Accepted {
        promoted_event_id: EventId,
    },
    Rejected {
        reason_code: ControlRejectionReason,
        expected_revision: Option<EventId>,
        observed_revision: Option<EventId>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectionDelta {
    pub(super) integrations: BTreeMap<CanonicalIntegrationId, IntegrationProjection>,
    pub(super) runs: BTreeMap<RunId, RunProjection>,
    pub(super) work: BTreeMap<WorkId, WorkProjection>,
    pub(super) control_request_outcomes: BTreeMap<RequestId, ControlRequestOutcomeV1>,
    pub(super) event_id: EventId,
    pub(super) event_digest: JournalRecordDigest,
    pub(super) pending_dlq_sequence: Option<(CanonicalIntegrationId, DlqEntryId)>,
    pub(super) pending_checkpoint_state_sequence: Option<CanonicalIntegrationId>,
}

impl ProjectionDelta {
    pub(super) fn for_record(record: &JournalRecordV1, digest: JournalRecordDigest) -> Self {
        Self {
            integrations: BTreeMap::new(),
            runs: BTreeMap::new(),
            work: BTreeMap::new(),
            control_request_outcomes: BTreeMap::new(),
            event_id: record.event_id.clone(),
            event_digest: digest,
            pending_dlq_sequence: None,
            pending_checkpoint_state_sequence: None,
        }
    }
}
