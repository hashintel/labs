//! Immutable, journal-referenced control-projection snapshots.
//!
//! A snapshot is only a replay accelerator. The payload is captured by the
//! serialized shard command loop, published content-addressed, and then its
//! reference is appended through that same writer. Recovery may ignore every
//! snapshot and replay the complete events stream without changing semantics.

use std::fmt;

use chrono::{DateTime, Utc};
use error_stack::{Report, ResultExt as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest as _, Sha256};

use super::projection::Projection;
use super::registry::{
    reject_unknown_fields, AlgorithmVersion, CompatError, DurabilityClass, DurableRecord,
    MigrationPolicy, RebuildableRecord, RecordFamily, UntrimmedJournalRecord, VersionedRecord,
};
use super::routing::{shard_path, Keyspace, Shard};
use crate::blob::{ArtifactStore, BlobRef};

pub(crate) const PROJECTOR_SCHEMA_VERSION: u32 = 1;
pub(crate) const MIN_PROJECTED_JOURNAL_EVENT_VERSION: u32 = 1;
pub(crate) const MAX_PROJECTED_JOURNAL_EVENT_VERSION: u32 = 1;
pub(crate) const MAX_PROJECTION_SNAPSHOT_PAYLOAD_BYTES: usize = 64 * 1024 * 1024;
pub(crate) const MAX_PROJECTION_SNAPSHOT_RECORD_BYTES: usize = 16 * 1024;
pub(crate) const SNAPSHOT_PAYLOAD_MEDIA_TYPE: &str =
    "application/vnd.integrations.control-projection-payload+json";

pub(crate) static CONTROL_PROJECTION_PAYLOAD_FAMILY: RecordFamily = RecordFamily {
    name: "control_projection_payload",
    owning_module: "orchestrator::projection_snapshot",
    emitted_version: 1,
    supported_versions: &[1],
    algorithm_versions: &[AlgorithmVersion {
        name: "control_projector_schema",
        version: PROJECTOR_SCHEMA_VERSION,
    }],
    durability: DurabilityClass::Derived,
    migration: MigrationPolicy::Rebuild,
};

