//! Immutable identity marker and startup gate for the tenant-first control plane.

use std::fmt;
use std::future::{ready, Future};

use error_stack::{Report, ResultExt as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ids::TenantNamespace;
use super::record_io::{self, InspectedRecord};
use super::registry::{
    reject_unknown_fields, AlgorithmVersion, CompatError, DurabilityClass, DurableRecord,
    MigrationPolicy, PureUpcastRecord, RecordDeclaration, VersionedRecord,
};
use super::routing::{Keyspace, ROUTING_VERSION, SHARD_COUNT};
use crate::blob::{ArtifactStore, CasWrite};

pub const CONTROL_PREFIX_VERSION: u32 = 1;
pub const DURABLE_METADATA_BASELINE: u32 = 1;
pub const EXTERNALLY_PINNED_IDENTITY_CONTRACT: &str = "ts-elixir-rust-v1";
const MAX_CONTROL_BASELINE_BYTES: usize = 4 * 1024;

pub(crate) static CONTROL_BASELINE_DECLARATION: RecordDeclaration = RecordDeclaration {
    name: "control_baseline",
    owning_module: "orchestrator::baseline",
    emitted_version: 1,
    supported_versions: &[1],
    algorithm_versions: &[
        AlgorithmVersion {
            name: "control_prefix",
            version: CONTROL_PREFIX_VERSION,
        },
        AlgorithmVersion {
            name: "durable_metadata_baseline",
            version: DURABLE_METADATA_BASELINE,
        },
        AlgorithmVersion {
            name: "routing",
            version: ROUTING_VERSION,
        },
    ],
    durability: DurabilityClass::ImmutableArtifact,
    migration: MigrationPolicy::PureUpcast,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub enum ControlBaseline {
    V1(ControlBaselineV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlBaselineV1 {
    pub tenant_namespace: String,
    pub control_prefix_version: u32,
    pub durable_metadata_baseline: u32,
    pub routing_version: u32,
    pub shard_count: u16,
    pub externally_pinned_identity_contract: String,
}

impl ControlBaseline {
    pub fn canonical(tenant: &TenantNamespace) -> Self {
        Self::V1(ControlBaselineV1 {
            tenant_namespace: tenant.as_str().to_owned(),
            control_prefix_version: CONTROL_PREFIX_VERSION,
            durable_metadata_baseline: DURABLE_METADATA_BASELINE,
            routing_version: ROUTING_VERSION,
            shard_count: SHARD_COUNT,
            externally_pinned_identity_contract: EXTERNALLY_PINNED_IDENTITY_CONTRACT.to_owned(),
        })
    }

    pub fn current(&self) -> &ControlBaselineV1 {
        match self {
            Self::V1(value) => value,
        }
    }
}

impl super::registry::sealed::Sealed for ControlBaseline {}

impl DurableRecord for ControlBaseline {
    fn declaration() -> &'static RecordDeclaration {
        &CONTROL_BASELINE_DECLARATION
    }
    const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::PureUpcast;

    fn encode(&self) -> Result<Vec<u8>, CompatError> {
        validate_shape(self)?;
        serde_json::to_vec(self).map_err(|error| CompatError::Malformed {
            name: Self::declaration().name,
            message: error.to_string(),
        })
    }

    fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
        if bytes.len() > MAX_CONTROL_BASELINE_BYTES {
            return Err(CompatError::Malformed {
                name: Self::declaration().name,
                message: format!(
                    "record is {} bytes; maximum is {MAX_CONTROL_BASELINE_BYTES}",
                    bytes.len()
                ),
            });
        }
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
        reject_unknown_fields(
            Self::declaration().name,
            "data",
            data,
            &[
                "tenant_namespace",
                "control_prefix_version",
                "durable_metadata_baseline",
                "routing_version",
                "shard_count",
                "externally_pinned_identity_contract",
            ],
        )?;
        let baseline: Self =
            serde_json::from_value(value).map_err(|error| CompatError::Malformed {
                name: Self::declaration().name,
                message: error.to_string(),
            })?;
        validate_shape(&baseline)?;
        Ok(baseline)
    }
}

impl VersionedRecord for ControlBaseline {
    type Current = ControlBaselineV1;

    fn normalize(self) -> Result<Self::Current, CompatError> {
        validate_shape(&self)?;
        let Self::V1(value) = self;
        Ok(value)
    }
}

impl PureUpcastRecord for ControlBaseline {}

fn validate_shape(baseline: &ControlBaseline) -> Result<(), CompatError> {
    TenantNamespace::parse(baseline.current().tenant_namespace.clone())
        .map(|_tenant| ())
        .map_err(|error| CompatError::Malformed {
            name: ControlBaseline::declaration().name,
            message: format!("tenant_namespace is invalid: {error}"),
        })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IncompatibleField {
    pub field: &'static str,
    pub expected: String,
    pub actual: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BaselineIncompatibility {
    Malformed(CompatError),
    Fields(Vec<IncompatibleField>),
}

impl fmt::Display for BaselineIncompatibility {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Malformed(error) => write!(formatter, "{error}"),
            Self::Fields(fields) => {
                formatter.write_str("incompatible control baseline fields:")?;
                for field in fields {
                    write!(
                        formatter,
                        " {} expected {:?}, found {:?};",
                        field.field, field.expected, field.actual
                    )?;
                }
                Ok(())
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BaselineRead {
    Present(ControlBaseline),
    Malformed(CompatError),
    Absent { inventory: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartupDecision {
    Recover,
    FailIncompatible(BaselineIncompatibility),
    RefuseForeign(Vec<String>),
    Initialize,
}

pub fn startup_decision(expected: &ControlBaseline, observation: BaselineRead) -> StartupDecision {
    match observation {
        BaselineRead::Present(actual) => {
            let fields = incompatible_fields(expected.current(), actual.current());
            if fields.is_empty() {
                StartupDecision::Recover
            } else {
                StartupDecision::FailIncompatible(BaselineIncompatibility::Fields(fields))
            }
        }
        BaselineRead::Malformed(error) => {
            StartupDecision::FailIncompatible(BaselineIncompatibility::Malformed(error))
        }
        BaselineRead::Absent { mut inventory } => {
            inventory.sort();
            inventory.dedup();
            if inventory.is_empty() {
                StartupDecision::Initialize
            } else {
                StartupDecision::RefuseForeign(inventory)
            }
        }
    }
}

fn incompatible_fields(
    expected: &ControlBaselineV1,
    actual: &ControlBaselineV1,
) -> Vec<IncompatibleField> {
    let mut fields = Vec::new();
    compare_field(
        &mut fields,
        "tenant_namespace",
        &expected.tenant_namespace,
        &actual.tenant_namespace,
    );
    compare_field(
        &mut fields,
        "control_prefix_version",
        &expected.control_prefix_version,
        &actual.control_prefix_version,
    );
    compare_field(
        &mut fields,
        "durable_metadata_baseline",
        &expected.durable_metadata_baseline,
        &actual.durable_metadata_baseline,
    );
    compare_field(
        &mut fields,
        "routing_version",
        &expected.routing_version,
        &actual.routing_version,
    );
    compare_field(
        &mut fields,
        "shard_count",
        &expected.shard_count,
        &actual.shard_count,
    );
    compare_field(
        &mut fields,
        "externally_pinned_identity_contract",
        &expected.externally_pinned_identity_contract,
        &actual.externally_pinned_identity_contract,
    );
    fields
}

fn compare_field<T: fmt::Display + PartialEq>(
    fields: &mut Vec<IncompatibleField>,
    field: &'static str,
    expected: &T,
    actual: &T,
) {
    if expected != actual {
        fields.push(IncompatibleField {
            field,
            expected: expected.to_string(),
            actual: actual.to_string(),
        });
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BaselineStartup {
    Recovered,
    Initialized,
}

#[derive(Debug)]
pub enum BaselineStartupError {
    Storage,
    Missing,
    Incompatible(BaselineIncompatibility),
    ForeignPrefix(Vec<String>),
    MissingAfterCreate,
}

impl fmt::Display for BaselineStartupError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Storage => formatter.write_str("control baseline storage operation failed"),
            Self::Missing => formatter.write_str("control baseline is missing"),
            Self::Incompatible(error) => {
                write!(formatter, "control baseline is incompatible: {error}")
            }
            Self::ForeignPrefix(objects) => write!(
                formatter,
                "refusing markerless non-empty control prefix containing {objects:?}"
            ),
            Self::MissingAfterCreate => formatter
                .write_str("control baseline is missing after its conditional create completed"),
        }
    }
}

impl std::error::Error for BaselineStartupError {}

/// Read-only compatibility check for operator queries and store inspection.
/// Unlike startup, this never initializes an empty prefix.
pub(crate) async fn verify_control_baseline(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
) -> Result<ControlBaselineV1, Report<BaselineStartupError>> {
    let paths = Keyspace::for_tenant(tenant);
    let expected = ControlBaseline::canonical(tenant);
    let observation = match read_baseline(store, &paths.baseline()).await? {
        Some(Ok(baseline)) => BaselineRead::Present(baseline),
        Some(Err(error)) => BaselineRead::Malformed(error),
        None => return Err(Report::new(BaselineStartupError::Missing)),
    };
    match startup_decision(&expected, observation) {
        StartupDecision::Recover => Ok(expected.current().clone()),
        StartupDecision::FailIncompatible(error) => {
            Err(Report::new(BaselineStartupError::Incompatible(error)))
        }
        StartupDecision::RefuseForeign(_) | StartupDecision::Initialize => {
            Err(Report::new(BaselineStartupError::Missing))
        }
    }
}

pub(crate) async fn compatible_control_baseline_exists(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
) -> Result<bool, Report<BaselineStartupError>> {
    let paths = Keyspace::for_tenant(tenant);
    let expected = ControlBaseline::canonical(tenant);
    let Some(observed) = read_baseline(store, &paths.baseline()).await? else {
        return Ok(false);
    };
    let observation = match observed {
        Ok(baseline) => BaselineRead::Present(baseline),
        Err(error) => BaselineRead::Malformed(error),
    };
    match startup_decision(&expected, observation) {
        StartupDecision::Recover => Ok(true),
        StartupDecision::FailIncompatible(error) => {
            Err(Report::new(BaselineStartupError::Incompatible(error)))
        }
        StartupDecision::RefuseForeign(_) | StartupDecision::Initialize => Ok(false),
    }
}

/// Ensures that a tenant control prefix has exactly the immutable baseline the
/// current binary expects.
pub async fn ensure_control_baseline(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
) -> Result<BaselineStartup, Report<BaselineStartupError>> {
    ensure_control_baseline_with(store, tenant, || ready(())).await
}

async fn ensure_control_baseline_with<F, Fut>(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
    after_absent_read: F,
) -> Result<BaselineStartup, Report<BaselineStartupError>>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = ()>,
{
    let paths = Keyspace::for_tenant(tenant);
    let expected = ControlBaseline::canonical(tenant);
    let first_read = read_baseline(store, &paths.baseline()).await?;
    let observation = match first_read {
        Some(result) => match result {
            Ok(baseline) => BaselineRead::Present(baseline),
            Err(error) => BaselineRead::Malformed(error),
        },
        None => {
            after_absent_read().await;
            let inventory = store
                .list(&paths.control_root())
                .await
                .change_context(BaselineStartupError::Storage)?
                .into_iter()
                .map(|object| object.key)
                .collect::<Vec<_>>();
            if inventory.iter().any(|key| key == &paths.baseline()) {
                match read_baseline(store, &paths.baseline()).await? {
                    Some(Ok(baseline)) => BaselineRead::Present(baseline),
                    Some(Err(error)) => BaselineRead::Malformed(error),
                    None => BaselineRead::Absent { inventory },
                }
            } else {
                BaselineRead::Absent { inventory }
            }
        }
    };

    match startup_decision(&expected, observation) {
        StartupDecision::Recover => Ok(BaselineStartup::Recovered),
        StartupDecision::FailIncompatible(error) => {
            Err(Report::new(BaselineStartupError::Incompatible(error)))
        }
        StartupDecision::RefuseForeign(objects) => {
            Err(Report::new(BaselineStartupError::ForeignPrefix(objects)))
        }
        StartupDecision::Initialize => create_and_read_back(store, &paths, &expected).await,
    }
}

async fn create_and_read_back(
    store: &ArtifactStore,
    paths: &Keyspace,
    expected: &ControlBaseline,
) -> Result<BaselineStartup, Report<BaselineStartupError>> {
    let created = record_io::create(store, &paths.baseline(), expected)
        .await
        .change_context(BaselineStartupError::Storage)?;
    let outcome = match created {
        CasWrite::Written(_) => BaselineStartup::Initialized,
        CasWrite::Conflict => BaselineStartup::Recovered,
    };

    let Some(read_back) = read_baseline(store, &paths.baseline()).await? else {
        return Err(Report::new(BaselineStartupError::MissingAfterCreate));
    };
    let observation = match read_back {
        Ok(baseline) => BaselineRead::Present(baseline),
        Err(error) => BaselineRead::Malformed(error),
    };
    match startup_decision(expected, observation) {
        StartupDecision::Recover => Ok(outcome),
        StartupDecision::FailIncompatible(error) => {
            Err(Report::new(BaselineStartupError::Incompatible(error)))
        }
        StartupDecision::RefuseForeign(_) | StartupDecision::Initialize => {
            Err(Report::new(BaselineStartupError::MissingAfterCreate))
        }
    }
}

async fn read_baseline(
    store: &ArtifactStore,
    key: &str,
) -> Result<Option<Result<ControlBaseline, CompatError>>, Report<BaselineStartupError>> {
    let read = record_io::inspect::<ControlBaseline>(store, key, MAX_CONTROL_BASELINE_BYTES)
        .await
        .change_context(BaselineStartupError::Storage)?;
    match read {
        InspectedRecord::Missing => Ok(None),
        InspectedRecord::Present(record, _version) => Ok(Some(Ok(record))),
        InspectedRecord::Malformed(error, _version) => Ok(Some(Err(error))),
        InspectedRecord::TooLarge {
            actual_bytes,
            maximum_bytes,
        } => Ok(Some(Err(CompatError::Malformed {
            name: ControlBaseline::declaration().name,
            message: format!("record is {actual_bytes} bytes; maximum is {maximum_bytes}"),
        }))),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use crate::blob::BoundedCasDocument;
    use serde_json::json;
    use tempfile::tempdir;

    fn tenant() -> TenantNamespace {
        TenantNamespace::parse("alice").expect("fixture tenant is valid")
    }

    #[test]
    fn canonical_wire_bytes_match_independent_fixture() {
        let encoded = ControlBaseline::canonical(&tenant())
            .encode()
            .expect("encode canonical baseline");
        let fixture = include_bytes!("../../tests/golden/control-baseline-v1.json");
        let fixture = fixture.strip_suffix(b"\n").unwrap_or(fixture);
        assert_eq!(encoded, fixture);
        assert_eq!(
            ControlBaseline::decode(&encoded).unwrap().encode().unwrap(),
            encoded
        );
    }

    #[test]
    fn decision_table_covers_recover_incompatible_malformed_foreign_and_initialize() {
        let expected = ControlBaseline::canonical(&tenant());
        assert_eq!(
            startup_decision(&expected, BaselineRead::Present(expected.clone())),
            StartupDecision::Recover
        );

        let mut wrong_tenant = expected.clone();
        let ControlBaseline::V1(value) = &mut wrong_tenant;
        value.tenant_namespace = "bob".to_owned();
        assert!(matches!(
            startup_decision(&expected, BaselineRead::Present(wrong_tenant)),
            StartupDecision::FailIncompatible(BaselineIncompatibility::Fields(fields))
                if fields.iter().map(|field| field.field).collect::<Vec<_>>() == ["tenant_namespace"]
        ));

        let mut wrong_contract = expected.clone();
        let ControlBaseline::V1(value) = &mut wrong_contract;
        value.routing_version = 2;
        value.shard_count = 128;
        value.externally_pinned_identity_contract = "other".to_owned();
        assert!(matches!(
            startup_decision(&expected, BaselineRead::Present(wrong_contract)),
            StartupDecision::FailIncompatible(BaselineIncompatibility::Fields(fields))
                if fields.iter().map(|field| field.field).collect::<Vec<_>>()
                    == ["routing_version", "shard_count", "externally_pinned_identity_contract"]
        ));

        let malformed = CompatError::Malformed {
            name: "control_baseline",
            message: "bad JSON".to_owned(),
        };
        assert_eq!(
            startup_decision(&expected, BaselineRead::Malformed(malformed.clone())),
            StartupDecision::FailIncompatible(BaselineIncompatibility::Malformed(malformed))
        );
        assert_eq!(
            startup_decision(
                &expected,
                BaselineRead::Absent {
                    inventory: vec!["z".to_owned(), "a".to_owned(), "a".to_owned()],
                },
            ),
            StartupDecision::RefuseForeign(vec!["a".to_owned(), "z".to_owned()])
        );
        assert_eq!(
            startup_decision(
                &expected,
                BaselineRead::Absent {
                    inventory: Vec::new(),
                },
            ),
            StartupDecision::Initialize
        );
    }

    #[test]
    fn codec_rejects_unknown_versions_fields_and_unsafe_tenants() {
        assert!(matches!(
            ControlBaseline::decode(br#"{"version":"v2","data":{}}"#),
            Err(CompatError::UnsupportedVersion { version, .. }) if version == "v2"
        ));
        assert_eq!(
            ControlBaseline::decode(br#"{"version":"v1","data":{"tenant_namespace":"alice","control_prefix_version":1,"durable_metadata_baseline":1,"routing_version":1,"shard_count":256,"externally_pinned_identity_contract":"ts-elixir-rust-v1","future":true}}"#),
            Err(CompatError::ExtraField {
                name: "control_baseline",
                path: "data.future".to_owned(),
            })
        );
        let unsafe_tenant = serde_json::to_vec(&ControlBaseline::V1(ControlBaselineV1 {
            tenant_namespace: "../alice".to_owned(),
            ..expected_v1()
        }))
        .unwrap();
        assert!(matches!(
            ControlBaseline::decode(&unsafe_tenant),
            Err(CompatError::Malformed { .. })
        ));
        let invalid = ControlBaseline::V1(ControlBaselineV1 {
            tenant_namespace: "../alice".to_owned(),
            ..expected_v1()
        });
        assert!(matches!(
            invalid.encode(),
            Err(CompatError::Malformed { .. })
        ));
    }

    fn expected_v1() -> ControlBaselineV1 {
        ControlBaseline::canonical(&tenant()).current().clone()
    }

    #[tokio::test]
    async fn local_startup_initializes_then_recovers_without_changing_bytes() {
        let remote = tempdir().unwrap();
        let cache = tempdir().unwrap();
        let store = ArtifactStore::local(remote.path(), cache.path()).unwrap();
        assert_eq!(
            ensure_control_baseline(&store, &tenant()).await.unwrap(),
            BaselineStartup::Initialized
        );
        assert_eq!(
            ensure_control_baseline(&store, &tenant()).await.unwrap(),
            BaselineStartup::Recovered
        );
        let paths = Keyspace::for_tenant(&tenant());
        let read_back = store
            .get_cas_document_bounded(&paths.baseline(), MAX_CONTROL_BASELINE_BYTES)
            .await
            .unwrap();
        let BoundedCasDocument::Present(bytes, _version) = read_back else {
            panic!("initialized baseline must be present and within its size bound")
        };
        assert_eq!(
            bytes.as_ref(),
            ControlBaseline::canonical(&tenant()).encode().unwrap()
        );
    }

    #[tokio::test]
    async fn crash_after_create_is_recovered_and_concurrent_creators_share_one_winner() {
        let remote = tempdir().unwrap();
        let first_cache = tempdir().unwrap();
        let second_cache = tempdir().unwrap();
        let first = ArtifactStore::local(remote.path(), first_cache.path()).unwrap();
        let second = ArtifactStore::local(remote.path(), second_cache.path()).unwrap();
        let tenant = tenant();
        let paths = Keyspace::for_tenant(&tenant);
        let expected = ControlBaseline::canonical(&tenant);

        let (left, right) = tokio::join!(
            create_and_read_back(&first, &paths, &expected),
            create_and_read_back(&second, &paths, &expected),
        );
        let outcomes = [left.unwrap(), right.unwrap()];
        assert!(outcomes.contains(&BaselineStartup::Initialized));
        assert!(outcomes.contains(&BaselineStartup::Recovered));

        assert_eq!(
            ensure_control_baseline(&first, &tenant).await.unwrap(),
            BaselineStartup::Recovered
        );
    }

    #[tokio::test]
    async fn marker_created_between_absent_read_and_list_recovers_through_full_startup() {
        let remote = tempdir().unwrap();
        let first_cache = tempdir().unwrap();
        let second_cache = tempdir().unwrap();
        let observer = ArtifactStore::local(remote.path(), first_cache.path()).unwrap();
        let initializer = ArtifactStore::local(remote.path(), second_cache.path()).unwrap();
        let tenant = tenant();
        let paths = Keyspace::for_tenant(&tenant);
        let expected = ControlBaseline::canonical(&tenant);

        let outcome = ensure_control_baseline_with(&observer, &tenant, || async {
            assert!(matches!(
                initializer
                    .create_json(&paths.baseline(), &expected)
                    .await
                    .unwrap(),
                CasWrite::Written(_)
            ));
        })
        .await
        .unwrap();

        assert_eq!(outcome, BaselineStartup::Recovered);
        let stored = observer
            .get_json::<ControlBaseline>(&paths.baseline())
            .await
            .unwrap()
            .unwrap()
            .0;
        assert_eq!(stored, expected);
    }

    #[tokio::test]
    async fn markerless_foreign_content_and_malformed_marker_fail_closed() {
        let foreign_remote = tempdir().unwrap();
        let foreign_cache = tempdir().unwrap();
        let foreign = ArtifactStore::local(foreign_remote.path(), foreign_cache.path()).unwrap();
        let paths = Keyspace::for_tenant(&tenant());
        foreign
            .create_json(
                &format!("{}/foreign.json", paths.control_root()),
                &json!({"old": true}),
            )
            .await
            .unwrap();
        assert!(matches!(
            ensure_control_baseline(&foreign, &tenant())
                .await
                .unwrap_err()
                .current_context(),
            BaselineStartupError::ForeignPrefix(objects)
                if objects == &vec![format!("{}/foreign.json", paths.control_root())]
        ));

        let malformed_remote = tempdir().unwrap();
        let malformed_cache = tempdir().unwrap();
        let malformed =
            ArtifactStore::local(malformed_remote.path(), malformed_cache.path()).unwrap();
        malformed
            .create_json(
                &paths.baseline(),
                &json!({"version": "v1", "data": {"future": true}}),
            )
            .await
            .unwrap();
        assert!(matches!(
            ensure_control_baseline(&malformed, &tenant())
                .await
                .unwrap_err()
                .current_context(),
            BaselineStartupError::Incompatible(BaselineIncompatibility::Malformed(_))
        ));

        let oversized_remote = tempdir().unwrap();
        let oversized_cache = tempdir().unwrap();
        let oversized =
            ArtifactStore::local(oversized_remote.path(), oversized_cache.path()).unwrap();
        oversized
            .create_json(&paths.baseline(), &"x".repeat(MAX_CONTROL_BASELINE_BYTES))
            .await
            .unwrap();
        assert!(matches!(
            ensure_control_baseline(&oversized, &tenant())
                .await
                .unwrap_err()
                .current_context(),
            BaselineStartupError::Incompatible(BaselineIncompatibility::Malformed(
                CompatError::Malformed { message, .. }
            )) if message.contains("maximum")
        ));
    }
}
