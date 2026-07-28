//! Compatibility registry for the clean durable-protocol baseline.
//!
//! A record cannot enter protocol storage unless it implements [`DurableRecord`] and
//! points at one of the families in [`record_families`]. The independently
//! maintained manifest is checked again by the production activation gate.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const REGISTRY_MANIFEST_VERSION: u32 = 1;

// Before the first production activation, protocol V1 is one design target:
// implementation PRs evolve its structs and independent fixtures in place.
// After V1 is released, a shape change adds a declared version, retains every
// still-supported decoder, and follows the family's migration policy below.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DurabilityClass {
    ImmutableJournal,
    ImmutableArtifact,
    MutableCas,
    Derived,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MigrationPolicy {
    NeverRetireWhileUntrimmed,
    PureUpcast,
    MutableCas,
    Rebuild,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AlgorithmVersion {
    pub name: &'static str,
    pub version: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecordFamily {
    pub name: &'static str,
    pub owning_module: &'static str,
    pub emitted_version: u32,
    pub supported_versions: &'static [u32],
    pub algorithm_versions: &'static [AlgorithmVersion],
    pub durability: DurabilityClass,
    pub migration: MigrationPolicy,
}

/// V1 families are added here with the change that introduces their codec.
static RECORD_FAMILIES: &[&RecordFamily] = &[
    &super::submission::ADMISSION_POINTER_FAMILY,
    &super::baseline::CONTROL_BASELINE_FAMILY,
    &super::projection_snapshot::CONTROL_PROJECTION_PAYLOAD_FAMILY,
    &super::projection_snapshot::CONTROL_PROJECTION_SNAPSHOT_FAMILY,
    &super::control::CONTROL_REQUEST_FAMILY,
    &super::inbox::CONTROL_REQUEST_RESULT_FAMILY,
    &super::state::CURRENT_STATE_HINT_FAMILY,
    &crate::graph::artifacts::DESIRED_PROJECTION_ARTIFACT_FAMILY,
    &crate::graph::artifacts::EFFECT_INDEX_ARTIFACT_FAMILY,
    &crate::graph::planner::GRAPH_DELIVERY_PAYLOAD_FAMILY,
    &crate::graph::effects::GRAPH_EFFECT_FAMILY,
    &super::events::JOURNAL_RECORD_FAMILY,
    &super::submission::KNOWN_SHARD_MARKER_FAMILY,
    &super::submission::READY_RECEIPT_FAMILY,
    &super::internal_metadata::REQUEST_BINDING_FAMILY,
    &super::internal_metadata::RUN_INPUT_FAMILY,
    &super::internal_metadata::RUN_LOCATOR_FAMILY,
    &super::internal_metadata::RUN_POLICY_FAMILY,
    &super::lease::SHARD_LEASE_FAMILY,
    &super::work::STATE_VERSION_FAMILY,
    &super::work::WORK_MANIFEST_FAMILY,
];

pub fn record_families() -> &'static [&'static RecordFamily] {
    RECORD_FAMILIES
}

pub(crate) mod sealed {
    pub trait Sealed {}
}

pub trait DurableRecord: sealed::Sealed + Sized {
    const FAMILY: &'static RecordFamily;
    const MIGRATION_POLICY: MigrationPolicy;

    fn encode(&self) -> Result<Vec<u8>, CompatError>;

    fn decode(bytes: &[u8]) -> Result<Self, CompatError>;
}

/// A versioned wire record with one validated domain shape used by the engine.
/// Adding a supported wire variant must extend this normalization boundary.
pub trait VersionedRecord: DurableRecord {
    type Current;

    fn normalize(self) -> Result<Self::Current, CompatError>;
}

/// Immutable records retain old bytes and normalize them while reachable.
pub trait PureUpcastRecord: VersionedRecord {}

/// Journal history is immutable and its decoders cannot retire while the
/// corresponding sequence range remains replayable.
pub trait UntrimmedJournalRecord: VersionedRecord {}

/// Mutable records are upgraded by normalizing observed bytes and conditionally
/// replacing exactly the observed CAS version with current canonical bytes.
pub trait MutableCasRecord: VersionedRecord + Send + Sync {
    fn from_current(current: Self::Current) -> Result<Self, CompatError>;

    fn into_emitted(self) -> Result<Self, CompatError> {
        Self::from_current(self.normalize()?)
    }
}

/// Derived records may be discarded and rebuilt from authoritative state.
pub trait RebuildableRecord: DurableRecord {}

/// Storage entry points call this before accepting a generic record. The
/// sealed trait prevents downstream implementations; this check also prevents
/// an internal test or unfinished family from reaching the baseline prefix.
pub fn require_registered<T: DurableRecord>() -> Result<(), RegistryError> {
    if T::MIGRATION_POLICY != T::FAMILY.migration {
        return Err(RegistryError::InvalidFamily {
            family: T::FAMILY.name.to_owned(),
            message: format!(
                "record type declares {:?} but registry declares {:?}",
                T::MIGRATION_POLICY,
                T::FAMILY.migration
            ),
        });
    }
    if record_families()
        .iter()
        .any(|family| **family == *T::FAMILY)
    {
        Ok(())
    } else {
        Err(RegistryError::UnregisteredFamily(T::FAMILY.name.to_owned()))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompatError {
    UnsupportedVersion {
        family: &'static str,
        version: String,
    },
    ExtraField {
        family: &'static str,
        path: String,
    },
    Malformed {
        family: &'static str,
        message: String,
    },
    Conflict {
        family: &'static str,
        message: String,
    },
}

impl fmt::Display for CompatError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedVersion { family, version } => {
                write!(formatter, "unsupported {family} version {version:?}")
            }
            Self::ExtraField { family, path } => {
                write!(formatter, "{family} contains undeclared field {path:?}")
            }
            Self::Malformed { family, message } => {
                write!(formatter, "malformed {family}: {message}")
            }
            Self::Conflict { family, message } => {
                write!(formatter, "conflicting {family}: {message}")
            }
        }
    }
}

