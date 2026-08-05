//! Conservative artifact reachability and quarantine reporting.
//!
//! Protocol v1 deliberately has no deletion capability. This module takes an
//! immutable projection snapshot, expands every load-bearing content reference,
//! inventories old content-addressed objects, and reports unmarked candidates.
//! A malformed or unavailable rooted artifact fails the pass closed.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fmt;
use std::time::Duration;

use chrono::{DateTime, Utc};
use error_stack::{Report, ResultExt as _};
use serde::{Deserialize, Serialize};

use super::events::WorkManifestRef;
use super::ids::{CanonicalIntegrationId, RunId, TenantNamespace};
use super::projection::{Projection, RunProjection, WorkProjection, WorkStatus};
use super::registry::DurableRecord;
use super::work::{
    StateVersion, StateVersionRef, WorkKind, WorkManifest, MAX_STATE_VERSION_BYTES,
    MAX_WORK_MANIFEST_BYTES,
};
use crate::blob::{ArtifactStore, BlobRef, ListedObject};
use crate::graph::artifacts::{
    DesiredProjectionArtifact, DesiredProjectionArtifactV1, EffectIndexArtifact,
    EffectIndexArtifactV1, MAX_INDEX_BYTES, MAX_PAGE_BYTES,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GcError {
    InvalidConfiguration,
    InvalidProjection,
    RootOutsidePrefix,
    ConflictingRootIdentity,
    RootArtifactUnavailable,
    RootArtifactInvalid,
    Inventory,
}

impl fmt::Display for GcError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidConfiguration => "artifact GC configuration is invalid",
            Self::InvalidProjection => "artifact GC projection snapshot is invalid",
            Self::RootOutsidePrefix => "artifact GC root is outside the inventory prefix",
            Self::ConflictingRootIdentity => "artifact GC root identities conflict",
            Self::RootArtifactUnavailable => "artifact GC could not read a rooted artifact",
            Self::RootArtifactInvalid => "artifact GC rooted artifact is invalid",
            Self::Inventory => "artifact GC inventory failed",
        })
    }
}