pub(crate) static CONTROL_PROJECTION_SNAPSHOT_FAMILY: RecordFamily = RecordFamily {
    name: "control_projection_snapshot",
    owning_module: "orchestrator::projection_snapshot",
    emitted_version: 1,
    supported_versions: &[1],
    algorithm_versions: &[AlgorithmVersion {
        name: "control_projector_schema",
        version: PROJECTOR_SCHEMA_VERSION,
    }],
    durability: DurabilityClass::ImmutableJournal,
    migration: MigrationPolicy::NeverRetireWhileUntrimmed,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct JournalEventVersionRangeV1 {
    pub(crate) min_inclusive: u32,
    pub(crate) max_inclusive: u32,
}

impl JournalEventVersionRangeV1 {
    fn current() -> Self {
        Self {
            min_inclusive: MIN_PROJECTED_JOURNAL_EVENT_VERSION,
            max_inclusive: MAX_PROJECTED_JOURNAL_EVENT_VERSION,
        }
    }

    fn is_supported(self) -> bool {
        self.min_inclusive == MIN_PROJECTED_JOURNAL_EVENT_VERSION
            && self.max_inclusive == MAX_PROJECTED_JOURNAL_EVENT_VERSION
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub(crate) enum ControlProjectionPayload {
    V1(ControlProjectionPayloadV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ControlProjectionPayloadV1 {
    pub(crate) shard: String,
    pub(crate) through_log_sequence: u64,
    pub(crate) projector_schema_version: u32,
    pub(crate) projected_journal_event_versions: JournalEventVersionRangeV1,
    pub(crate) projection: Projection,
}

impl ControlProjectionPayload {
    pub(crate) fn capture(shard: Shard, projection: &Projection) -> Option<Self> {
        let through_log_sequence = projection.through_log_sequence?;
        Some(Self::V1(ControlProjectionPayloadV1 {
            shard: shard_path(shard),
            through_log_sequence,
            projector_schema_version: PROJECTOR_SCHEMA_VERSION,
            projected_journal_event_versions: JournalEventVersionRangeV1::current(),
            projection: projection.clone(),
        }))
    }

    pub(crate) fn current(&self) -> &ControlProjectionPayloadV1 {
        match self {
            Self::V1(value) => value,
        }
    }

    pub(crate) fn into_projection(self) -> Projection {
        match self {
            Self::V1(value) => value.projection,
        }
    }

    pub(crate) fn digest(&self) -> Result<String, CompatError> {
        Ok(hex::encode(Sha256::digest(self.encode()?)))
    }
}

impl super::registry::sealed::Sealed for ControlProjectionPayload {}

impl DurableRecord for ControlProjectionPayload {
    const FAMILY: &'static RecordFamily = &CONTROL_PROJECTION_PAYLOAD_FAMILY;
    const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::Rebuild;

    fn encode(&self) -> Result<Vec<u8>, CompatError> {
        validate_payload(self.current())?;
        let bytes =
            serde_json::to_vec(self).map_err(|error| payload_malformed(error.to_string()))?;
        if bytes.len() > MAX_PROJECTION_SNAPSHOT_PAYLOAD_BYTES {
            return Err(payload_malformed(format!(
                "payload is {} bytes; maximum is {MAX_PROJECTION_SNAPSHOT_PAYLOAD_BYTES}",
                bytes.len()
            )));
        }
        Ok(bytes)
    }

    fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
        decode_versioned(
            Self::FAMILY.name,
            bytes,
            MAX_PROJECTION_SNAPSHOT_PAYLOAD_BYTES,
            |value| {
                let decoded: Self = serde_json::from_value(value)
                    .map_err(|error| payload_malformed(error.to_string()))?;
                validate_payload(decoded.current())?;
                Ok(decoded)
            },
        )
    }
}

impl VersionedRecord for ControlProjectionPayload {
    type Current = ControlProjectionPayloadV1;

    fn normalize(self) -> Result<Self::Current, CompatError> {
        match self {
            Self::V1(value) => Ok(value),
        }
    }
}

impl RebuildableRecord for ControlProjectionPayload {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub(crate) enum ControlProjectionSnapshot {
    V1(ControlProjectionSnapshotV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ControlProjectionSnapshotV1 {
    pub(crate) shard: String,
    pub(crate) through_log_sequence: u64,
    pub(crate) projector_schema_version: u32,
    pub(crate) projected_journal_event_versions: JournalEventVersionRangeV1,
    pub(crate) payload_sha256: String,
    pub(crate) payload: BlobRef,
    pub(crate) created_at: String,
}

impl ControlProjectionSnapshot {
    pub(crate) fn new(
        shard: Shard,
        payload: &ControlProjectionPayload,
        reference: BlobRef,
        created_at: DateTime<Utc>,
    ) -> Result<Self, CompatError> {
        let captured = payload.current();
        if captured.shard != shard_path(shard) {
            return Err(malformed(
                "captured payload belongs to another shard".to_owned(),
            ));
        }
        let record = Self::V1(ControlProjectionSnapshotV1 {
            shard: captured.shard.clone(),
            through_log_sequence: captured.through_log_sequence,
            projector_schema_version: captured.projector_schema_version,
            projected_journal_event_versions: captured.projected_journal_event_versions,
            payload_sha256: payload.digest()?,
            payload: reference,
            created_at: created_at.to_rfc3339(),
        });
        validate_snapshot(record.current())?;
        Ok(record)
    }

    pub(crate) fn current(&self) -> &ControlProjectionSnapshotV1 {
        match self {
            Self::V1(value) => value,
        }
    }

    pub(crate) fn supports_current_projector(&self) -> bool {
        let value = self.current();
        value.projector_schema_version == PROJECTOR_SCHEMA_VERSION
            && value.projected_journal_event_versions.is_supported()
    }

    pub(crate) fn matches_payload(&self, payload: &ControlProjectionPayload) -> bool {
        let reference = self.current();
        let value = payload.current();
        reference.shard == value.shard
            && reference.through_log_sequence == value.through_log_sequence
            && reference.projector_schema_version == value.projector_schema_version
            && reference.projected_journal_event_versions == value.projected_journal_event_versions
            && payload
                .digest()
                .is_ok_and(|digest| digest == reference.payload_sha256)
    }
}

impl super::registry::sealed::Sealed for ControlProjectionSnapshot {}

impl DurableRecord for ControlProjectionSnapshot {
    const FAMILY: &'static RecordFamily = &CONTROL_PROJECTION_SNAPSHOT_FAMILY;
    const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::NeverRetireWhileUntrimmed;

    fn encode(&self) -> Result<Vec<u8>, CompatError> {
        validate_snapshot(self.current())?;
        let bytes = serde_json::to_vec(self).map_err(|error| malformed(error.to_string()))?;
        if bytes.len() > MAX_PROJECTION_SNAPSHOT_RECORD_BYTES {
            return Err(malformed(format!(
                "record is {} bytes; maximum is {MAX_PROJECTION_SNAPSHOT_RECORD_BYTES}",
                bytes.len()
            )));
        }
        Ok(bytes)
    }

    fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
        decode_versioned(
            Self::FAMILY.name,
            bytes,
            MAX_PROJECTION_SNAPSHOT_RECORD_BYTES,
            |value| {
                let decoded: Self =
                    serde_json::from_value(value).map_err(|error| malformed(error.to_string()))?;
                validate_snapshot(decoded.current())?;
                Ok(decoded)
            },
        )
    }
}

impl VersionedRecord for ControlProjectionSnapshot {
    type Current = ControlProjectionSnapshotV1;

    fn normalize(self) -> Result<Self::Current, CompatError> {
        match self {
            Self::V1(value) => Ok(value),
        }
    }
}

impl UntrimmedJournalRecord for ControlProjectionSnapshot {}

#[derive(Debug, Clone)]
pub(crate) struct SnapshotCapture {
    payload: ControlProjectionPayload,
}

impl SnapshotCapture {
    pub(crate) fn new(shard: Shard, projection: &Projection) -> Option<Self> {
        ControlProjectionPayload::capture(shard, projection).map(|payload| Self { payload })
    }

    pub(crate) fn payload(&self) -> &ControlProjectionPayload {
        &self.payload
    }

    pub(crate) fn into_record(
        self,
        shard: Shard,
        reference: BlobRef,
        created_at: DateTime<Utc>,
    ) -> Result<ControlProjectionSnapshot, CompatError> {
        ControlProjectionSnapshot::new(shard, &self.payload, reference, created_at)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SnapshotError {
    PublishPayload,
    BuildReference,
    CommitReference,
}

impl fmt::Display for SnapshotError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::PublishPayload => "publish control-projection snapshot payload failed",
            Self::BuildReference => "build control-projection snapshot reference failed",
            Self::CommitReference => "commit control-projection snapshot reference failed",
        })
    }
}

impl std::error::Error for SnapshotError {}

pub(crate) async fn publish_capture(
    store: &ArtifactStore,
    tenant: &super::ids::TenantNamespace,
    shard: Shard,
    capture: SnapshotCapture,
    created_at: DateTime<Utc>,
) -> Result<ControlProjectionSnapshot, Report<SnapshotError>> {
    let prefix = Keyspace::for_tenant(tenant).shard_projection(shard);
    let reference = store
        .publish_record(
            capture.payload(),
            MAX_PROJECTION_SNAPSHOT_PAYLOAD_BYTES,
            &prefix,
            SNAPSHOT_PAYLOAD_MEDIA_TYPE,
        )
        .await
        .change_context(SnapshotError::PublishPayload)?;
    capture
        .into_record(shard, reference, created_at)
        .change_context(SnapshotError::BuildReference)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SnapshotLoadError {
    UnsupportedProjector,
    WrongShard,
    InvalidObjectKey,
    FetchPayload,
    ReadPayload,
    DecodePayload,
    ReferenceMismatch,
}

impl fmt::Display for SnapshotLoadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::UnsupportedProjector => "projection snapshot requires an unsupported projector",
            Self::WrongShard => "projection snapshot belongs to another shard",
            Self::InvalidObjectKey => "projection snapshot uses an invalid object key",
            Self::FetchPayload => "fetch projection snapshot payload failed",
            Self::ReadPayload => "read projection snapshot payload failed",
            Self::DecodePayload => "decode projection snapshot payload failed",
            Self::ReferenceMismatch => "projection snapshot reference does not match its payload",
        })
    }
}

impl std::error::Error for SnapshotLoadError {}

pub(crate) async fn load_projection(
    store: &ArtifactStore,
    tenant: &super::ids::TenantNamespace,
    shard: Shard,
    snapshot: &ControlProjectionSnapshot,
) -> Result<Projection, Report<SnapshotLoadError>> {
    if !snapshot.supports_current_projector() {
        return Err(Report::new(SnapshotLoadError::UnsupportedProjector));
    }
    let value = snapshot.current();
    if parse_shard(&value.shard).change_context(SnapshotLoadError::WrongShard)? != shard {
        return Err(Report::new(SnapshotLoadError::WrongShard));
    }
    let expected_prefix = format!(
        "{}/sha256/",
        Keyspace::for_tenant(tenant).shard_projection(shard)
    );
    if !value.payload.current().key.starts_with(&expected_prefix) {
        return Err(
            Report::new(SnapshotLoadError::InvalidObjectKey).attach_printable(format!(
                "snapshot payload key {:?} is outside {expected_prefix:?}",
                value.payload.current().key
            )),
        );
    }
    let path = store
        .materialize(&value.payload)
        .await
        .change_context(SnapshotLoadError::FetchPayload)?;
    let bytes = tokio::fs::read(path)
        .await
        .change_context(SnapshotLoadError::ReadPayload)?;
    let payload = ControlProjectionPayload::decode(&bytes)
        .change_context(SnapshotLoadError::DecodePayload)?;
    if !snapshot.matches_payload(&payload) {
        return Err(Report::new(SnapshotLoadError::ReferenceMismatch));
    }
    Ok(payload.into_projection())
}

fn validate_payload(value: &ControlProjectionPayloadV1) -> Result<(), CompatError> {
    validate_metadata(
        CONTROL_PROJECTION_PAYLOAD_FAMILY.name,
        &value.shard,
        value.through_log_sequence,
        value.projector_schema_version,
        value.projected_journal_event_versions,
    )?;
    if value.projection.through_log_sequence != Some(value.through_log_sequence) {
        return Err(payload_malformed(
            "payload projection watermark does not match through_log_sequence".to_owned(),
        ));
    }
    Ok(())
}

fn validate_snapshot(value: &ControlProjectionSnapshotV1) -> Result<(), CompatError> {
    validate_metadata(
        CONTROL_PROJECTION_SNAPSHOT_FAMILY.name,
        &value.shard,
        value.through_log_sequence,
        value.projector_schema_version,
        value.projected_journal_event_versions,
    )?;
    validate_sha256(&value.payload_sha256, "payload_sha256")?;
    let payload = value.payload.current();
    if payload.sha256 != value.payload_sha256 {
        return Err(malformed(
            "payload_sha256 does not match the payload reference".to_owned(),
        ));
    }
    if payload.size > MAX_PROJECTION_SNAPSHOT_PAYLOAD_BYTES as u64 {
        return Err(malformed(format!(
            "payload reference is {} bytes; maximum is {MAX_PROJECTION_SNAPSHOT_PAYLOAD_BYTES}",
            payload.size
        )));
    }
    if payload.media_type != SNAPSHOT_PAYLOAD_MEDIA_TYPE {
        return Err(malformed(
            "payload media type is not a projection snapshot".to_owned(),
        ));
    }
    DateTime::parse_from_rfc3339(&value.created_at)
        .map_err(|error| malformed(format!("created_at is not RFC 3339: {error}")))?;
    Ok(())
}

fn validate_metadata(
    family: &'static str,
    shard: &str,
    _through_log_sequence: u64,
    projector_schema_version: u32,
    versions: JournalEventVersionRangeV1,
) -> Result<(), CompatError> {
    parse_shard_for(family, shard)?;
    if projector_schema_version == 0 {
        return Err(malformed_for(
            family,
            "projector_schema_version must be nonzero".to_owned(),
        ));
    }
    if versions.min_inclusive == 0 || versions.min_inclusive > versions.max_inclusive {
        return Err(malformed_for(
            family,
            "projected journal-event version range must be nonzero and ordered".to_owned(),
        ));
    }
    Ok(())
}

pub(crate) fn parse_shard(value: &str) -> Result<Shard, CompatError> {
    parse_shard_for(CONTROL_PROJECTION_SNAPSHOT_FAMILY.name, value)
}

fn parse_shard_for(family: &'static str, value: &str) -> Result<Shard, CompatError> {
    if value.len() != 3 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(malformed_for(
            family,
            "shard must be three hexadecimal characters".to_owned(),
        ));
    }
    let raw = u16::from_str_radix(value, 16)
        .map_err(|error| malformed_for(family, format!("shard is invalid: {error}")))?;
    let shard = Shard::try_from(raw).map_err(|error| malformed_for(family, error.to_string()))?;
    if shard_path(shard) != value {
        return Err(malformed_for(
            family,
            "shard path must use canonical lowercase encoding".to_owned(),
        ));
    }
    Ok(shard)
}