impl std::error::Error for CompatError {}

/// Rejects undeclared fields without relying on parsing Serde error strings.
/// Version codecs call this for the envelope and every nested object before
/// deserializing the validated value.
pub fn reject_unknown_fields(
    family: &'static str,
    path: &str,
    value: &Value,
    allowed: &[&str],
) -> Result<(), CompatError> {
    let object = value.as_object().ok_or_else(|| CompatError::Malformed {
        family,
        message: format!("{path} must be an object"),
    })?;
    for key in object.keys() {
        if !allowed.contains(&key.as_str()) {
            let path = if path.is_empty() {
                key.clone()
            } else {
                format!("{path}.{key}")
            };
            return Err(CompatError::ExtraField { family, path });
        }
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegistryManifest {
    pub version: u32,
    pub families: Vec<RecordFamilyManifest>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordFamilyManifest {
    pub name: String,
    pub owning_module: String,
    pub emitted_version: u32,
    pub supported_versions: Vec<u32>,
    pub algorithm_versions: Vec<AlgorithmVersionManifest>,
    pub durability: DurabilityClass,
    pub migration: MigrationPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlgorithmVersionManifest {
    pub name: String,
    pub version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegistryError {
    ManifestMalformed(String),
    InvalidFamily {
        family: String,
        message: String,
    },
    UnregisteredFamily(String),
    DuplicateFamily(String),
    FamiliesNotSorted,
    Mismatch {
        missing: Vec<String>,
        unexpected: Vec<String>,
        changed: Vec<String>,
    },
}

impl fmt::Display for RegistryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ManifestMalformed(message) => {
                write!(formatter, "durable-record manifest is malformed: {message}")
            }
            Self::InvalidFamily { family, message } => {
                write!(formatter, "durable-record family {family:?} is invalid: {message}")
            }
            Self::UnregisteredFamily(family) => write!(
                formatter,
                "durable-record family {family:?} is not in the V1 registry"
            ),
            Self::DuplicateFamily(family) => {
                write!(formatter, "durable-record family {family:?} is duplicated")
            }
            Self::FamiliesNotSorted => formatter.write_str(
                "durable-record families must be sorted by name for reviewable diffs",
            ),
            Self::Mismatch {
                missing,
                unexpected,
                changed,
            } => write!(
                formatter,
                "durable-record registry differs from its independent manifest; missing={missing:?}, unexpected={unexpected:?}, changed={changed:?}"
            ),
        }
    }
}

impl std::error::Error for RegistryError {}

pub fn validate_expected_manifest(bytes: &[u8]) -> Result<(), RegistryError> {
    validate_manifest_against(bytes, record_families())
}

/// Proves that every registered family has the capability required by its
/// declared migration policy. The generic bounds make this an executable
/// compatibility check rather than a second string-only registry.
pub fn validate_migration_capabilities() -> Result<(), RegistryError> {
    fn pure_upcast<T: PureUpcastRecord>() -> Result<&'static str, RegistryError> {
        require_registered::<T>()?;
        Ok(T::FAMILY.name)
    }
    fn mutable_cas<T: MutableCasRecord>() -> Result<&'static str, RegistryError> {
        require_registered::<T>()?;
        Ok(T::FAMILY.name)
    }
    fn rebuildable<T: RebuildableRecord>() -> Result<&'static str, RegistryError> {
        require_registered::<T>()?;
        Ok(T::FAMILY.name)
    }
    fn untrimmed<T: UntrimmedJournalRecord>() -> Result<&'static str, RegistryError> {
        require_registered::<T>()?;
        Ok(T::FAMILY.name)
    }

    let covered = BTreeSet::from([
        mutable_cas::<super::submission::AdmissionPointer>()?,
        pure_upcast::<super::baseline::ControlBaseline>()?,
        rebuildable::<super::projection_snapshot::ControlProjectionPayload>()?,
        untrimmed::<super::projection_snapshot::ControlProjectionSnapshot>()?,
        pure_upcast::<super::control::ControlRequest>()?,
        rebuildable::<super::inbox::ControlRequestResult>()?,
        rebuildable::<super::state::CurrentStateHint>()?,
        pure_upcast::<crate::graph::artifacts::DesiredProjectionArtifact>()?,
        pure_upcast::<crate::graph::artifacts::EffectIndexArtifact>()?,
        pure_upcast::<crate::graph::planner::GraphDeliveryPayload>()?,
        pure_upcast::<crate::graph::effects::GraphEffect>()?,
        untrimmed::<super::events::JournalRecord>()?,
        pure_upcast::<super::submission::KnownShardMarker>()?,
        pure_upcast::<super::submission::ReadyReceipt>()?,
        pure_upcast::<super::internal_metadata::RequestBindingRecord>()?,
        pure_upcast::<super::internal_metadata::RunInputRecord>()?,
        pure_upcast::<super::internal_metadata::RunLocatorRecord>()?,
        pure_upcast::<super::internal_metadata::RunPolicyRecord>()?,
        mutable_cas::<super::lease::ShardLease>()?,
        pure_upcast::<super::work::StateVersion>()?,
        pure_upcast::<super::work::WorkManifest>()?,
    ]);
    let registered = record_families()
        .iter()
        .map(|family| family.name)
        .collect::<BTreeSet<_>>();
    if covered == registered {
        Ok(())
    } else {
        Err(RegistryError::Mismatch {
            missing: registered
                .difference(&covered)
                .map(ToString::to_string)
                .collect(),
            unexpected: covered
                .difference(&registered)
                .map(ToString::to_string)
                .collect(),
            changed: vec![],
        })
    }
}