impl std::error::Error for GcError {}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RootKind {
    CheckpointState,
    AppliedState,
    RestoreTarget,
    ContaminatedState,
    DesiredDefinition,
    NonterminalRun,
    ActiveDlqRun,
    ActiveDlqEvidence,
    LiveWork,
    DlqFailedWork,
    ExplicitHistoryRun,
    ExplicitHistoryArtifact,
    ProjectionSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RootReason {
    pub kind: RootKind,
    pub owner: String,
}

impl RootReason {
    fn new(kind: RootKind, owner: impl Into<String>) -> Self {
        Self {
            kind,
            owner: owner.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HistoryRetention {
    /// Terminal runs retained for diff or rerun workflows.
    pub run_ids: BTreeSet<RunId>,
    /// Additional content explicitly retained by an operator-owned history
    /// policy. Expiration must still be represented by an authoritative event.
    pub artifacts: Vec<BlobRef>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectionSnapshotRoot {
    pub through_log_sequence: u64,
    pub payload: BlobRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObservedControlVersion {
    pub e_tag: Option<String>,
    pub provider_version: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ShardRootSnapshot {
    /// Stable shard label used in the report and to reject incomplete or
    /// duplicated tenant snapshots before inventory begins.
    pub shard: String,
    pub projection: Projection,
    pub projection_snapshots: Vec<ProjectionSnapshotRoot>,
}

#[derive(Debug, Clone)]
pub struct GcRootSnapshot {
    /// Every shard whose artifacts share the tenant inventory prefix. GC is a
    /// tenant-wide operation: a shard-local mark set is never safe against a
    /// tenant-wide object listing.
    pub shards: Vec<ShardRootSnapshot>,
    pub history: HistoryRetention,
    /// Exact versions of non-journal control records used by the caller when
    /// capturing this immutable root snapshot.
    pub control_versions: BTreeMap<String, ObservedControlVersion>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GcPolicy {
    pub observed_at: DateTime<Utc>,
    pub cutoff: DateTime<Utc>,
    pub publication_grace: Duration,
    pub maximum_publication_attempt: Duration,
}

impl GcPolicy {
    pub fn validate(self) -> Result<Self, Report<GcError>> {
        if self.cutoff > self.observed_at
            || self.publication_grace.is_zero()
            || self.publication_grace <= self.maximum_publication_attempt
        {
            return Err(Report::new(GcError::InvalidConfiguration).attach_printable(
                "cutoff must not be in the future and publication_grace must be strictly longer than maximum_publication_attempt",
            ));
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MarkedArtifact {
    pub key: String,
    pub sha256: String,
    pub size: u64,
    pub media_type: String,
    pub reasons: BTreeSet<RootReason>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QuarantineCandidate {
    pub key: String,
    pub size: u64,
    pub e_tag: Option<String>,
    pub provider_version: Option<String>,
    pub last_modified: String,
    pub observed_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GcReport {
    pub run_id: String,
    pub inventory_prefix: String,
    pub observed_at: String,
    pub cutoff: String,
    pub publication_grace_seconds: u64,
    pub through_log_sequences: BTreeMap<String, u64>,
    pub control_versions: BTreeMap<String, ObservedControlVersion>,
    pub marked: BTreeMap<String, MarkedArtifact>,
    pub inventoried_artifact_count: u64,
    pub inventoried_artifact_bytes: u64,
    pub quarantine: Vec<QuarantineCandidate>,
    pub quarantine_bytes: u64,
}

impl GcReport {
    /// Kept explicit so the v1 surface cannot accidentally grow a sweep path.
    pub fn has_rooted_quarantine_candidate(&self) -> bool {
        self.quarantine
            .iter()
            .any(|candidate| self.marked.contains_key(&candidate.key))
    }
}

#[derive(Debug, Clone)]
struct StateRoot {
    reference: StateVersionRef,
    reason: RootReason,
}

#[derive(Debug, Clone)]
struct WorkRoot {
    integration_id: CanonicalIntegrationId,
    reference: WorkManifestRef,
    expected: WorkProjection,
    reason: RootReason,
}

#[derive(Debug, Clone)]
struct EffectRoot {
    reference: BlobRef,
    expected_count: u64,
    expected_target_state_digest: String,
    reason: RootReason,
}

#[derive(Debug, Default)]
struct RootPlan {
    blobs: Vec<(BlobRef, RootReason)>,
    states: Vec<StateRoot>,
    work: Vec<WorkRoot>,
}

#[derive(Debug)]
struct Marker<'a> {
    store: &'a ArtifactStore,
    prefix: String,
    marked: BTreeMap<String, MarkedArtifact>,
    expanded_states: BTreeSet<(String, RootReason)>,
    expanded_work: BTreeSet<(String, RootReason)>,
    expanded_desired: BTreeSet<(String, RootReason)>,
    expanded_effects: BTreeSet<(String, RootReason)>,
}

impl<'a> Marker<'a> {
    fn new(store: &'a ArtifactStore, prefix: &str) -> Result<Self, Report<GcError>> {
        let prefix = prefix.trim_matches('/');
        let mut segments = prefix.split('/');
        let namespace = segments.next();
        let tenant = segments.next();
        if namespace != Some("tenants")
            || tenant.is_none_or(|value| TenantNamespace::parse(value).is_err())
            || segments.next().is_some()
        {
            return Err(Report::new(GcError::InvalidConfiguration)
                .attach_printable("GC inventory prefix must be exactly tenants/<tenant>"));
        }
        Ok(Self {
            store,
            prefix: format!("{prefix}/"),
            marked: BTreeMap::new(),
            expanded_states: BTreeSet::new(),
            expanded_work: BTreeSet::new(),
            expanded_desired: BTreeSet::new(),
            expanded_effects: BTreeSet::new(),
        })
    }

    fn mark(&mut self, reference: &BlobRef, reason: RootReason) -> Result<(), Report<GcError>> {
        let value = reference.current();
        if !value.key.starts_with(&self.prefix) {
            return Err(Report::new(GcError::RootOutsidePrefix)
                .attach_printable(format!("root {:?} is outside {:?}", value.key, self.prefix)));
        }
        match self.marked.entry(value.key.clone()) {
            std::collections::btree_map::Entry::Vacant(entry) => {
                entry.insert(MarkedArtifact {
                    key: value.key.clone(),
                    sha256: value.sha256.clone(),
                    size: value.size,
                    media_type: value.media_type.clone(),
                    reasons: BTreeSet::from([reason]),
                });
            }
            std::collections::btree_map::Entry::Occupied(mut entry) => {
                let existing = entry.get_mut();
                if existing.sha256 != value.sha256
                    || existing.size != value.size
                    || existing.media_type != value.media_type
                {
                    return Err(Report::new(GcError::ConflictingRootIdentity)
                        .attach_printable(format!("conflicting identities for {:?}", value.key)));
                }
                existing.reasons.insert(reason);
            }
        }
        Ok(())
    }

    async fn expand(
        mut self,
        plan: RootPlan,
    ) -> Result<BTreeMap<String, MarkedArtifact>, Report<GcError>> {
        for (reference, reason) in plan.blobs {
            self.mark(&reference, reason)?;
        }
        let mut states = VecDeque::from(plan.states);
        let mut work = VecDeque::from(plan.work);
        let mut desired = VecDeque::new();
        let mut effects: VecDeque<EffectRoot> = VecDeque::new();

        while let Some(root) = work.pop_front() {
            self.mark(&root.reference.artifact, root.reason.clone())?;
            let expansion = (
                root.reference.artifact.current().key.clone(),
                root.reason.clone(),
            );
            if !self.expanded_work.insert(expansion) {
                continue;
            }
            if root.reference.manifest_digest != root.reference.artifact.current().sha256 {
                return Err(Report::new(GcError::RootArtifactInvalid)
                    .attach_printable("work manifest digest disagrees with its blob reference"));
            }
            let record: WorkManifest = self
                .read_record(&root.reference.artifact, MAX_WORK_MANIFEST_BYTES)
                .await?;
            let manifest = record
                .into_current_for(&root.integration_id)
                .change_context(GcError::RootArtifactInvalid)?;
            if manifest.work_id != root.reference.work_id
                || manifest.kind != root.expected.kind
                || manifest.effect_count != root.expected.effect_count
            {
                return Err(Report::new(GcError::RootArtifactInvalid)
                    .attach_printable("work projection disagrees with its immutable manifest"));
            }
            self.mark(&manifest.effects, root.reason.clone())?;
            effects.push_back(EffectRoot {
                reference: manifest.effects,
                expected_count: manifest.effect_count,
                expected_target_state_digest: work_target_state_digest(&manifest.kind),
                reason: root.reason.clone(),
            });
            for state in work_state_references(&manifest.kind) {
                states.push_back(StateRoot {
                    reference: state,
                    reason: root.reason.clone(),
                });
            }
        }

        while let Some(root) = states.pop_front() {
            self.mark(&root.reference.artifact, root.reason.clone())?;
            let expansion = (
                root.reference.artifact.current().key.clone(),
                root.reason.clone(),
            );
            if !self.expanded_states.insert(expansion) {
                continue;
            }
            let record: StateVersion = self
                .read_record(&root.reference.artifact, MAX_STATE_VERSION_BYTES)
                .await?;
            let state = record
                .into_current()
                .change_context(GcError::RootArtifactInvalid)?;
            if state.id != root.reference.id {
                return Err(Report::new(GcError::RootArtifactInvalid).attach_printable(
                    "state projection reference disagrees with decoded state ID",
                ));
            }
            let snapshot = state.snapshot.current();
            self.mark(&snapshot.duckdb, root.reason.clone())?;
            for batch in &snapshot.accepted_batches {
                self.mark(batch, root.reason.clone())?;
            }
            self.mark(&state.desired_projection.artifact, root.reason.clone())?;
            desired.push_back((state.desired_projection.artifact, root.reason));
        }

        while let Some((reference, reason)) = desired.pop_front() {
            let expansion = (reference.current().key.clone(), reason.clone());
            if !self.expanded_desired.insert(expansion) {
                continue;
            }
            let index: DesiredProjectionArtifact =
                self.read_record(&reference, MAX_INDEX_BYTES).await?;
            let DesiredProjectionArtifact::V1(DesiredProjectionArtifactV1::Index(index)) = index
            else {
                return Err(Report::new(GcError::RootArtifactInvalid)
                    .attach_printable("desired projection root is not an index"));
            };
            let declared_object_count = index.object_count;
            let mut observed_objects = 0_u64;
            let mut previous_object = None;
            for (page, bounds) in index.pages.into_iter().zip(index.page_bounds) {
                self.mark(&page, reason.clone())?;
                let page_record: DesiredProjectionArtifact =
                    self.read_record(&page, MAX_PAGE_BYTES).await?;
                let DesiredProjectionArtifact::V1(DesiredProjectionArtifactV1::Page(page_record)) =
                    page_record
                else {
                    return Err(Report::new(GcError::RootArtifactInvalid).attach_printable(
                        "desired projection index references a non-page artifact",
                    ));
                };
                observed_objects = observed_objects
                    .checked_add(page_record.objects.len() as u64)
                    .ok_or_else(|| Report::new(GcError::RootArtifactInvalid))?;
                let first = page_record
                    .objects
                    .first()
                    .map(|object| (object.kind, object.graph_identity.as_str()));
                let last = page_record
                    .objects
                    .last()
                    .map(|object| (object.kind, object.graph_identity.as_str()));
                if first != Some((bounds.first.kind, bounds.first.graph_identity.as_str()))
                    || last != Some((bounds.last.kind, bounds.last.graph_identity.as_str()))
                {
                    return Err(Report::new(GcError::RootArtifactInvalid).attach_printable(
                        "desired projection page content disagrees with its index bounds",
                    ));
                }
                for object in page_record.objects {
                    let identity = (object.kind, object.graph_identity.clone());
                    if previous_object
                        .as_ref()
                        .is_some_and(|previous| previous >= &identity)
                    {
                        return Err(Report::new(GcError::RootArtifactInvalid).attach_printable(
                            "desired projection objects are not globally ordered and unique",
                        ));
                    }
                    previous_object = Some(identity);
                    self.mark(&object.disposition.payload().artifact, reason.clone())?;
                }
            }
            if observed_objects != declared_object_count {
                return Err(
                    Report::new(GcError::RootArtifactInvalid).attach_printable(format!(
                        "desired projection declares {declared_object_count} objects but pages contain {observed_objects}"
                    )),
                );
            }
        }

        while let Some(root) = effects.pop_front() {
            let expansion = (root.reference.current().key.clone(), root.reason.clone());
            if !self.expanded_effects.insert(expansion) {
                continue;
            }
            let index: EffectIndexArtifact =
                self.read_record(&root.reference, MAX_INDEX_BYTES).await?;
            let EffectIndexArtifact::V1(EffectIndexArtifactV1::Index(index)) = index else {
                return Err(Report::new(GcError::RootArtifactInvalid)
                    .attach_printable("effect root is not an index"));
            };
            if index.effect_count != root.expected_count
                || index.target_state_digest != root.expected_target_state_digest
            {
                return Err(Report::new(GcError::RootArtifactInvalid).attach_printable(
                    "effect index count or target state disagrees with its work manifest",
                ));
            }
            let mut observed_effects = 0_u64;
            let mut effect_ids = BTreeSet::new();
            for page in index.pages {
                self.mark(&page, root.reason.clone())?;
                let page_record: EffectIndexArtifact =
                    self.read_record(&page, MAX_PAGE_BYTES).await?;
                let EffectIndexArtifact::V1(EffectIndexArtifactV1::Page(page_record)) = page_record
                else {
                    return Err(Report::new(GcError::RootArtifactInvalid)
                        .attach_printable("effect index references a non-page artifact"));
                };
                observed_effects = observed_effects
                    .checked_add(page_record.effects.len() as u64)
                    .ok_or_else(|| Report::new(GcError::RootArtifactInvalid))?;
                for effect in page_record.effects {
                    let effect = effect
                        .into_current()
                        .change_context(GcError::RootArtifactInvalid)?;
                    if effect.target_state_digest != root.expected_target_state_digest
                        || !effect_ids.insert(effect.effect_id.clone())
                    {
                        return Err(Report::new(GcError::RootArtifactInvalid).attach_printable(
                            "effect pages contain a duplicate ID or disagree on target state",
                        ));
                    }
                    if let Some(payload) = effect.payload {
                        self.mark(&payload.artifact, root.reason.clone())?;
                    }
                }
            }
            if observed_effects != index.effect_count {
                return Err(
                    Report::new(GcError::RootArtifactInvalid).attach_printable(format!(
                        "effect index declares {} effects but pages contain {observed_effects}",
                        index.effect_count
                    )),
                );
            }
        }
        Ok(self.marked)
    }

    async fn read_record<T: DurableRecord>(
        &self,
        reference: &BlobRef,
        maximum_bytes: usize,
    ) -> Result<T, Report<GcError>> {
        if reference.current().size > maximum_bytes as u64 {
            return Err(
                Report::new(GcError::RootArtifactInvalid).attach_printable(format!(
                    "rooted record {} declares {} bytes; maximum is {maximum_bytes}",
                    reference.current().key,
                    reference.current().size
                )),
            );
        }
        let guarded = self
            .store
            .materialize_guarded(reference)
            .await
            .change_context(GcError::RootArtifactUnavailable)?;
        let bytes = tokio::fs::read(guarded.path())
            .await
            .change_context(GcError::RootArtifactUnavailable)?;
        T::decode(&bytes).change_context(GcError::RootArtifactInvalid)
    }
}

/// Produces a conservative report. No object-store deletion primitive is
/// accepted or invoked anywhere in this path.
pub async fn mark_and_report(
    store: &ArtifactStore,
    inventory_prefix: &str,
    roots: GcRootSnapshot,
    policy: GcPolicy,
) -> Result<GcReport, Report<GcError>> {
    let policy = policy.validate()?;
    let (plan, through_log_sequences) = collect_direct_roots(&roots)?;
    let traversal = Marker::new(store, inventory_prefix)?;
    let marked = traversal.expand(plan).await?;
    let mut inventory = store
        .list(inventory_prefix.trim_matches('/'))
        .await
        .change_context(GcError::Inventory)?;
    inventory.sort_by(|left, right| left.key.cmp(&right.key));

    let mut inventoried_artifact_count = 0_u64;
    let mut inventoried_artifact_bytes = 0_u64;
    let mut quarantine = Vec::new();
    let mut quarantine_bytes = 0_u64;
    for object in inventory {
        if !is_content_addressed_key(&object.key) {
            continue;
        }
        inventoried_artifact_count =
            inventoried_artifact_count.checked_add(1).ok_or_else(|| {
                Report::new(GcError::Inventory)
                    .attach_printable("inventory object count overflowed u64")
            })?;
        inventoried_artifact_bytes = inventoried_artifact_bytes
            .checked_add(object.size)
            .ok_or_else(|| {
                Report::new(GcError::Inventory)
                    .attach_printable("inventory byte count overflowed u64")
            })?;
        if marked.contains_key(&object.key) || !older_than_both(&object, policy)? {
            continue;
        }
        quarantine_bytes = quarantine_bytes.checked_add(object.size).ok_or_else(|| {
            Report::new(GcError::Inventory).attach_printable("quarantine bytes overflowed u64")
        })?;
        quarantine.push(QuarantineCandidate {
            key: object.key,
            size: object.size,
            e_tag: object.e_tag,
            provider_version: object.provider_version,
            last_modified: object.last_modified,
            observed_at: policy.observed_at.to_rfc3339(),
        });
    }

    let report = GcReport {
        run_id: uuid::Uuid::new_v4().to_string(),
        inventory_prefix: inventory_prefix.trim_matches('/').to_owned(),
        observed_at: policy.observed_at.to_rfc3339(),
        cutoff: policy.cutoff.to_rfc3339(),
        publication_grace_seconds: policy.publication_grace.as_secs(),
        through_log_sequences,
        control_versions: roots.control_versions,
        marked,
        inventoried_artifact_count,
        inventoried_artifact_bytes,
        quarantine,
        quarantine_bytes,
    };
    if report.has_rooted_quarantine_candidate() {
        return Err(Report::new(GcError::Inventory)
            .attach_printable("internal invariant violated: rooted artifact was quarantined"));
    }
    store.telemetry().record_gc(
        report.observed_at.clone(),
        report.inventoried_artifact_count,
        report.inventoried_artifact_bytes,
        u64::try_from(report.quarantine.len()).unwrap_or(u64::MAX),
        report.quarantine_bytes,
    );
    Ok(report)
}

fn collect_direct_roots(
    roots: &GcRootSnapshot,
) -> Result<(RootPlan, BTreeMap<String, u64>), Report<GcError>> {
    let mut plan = RootPlan::default();
    if roots.shards.is_empty() {
        return Err(Report::new(GcError::InvalidProjection)
            .attach_printable("GC requires at least one shard root snapshot"));
    }
    let mut through_log_sequences = BTreeMap::new();
    let mut observed_runs = BTreeSet::new();

    for shard in &roots.shards {
        if shard.shard.trim().is_empty() || shard.shard.chars().any(char::is_whitespace) {
            return Err(Report::new(GcError::InvalidProjection)
                .attach_printable("GC shard labels must be non-empty and contain no whitespace"));
        }
        if shard.projection.poisoned.is_some() {
            return Err(
                Report::new(GcError::InvalidProjection).attach_printable(format!(
                    "refusing GC against poisoned shard {:?}",
                    shard.shard
                )),
            );
        }
        let sequence = shard.projection.through_log_sequence.ok_or_else(|| {
            Report::new(GcError::InvalidProjection).attach_printable(format!(
                "GC requires shard {:?} to have a durable journal watermark",
                shard.shard
            ))
        })?;
        if through_log_sequences
            .insert(shard.shard.clone(), sequence)
            .is_some()
        {
            return Err(Report::new(GcError::InvalidProjection)
                .attach_printable(format!("duplicate GC shard snapshot {:?}", shard.shard)));
        }
        for run_id in shard.projection.runs.keys() {
            if !observed_runs.insert(run_id.clone()) {
                return Err(
                    Report::new(GcError::InvalidProjection).attach_printable(format!(
                        "run {run_id} appears in more than one shard projection"
                    )),
                );
            }
        }
        collect_projection_roots(&mut plan, &shard.projection, &roots.history)?;
        for snapshot in &shard.projection_snapshots {
            plan.blobs.push((
                snapshot.payload.clone(),
                RootReason::new(
                    RootKind::ProjectionSnapshot,
                    format!("{}:{}", shard.shard, snapshot.through_log_sequence),
                ),
            ));
        }
    }
    for run_id in &roots.history.run_ids {
        if !observed_runs.contains(run_id) {
            return Err(Report::new(GcError::InvalidProjection)
                .attach_printable(format!("history policy references missing run {run_id}")));
        }
    }
    for (index, reference) in roots.history.artifacts.iter().enumerate() {
        plan.blobs.push((
            reference.clone(),
            RootReason::new(RootKind::ExplicitHistoryArtifact, index.to_string()),
        ));
    }
    Ok((plan, through_log_sequences))
}

fn collect_projection_roots(
    plan: &mut RootPlan,
    projection: &Projection,
    history: &HistoryRetention,
) -> Result<(), Report<GcError>> {
    let active_dlq_runs: BTreeSet<_> = projection
        .integrations
        .values()
        .flat_map(|integration| integration.dlq.values().map(|entry| entry.run_id.clone()))
        .collect();

    for (integration_id, integration) in &projection.integrations {
        if let Some(reference) = &integration.checkpoint_state {
            plan.states.push(StateRoot {
                reference: reference.clone(),
                reason: RootReason::new(RootKind::CheckpointState, integration_id.to_string()),
            });
        }
        if let Some(reference) = &integration.applied_state {
            plan.states.push(StateRoot {
                reference: reference.clone(),
                reason: RootReason::new(RootKind::AppliedState, integration_id.to_string()),
            });
        }
        if let Some(reference) = &integration.desired_definition {
            plan.blobs.push((
                reference.clone(),
                RootReason::new(RootKind::DesiredDefinition, integration_id.to_string()),
            ));
        }
        if let Some(evidence) = &integration.restore_evidence {
            if let Some(target) = &evidence.target {
                plan.states.push(StateRoot {
                    reference: target.clone(),
                    reason: RootReason::new(
                        RootKind::RestoreTarget,
                        evidence.failed_work_id.to_string(),
                    ),
                });
            }
            plan.states.push(StateRoot {
                reference: evidence.contaminated.clone(),
                reason: RootReason::new(
                    RootKind::ContaminatedState,
                    evidence.failed_work_id.to_string(),
                ),
            });
        }
        for entry in integration.dlq.values() {
            for evidence in &entry.evidence {
                plan.blobs.push((
                    evidence.clone(),
                    RootReason::new(RootKind::ActiveDlqEvidence, entry.entry_id.to_string()),
                ));
            }
            if let Some(work_id) = &entry.failed_work {
                let work = projection.work.get(work_id).ok_or_else(|| {
                    Report::new(GcError::InvalidProjection)
                        .attach_printable(format!("DLQ entry references missing work {work_id}"))
                })?;
                plan.work.push(WorkRoot {
                    integration_id: work.integration_id.clone(),
                    reference: work.manifest.clone(),
                    expected: work.clone(),
                    reason: RootReason::new(RootKind::DlqFailedWork, entry.entry_id.to_string()),
                });
            }
        }
    }

    for (run_id, run) in &projection.runs {
        let reason = if !run.status.is_terminal() {
            Some(RootReason::new(
                RootKind::NonterminalRun,
                run_id.to_string(),
            ))
        } else if active_dlq_runs.contains(run_id) {
            Some(RootReason::new(RootKind::ActiveDlqRun, run_id.to_string()))
        } else if history.run_ids.contains(run_id) {
            Some(RootReason::new(
                RootKind::ExplicitHistoryRun,
                run_id.to_string(),
            ))
        } else {
            None
        };
        if let Some(reason) = reason {
            retain_run(plan, run, reason);
        }
    }
    for run_id in &active_dlq_runs {
        if !projection.runs.contains_key(run_id) {
            return Err(Report::new(GcError::InvalidProjection)
                .attach_printable(format!("active DLQ references missing run {run_id}")));
        }
    }
    for (work_id, work) in &projection.work {
        if matches!(work.status, WorkStatus::Planned | WorkStatus::Blocked) {
            plan.work.push(WorkRoot {
                integration_id: work.integration_id.clone(),
                reference: work.manifest.clone(),
                expected: work.clone(),
                reason: RootReason::new(RootKind::LiveWork, work_id.to_string()),
            });
        } else if matches!(&work.kind, WorkKind::Apply(apply) if history.run_ids.contains(&apply.run_id))
        {
            plan.work.push(WorkRoot {
                integration_id: work.integration_id.clone(),
                reference: work.manifest.clone(),
                expected: work.clone(),
                reason: RootReason::new(RootKind::ExplicitHistoryRun, work_id.to_string()),
            });
        }
    }
    Ok(())
}

fn retain_run(plan: &mut RootPlan, run: &RunProjection, reason: RootReason) {
    plan.blobs
        .push((run.immutable_input.artifact.clone(), reason.clone()));
    plan.blobs
        .push((run.policy.artifact.clone(), reason.clone()));
    plan.blobs.extend(
        run.artifacts
            .values()
            .cloned()
            .map(|value| (value, reason.clone())),
    );
    plan.blobs.extend(
        run.steps
            .values()
            .cloned()
            .map(|value| (value, reason.clone())),
    );
    if let Some(result) = &run.result {
        plan.blobs.push((result.clone(), reason));
    }
}

fn work_state_references(kind: &WorkKind) -> Vec<StateVersionRef> {
    match kind {
        WorkKind::Apply(apply) => vec![apply.candidate.clone()],
        WorkKind::Restore(restore) => restore
            .target
            .iter()
            .cloned()
            .chain(std::iter::once(restore.contaminated.clone()))
            .collect(),
        WorkKind::Reconcile(reconcile) => vec![reconcile.target.clone()],
    }
}

fn work_target_state_digest(kind: &WorkKind) -> String {
    match kind {
        WorkKind::Apply(apply) => apply.candidate.id.to_string(),
        WorkKind::Restore(restore) => restore
            .target
            .as_ref()
            .map_or_else(String::new, |target| target.id.to_string()),
        WorkKind::Reconcile(reconcile) => reconcile.target.id.to_string(),
    }
}

fn older_than_both(object: &ListedObject, policy: GcPolicy) -> Result<bool, Report<GcError>> {
    let modified = DateTime::parse_from_rfc3339(&object.last_modified)
        .change_context(GcError::Inventory)?
        .with_timezone(&Utc);
    if modified >= policy.cutoff || modified >= policy.observed_at {
        return Ok(false);
    }
    let age = policy
        .observed_at
        .signed_duration_since(modified)
        .to_std()
        .change_context(GcError::Inventory)?;
    Ok(age >= policy.publication_grace)
}

fn is_content_addressed_key(key: &str) -> bool {
    let segments: Vec<_> = key.split('/').collect();
    segments.windows(3).any(|window| {
        let [marker, shard, file] = window else {
            return false;
        };
        if *marker != "sha256" || shard.len() != 2 {
            return false;
        }
        let digest = file.split('.').next().unwrap_or_default();
        digest.len() == 64
            && digest.starts_with(*shard)
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::blob::{BlobRefV1, StateSnapshot, StateSnapshotV1};
    use crate::graph::artifacts::{
        DesiredDispositionV1, DesiredGraphObjectV1, DesiredObjectKeyV1, DesiredProjectionIndexV1,
        DesiredProjectionPageBoundsV1, DesiredProjectionPageV1, EffectIndexV1, EffectPageV1,
        GraphObjectKindV1, DESIRED_PROJECTION_INDEX_MEDIA_TYPE, DESIRED_PROJECTION_PAGE_MEDIA_TYPE,
        EFFECT_INDEX_SCHEMA_VERSION, GRAPH_EFFECT_INDEX_MEDIA_TYPE, GRAPH_EFFECT_PAGE_MEDIA_TYPE,
    };
    use crate::graph::effects::{
        BlobSliceRefV1, GraphEffect, GraphEffectV1, GraphOperationV1, EFFECT_ENCODING_VERSION,
        EFFECT_IDENTITY_VERSION, GRAPH_EFFECT_PAYLOAD_MEDIA_TYPE,
    };
    use crate::orchestrator::events::{InputRef, PolicyRef};
    use crate::orchestrator::ids::{EffectId, EventId, StateVersionId, WorkId};
    use crate::orchestrator::projection::{IntegrationProjection, MaintenanceStatus, RunStatus};
    use crate::orchestrator::work::{
        DesiredProjectionRef, ReconcileWorkV1, StatePhase, StatePhaseV1, StateVersionV1,
        WorkManifestV1,
    };
    use sha2::{Digest as _, Sha256};

    fn integration() -> CanonicalIntegrationId {
        CanonicalIntegrationId::parse("alice:gc-test").unwrap()
    }

    fn run_id(label: &str) -> RunId {
        RunId::parse(uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, label.as_bytes()).to_string())
            .unwrap()
    }

    fn blob(key: &str, byte: u8, media_type: &str) -> BlobRef {
        BlobRef::V1(BlobRefV1 {
            key: format!(
                "tenants/alice/{key}/sha256/{byte:02x}/{}",
                hex::encode([byte; 32])
            ),
            sha256: hex::encode([byte; 32]),
            size: 1,
            media_type: media_type.to_owned(),
            e_tag: None,
            provider_version: None,
        })
    }

    fn state_ref(label: u8) -> StateVersionRef {
        StateVersionRef {
            id: StateVersionId::from_digest(hex::encode([label; 32])),
            artifact: blob("states", label, "application/json"),
        }
    }

    fn work_projection(
        integration_id: &CanonicalIntegrationId,
        state: StateVersionRef,
        status: WorkStatus,
    ) -> WorkProjection {
        let id = WorkId::from_digest("9".repeat(64));
        WorkProjection {
            integration_id: integration_id.clone(),
            manifest: WorkManifestRef {
                work_id: id,
                artifact: blob("manifests", 0x90, "application/json"),
                manifest_digest: hex::encode([0x90; 32]),
            },
            kind: WorkKind::Reconcile(ReconcileWorkV1 {
                target: state,
                applied_incarnation: None,
                cycle: 1,
            }),
            effect_count: 1,
            completed_effect_count: 0,
            status,
            last_completed_effect: None,
            failure: None,
            settings_revision: Some(1),
            revision: EventId::from_digest("8".repeat(64)),
        }
    }

    fn run_projection(status: RunStatus, id: &RunId) -> RunProjection {
        RunProjection {
            integration_id: integration(),
            status,
            attempt: 1,
            handler_failures: 0,
            attempt_id: None,
            immutable_input: InputRef {
                artifact: blob("inputs", 0x11, "application/json"),
                definition_digest: "2".repeat(64),
                definition_digest_encoding_version: 1,
                planner_version: 1,
            },
            policy: PolicyRef {
                artifact: blob("policies", 0x12, "application/json"),
                policy_digest: "3".repeat(64),
            },
            submitted_at: "2026-07-22T00:00:00Z".to_owned(),
            artifacts: BTreeMap::new(),
            steps: BTreeMap::new(),
            result: None,
            outcome: None,
            failure: None,
            revision: EventId::from_digest(hex::encode(Sha256::digest(id.as_str()))),
        }
    }

    #[test]
    fn direct_root_plan_covers_independent_state_work_run_dlq_history_and_snapshots() {
        let integration_id = integration();
        let checkpoint = state_ref(0x21);
        let applied = state_ref(0x22);
        let contaminated = state_ref(0x23);
        let target = state_ref(0x24);
        let live_work = work_projection(&integration_id, applied.clone(), WorkStatus::Blocked);
        let live_work_id = live_work.manifest.work_id.clone();
        let failed_work = work_projection(
            &integration_id,
            contaminated.clone(),
            WorkStatus::Terminated,
        );
        let failed_work_id = WorkId::from_digest("7".repeat(64));
        let failed_work = WorkProjection {
            manifest: WorkManifestRef {
                work_id: failed_work_id.clone(),
                ..failed_work.manifest
            },
            ..failed_work
        };
        let active_run = run_id("active");
        let history_run = run_id("history");
        let entry_id = super::super::ids::DlqEntryId::from_digest("6".repeat(64));
        let mut integration_projection = IntegrationProjection {
            checkpoint_state: Some(checkpoint),
            applied_state: Some(applied),
            desired_definition: Some(blob("definitions", 0x25, "application/json")),
            maintenance: MaintenanceStatus::Blocked,
            restore_evidence: Some(super::super::projection::RestoreEvidence {
                failed_run_id: active_run.clone(),
                failed_work_id: failed_work_id.clone(),
                target: Some(target),
                contaminated,
                dlq_entry_id: Some(entry_id.clone()),
            }),
            ..IntegrationProjection::default()
        };
        integration_projection.dlq.insert(
            entry_id.clone(),
            super::super::projection::DlqEntryV1 {
                entry_id,
                run_id: active_run.clone(),
                attempt_id: None,
                failed_work: Some(failed_work_id.clone()),
                failure: super::super::events::FailureSummary {
                    code: "failed".to_owned(),
                    message: "failed".to_owned(),
                    retryable: false,
                },
                evidence: vec![blob("dlq", 0x26, "application/json")],
                entered_at_sequence: 1,
                maintenance_failure: None,
            },
        );
        let mut projection = Projection {
            through_log_sequence: Some(10),
            ..Projection::default()
        };
        projection
            .integrations
            .insert(integration_id.clone(), integration_projection);
        projection.runs.insert(
            active_run.clone(),
            run_projection(RunStatus::Terminated, &active_run),
        );
        projection.runs.insert(
            history_run.clone(),
            run_projection(RunStatus::Completed, &history_run),
        );
        projection.work.insert(live_work_id, live_work);
        projection.work.insert(failed_work_id, failed_work);
        let roots = GcRootSnapshot {
            shards: vec![ShardRootSnapshot {
                shard: "039".to_owned(),
                projection,
                projection_snapshots: vec![ProjectionSnapshotRoot {
                    through_log_sequence: 9,
                    payload: blob("projection", 0x27, "application/json"),
                }],
            }],
            history: HistoryRetention {
                run_ids: BTreeSet::from([history_run]),
                artifacts: vec![blob("history", 0x28, "application/octet-stream")],
            },
            control_versions: BTreeMap::new(),
        };
        let (plan, sequences) = collect_direct_roots(&roots).unwrap();
        assert_eq!(sequences, BTreeMap::from([("039".to_owned(), 10)]));
        let state_kinds: BTreeSet<_> = plan
            .states
            .iter()
            .map(|root| root.reason.kind.clone())
            .collect();
        assert!(state_kinds.contains(&RootKind::CheckpointState));
        assert!(state_kinds.contains(&RootKind::AppliedState));
        assert!(state_kinds.contains(&RootKind::RestoreTarget));
        assert!(state_kinds.contains(&RootKind::ContaminatedState));
        let work_kinds: BTreeSet<_> = plan
            .work
            .iter()
            .map(|root| root.reason.kind.clone())
            .collect();
        assert!(work_kinds.contains(&RootKind::LiveWork));
        assert!(work_kinds.contains(&RootKind::DlqFailedWork));
        let blob_kinds: BTreeSet<_> = plan
            .blobs
            .iter()
            .map(|(_, reason)| reason.kind.clone())
            .collect();
        for kind in [
            RootKind::DesiredDefinition,
            RootKind::ActiveDlqRun,
            RootKind::ActiveDlqEvidence,
            RootKind::ExplicitHistoryRun,
            RootKind::ExplicitHistoryArtifact,
            RootKind::ProjectionSnapshot,
        ] {
            assert!(blob_kinds.contains(&kind), "missing {kind:?}");
        }
    }

    #[tokio::test]
    async fn report_marks_transitive_pages_and_payloads_and_only_quarantines_the_orphan() {
        let cache = tempfile::tempdir().unwrap();
        let store = ArtifactStore::in_memory(cache.path()).unwrap();
        let prefix = "tenants/alice";
        let desired_payload = store
            .publish_bytes(
                b"desired-payload",
                ".pack",
                &format!("{prefix}/payloads"),
                GRAPH_EFFECT_PAYLOAD_MEDIA_TYPE,
            )
            .await
            .unwrap();
        let desired_digest = hex::encode(Sha256::digest(b"desired-payload"));
        let desired_page = DesiredProjectionArtifact::V1(DesiredProjectionArtifactV1::Page(
            DesiredProjectionPageV1 {
                objects: vec![DesiredGraphObjectV1 {
                    kind: GraphObjectKindV1::Entity,
                    graph_identity: "entity-1".to_owned(),
                    disposition: DesiredDispositionV1::Live {
                        payload_digest: desired_digest,
                        payload: BlobSliceRefV1 {
                            artifact: desired_payload.clone(),
                            offset: 0,
                            length: 15,
                        },
                    },
                }],
            },
        ));
        let desired_page_ref = store
            .publish_record(
                &desired_page,
                MAX_PAGE_BYTES,
                &format!("{prefix}/desired-pages"),
                DESIRED_PROJECTION_PAGE_MEDIA_TYPE,
            )
            .await
            .unwrap();
        let desired_index = DesiredProjectionArtifact::V1(DesiredProjectionArtifactV1::Index(
            DesiredProjectionIndexV1 {
                schema_version: 1,
                object_count: 1,
                page_entries: 256,
                pages: vec![desired_page_ref.clone()],
                page_bounds: vec![DesiredProjectionPageBoundsV1 {
                    first: DesiredObjectKeyV1 {
                        kind: GraphObjectKindV1::Entity,
                        graph_identity: "entity-1".to_owned(),
                    },
                    last: DesiredObjectKeyV1 {
                        kind: GraphObjectKindV1::Entity,
                        graph_identity: "entity-1".to_owned(),
                    },
                }],
            },
        ));
        let desired_index_ref = store
            .publish_record(
                &desired_index,
                MAX_INDEX_BYTES,
                &format!("{prefix}/desired-indexes"),
                DESIRED_PROJECTION_INDEX_MEDIA_TYPE,
            )
            .await
            .unwrap();
        let duckdb = store
            .publish_bytes(
                b"duckdb",
                ".duckdb",
                &format!("{prefix}/states"),
                "application/vnd.duckdb",
            )
            .await
            .unwrap();
        let state = StateVersionV1::new(
            "actor:owner".to_owned(),
            None,
            StatePhase::V1(StatePhaseV1::LinksCommitted),
            StateSnapshot::V1(StateSnapshotV1 {
                generation: 1,
                duckdb: duckdb.clone(),
                accepted_batches: vec![],
                created_at: "2026-07-23T00:00:00Z".to_owned(),
            }),
            DesiredProjectionRef {
                artifact: desired_index_ref.clone(),
            },
            "a".repeat(64),
            1,
            1,
            1,
            1,
        )
        .unwrap();
        let state_artifact = store
            .publish_record(
                &StateVersion::V1(state.clone()),
                MAX_STATE_VERSION_BYTES,
                &format!("{prefix}/state-records"),
                "application/vnd.hash.state-version+json",
            )
            .await
            .unwrap();
        let state_reference = StateVersionRef {
            id: state.id.clone(),
            artifact: state_artifact.clone(),
        };

        let effect_payload = store
            .publish_bytes(
                b"effect-payload",
                ".pack",
                &format!("{prefix}/payloads"),
                GRAPH_EFFECT_PAYLOAD_MEDIA_TYPE,
            )
            .await
            .unwrap();
        let effect = GraphEffectV1::new(
            state.id.to_string(),
            GraphOperationV1::UpsertEntity,
            "entity-1".to_owned(),
            Some(hex::encode(Sha256::digest(b"effect-payload"))),
            Some(BlobSliceRefV1 {
                artifact: effect_payload.clone(),
                offset: 0,
                length: 14,
            }),
        )
        .unwrap();
        let effect_page = EffectIndexArtifact::V1(EffectIndexArtifactV1::Page(EffectPageV1 {
            effects: vec![GraphEffect::V1(effect)],
        }));
        let effect_page_ref = store
            .publish_record(
                &effect_page,
                MAX_PAGE_BYTES,
                &format!("{prefix}/effect-pages"),
                GRAPH_EFFECT_PAGE_MEDIA_TYPE,
            )
            .await
            .unwrap();
        let effect_index = EffectIndexArtifact::V1(EffectIndexArtifactV1::Index(EffectIndexV1 {
            schema_version: EFFECT_INDEX_SCHEMA_VERSION,
            target_state_digest: state.id.to_string(),
            effect_count: 1,
            page_entries: 256,
            pages: vec![effect_page_ref.clone()],
        }));
        let effect_index_ref = store
            .publish_record(
                &effect_index,
                MAX_INDEX_BYTES,
                &format!("{prefix}/effect-indexes"),
                GRAPH_EFFECT_INDEX_MEDIA_TYPE,
            )
            .await
            .unwrap();
        let kind = WorkKind::Reconcile(ReconcileWorkV1 {
            target: state_reference.clone(),
            applied_incarnation: None,
            cycle: 1,
        });
        let manifest = WorkManifestV1::new(
            &integration(),
            "actor:owner".to_owned(),
            kind.clone(),
            effect_index_ref.clone(),
            1,
            EFFECT_IDENTITY_VERSION,
            EFFECT_ENCODING_VERSION,
            "2026-07-23T00:00:00Z".to_owned(),
        )
        .unwrap();
        let manifest_artifact = store
            .publish_record(
                &WorkManifest::V1(manifest.clone()),
                MAX_WORK_MANIFEST_BYTES,
                &format!("{prefix}/work-manifests"),
                "application/vnd.hash.work-manifest+json",
            )
            .await
            .unwrap();
        let snapshot_payload = store
            .publish_bytes(
                b"projection-snapshot",
                ".json",
                &format!("{prefix}/projection-snapshots"),
                "application/json",
            )
            .await
            .unwrap();
        let orphan = store
            .publish_bytes(
                b"orphan",
                ".bin",
                &format!("{prefix}/orphans"),
                "application/octet-stream",
            )
            .await
            .unwrap();

        let work = WorkProjection {
            integration_id: integration(),
            manifest: WorkManifestRef {
                work_id: manifest.work_id.clone(),
                manifest_digest: manifest_artifact.current().sha256.clone(),
                artifact: manifest_artifact.clone(),
            },
            kind,
            effect_count: 1,
            completed_effect_count: 0,
            status: WorkStatus::Blocked,
            last_completed_effect: Some(EffectId::from_digest("f".repeat(64))),
            failure: None,
            settings_revision: Some(1),
            revision: EventId::from_digest("e".repeat(64)),
        };
        let mut projection = Projection {
            through_log_sequence: Some(7),
            ..Projection::default()
        };
        projection.integrations.insert(
            integration(),
            IntegrationProjection {
                checkpoint_state: Some(state_reference.clone()),
                applied_state: Some(state_reference.clone()),
                reconciliation_work: Some(manifest.work_id.clone()),
                maintenance: MaintenanceStatus::RestoreRequired,
                restore_evidence: Some(super::super::projection::RestoreEvidence {
                    failed_run_id: run_id("contaminated"),
                    failed_work_id: WorkId::from_digest("d".repeat(64)),
                    target: None,
                    contaminated: state_reference,
                    dlq_entry_id: None,
                }),
                ..IntegrationProjection::default()
            },
        );
        projection.work.insert(manifest.work_id.clone(), work);
        let now = Utc::now();
        let report = mark_and_report(
            &store,
            prefix,
            GcRootSnapshot {
                shards: vec![ShardRootSnapshot {
                    shard: "039".to_owned(),
                    projection,
                    projection_snapshots: vec![ProjectionSnapshotRoot {
                        through_log_sequence: 6,
                        payload: snapshot_payload.clone(),
                    }],
                }],
                history: HistoryRetention::default(),
                control_versions: BTreeMap::from([(
                    "baseline".to_owned(),
                    ObservedControlVersion {
                        e_tag: Some("etag-v1".to_owned()),
                        provider_version: Some("provider-v1".to_owned()),
                    },
                )]),
            },
            GcPolicy {
                observed_at: now + chrono::Duration::hours(2),
                cutoff: now + chrono::Duration::hours(1),
                publication_grace: Duration::from_secs(60 * 60),
                maximum_publication_attempt: Duration::from_secs(30 * 60),
            },
        )
        .await
        .unwrap();

        for rooted in [
            state_artifact.clone(),
            duckdb,
            desired_index_ref,
            desired_page_ref,
            desired_payload,
            manifest_artifact,
            effect_index_ref,
            effect_page_ref,
            effect_payload,
            snapshot_payload,
        ] {
            assert!(
                report.marked.contains_key(&rooted.current().key),
                "missing transitive root {}",
                rooted.current().key
            );
        }
        assert_eq!(
            report
                .quarantine
                .iter()
                .map(|candidate| candidate.key.as_str())
                .collect::<Vec<_>>(),
            vec![orphan.current().key.as_str()]
        );
        assert!(!report.has_rooted_quarantine_candidate());
        assert!(report.marked[&state_artifact.current().key]
            .reasons
            .iter()
            .any(|reason| reason.kind == RootKind::ContaminatedState));
        assert_eq!(
            report.through_log_sequences,
            BTreeMap::from([("039".to_owned(), 7)])
        );
        assert_eq!(
            report.control_versions["baseline"].e_tag.as_deref(),
            Some("etag-v1")
        );
    }

    #[tokio::test]
    async fn tenant_inventory_never_quarantines_an_artifact_rooted_only_by_another_shard() {
        let cache = tempfile::tempdir().unwrap();
        let store = ArtifactStore::in_memory(cache.path()).unwrap();
        let prefix = "tenants/alice";
        let input = store
            .publish_bytes(
                b"input",
                ".json",
                &format!("{prefix}/inputs"),
                "application/json",
            )
            .await
            .unwrap();
        let policy_artifact = store
            .publish_bytes(
                b"policy",
                ".json",
                &format!("{prefix}/policies"),
                "application/json",
            )
            .await
            .unwrap();
        let orphan = store
            .publish_bytes(
                b"orphan",
                ".bin",
                &format!("{prefix}/orphans"),
                "application/octet-stream",
            )
            .await
            .unwrap();

        let run_id = run_id("second-shard-root");
        let mut run = run_projection(RunStatus::Accepted, &run_id);
        run.immutable_input.artifact = input.clone();
        run.policy.artifact = policy_artifact.clone();
        let mut second = Projection {
            through_log_sequence: Some(12),
            ..Projection::default()
        };
        second.runs.insert(run_id, run);
        let now = Utc::now();
        let report = mark_and_report(
            &store,
            prefix,
            GcRootSnapshot {
                shards: vec![
                    ShardRootSnapshot {
                        shard: "001".to_owned(),
                        projection: Projection {
                            through_log_sequence: Some(4),
                            ..Projection::default()
                        },
                        projection_snapshots: vec![],
                    },
                    ShardRootSnapshot {
                        shard: "039".to_owned(),
                        projection: second,
                        projection_snapshots: vec![],
                    },
                ],
                history: HistoryRetention::default(),
                control_versions: BTreeMap::new(),
            },
            GcPolicy {
                observed_at: now + chrono::Duration::hours(2),
                cutoff: now + chrono::Duration::hours(1),
                publication_grace: Duration::from_secs(60 * 60),
                maximum_publication_attempt: Duration::from_secs(30 * 60),
            },
        )
        .await
        .unwrap();

        assert!(report.marked.contains_key(&input.current().key));
        assert!(report.marked.contains_key(&policy_artifact.current().key));
        assert_eq!(
            report
                .quarantine
                .iter()
                .map(|candidate| candidate.key.as_str())
                .collect::<Vec<_>>(),
            vec![orphan.current().key.as_str()]
        );
        assert_eq!(
            report.through_log_sequences,
            BTreeMap::from([("001".to_owned(), 4), ("039".to_owned(), 12)])
        );
    }

    #[test]
    fn policy_requires_a_grace_strictly_longer_than_publication_attempts() {
        let now = Utc::now();
        let invalid = GcPolicy {
            observed_at: now,
            cutoff: now,
            publication_grace: Duration::from_secs(60),
            maximum_publication_attempt: Duration::from_secs(60),
        };
        assert_eq!(
            invalid.validate().unwrap_err().current_context(),
            &GcError::InvalidConfiguration
        );
    }

    #[test]
    fn cutoff_and_publication_grace_are_independent_guards() {
        let modified = Utc::now();
        let object = ListedObject {
            key: "tenants/alice/orphans/sha256/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bin".to_owned(),
            size: 1,
            e_tag: Some("etag".to_owned()),
            provider_version: None,
            last_modified: modified.to_rfc3339(),
        };
        let base = GcPolicy {
            observed_at: modified + chrono::Duration::minutes(30),
            cutoff: modified + chrono::Duration::minutes(1),
            publication_grace: Duration::from_secs(60 * 60),
            maximum_publication_attempt: Duration::from_secs(30 * 60),
        };
        assert!(!older_than_both(&object, base).unwrap());
        assert!(!older_than_both(
            &object,
            GcPolicy {
                observed_at: modified + chrono::Duration::hours(2),
                cutoff: modified - chrono::Duration::seconds(1),
                ..base
            }
        )
        .unwrap());
        assert!(older_than_both(
            &object,
            GcPolicy {
                observed_at: modified + chrono::Duration::hours(2),
                cutoff: modified + chrono::Duration::hours(1),
                ..base
            }
        )
        .unwrap());
    }

    #[test]
    fn one_key_with_conflicting_root_identity_fails_closed() {
        let cache = tempfile::tempdir().unwrap();
        let store = ArtifactStore::in_memory(cache.path()).unwrap();
        let mut marker = Marker::new(&store, "tenants/alice").unwrap();
        let first = blob("same", 0x41, "application/octet-stream");
        let mut second = first.clone();
        let BlobRef::V1(value) = &mut second;
        value.sha256 = "b".repeat(64);
        marker
            .mark(
                &first,
                RootReason::new(RootKind::ExplicitHistoryArtifact, "first"),
            )
            .unwrap();
        let error = marker
            .mark(
                &second,
                RootReason::new(RootKind::ExplicitHistoryArtifact, "second"),
            )
            .unwrap_err();
        assert_eq!(error.current_context(), &GcError::ConflictingRootIdentity);
    }

    #[tokio::test]
    async fn corrupt_rooted_state_aborts_before_an_orphan_can_be_reported() {
        let cache = tempfile::tempdir().unwrap();
        let store = ArtifactStore::in_memory(cache.path()).unwrap();
        let corrupt = store
            .publish_bytes(
                b"not-a-state-record",
                ".json",
                "tenants/alice/state-records",
                "application/vnd.hash.state-version+json",
            )
            .await
            .unwrap();
        let mut projection = Projection {
            through_log_sequence: Some(1),
            ..Projection::default()
        };
        projection.integrations.insert(
            integration(),
            IntegrationProjection {
                checkpoint_state: Some(StateVersionRef {
                    id: StateVersionId::from_digest("a".repeat(64)),
                    artifact: corrupt,
                }),
                ..IntegrationProjection::default()
            },
        );
        let now = Utc::now();
        let error = mark_and_report(
            &store,
            "tenants/alice",
            GcRootSnapshot {
                shards: vec![ShardRootSnapshot {
                    shard: "039".to_owned(),
                    projection,
                    projection_snapshots: vec![],
                }],
                history: HistoryRetention::default(),
                control_versions: BTreeMap::new(),
            },
            GcPolicy {
                observed_at: now,
                cutoff: now,
                publication_grace: Duration::from_secs(61),
                maximum_publication_attempt: Duration::from_secs(60),
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.current_context(), &GcError::RootArtifactInvalid);
    }
}
