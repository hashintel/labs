//! Versioned immutable state and external-work records.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ids::{
    canonical_digest, CanonicalIntegrationId, EventId, RunId, StateVersionId, WorkId,
};
use super::registry::{
    reject_unknown_fields, AlgorithmVersion, CompatError, DurabilityClass, DurableRecord,
    MigrationPolicy, PureUpcastRecord, RecordFamily, VersionedRecord,
};
use crate::blob::{BlobRef, BlobRefV1, StateSnapshot};

pub(crate) const MAX_STATE_VERSION_BYTES: usize = 256 * 1024;
pub(crate) const MAX_WORK_MANIFEST_BYTES: usize = 256 * 1024;
const IDENTITY_VERSION: u32 = 1;

pub(crate) static STATE_VERSION_FAMILY: RecordFamily = RecordFamily {
    name: "state_version",
    owning_module: "orchestrator::work",
    emitted_version: 1,
    supported_versions: &[1],
    algorithm_versions: &[AlgorithmVersion {
        name: "state_identity",
        version: IDENTITY_VERSION,
    }],
    durability: DurabilityClass::ImmutableArtifact,
    migration: MigrationPolicy::PureUpcast,
};

pub(crate) static WORK_MANIFEST_FAMILY: RecordFamily = RecordFamily {
    name: "work_manifest",
    owning_module: "orchestrator::work",
    emitted_version: 1,
    supported_versions: &[1],
    algorithm_versions: &[
        AlgorithmVersion {
            name: "apply_work_identity",
            version: IDENTITY_VERSION,
        },
        AlgorithmVersion {
            name: "reconcile_work_identity",
            version: IDENTITY_VERSION,
        },
        AlgorithmVersion {
            name: "restore_work_identity",
            version: IDENTITY_VERSION,
        },
    ],
    durability: DurabilityClass::ImmutableArtifact,
    migration: MigrationPolicy::PureUpcast,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub enum StateVersion {
    V1(StateVersionV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StateVersionV1 {
    pub id: StateVersionId,
    pub parent: Option<StateVersionRef>,
    pub phase: StatePhase,
    pub snapshot: StateSnapshot,
    pub desired_projection: DesiredProjectionRef,
    pub definition_digest: String,
    pub definition_digest_encoding_version: u32,
    pub planner_version: u32,
    pub state_schema_version: u32,
    pub desired_projection_schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StateVersionRef {
    pub id: StateVersionId,
    pub artifact: BlobRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DesiredProjectionRef {
    pub artifact: BlobRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub enum StatePhase {
    V1(StatePhaseV1),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StatePhaseV1 {
    SourcesCommitted,
    LinksCommitted,
    Stream,
}

impl StateVersionV1 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        parent: Option<StateVersionRef>,
        phase: StatePhase,
        snapshot: StateSnapshot,
        desired_projection: DesiredProjectionRef,
        definition_digest: String,
        definition_digest_encoding_version: u32,
        planner_version: u32,
        state_schema_version: u32,
        desired_projection_schema_version: u32,
    ) -> Result<Self, CompatError> {
        let mut state = Self {
            id: StateVersionId::from_digest("0".repeat(64)),
            parent,
            phase,
            snapshot,
            desired_projection,
            definition_digest,
            definition_digest_encoding_version,
            planner_version,
            state_schema_version,
            desired_projection_schema_version,
        };
        validate_state_fields(&state)?;
        state.id = derive_state_version_id(&state)?;
        Ok(state)
    }

    pub fn verify_identity(&self) -> Result<(), CompatError> {
        let expected = derive_state_version_id(self)?;
        if self.id == expected {
            Ok(())
        } else {
            Err(conflict(
                StateVersion::FAMILY.name,
                format!("state ID mismatch: expected {expected}, found {}", self.id),
            ))
        }
    }
}

impl StateVersion {
    pub fn into_current(self) -> Result<StateVersionV1, CompatError> {
        let Self::V1(state) = self;
        validate_state(&state)?;
        Ok(state)
    }

    pub fn try_current(&self) -> Result<&StateVersionV1, CompatError> {
        let state = self.wire();
        validate_state(state)?;
        Ok(state)
    }

    fn wire(&self) -> &StateVersionV1 {
        match self {
            Self::V1(state) => state,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub enum WorkManifest {
    V1(WorkManifestV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkManifestV1 {
    pub work_id: WorkId,
    pub kind: WorkKind,
    pub effects: BlobRef,
    pub effect_count: u64,
    pub effect_identity_version: u32,
    pub effect_encoding_version: u32,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum WorkKind {
    Apply(ApplyWorkV1),
    Restore(RestoreWorkV1),
    Reconcile(ReconcileWorkV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApplyWorkV1 {
    pub run_id: RunId,
    pub candidate: StateVersionRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RestoreWorkV1 {
    pub failed_run_id: RunId,
    pub failed_work_id: WorkId,
    pub target: Option<StateVersionRef>,
    pub contaminated: StateVersionRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReconcileWorkV1 {
    pub target: StateVersionRef,
    pub applied_incarnation: Option<EventId>,
    pub cycle: u64,
}

impl WorkManifestV1 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        integration_id: &CanonicalIntegrationId,
        kind: WorkKind,
        effects: BlobRef,
        effect_count: u64,
        effect_identity_version: u32,
        effect_encoding_version: u32,
        created_at: String,
    ) -> Result<Self, CompatError> {
        let mut manifest = Self {
            work_id: WorkId::from_digest("0".repeat(64)),
            kind,
            effects,
            effect_count,
            effect_identity_version,
            effect_encoding_version,
            created_at,
        };
        validate_work_fields(&manifest)?;
        manifest.work_id = derive_work_id(integration_id, &manifest)?;
        Ok(manifest)
    }

    pub fn verify_identity(
        &self,
        integration_id: &CanonicalIntegrationId,
    ) -> Result<(), CompatError> {
        let expected = derive_work_id(integration_id, self)?;
        if self.work_id == expected {
            Ok(())
        } else {
            Err(conflict(
                WorkManifest::FAMILY.name,
                format!(
                    "work ID mismatch for integration {integration_id}: expected {expected}, found {}",
                    self.work_id
                ),
            ))
        }
    }
}

impl WorkManifest {
    pub fn into_current_for(
        self,
        integration_id: &CanonicalIntegrationId,
    ) -> Result<WorkManifestV1, CompatError> {
        let Self::V1(manifest) = self;
        validate_work_fields(&manifest)?;
        manifest.verify_identity(integration_id)?;
        Ok(manifest)
    }

    pub fn try_current_for(
        &self,
        integration_id: &CanonicalIntegrationId,
    ) -> Result<&WorkManifestV1, CompatError> {
        let manifest = self.wire();
        validate_work_fields(manifest)?;
        manifest.verify_identity(integration_id)?;
        Ok(manifest)
    }

    fn wire(&self) -> &WorkManifestV1 {
        match self {
            Self::V1(manifest) => manifest,
        }
    }
}

#[derive(Serialize)]
struct BlobIdentity<'a> {
    sha256: &'a str,
    size: u64,
    media_type: &'a str,
}

#[derive(Serialize)]
struct StateRefIdentity<'a> {
    id: &'a StateVersionId,
    artifact: BlobIdentity<'a>,
}

#[derive(Serialize)]
struct StateIdentity<'a> {
    parent: Option<StateRefIdentity<'a>>,
    phase: &'a StatePhase,
    snapshot: SnapshotIdentity<'a>,
    desired_projection: BlobIdentity<'a>,
    definition_digest: &'a str,
    definition_digest_encoding_version: u32,
    planner_version: u32,
    state_schema_version: u32,
    desired_projection_schema_version: u32,
}

#[derive(Serialize)]
struct SnapshotIdentity<'a> {
    generation: u64,
    duckdb: BlobIdentity<'a>,
    accepted_batches: Vec<BlobIdentity<'a>>,
}

#[derive(Serialize)]
struct ApplyWorkIdentity<'a> {
    integration_id: &'a CanonicalIntegrationId,
    run_id: &'a RunId,
    candidate: StateRefIdentity<'a>,
    effects: BlobIdentity<'a>,
    effect_count: u64,
    effect_identity_version: u32,
    effect_encoding_version: u32,
}

#[derive(Serialize)]
struct RestoreWorkIdentity<'a> {
    integration_id: &'a CanonicalIntegrationId,
    failed_work_id: &'a WorkId,
    target_state_digest_or_empty: &'a str,
    contaminated_state_digest: &'a StateVersionId,
}

#[derive(Serialize)]
struct ReconcileWorkIdentity<'a> {
    integration_id: &'a CanonicalIntegrationId,
    target_state_digest: &'a StateVersionId,
    applied_incarnation: Option<EventId>,
    cycle: u64,
}

fn derive_state_version_id(state: &StateVersionV1) -> Result<StateVersionId, CompatError> {
    let snapshot = state.snapshot.current();
    let projection = StateIdentity {
        parent: state.parent.as_ref().map(state_ref_identity),
        phase: &state.phase,
        snapshot: SnapshotIdentity {
            generation: snapshot.generation,
            duckdb: blob_identity(&snapshot.duckdb),
            accepted_batches: snapshot
                .accepted_batches
                .iter()
                .map(blob_identity)
                .collect(),
        },
        desired_projection: blob_identity(&state.desired_projection.artifact),
        definition_digest: &state.definition_digest,
        definition_digest_encoding_version: state.definition_digest_encoding_version,
        planner_version: state.planner_version,
        state_schema_version: state.state_schema_version,
        desired_projection_schema_version: state.desired_projection_schema_version,
    };
    canonical_digest("state-version:v1", &projection)
        .map(StateVersionId::from_digest)
        .map_err(|error| malformed(StateVersion::FAMILY.name, error.to_string()))
}

fn derive_work_id(
    integration_id: &CanonicalIntegrationId,
    manifest: &WorkManifestV1,
) -> Result<WorkId, CompatError> {
    // Apply names a fully materialized delivery plan. Restore and Reconcile
    // instead name recovery obligations: regenerated effect artifacts must not
    // change their IDs after a crash before WorkPlanned becomes durable.
    let digest = match &manifest.kind {
        WorkKind::Apply(work) => canonical_digest(
            "work:v1",
            &ApplyWorkIdentity {
                integration_id,
                run_id: &work.run_id,
                candidate: state_ref_identity(&work.candidate),
                effects: blob_identity(&manifest.effects),
                effect_count: manifest.effect_count,
                effect_identity_version: manifest.effect_identity_version,
                effect_encoding_version: manifest.effect_encoding_version,
            },
        ),
        WorkKind::Restore(work) => canonical_digest(
            "restore-v1",
            &RestoreWorkIdentity {
                integration_id,
                failed_work_id: &work.failed_work_id,
                target_state_digest_or_empty: work
                    .target
                    .as_ref()
                    .map_or("", |target| target.id.as_str()),
                contaminated_state_digest: &work.contaminated.id,
            },
        ),
        WorkKind::Reconcile(work) => canonical_digest(
            "reconcile-v1",
            &ReconcileWorkIdentity {
                integration_id,
                target_state_digest: &work.target.id,
                applied_incarnation: work.applied_incarnation.clone(),
                cycle: work.cycle,
            },
        ),
    };
    digest
        .map(WorkId::from_digest)
        .map_err(|error| malformed(WorkManifest::FAMILY.name, error.to_string()))
}

fn state_ref_identity(reference: &StateVersionRef) -> StateRefIdentity<'_> {
    StateRefIdentity {
        id: &reference.id,
        artifact: blob_identity(&reference.artifact),
    }
}

fn blob_identity(reference: &BlobRef) -> BlobIdentity<'_> {
    let BlobRefV1 {
        sha256,
        size,
        media_type,
        ..
    } = reference.current();
    BlobIdentity {
        sha256,
        size: *size,
        media_type,
    }
}

fn validate_state(state: &StateVersionV1) -> Result<(), CompatError> {
    validate_state_fields(state)?;
    state.verify_identity()
}

fn validate_state_fields(state: &StateVersionV1) -> Result<(), CompatError> {
    if matches!(state.phase, StatePhase::V1(StatePhaseV1::Stream)) {
        return Err(malformed(
            StateVersion::FAMILY.name,
            "continuous stream state is reserved and unsupported in protocol v1".to_owned(),
        ));
    }
    validate_sha256(
        StateVersion::FAMILY.name,
        "definition_digest",
        &state.definition_digest,
    )?;
    for (name, version) in [
        (
            "definition_digest_encoding_version",
            state.definition_digest_encoding_version,
        ),
        ("planner_version", state.planner_version),
        ("state_schema_version", state.state_schema_version),
        (
            "desired_projection_schema_version",
            state.desired_projection_schema_version,
        ),
    ] {
        if version == 0 {
            return Err(malformed(
                StateVersion::FAMILY.name,
                format!("{name} must be nonzero"),
            ));
        }
    }
    chrono::DateTime::parse_from_rfc3339(&state.snapshot.current().created_at).map_err(
        |error| {
            malformed(
                StateVersion::FAMILY.name,
                format!("snapshot.created_at must be RFC 3339: {error}"),
            )
        },
    )?;
    validate_blob(
        StateVersion::FAMILY.name,
        "snapshot.duckdb",
        &state.snapshot.current().duckdb,
    )?;
    for (index, batch) in state.snapshot.current().accepted_batches.iter().enumerate() {
        validate_blob(
            StateVersion::FAMILY.name,
            &format!("snapshot.accepted_batches[{index}]"),
            batch,
        )?;
    }
    validate_blob(
        StateVersion::FAMILY.name,
        "desired_projection.artifact",
        &state.desired_projection.artifact,
    )?;
    if let Some(parent) = &state.parent {
        validate_blob(
            StateVersion::FAMILY.name,
            "parent.artifact",
            &parent.artifact,
        )?;
    }
    Ok(())
}

fn validate_work_fields(manifest: &WorkManifestV1) -> Result<(), CompatError> {
    if manifest.effect_identity_version == 0 || manifest.effect_encoding_version == 0 {
        return Err(malformed(
            WorkManifest::FAMILY.name,
            "effect identity and encoding versions must be nonzero".to_owned(),
        ));
    }
    validate_blob(WorkManifest::FAMILY.name, "effects", &manifest.effects)?;
    chrono::DateTime::parse_from_rfc3339(&manifest.created_at).map_err(|error| {
        malformed(
            WorkManifest::FAMILY.name,
            format!("created_at must be RFC 3339: {error}"),
        )
    })?;
    Ok(())
}

fn validate_blob(family: &'static str, path: &str, reference: &BlobRef) -> Result<(), CompatError> {
    let value = reference.current();
    if value.key.is_empty() || value.media_type.is_empty() {
        return Err(malformed(
            family,
            format!("{path} key and media_type must be non-empty"),
        ));
    }
    validate_sha256(family, &format!("{path}.sha256"), &value.sha256)
}

fn validate_sha256(family: &'static str, path: &str, value: &str) -> Result<(), CompatError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(malformed(
            family,
            format!("{path} must be 64 lowercase hexadecimal characters"),
        ))
    }
}

fn malformed(family: &'static str, message: String) -> CompatError {
    CompatError::Malformed { family, message }
}

fn conflict(family: &'static str, message: String) -> CompatError {
    CompatError::Conflict { family, message }
}

fn decode<T: for<'de> Deserialize<'de>>(
    bytes: &[u8],
    family: &'static str,
    maximum: usize,
) -> Result<T, CompatError> {
    if bytes.len() > maximum {
        return Err(malformed(
            family,
            format!("record is {} bytes; maximum is {maximum}", bytes.len()),
        ));
    }
    let value: Value =
        serde_json::from_slice(bytes).map_err(|error| malformed(family, error.to_string()))?;
    reject_unknown_fields(family, "", &value, &["version", "data"])?;
    let version = value
        .get("version")
        .and_then(Value::as_str)
        .ok_or_else(|| malformed(family, "version must be a string".to_owned()))?;
    if version != "v1" {
        return Err(CompatError::UnsupportedVersion {
            family,
            version: version.to_owned(),
        });
    }
    serde_json::from_value(value).map_err(|error| malformed(family, error.to_string()))
}

impl super::registry::sealed::Sealed for StateVersion {}

impl DurableRecord for StateVersion {
    const FAMILY: &'static RecordFamily = &STATE_VERSION_FAMILY;
    const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::PureUpcast;

    fn encode(&self) -> Result<Vec<u8>, CompatError> {
        validate_state(self.wire())?;
        serde_json::to_vec(self).map_err(|error| malformed(Self::FAMILY.name, error.to_string()))
    }

    fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
        let state: Self = decode(bytes, Self::FAMILY.name, MAX_STATE_VERSION_BYTES)?;
        validate_state(state.wire())?;
        Ok(state)
    }
}