pub fn validate_manifest_against(
    bytes: &[u8],
    families: &[&RecordFamily],
) -> Result<(), RegistryError> {
    let expected: RegistryManifest = serde_json::from_slice(bytes)
        .map_err(|error| RegistryError::ManifestMalformed(error.to_string()))?;
    validate_manifest_structure(&expected)?;
    validate_family_definitions(families)?;
    let actual = manifest_from_families(families);

    let expected_by_name = expected
        .families
        .iter()
        .map(|family| (family.name.as_str(), family))
        .collect::<BTreeMap<_, _>>();
    let actual_by_name = actual
        .families
        .iter()
        .map(|family| (family.name.as_str(), family))
        .collect::<BTreeMap<_, _>>();

    let missing = expected_by_name
        .keys()
        .filter(|name| !actual_by_name.contains_key(**name))
        .map(|name| (*name).to_owned())
        .collect::<Vec<_>>();
    let unexpected = actual_by_name
        .keys()
        .filter(|name| !expected_by_name.contains_key(**name))
        .map(|name| (*name).to_owned())
        .collect::<Vec<_>>();
    let changed = expected_by_name
        .iter()
        .filter_map(|(name, expected_family)| {
            actual_by_name
                .get(name)
                .filter(|actual_family| *actual_family != expected_family)
                .map(|_| (*name).to_owned())
        })
        .collect::<Vec<_>>();

    if missing.is_empty() && unexpected.is_empty() && changed.is_empty() {
        Ok(())
    } else {
        Err(RegistryError::Mismatch {
            missing,
            unexpected,
            changed,
        })
    }
}

