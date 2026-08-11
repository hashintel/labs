//! Compatibility registry for the clean durable-protocol baseline.
//!
//! A record cannot enter protocol storage unless it implements [`DurableRecord`] and
//! points at one of the declarations in [`record_declarations`]. The independently
//! maintained manifest is checked again at production activation.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use serde::{Deserialize, Serialize};

pub const REGISTRY_MANIFEST_VERSION: u32 = 1;

// The declaration mechanism (declaration and record traits, codec errors,
// interning) is kernel-owned; this module owns V1 policy on top of it: the
// reviewed static catalog, the attestation manifest, and the executable
// migration-capability proofs.
pub use durable_kernel::registry::{
    reject_unknown_fields, AlgorithmVersion, CompatError, DurabilityClass, DurableRecord,
    MigrationPolicy, MutableCasRecord, PureUpcastRecord, RebuildableRecord, RecordDeclaration,
    UntrimmedJournalRecord, VersionedRecord,
};

// Before the first production activation, protocol V1 is one design target:
// implementation PRs evolve its structs and independent fixtures in place.
// After V1 is released, a shape change adds a declared version, retains every
// still-supported decoder, and follows the declaration's migration policy below.

/// V1 declarations are added here with the change that introduces their codec.
static RECORD_DECLARATIONS: &[&RecordDeclaration] = &[
    &super::submission::ADMISSION_POINTER_DECLARATION,
    &super::baseline::CONTROL_BASELINE_DECLARATION,
    &super::projection_snapshot::CONTROL_PROJECTION_PAYLOAD_DECLARATION,
    &super::projection_snapshot::CONTROL_PROJECTION_SNAPSHOT_DECLARATION,
    &super::control::CONTROL_REQUEST_DECLARATION,
    &super::inbox::CONTROL_REQUEST_RESULT_DECLARATION,
    &super::state::CURRENT_STATE_HINT_DECLARATION,
    &crate::graph::artifacts::DESIRED_PROJECTION_ARTIFACT_DECLARATION,
    &crate::graph::artifacts::EFFECT_INDEX_ARTIFACT_DECLARATION,
    &crate::graph::planner::GRAPH_DELIVERY_PAYLOAD_DECLARATION,
    &crate::graph::effects::GRAPH_EFFECT_DECLARATION,
    &super::events::JOURNAL_RECORD_DECLARATION,
    &super::submission::KNOWN_SHARD_MARKER_DECLARATION,
    &super::submission::READY_RECEIPT_DECLARATION,
    &super::internal_metadata::REQUEST_BINDING_DECLARATION,
    &super::internal_metadata::RUN_INPUT_DECLARATION,
    &super::internal_metadata::RUN_LOCATOR_DECLARATION,
    &super::internal_metadata::RUN_POLICY_DECLARATION,
    &super::lease::SHARD_LEASE_DECLARATION,
    &super::work::STATE_VERSION_DECLARATION,
    &super::work::WORK_MANIFEST_DECLARATION,
];

pub fn record_declarations() -> &'static [&'static RecordDeclaration] {
    RECORD_DECLARATIONS
}