impl VersionedRecord for StateVersion {
    type Current = StateVersionV1;

    fn normalize(self) -> Result<Self::Current, CompatError> {
        Self::into_current(self)
    }
}

impl PureUpcastRecord for StateVersion {}

impl super::registry::sealed::Sealed for WorkManifest {}

impl DurableRecord for WorkManifest {
    const FAMILY: &'static RecordFamily = &WORK_MANIFEST_FAMILY;
    const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::PureUpcast;

    fn encode(&self) -> Result<Vec<u8>, CompatError> {
        validate_work_fields(self.wire())?;
        serde_json::to_vec(self).map_err(|error| malformed(Self::FAMILY.name, error.to_string()))
    }

    fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
        let manifest: Self = decode(bytes, Self::FAMILY.name, MAX_WORK_MANIFEST_BYTES)?;
        validate_work_fields(manifest.wire())?;
        Ok(manifest)
    }
}

impl VersionedRecord for WorkManifest {
    type Current = WorkManifestV1;

    fn normalize(self) -> Result<Self::Current, CompatError> {
        let Self::V1(manifest) = self;
        validate_work_fields(&manifest)?;
        Ok(manifest)
    }
}

impl PureUpcastRecord for WorkManifest {}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use crate::blob::{BlobRefV1, StateSnapshotV1};

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct IdentityGoldens {
        state_version_id: String,
        reconcile_work_id: String,
        reconcile_work_id_with_new_incarnation: String,
        restore_work_id: String,
        empty_state_restore_work_id: String,
    }

    fn identities() -> IdentityGoldens {
        serde_json::from_slice(include_bytes!(
            "../../tests/golden/protocol-identities-v1.json"
        ))
        .expect("valid independent identity fixture")
    }

    fn blob(
        key: &str,
        sha256: char,
        size: u64,
        media_type: &str,
        e_tag: &str,
        provider_version: &str,
    ) -> BlobRef {
        BlobRef::V1(BlobRefV1 {
            key: key.to_owned(),
            sha256: sha256.to_string().repeat(64),
            size,
            media_type: media_type.to_owned(),
            e_tag: Some(e_tag.to_owned()),
            provider_version: Some(provider_version.to_owned()),
        })
    }

    fn state() -> StateVersionV1 {
        StateVersionV1::new(
            None,
            StatePhase::V1(StatePhaseV1::SourcesCommitted),
            StateSnapshot::V1(StateSnapshotV1 {
                generation: 7,
                duckdb: blob(
                    "artifacts/duckdb",
                    'a',
                    100,
                    "application/vnd.duckdb",
                    "etag-duckdb",
                    "provider-a",
                ),
                accepted_batches: vec![blob(
                    "artifacts/batch",
                    'b',
                    50,
                    "application/x-parquet",
                    "etag-batch",
                    "provider-b",
                )],
                created_at: "2026-07-21T10:00:00Z".to_owned(),
            }),
            DesiredProjectionRef {
                artifact: blob(
                    "artifacts/desired",
                    'c',
                    75,
                    "application/json",
                    "etag-desired",
                    "provider-c",
                ),
            },
            "d".repeat(64),
            1,
            1,
            1,
            1,
        )
        .expect("valid state fixture")
    }

    #[test]
    fn protocol_v1_rejects_reserved_stream_state() {
        let current = state();
        let error = StateVersionV1::new(
            current.parent,
            StatePhase::V1(StatePhaseV1::Stream),
            current.snapshot,
            current.desired_projection,
            current.definition_digest,
            current.definition_digest_encoding_version,
            current.planner_version,
            current.state_schema_version,
            current.desired_projection_schema_version,
        )
        .expect_err("stream state must stay outside protocol v1");
        assert!(error.to_string().contains("continuous stream state"));
    }

    fn reconcile(incarnation: char) -> WorkManifestV1 {
        let integration =
            CanonicalIntegrationId::parse("alice:supply-chain").expect("valid integration");
        WorkManifestV1::new(
            &integration,
            WorkKind::Reconcile(ReconcileWorkV1 {
                target: StateVersionRef {
                    id: state().id,
                    artifact: blob(
                        "artifacts/state",
                        'e',
                        500,
                        "application/json",
                        "etag-state",
                        "provider-state",
                    ),
                },
                applied_incarnation: Some(
                    EventId::parse(incarnation.to_string().repeat(64))
                        .expect("valid event fixture"),
                ),
                cycle: 2,
            }),
            blob(
                "artifacts/effects",
                '1',
                300,
                "application/x-ndjson",
                "etag-effects",
                "provider-effects",
            ),
            3,
            1,
            1,
            "2026-07-21T10:05:00Z".to_owned(),
        )
        .expect("valid work fixture")
    }

    fn restore(target: bool) -> WorkManifestV1 {
        let integration =
            CanonicalIntegrationId::parse("alice:supply-chain").expect("valid integration");
        let target = target.then(|| StateVersionRef {
            id: state().id,
            artifact: blob(
                "artifacts/target",
                'e',
                500,
                "application/json",
                "etag-target",
                "provider-target",
            ),
        });
        WorkManifestV1::new(
            &integration,
            WorkKind::Restore(RestoreWorkV1 {
                failed_run_id: RunId::parse("00000000-0000-4000-8000-000000000001")
                    .expect("valid failed run ID"),
                failed_work_id: WorkId::parse("5".repeat(64)).expect("valid failed work ID"),
                target,
                contaminated: StateVersionRef {
                    id: StateVersionId::parse("7".repeat(64)).expect("valid contaminated state ID"),
                    artifact: blob(
                        "artifacts/contaminated",
                        '8',
                        600,
                        "application/json",
                        "etag-contaminated",
                        "provider-contaminated",
                    ),
                },
            }),
            blob(
                "artifacts/restore-effects",
                '9',
                900,
                "application/x-ndjson",
                "etag-restore-effects",
                "provider-restore-effects",
            ),
            9,
            1,
            1,
            "2026-07-21T10:10:00Z".to_owned(),
        )
        .expect("valid restore fixture")
    }

    #[test]
    fn state_wire_and_identity_match_independent_golden() {
        let state = state();
        assert_eq!(state.id.as_str(), identities().state_version_id);
        let wire = StateVersion::V1(state);
        assert_eq!(
            wire.encode().expect("encode state"),
            include_bytes!("../../tests/golden/state-version-v1.json")
                .strip_suffix(b"\n")
                .expect("fixture newline")
        );
        assert_eq!(
            StateVersion::decode(&wire.encode().expect("encode state")).expect("decode state"),
            wire
        );
    }

    #[test]
    fn provider_metadata_and_audit_time_do_not_change_state_identity() {
        let first = state();
        let mut second = state();
        let StateSnapshot::V1(snapshot) = &mut second.snapshot;
        snapshot.created_at = "2030-01-01T00:00:00Z".to_owned();
        let BlobRef::V1(duckdb) = &mut snapshot.duckdb;
        duckdb.e_tag = Some("different".to_owned());
        let BlobRef::V1(desired) = &mut second.desired_projection.artifact;
        desired.provider_version = Some("different".to_owned());
        second.id = derive_state_version_id(&second).expect("derive changed state ID");
        assert_eq!(first.id, second.id);
    }

    #[test]
    fn work_wire_and_incarnation_identity_match_independent_goldens() {
        let first = reconcile('f');
        let identities = identities();
        assert_eq!(first.work_id.as_str(), identities.reconcile_work_id);
        let later = reconcile('2');
        assert_eq!(
            later.work_id.as_str(),
            identities.reconcile_work_id_with_new_incarnation
        );
        assert_ne!(first.work_id, later.work_id);
        let wire = WorkManifest::V1(first);
        assert_eq!(
            wire.encode().expect("encode work"),
            include_bytes!("../../tests/golden/work-manifest-v1.json")
                .strip_suffix(b"\n")
                .expect("fixture newline")
        );
        assert_eq!(
            WorkManifest::decode(&wire.encode().expect("encode work")).expect("decode work"),
            wire
        );
    }

    #[test]
    fn reconcile_identity_depends_only_on_target_incarnation_and_cycle() {
        let integration =
            CanonicalIntegrationId::parse("alice:supply-chain").expect("valid integration");
        let first = reconcile('f');
        let mut second = reconcile('f');
        second.created_at = "2030-01-01T00:00:00Z".to_owned();
        let BlobRef::V1(effects) = &mut second.effects;
        effects.sha256 = "9".repeat(64);
        effects.size = 999;
        effects.e_tag = Some("different".to_owned());
        second.effect_count = 99;
        second.effect_identity_version = 9;
        second.effect_encoding_version = 9;
        let WorkKind::Reconcile(reconcile) = &mut second.kind else {
            panic!("fixture is reconcile work");
        };
        let BlobRef::V1(target) = &mut reconcile.target.artifact;
        target.key = "artifacts/regenerated-state".to_owned();
        target.sha256 = "8".repeat(64);
        target.provider_version = Some("different".to_owned());
        second.work_id = derive_work_id(&integration, &second).expect("derive changed work ID");
        assert_eq!(first.work_id, second.work_id);
    }

    #[test]
    fn restore_identity_matches_spec_and_is_effects_and_failed_run_independent() {
        let identities = identities();
        let integration =
            CanonicalIntegrationId::parse("alice:supply-chain").expect("valid integration");
        let first = restore(true);
        assert_eq!(first.work_id.as_str(), identities.restore_work_id);
        assert_eq!(
            restore(false).work_id.as_str(),
            identities.empty_state_restore_work_id
        );

        let mut replanned = restore(true);
        replanned.created_at = "2030-01-01T00:00:00Z".to_owned();
        replanned.effects = blob(
            "artifacts/regenerated-effects",
            'a',
            1_500,
            "application/x-ndjson",
            "new-etag",
            "new-provider-version",
        );
        replanned.effect_count = 15;
        replanned.effect_identity_version = 4;
        replanned.effect_encoding_version = 5;
        let WorkKind::Restore(work) = &mut replanned.kind else {
            panic!("fixture is restore work");
        };
        work.failed_run_id = RunId::parse("00000000-0000-4000-8000-000000000002")
            .expect("valid alternate failed run ID");
        replanned.work_id =
            derive_work_id(&integration, &replanned).expect("derive replanned restore ID");
        assert_eq!(first.work_id, replanned.work_id);
    }
}