pub fn manifest_from_families(families: &[&RecordFamily]) -> RegistryManifest {
    RegistryManifest {
        version: REGISTRY_MANIFEST_VERSION,
        families: families
            .iter()
            .map(|family| RecordFamilyManifest {
                name: family.name.to_owned(),
                owning_module: family.owning_module.to_owned(),
                emitted_version: family.emitted_version,
                supported_versions: family.supported_versions.to_vec(),
                algorithm_versions: family
                    .algorithm_versions
                    .iter()
                    .map(|algorithm| AlgorithmVersionManifest {
                        name: algorithm.name.to_owned(),
                        version: algorithm.version,
                    })
                    .collect(),
                durability: family.durability,
                migration: family.migration,
            })
            .collect(),
    }
}

fn validate_manifest_structure(manifest: &RegistryManifest) -> Result<(), RegistryError> {
    if manifest.version != REGISTRY_MANIFEST_VERSION {
        return Err(RegistryError::ManifestMalformed(format!(
            "unsupported manifest version {}",
            manifest.version
        )));
    }
    let names = manifest
        .families
        .iter()
        .map(|family| family.name.as_str())
        .collect::<Vec<_>>();
    if !names.windows(2).all(|pair| pair[0] < pair[1]) {
        if names.windows(2).any(|pair| pair[0] == pair[1]) {
            let duplicate = names
                .windows(2)
                .find(|pair| pair[0] == pair[1])
                .map_or("<unknown>", |pair| pair[0]);
            return Err(RegistryError::DuplicateFamily(duplicate.to_owned()));
        }
        return Err(RegistryError::FamiliesNotSorted);
    }
    for family in &manifest.families {
        validate_manifest_family(family)?;
    }
    Ok(())
}

fn validate_manifest_family(family: &RecordFamilyManifest) -> Result<(), RegistryError> {
    if family.name.trim().is_empty() || family.owning_module.trim().is_empty() {
        return Err(RegistryError::InvalidFamily {
            family: family.name.clone(),
            message: "name and owning module must be non-empty".to_owned(),
        });
    }
    validate_versions(
        &family.name,
        family.emitted_version,
        &family.supported_versions,
    )?;
    validate_policy_class(&family.name, family.durability, family.migration)?;
    validate_algorithms(
        &family.name,
        family
            .algorithm_versions
            .iter()
            .map(|algorithm| (algorithm.name.as_str(), algorithm.version)),
    )
}

fn validate_family_definitions(families: &[&RecordFamily]) -> Result<(), RegistryError> {
    let names = families
        .iter()
        .map(|family| family.name)
        .collect::<Vec<_>>();
    if !names.windows(2).all(|pair| pair[0] < pair[1]) {
        if let Some(duplicate) = names.windows(2).find(|pair| pair[0] == pair[1]) {
            return Err(RegistryError::DuplicateFamily(duplicate[0].to_owned()));
        }
        return Err(RegistryError::FamiliesNotSorted);
    }
    for family in families {
        if family.name.trim().is_empty() || family.owning_module.trim().is_empty() {
            return Err(RegistryError::InvalidFamily {
                family: family.name.to_owned(),
                message: "name and owning module must be non-empty".to_owned(),
            });
        }
        validate_versions(
            family.name,
            family.emitted_version,
            family.supported_versions,
        )?;
        validate_policy_class(family.name, family.durability, family.migration)?;
        validate_algorithms(
            family.name,
            family
                .algorithm_versions
                .iter()
                .map(|algorithm| (algorithm.name, algorithm.version)),
        )?;
    }
    Ok(())
}

fn validate_policy_class(
    family: &str,
    durability: DurabilityClass,
    migration: MigrationPolicy,
) -> Result<(), RegistryError> {
    let valid = matches!(
        (durability, migration),
        (
            DurabilityClass::ImmutableJournal,
            MigrationPolicy::NeverRetireWhileUntrimmed
        ) | (
            DurabilityClass::ImmutableArtifact,
            MigrationPolicy::PureUpcast
        ) | (DurabilityClass::MutableCas, MigrationPolicy::MutableCas)
            | (DurabilityClass::Derived, MigrationPolicy::Rebuild)
    );
    if valid {
        Ok(())
    } else {
        Err(RegistryError::InvalidFamily {
            family: family.to_owned(),
            message: format!(
                "durability class {durability:?} is incompatible with migration policy {migration:?}"
            ),
        })
    }
}