/// Storage entry points call this before accepting a generic record: its
/// declaration must be in the reviewed V1 catalog (or interned by a hosted
/// domain), preventing an internal test or unfinished declaration from
/// reaching the baseline prefix.
pub fn require_registered<T: DurableRecord>() -> Result<(), RegistryError> {
    if T::MIGRATION_POLICY != T::declaration().migration {
        return Err(RegistryError::InvalidDeclaration {
            name: T::declaration().name.to_owned(),
            message: format!(
                "record type declares {:?} but registry declares {:?}",
                T::MIGRATION_POLICY,
                T::declaration().migration
            ),
        });
    }
    if record_declarations()
        .iter()
        .any(|declaration| **declaration == *T::declaration())
        || durable_kernel::registry::interned_declaration_matches(T::declaration())
    {
        Ok(())
    } else {
        Err(RegistryError::UnregisteredDeclaration(
            T::declaration().name.to_owned(),
        ))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegistryManifest {
    pub version: u32,
    pub declarations: Vec<RecordDeclarationManifest>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordDeclarationManifest {
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
    InvalidDeclaration {
        name: String,
        message: String,
    },
    UnregisteredDeclaration(String),
    DuplicateDeclaration(String),
    DeclarationsNotSorted,
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
            Self::InvalidDeclaration { name, message } => {
                write!(formatter, "durable-record declaration {name:?} is invalid: {message}")
            }
            Self::UnregisteredDeclaration(name) => write!(
                formatter,
                "durable-record declaration {name:?} is not in the V1 registry"
            ),
            Self::DuplicateDeclaration(name) => {
                write!(formatter, "durable-record declaration {name:?} is duplicated")
            }
            Self::DeclarationsNotSorted => formatter.write_str(
                "durable-record declarations must be sorted by name for reviewable diffs",
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
    validate_manifest_against(bytes, record_declarations())
}

/// Proves that every registered declaration has the capability required by its
/// declared migration policy. The generic bounds make this an executable
/// compatibility check rather than a second string-only registry.
pub fn validate_migration_capabilities() -> Result<(), RegistryError> {
    fn pure_upcast<T: PureUpcastRecord>() -> Result<&'static str, RegistryError> {
        require_registered::<T>()?;
        Ok(T::declaration().name)
    }
    fn mutable_cas<T: MutableCasRecord>() -> Result<&'static str, RegistryError> {
        require_registered::<T>()?;
        Ok(T::declaration().name)
    }
    fn rebuildable<T: RebuildableRecord>() -> Result<&'static str, RegistryError> {
        require_registered::<T>()?;
        Ok(T::declaration().name)
    }
    fn untrimmed<T: UntrimmedJournalRecord>() -> Result<&'static str, RegistryError> {
        require_registered::<T>()?;
        Ok(T::declaration().name)
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
    let registered = record_declarations()
        .iter()
        .map(|declaration| declaration.name)
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
    declarations: &[&RecordDeclaration],
) -> Result<(), RegistryError> {
    let expected: RegistryManifest = serde_json::from_slice(bytes)
        .map_err(|error| RegistryError::ManifestMalformed(error.to_string()))?;
    validate_manifest_structure(&expected)?;
    validate_declaration_definitions(declarations)?;
    let actual = manifest_from_declarations(declarations);

    let expected_by_name = expected
        .declarations
        .iter()
        .map(|declaration| (declaration.name.as_str(), declaration))
        .collect::<BTreeMap<_, _>>();
    let actual_by_name = actual
        .declarations
        .iter()
        .map(|declaration| (declaration.name.as_str(), declaration))
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
        .filter_map(|(name, expected_declaration)| {
            actual_by_name
                .get(name)
                .filter(|actual_declaration| *actual_declaration != expected_declaration)
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

pub fn manifest_from_declarations(declarations: &[&RecordDeclaration]) -> RegistryManifest {
    RegistryManifest {
        version: REGISTRY_MANIFEST_VERSION,
        declarations: declarations
            .iter()
            .map(|declaration| RecordDeclarationManifest {
                name: declaration.name.to_owned(),
                owning_module: declaration.owning_module.to_owned(),
                emitted_version: declaration.emitted_version,
                supported_versions: declaration.supported_versions.to_vec(),
                algorithm_versions: declaration
                    .algorithm_versions
                    .iter()
                    .map(|algorithm| AlgorithmVersionManifest {
                        name: algorithm.name.to_owned(),
                        version: algorithm.version,
                    })
                    .collect(),
                durability: declaration.durability,
                migration: declaration.migration,
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
        .declarations
        .iter()
        .map(|declaration| declaration.name.as_str())
        .collect::<Vec<_>>();
    if !names.windows(2).all(|pair| pair[0] < pair[1]) {
        if names.windows(2).any(|pair| pair[0] == pair[1]) {
            let duplicate = names
                .windows(2)
                .find(|pair| pair[0] == pair[1])
                .map_or("<unknown>", |pair| pair[0]);
            return Err(RegistryError::DuplicateDeclaration(duplicate.to_owned()));
        }
        return Err(RegistryError::DeclarationsNotSorted);
    }
    for declaration in &manifest.declarations {
        validate_manifest_declaration(declaration)?;
    }
    Ok(())
}

fn validate_manifest_declaration(
    declaration: &RecordDeclarationManifest,
) -> Result<(), RegistryError> {
    if declaration.name.trim().is_empty() || declaration.owning_module.trim().is_empty() {
        return Err(RegistryError::InvalidDeclaration {
            name: declaration.name.clone(),
            message: "name and owning module must be non-empty".to_owned(),
        });
    }
    validate_versions(
        &declaration.name,
        declaration.emitted_version,
        &declaration.supported_versions,
    )?;
    validate_policy_class(
        &declaration.name,
        declaration.durability,
        declaration.migration,
    )?;
    validate_algorithms(
        &declaration.name,
        declaration
            .algorithm_versions
            .iter()
            .map(|algorithm| (algorithm.name.as_str(), algorithm.version)),
    )
}

fn validate_declaration_definitions(
    declarations: &[&RecordDeclaration],
) -> Result<(), RegistryError> {
    let names = declarations
        .iter()
        .map(|declaration| declaration.name)
        .collect::<Vec<_>>();
    if !names.windows(2).all(|pair| pair[0] < pair[1]) {
        if let Some(duplicate) = names.windows(2).find(|pair| pair[0] == pair[1]) {
            return Err(RegistryError::DuplicateDeclaration(duplicate[0].to_owned()));
        }
        return Err(RegistryError::DeclarationsNotSorted);
    }
    for declaration in declarations {
        if declaration.name.trim().is_empty() || declaration.owning_module.trim().is_empty() {
            return Err(RegistryError::InvalidDeclaration {
                name: declaration.name.to_owned(),
                message: "name and owning module must be non-empty".to_owned(),
            });
        }
        validate_versions(
            declaration.name,
            declaration.emitted_version,
            declaration.supported_versions,
        )?;
        validate_policy_class(
            declaration.name,
            declaration.durability,
            declaration.migration,
        )?;
        validate_algorithms(
            declaration.name,
            declaration
                .algorithm_versions
                .iter()
                .map(|algorithm| (algorithm.name, algorithm.version)),
        )?;
    }
    Ok(())
}

fn validate_policy_class(
    name: &str,
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
        Err(RegistryError::InvalidDeclaration {
            name: name.to_owned(),
            message: format!(
                "durability class {durability:?} is incompatible with migration policy {migration:?}"
            ),
        })
    }
}

fn validate_versions(
    name: &str,
    emitted_version: u32,
    supported_versions: &[u32],
) -> Result<(), RegistryError> {
    if emitted_version == 0 || supported_versions.is_empty() {
        return Err(RegistryError::InvalidDeclaration {
            name: name.to_owned(),
            message: "versions are one-based and the supported set must be non-empty".to_owned(),
        });
    }
    let unique = supported_versions.iter().copied().collect::<BTreeSet<_>>();
    if unique.len() != supported_versions.len()
        || unique.contains(&0)
        || !unique.contains(&emitted_version)
        || !supported_versions.windows(2).all(|pair| pair[0] < pair[1])
    {
        return Err(RegistryError::InvalidDeclaration {
            name: name.to_owned(),
            message: "supported versions must be unique, nonzero, and contain the emitted version"
                .to_owned(),
        });
    }
    Ok(())
}

fn validate_algorithms<'a>(
    name: &str,
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
        return Err(RegistryError::InvalidDeclaration {
            name: name.to_owned(),
            message: "algorithm names must be non-empty, unique, and sorted".to_owned(),
        });
    }
    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use serde_json::Value;

    const TEST_DECLARATION: RecordDeclaration = RecordDeclaration {
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

    impl DurableRecord for TestRecord {
        fn declaration() -> &'static RecordDeclaration {
            &TEST_DECLARATION
        }
        const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::PureUpcast;

        fn encode(&self) -> Result<Vec<u8>, CompatError> {
            serde_json::to_vec(self).map_err(|error| CompatError::Malformed {
                name: Self::declaration().name,
                message: error.to_string(),
            })
        }

        fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
            let value: Value =
                serde_json::from_slice(bytes).map_err(|error| CompatError::Malformed {
                    name: Self::declaration().name,
                    message: error.to_string(),
                })?;
            reject_unknown_fields(Self::declaration().name, "", &value, &["version", "data"])?;
            let version = value
                .get("version")
                .and_then(Value::as_str)
                .ok_or_else(|| CompatError::Malformed {
                    name: Self::declaration().name,
                    message: "version must be a string".to_owned(),
                })?;
            if version != "v1" {
                return Err(CompatError::UnsupportedVersion {
                    name: Self::declaration().name,
                    version: version.to_owned(),
                });
            }
            let data = value.get("data").ok_or_else(|| CompatError::Malformed {
                name: Self::declaration().name,
                message: "data is required".to_owned(),
            })?;
            reject_unknown_fields(Self::declaration().name, "data", data, &["value"])?;
            serde_json::from_value(value).map_err(|error| CompatError::Malformed {
                name: Self::declaration().name,
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

    const TEST_MUTABLE_DECLARATION: RecordDeclaration = RecordDeclaration {
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

    impl DurableRecord for TestMutableRecord {
        fn declaration() -> &'static RecordDeclaration {
            &TEST_MUTABLE_DECLARATION
        }
        const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::MutableCas;

        fn encode(&self) -> Result<Vec<u8>, CompatError> {
            serde_json::to_vec(self).map_err(|error| CompatError::Malformed {
                name: Self::declaration().name,
                message: error.to_string(),
            })
        }

        fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
            serde_json::from_slice(bytes).map_err(|error| CompatError::Malformed {
                name: Self::declaration().name,
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
    fn every_production_declaration_has_its_executable_migration_capability() {
        validate_migration_capabilities()
            .expect("every declaration has its policy-specific executable capability");
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
            "../../tests/golden/expected-record-declarations-v1.json"
        ))
        .unwrap();
    }

    #[test]
    fn independent_manifest_detects_an_omitted_declaration() {
        let error = validate_manifest_against(
            include_bytes!("../../tests/golden/registry-omitted-declaration.json"),
            &[],
        )
        .expect_err("the manifest declaration is absent from the registry by construction");
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
                name: "test_record",
                path: "data.future".to_owned(),
            }
        );
    }

    #[test]
    fn sealed_but_unfinished_declaration_cannot_reach_storage() {
        assert_eq!(
            require_registered::<TestRecord>(),
            Err(RegistryError::UnregisteredDeclaration(
                "test_record".to_owned()
            ))
        );
    }

    #[test]
    fn changed_declaration_metadata_is_a_registry_mismatch() {
        let expected =
            serde_json::to_vec(&manifest_from_declarations(&[&TEST_DECLARATION])).unwrap();
        let changed = RecordDeclaration {
            emitted_version: 2,
            supported_versions: &[1, 2],
            ..TEST_DECLARATION
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
            RegistryError::InvalidDeclaration { name, .. } if name == "derived_test"
        ));
    }
}
