//! Immutable, versioned Graph effects planned before any external delivery.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::blob::BlobRef;
use crate::orchestrator::ids::{canonical_digest, EffectId};
use crate::orchestrator::registry::{
    reject_unknown_fields, AlgorithmVersion, CompatError, DurabilityClass, DurableRecord,
    MigrationPolicy, PureUpcastRecord, RecordFamily, VersionedRecord,
};

pub const EFFECT_IDENTITY_VERSION: u32 = 1;
pub const EFFECT_ENCODING_VERSION: u32 = 1;
pub const GRAPH_EFFECT_MEDIA_TYPE: &str = "application/vnd.hash.graph-effect+json";
pub const GRAPH_EFFECT_PAYLOAD_MEDIA_TYPE: &str = "application/vnd.hash.graph-effect-payload-pack";
const MAX_GRAPH_EFFECT_BYTES: usize = 64 * 1024;
const MAX_GRAPH_IDENTITY_BYTES: usize = 8 * 1024;

pub(crate) static GRAPH_EFFECT_FAMILY: RecordFamily = RecordFamily {
    name: "graph_effect",
    owning_module: "graph::effects",
    emitted_version: 1,
    supported_versions: &[1],
    algorithm_versions: &[
        AlgorithmVersion {
            name: "effect_encoding",
            version: EFFECT_ENCODING_VERSION,
        },
        AlgorithmVersion {
            name: "effect_identity",
            version: EFFECT_IDENTITY_VERSION,
        },
    ],
    durability: DurabilityClass::ImmutableArtifact,
    migration: MigrationPolicy::PureUpcast,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub enum GraphEffect {
    V1(GraphEffectV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GraphEffectV1 {
    pub effect_id: EffectId,
    pub effect_identity_version: u32,
    pub effect_encoding_version: u32,
    /// State-version digest selected by the work kind. The empty string is
    /// reserved for Restore targeting the canonical initial empty state.
    pub target_state_digest: String,
    pub operation: GraphOperationV1,
    pub graph_identity: String,
    pub payload_digest: Option<String>,
    pub payload: Option<BlobSliceRefV1>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GraphOperationV1 {
    UpsertEntity,
    UpsertLink,
    ArchiveLink,
    ArchiveEntity,
}

impl GraphOperationV1 {
    pub const fn order(self) -> u8 {
        match self {
            Self::UpsertEntity => 0,
            Self::UpsertLink => 1,
            Self::ArchiveLink => 2,
            Self::ArchiveEntity => 3,
        }
    }

    const fn requires_payload(self) -> bool {
        matches!(self, Self::UpsertEntity | Self::UpsertLink)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BlobSliceRefV1 {
    pub artifact: BlobRef,
    pub offset: u64,
    pub length: u64,
}

impl GraphEffectV1 {
    pub fn new(
        target_state_digest: String,
        operation: GraphOperationV1,
        graph_identity: String,
        payload_digest: Option<String>,
        payload: Option<BlobSliceRefV1>,
    ) -> Result<Self, CompatError> {
        let mut effect = Self {
            effect_id: EffectId::from_digest("0".repeat(64)),
            effect_identity_version: EFFECT_IDENTITY_VERSION,
            effect_encoding_version: EFFECT_ENCODING_VERSION,
            target_state_digest,
            operation,
            graph_identity,
            payload_digest,
            payload,
        };
        validate_effect_fields(&effect)?;
        effect.effect_id = derive_effect_id(&effect)?;
        Ok(effect)
    }

    pub fn verify(&self) -> Result<(), CompatError> {
        validate_effect_fields(self)?;
        let expected = derive_effect_id(self)?;
        if self.effect_id == expected {
            Ok(())
        } else {
            Err(CompatError::Conflict {
                family: GraphEffect::FAMILY.name,
                message: format!(
                    "effect ID mismatch: expected {expected}, found {}",
                    self.effect_id
                ),
            })
        }
    }
}

impl GraphEffect {
    pub fn into_current(self) -> Result<GraphEffectV1, CompatError> {
        let Self::V1(effect) = self;
        effect.verify()?;
        Ok(effect)
    }

    fn wire(&self) -> &GraphEffectV1 {
        match self {
            Self::V1(effect) => effect,
        }
    }
}

pub fn derive_effect_id(effect: &GraphEffectV1) -> Result<EffectId, CompatError> {
    #[derive(Serialize)]
    struct EffectIdentity<'a> {
        operation: GraphOperationV1,
        graph_identity: &'a str,
        target_state_digest: &'a str,
        payload_digest: Option<&'a str>,
    }

    canonical_digest(
        "graph-effect:v1",
        &EffectIdentity {
            operation: effect.operation,
            graph_identity: &effect.graph_identity,
            target_state_digest: &effect.target_state_digest,
            payload_digest: effect.payload_digest.as_deref(),
        },
    )
    .map(EffectId::from_digest)
    .map_err(|error| malformed(error.to_string()))
}

fn validate_effect_fields(effect: &GraphEffectV1) -> Result<(), CompatError> {
    if effect.effect_identity_version != EFFECT_IDENTITY_VERSION {
        return Err(malformed(format!(
            "effect_identity_version must be {EFFECT_IDENTITY_VERSION}"
        )));
    }
    if effect.effect_encoding_version != EFFECT_ENCODING_VERSION {
        return Err(malformed(format!(
            "effect_encoding_version must be {EFFECT_ENCODING_VERSION}"
        )));
    }
    if !effect.target_state_digest.is_empty() {
        validate_sha256("target_state_digest", &effect.target_state_digest)?;
    }
    if effect.graph_identity.is_empty()
        || effect.graph_identity.len() > MAX_GRAPH_IDENTITY_BYTES
        || effect.graph_identity.chars().any(char::is_whitespace)
    {
        return Err(malformed(format!(
            "graph_identity must be non-empty, whitespace-free, and at most {MAX_GRAPH_IDENTITY_BYTES} bytes"
        )));
    }
    match (
        effect.operation.requires_payload(),
        &effect.payload_digest,
        &effect.payload,
    ) {
        (true, Some(digest), Some(payload)) => {
            validate_sha256("payload_digest", digest)?;
            validate_payload(payload)?;
        }
        (false, None, None) => {}
        (true, _, _) => {
            return Err(malformed(
                "upsert effects require both payload_digest and payload".to_owned(),
            ));
        }
        (false, _, _) => {
            return Err(malformed(
                "archive effects must not carry payload_digest or payload".to_owned(),
            ));
        }
    }
    Ok(())
}

fn validate_payload(payload: &BlobSliceRefV1) -> Result<(), CompatError> {
    let artifact = payload.artifact.current();
    if artifact.key.is_empty() {
        return Err(malformed(
            "payload.artifact.key must not be empty".to_owned(),
        ));
    }
    validate_sha256("payload.artifact.sha256", &artifact.sha256)?;
    if artifact.media_type != GRAPH_EFFECT_PAYLOAD_MEDIA_TYPE {
        return Err(malformed(format!(
            "payload.artifact.media_type must be {GRAPH_EFFECT_PAYLOAD_MEDIA_TYPE:?}"
        )));
    }
    if payload.length == 0 {
        return Err(malformed("payload.length must be nonzero".to_owned()));
    }
    let end = payload
        .offset
        .checked_add(payload.length)
        .ok_or_else(|| malformed("payload byte range overflows u64".to_owned()))?;
    if end > artifact.size {
        return Err(malformed(format!(
            "payload byte range ends at {end}, beyond artifact size {}",
            artifact.size
        )));
    }
    Ok(())
}

fn validate_sha256(path: &str, value: &str) -> Result<(), CompatError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(malformed(format!(
            "{path} must be 64 lowercase hexadecimal characters"
        )))
    }
}

fn malformed(message: String) -> CompatError {
    CompatError::Malformed {
        family: GraphEffect::FAMILY.name,
        message,
    }
}

impl crate::orchestrator::registry::sealed::Sealed for GraphEffect {}

impl DurableRecord for GraphEffect {
    const FAMILY: &'static RecordFamily = &GRAPH_EFFECT_FAMILY;
    const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::PureUpcast;

    fn encode(&self) -> Result<Vec<u8>, CompatError> {
        self.wire().verify()?;
        let bytes = serde_json::to_vec(self).map_err(|error| malformed(error.to_string()))?;
        if bytes.len() > MAX_GRAPH_EFFECT_BYTES {
            return Err(malformed(format!(
                "record is {} bytes; maximum is {MAX_GRAPH_EFFECT_BYTES}",
                bytes.len()
            )));
        }
        Ok(bytes)
    }

    fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
        if bytes.len() > MAX_GRAPH_EFFECT_BYTES {
            return Err(malformed(format!(
                "record is {} bytes; maximum is {MAX_GRAPH_EFFECT_BYTES}",
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
        let data = value
            .get("data")
            .ok_or_else(|| malformed("data is required".to_owned()))?;
        reject_unknown_fields(
            Self::FAMILY.name,
            "data",
            data,
            &[
                "effect_id",
                "effect_identity_version",
                "effect_encoding_version",
                "target_state_digest",
                "operation",
                "graph_identity",
                "payload_digest",
                "payload",
            ],
        )?;
        if let Some(payload) = data.get("payload").filter(|payload| !payload.is_null()) {
            reject_unknown_fields(
                Self::FAMILY.name,
                "data.payload",
                payload,
                &["artifact", "offset", "length"],
            )?;
            let artifact = payload
                .get("artifact")
                .ok_or_else(|| malformed("data.payload.artifact is required".to_owned()))?;
            reject_unknown_fields(
                Self::FAMILY.name,
                "data.payload.artifact",
                artifact,
                &["version", "value"],
            )?;
            if artifact.get("version").and_then(Value::as_str) != Some("v1") {
                return Err(malformed(
                    "data.payload.artifact.version must be v1".to_owned(),
                ));
            }
            let artifact_value = artifact
                .get("value")
                .ok_or_else(|| malformed("data.payload.artifact.value is required".to_owned()))?;
            reject_unknown_fields(
                Self::FAMILY.name,
                "data.payload.artifact.value",
                artifact_value,
                &[
                    "key",
                    "sha256",
                    "size",
                    "mediaType",
                    "eTag",
                    "providerVersion",
                ],
            )?;
        }
        let effect: Self =
            serde_json::from_value(value).map_err(|error| malformed(error.to_string()))?;
        effect.wire().verify()?;
        Ok(effect)
    }
}

impl VersionedRecord for GraphEffect {
    type Current = GraphEffectV1;

    fn normalize(self) -> Result<Self::Current, CompatError> {
        Self::into_current(self)
    }
}

impl PureUpcastRecord for GraphEffect {}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use crate::blob::BlobRefV1;

    fn payload(etag: &str, provider_version: &str) -> BlobSliceRefV1 {
        BlobSliceRefV1 {
            artifact: BlobRef::V1(BlobRefV1 {
                key: format!("effects/{}.bin", "3".repeat(64)),
                sha256: "3".repeat(64),
                size: 4096,
                media_type: GRAPH_EFFECT_PAYLOAD_MEDIA_TYPE.to_owned(),
                e_tag: Some(etag.to_owned()),
                provider_version: Some(provider_version.to_owned()),
            }),
            offset: 128,
            length: 512,
        }
    }

    fn upsert() -> GraphEffectV1 {
        GraphEffectV1::new(
            "1".repeat(64),
            GraphOperationV1::UpsertEntity,
            "https://graph.example/entities/00000000-0000-4000-8000-000000000001".to_owned(),
            Some("2".repeat(64)),
            Some(payload("etag-a", "version-a")),
        )
        .expect("valid effect")
    }

    fn archive() -> GraphEffectV1 {
        GraphEffectV1::new(
            "1".repeat(64),
            GraphOperationV1::ArchiveEntity,
            "https://graph.example/entities/00000000-0000-4000-8000-000000000001".to_owned(),
            None,
            None,
        )
        .expect("valid archive effect")
    }

    #[test]
    fn operation_order_is_dependency_safe() {
        assert!(GraphOperationV1::UpsertEntity.order() < GraphOperationV1::UpsertLink.order());
        assert!(GraphOperationV1::UpsertLink.order() < GraphOperationV1::ArchiveLink.order());
        assert!(GraphOperationV1::ArchiveLink.order() < GraphOperationV1::ArchiveEntity.order());
    }

    #[test]
    fn provider_metadata_and_slice_location_do_not_change_effect_identity() {
        let first = upsert();
        let mut second = first.clone();
        second.payload = Some(payload("etag-b", "version-b"));
        second.payload.as_mut().expect("payload").offset = 1024;
        second.effect_id = derive_effect_id(&second).expect("derive second ID");
        assert_eq!(first.effect_id, second.effect_id);
        assert_ne!(
            GraphEffect::V1(first).encode().expect("first wire"),
            GraphEffect::V1(second).encode().expect("second wire")
        );
    }

    #[test]
    fn invalid_payload_pair_range_and_forged_identity_fail_closed() {
        let mut missing = upsert();
        missing.payload = None;
        assert!(GraphEffect::V1(missing).encode().is_err());

        let mut range = upsert();
        range.payload.as_mut().expect("payload").length = 4096;
        assert!(GraphEffect::V1(range).encode().is_err());

        let mut forged = upsert();
        forged.effect_id = EffectId::from_digest("f".repeat(64));
        assert!(matches!(
            GraphEffect::V1(forged).encode(),
            Err(CompatError::Conflict { .. })
        ));
    }

    #[test]
    fn codec_rejects_unknown_versions_and_fields() {
        let record = GraphEffect::V1(upsert());
        let bytes = record.encode().expect("encode effect");
        assert_eq!(GraphEffect::decode(&bytes).expect("decode effect"), record);

        let mut future: Value = serde_json::from_slice(&bytes).expect("parse effect");
        future["version"] = Value::String("v2".to_owned());
        assert!(matches!(
            GraphEffect::decode(&serde_json::to_vec(&future).expect("encode future")),
            Err(CompatError::UnsupportedVersion { .. })
        ));

        let mut drift: Value = serde_json::from_slice(&bytes).expect("parse effect");
        drift["data"]["payload"]["future"] = Value::Bool(true);
        assert!(matches!(
            GraphEffect::decode(&serde_json::to_vec(&drift).expect("encode drift")),
            Err(CompatError::ExtraField { path, .. }) if path == "data.payload.future"
        ));

        let mut nested: Value = serde_json::from_slice(&bytes).expect("parse effect");
        nested["data"]["payload"]["artifact"]["value"]["future"] = Value::Bool(true);
        assert!(matches!(
            GraphEffect::decode(&serde_json::to_vec(&nested).expect("encode nested drift")),
            Err(CompatError::ExtraField { path, .. })
                if path == "data.payload.artifact.value.future"
        ));
    }

    #[test]
    fn wire_and_identity_match_independent_goldens() {
        let fixture: Value =
            serde_json::from_slice(include_bytes!("../../tests/golden/graph-effects-v1.json"))
                .expect("valid independent fixture");
        let upsert = GraphEffect::V1(upsert());
        let archive = GraphEffect::V1(archive());
        assert_eq!(
            upsert.encode().expect("encode upsert"),
            serde_json::to_vec(&fixture["upsert"]).expect("encode upsert fixture")
        );
        assert_eq!(
            archive.encode().expect("encode archive"),
            serde_json::to_vec(&fixture["archive"]).expect("encode archive fixture")
        );
    }
}