fn validate_sha256(value: &str, field: &str) -> Result<(), CompatError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(malformed(format!(
            "{field} must be 64 lowercase hexadecimal characters"
        )))
    }
}

fn decode_versioned<T>(
    family: &'static str,
    bytes: &[u8],
    maximum: usize,
    decode: impl FnOnce(Value) -> Result<T, CompatError>,
) -> Result<T, CompatError> {
    if bytes.len() > maximum {
        return Err(malformed_for(
            family,
            format!("record is {} bytes; maximum is {maximum}", bytes.len()),
        ));
    }
    let value: Value =
        serde_json::from_slice(bytes).map_err(|error| malformed_for(family, error.to_string()))?;
    reject_unknown_fields(family, "", &value, &["version", "data"])?;
    let version = value
        .get("version")
        .and_then(Value::as_str)
        .ok_or_else(|| malformed_for(family, "version must be a string".to_owned()))?;
    if version != "v1" {
        return Err(CompatError::UnsupportedVersion {
            family,
            version: version.to_owned(),
        });
    }
    decode(value)
}

fn malformed(message: String) -> CompatError {
    malformed_for(CONTROL_PROJECTION_SNAPSHOT_FAMILY.name, message)
}

fn payload_malformed(message: String) -> CompatError {
    malformed_for(CONTROL_PROJECTION_PAYLOAD_FAMILY.name, message)
}