fn validate_versions(
    family: &str,
    emitted_version: u32,
    supported_versions: &[u32],
) -> Result<(), RegistryError> {
    if emitted_version == 0 || supported_versions.is_empty() {
        return Err(RegistryError::InvalidFamily {
            family: family.to_owned(),
            message: "versions are one-based and the supported set must be non-empty".to_owned(),
        });
    }
    let unique = supported_versions.iter().copied().collect::<BTreeSet<_>>();
    if unique.len() != supported_versions.len()
        || unique.contains(&0)
        || !unique.contains(&emitted_version)
        || !supported_versions.windows(2).all(|pair| pair[0] < pair[1])
    {
        return Err(RegistryError::InvalidFamily {
            family: family.to_owned(),
            message: "supported versions must be unique, nonzero, and contain the emitted version"
                .to_owned(),
        });
    }
    Ok(())
}

fn validate_algorithms<'a>(
    family: &str,
    algorithms: impl Iterator<Item = (&'a str, u32)>,
) -> Result<(), RegistryError> {
    let algorithms = algorithms.collect::<Vec<_>>();
    let names = algorithms
        .iter()
        .map(|(name, _version)| *name)
        .collect::<Vec<_>>();
    if names.iter().any(|name| name.trim().is_empty())
        || algorithms.iter().any(|(_name, version)| *version == 0)
        || !names.windows(2).all(|pair| pair[0] < pair[1])
    {
        return Err(RegistryError::InvalidFamily {
            family: family.to_owned(),
            message: "algorithm names must be non-empty, unique, and sorted".to_owned(),
        });
    }
    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    const TEST_FAMILY: RecordFamily = RecordFamily {
        name: "test_record",
        owning_module: "orchestrator::registry::tests",
        emitted_version: 1,
        supported_versions: &[1],
        algorithm_versions: &[AlgorithmVersion {
            name: "test_identity",
            version: 1,
        }],
        durability: DurabilityClass::ImmutableArtifact,
        migration: MigrationPolicy::PureUpcast,
    };

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(tag = "version", content = "data", rename_all = "snake_case")]
    enum TestRecord {
        V1(TestRecordV1),
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct TestRecordV1 {
        value: String,
    }

    impl sealed::Sealed for TestRecord {}

    impl DurableRecord for TestRecord {
        const FAMILY: &'static RecordFamily = &TEST_FAMILY;
        const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::PureUpcast;

        fn encode(&self) -> Result<Vec<u8>, CompatError> {
            serde_json::to_vec(self).map_err(|error| CompatError::Malformed {
                family: Self::FAMILY.name,
                message: error.to_string(),
            })
        }

        fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
            let value: Value =
                serde_json::from_slice(bytes).map_err(|error| CompatError::Malformed {
                    family: Self::FAMILY.name,
                    message: error.to_string(),
                })?;
            reject_unknown_fields(Self::FAMILY.name, "", &value, &["version", "data"])?;
            let version = value
                .get("version")
                .and_then(Value::as_str)
                .ok_or_else(|| CompatError::Malformed {
                    family: Self::FAMILY.name,
                    message: "version must be a string".to_owned(),
                })?;
            if version != "v1" {
                return Err(CompatError::UnsupportedVersion {
                    family: Self::FAMILY.name,
                    version: version.to_owned(),
                });
            }
            let data = value.get("data").ok_or_else(|| CompatError::Malformed {
                family: Self::FAMILY.name,
                message: "data is required".to_owned(),
            })?;
            reject_unknown_fields(Self::FAMILY.name, "data", data, &["value"])?;
            serde_json::from_value(value).map_err(|error| CompatError::Malformed {
                family: Self::FAMILY.name,
                message: error.to_string(),
            })
        }
    }

    impl VersionedRecord for TestRecord {
        type Current = TestRecordV1;

        fn normalize(self) -> Result<Self::Current, CompatError> {
            let Self::V1(value) = self;
            Ok(value)
        }
    }

    impl PureUpcastRecord for TestRecord {}

    const TEST_MUTABLE_FAMILY: RecordFamily = RecordFamily {
        name: "test_mutable_record",
        owning_module: "orchestrator::registry::tests",
        emitted_version: 2,
        supported_versions: &[1, 2],
        algorithm_versions: &[],
        durability: DurabilityClass::MutableCas,
        migration: MigrationPolicy::MutableCas,
    };

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(tag = "version", content = "data", rename_all = "snake_case")]
    enum TestMutableRecord {
        V1 { value: String },
        V2 { value: String, audit: String },
    }

    impl sealed::Sealed for TestMutableRecord {}

    impl DurableRecord for TestMutableRecord {
        const FAMILY: &'static RecordFamily = &TEST_MUTABLE_FAMILY;
        const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::MutableCas;

        fn encode(&self) -> Result<Vec<u8>, CompatError> {
            serde_json::to_vec(self).map_err(|error| CompatError::Malformed {
                family: Self::FAMILY.name,
                message: error.to_string(),
            })
        }

        fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
            serde_json::from_slice(bytes).map_err(|error| CompatError::Malformed {
                family: Self::FAMILY.name,
                message: error.to_string(),
            })
        }
    }

    impl VersionedRecord for TestMutableRecord {
        type Current = String;

        fn normalize(self) -> Result<Self::Current, CompatError> {
            Ok(match self {
                Self::V1 { value } | Self::V2 { value, .. } => value,
            })
        }
    }

    impl MutableCasRecord for TestMutableRecord {
        fn from_current(value: Self::Current) -> Result<Self, CompatError> {
            Ok(Self::V2 {
                value,
                audit: "current-writer".to_owned(),
            })
        }
    }

    #[test]
    fn every_production_family_has_its_executable_migration_capability() {
        validate_migration_capabilities()
            .expect("every family has its policy-specific executable capability");
    }

    #[test]
    fn mutable_capability_upcasts_retained_bytes_and_emits_only_the_current_version() {
        let old = TestMutableRecord::V1 {
            value: "preserved".to_owned(),
        };
        let emitted = old.into_emitted().expect("upcast retained record");
        assert_eq!(
            emitted,
            TestMutableRecord::V2 {
                value: "preserved".to_owned(),
                audit: "current-writer".to_owned(),
            }
        );
    }

    #[test]
    fn production_registry_matches_independent_manifest() {
        validate_expected_manifest(include_bytes!(
            "../../tests/golden/expected-record-families-v1.json"
        ))
        .unwrap();
    }

    #[test]
    fn independent_manifest_detects_an_omitted_family() {
        let error = validate_manifest_against(
            include_bytes!("../../tests/golden/registry-omitted-family.json"),
            &[],
        )
        .expect_err("the manifest family is deliberately absent from the registry");
        assert_eq!(
            error,
            RegistryError::Mismatch {
                missing: vec!["test_record".to_owned()],
                unexpected: Vec::new(),
                changed: Vec::new(),
            }
        );
    }

    #[test]
    fn codecs_reject_unknown_versions_and_extra_fields() {
        let record = TestRecord::V1(TestRecordV1 {
            value: "hello".to_owned(),
        });
        assert_eq!(
            TestRecord::decode(&record.encode().unwrap()).unwrap(),
            record
        );

        let unsupported = TestRecord::decode(br#"{"version":"v2","data":{"value":"x"}}"#)
            .expect_err("v2 is not supported");
        assert!(matches!(
            unsupported,
            CompatError::UnsupportedVersion { version, .. } if version == "v2"
        ));

        let extra = TestRecord::decode(br#"{"version":"v1","data":{"value":"x","future":true}}"#)
            .expect_err("undeclared fields fail closed");
        assert_eq!(
            extra,
            CompatError::ExtraField {
                family: "test_record",
                path: "data.future".to_owned(),
            }
        );
    }

    #[test]
    fn sealed_but_unfinished_family_cannot_reach_storage() {
        assert_eq!(
            require_registered::<TestRecord>(),
            Err(RegistryError::UnregisteredFamily("test_record".to_owned()))
        );
    }

    #[test]
    fn changed_family_metadata_is_a_registry_mismatch() {
        let expected = serde_json::to_vec(&manifest_from_families(&[&TEST_FAMILY])).unwrap();
        let changed = RecordFamily {
            emitted_version: 2,
            supported_versions: &[1, 2],
            ..TEST_FAMILY
        };
        let error = validate_manifest_against(&expected, &[&changed]).unwrap_err();
        assert_eq!(
            error,
            RegistryError::Mismatch {
                missing: Vec::new(),
                unexpected: Vec::new(),
                changed: vec!["test_record".to_owned()],
            }
        );
    }

    #[test]
    fn durability_class_cannot_claim_an_inexecutable_migration_policy() {
        let error = validate_policy_class(
            "derived_test",
            DurabilityClass::Derived,
            MigrationPolicy::PureUpcast,
        )
        .expect_err("derived records must rebuild");
        assert!(matches!(
            error,
            RegistryError::InvalidFamily { family, .. } if family == "derived_test"
        ));
    }
}