fn malformed_for(family: &'static str, message: String) -> CompatError {
    CompatError::Malformed { family, message }
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::blob::BlobRefV1;
    use crate::orchestrator::events::{ArtifactRole, InputRef, PolicyRef};
    use crate::orchestrator::ids::{
        CanonicalIntegrationId, EventId, JournalRecordDigest, RequestDigest, RequestId, RunId,
    };
    use crate::orchestrator::projection::{
        ControlRequestOutcomeKindV1, ControlRequestOutcomeV1, RunProjection, RunStatus,
    };
    use crate::orchestrator::registry::DurableRecord;

    fn payload() -> ControlProjectionPayload {
        let projection = Projection {
            through_log_sequence: Some(7),
            ..Projection::default()
        };
        ControlProjectionPayload::capture(Shard::try_from(60).unwrap(), &projection)
            .expect("nonempty projection")
    }

    fn reference(payload: &ControlProjectionPayload) -> ControlProjectionSnapshot {
        let bytes = payload.encode().expect("encode payload");
        let digest = hex::encode(Sha256::digest(&bytes));
        ControlProjectionSnapshot::new(
            Shard::try_from(60).unwrap(),
            payload,
            BlobRef::V1(BlobRefV1 {
                key: format!(
                    "tenants/alice/control/v1/shards/03c/projection/sha256/{}/{digest}.json",
                    &digest[..2]
                ),
                sha256: digest,
                size: u64::try_from(bytes.len()).unwrap(),
                media_type: SNAPSHOT_PAYLOAD_MEDIA_TYPE.to_owned(),
                e_tag: None,
                provider_version: None,
            }),
            DateTime::parse_from_rfc3339("2026-07-22T10:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        )
        .expect("valid snapshot reference")
    }

    #[test]
    fn canonical_wire_fixture_is_independent_and_round_trips() {
        let payload = payload();
        let reference = reference(&payload);
        let expected: Value = serde_json::from_slice(include_bytes!(
            "../../tests/golden/control-projection-snapshot-v1.json"
        ))
        .expect("golden fixture");
        assert_eq!(
            serde_json::to_value(&payload).expect("payload value"),
            expected["payload"]
        );
        assert_eq!(
            serde_json::to_value(&reference).expect("reference value"),
            expected["reference"]
        );
        assert_eq!(
            ControlProjectionPayload::decode(&payload.encode().unwrap()).unwrap(),
            payload
        );
        assert_eq!(
            ControlProjectionSnapshot::decode(&reference.encode().unwrap()).unwrap(),
            reference
        );
    }

    #[test]
    fn unknown_fields_and_future_versions_fail_closed() {
        let payload = payload();
        let mut value = serde_json::to_value(&payload).unwrap();
        value["data"]["projection"]["invented"] = Value::Bool(true);
        assert!(matches!(
            ControlProjectionPayload::decode(&serde_json::to_vec(&value).unwrap()),
            Err(CompatError::Malformed { .. } | CompatError::ExtraField { .. })
        ));

        value = serde_json::to_value(reference(&payload)).unwrap();
        value["version"] = Value::String("v2".to_owned());
        assert!(matches!(
            ControlProjectionSnapshot::decode(&serde_json::to_vec(&value).unwrap()),
            Err(CompatError::UnsupportedVersion { .. })
        ));
    }

    #[test]
    fn digest_range_and_projection_watermark_are_bound() {
        let captured = payload();
        let mut wrong_watermark = captured.clone();
        let ControlProjectionPayload::V1(value) = &mut wrong_watermark;
        value.projection.through_log_sequence = Some(6);
        assert!(wrong_watermark.encode().is_err());

        let mut wrong_digest = reference(&captured);
        let ControlProjectionSnapshot::V1(value) = &mut wrong_digest;
        value.payload_sha256 = "f".repeat(64);
        assert!(wrong_digest.encode().is_err());

        let mut invalid_range = captured;
        let ControlProjectionPayload::V1(value) = &mut invalid_range;
        value.projected_journal_event_versions = JournalEventVersionRangeV1 {
            min_inclusive: 2,
            max_inclusive: 1,
        };
        assert!(invalid_range.encode().is_err());

        let current = payload();
        let mut future_projector = reference(&current);
        let ControlProjectionSnapshot::V1(value) = &mut future_projector;
        value.projector_schema_version = PROJECTOR_SCHEMA_VERSION + 1;
        assert!(!future_projector.supports_current_projector());
    }

    #[test]
    fn payload_retains_complete_identity_and_control_outcome_indexes() {
        let mut projection = Projection {
            through_log_sequence: Some(9),
            ..Projection::default()
        };
        projection.seen_event_digests.insert(
            EventId::parse("1".repeat(64)).unwrap(),
            JournalRecordDigest::parse("2".repeat(64)).unwrap(),
        );
        projection.control_request_outcomes.insert(
            RequestId::parse("5".repeat(64)).unwrap(),
            ControlRequestOutcomeV1 {
                request_digest: RequestDigest::parse("3".repeat(64)).unwrap(),
                outcome: ControlRequestOutcomeKindV1::Accepted {
                    promoted_event_id: EventId::parse("4".repeat(64)).unwrap(),
                },
            },
        );
        let artifact = reference(&payload()).current().payload.clone();
        let run_id = RunId::parse("00000000-0000-4000-8000-000000000001").unwrap();
        projection.runs.insert(
            run_id,
            RunProjection {
                integration_id: CanonicalIntegrationId::parse("alice:connector").unwrap(),
                status: RunStatus::Running,
                attempt: 1,
                handler_failures: 0,
                attempt_id: None,
                immutable_input: InputRef {
                    artifact: artifact.clone(),
                    definition_digest: "6".repeat(64),
                    definition_digest_encoding_version: 1,
                    planner_version: 1,
                },
                policy: PolicyRef {
                    artifact: artifact.clone(),
                    policy_digest: "7".repeat(64),
                },
                submitted_at: "2026-07-31T12:00:00Z".to_owned(),
                artifacts: std::iter::once((
                    ArtifactRole::BronzeCapture("source".to_owned()),
                    artifact,
                ))
                .collect(),
                steps: Default::default(),
                result: None,
                outcome: None,
                failure: None,
                revision: EventId::parse("8".repeat(64)).unwrap(),
            },
        );
        let payload = ControlProjectionPayload::capture(Shard::try_from(60).unwrap(), &projection)
            .expect("nonempty projection");
        let restored = ControlProjectionPayload::decode(&payload.encode().unwrap())
            .unwrap()
            .into_projection();
        assert_eq!(restored, projection);
    }
}
