//! Versioned internal records owned by the greenfield orchestration port.
//!
//! V1 and its independent fixture define the released baseline. New shapes add
//! enum variants and explicit conversions here.
//! Unknown versions and fields fail closed; no codec in this module interprets
//! any external runner state.

use std::collections::BTreeMap;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ids::{CanonicalIntegrationId, RequestId};
use super::registry::{
    reject_unknown_fields, CompatError, DurabilityClass, DurableRecord, MigrationPolicy,
    PureUpcastRecord, RecordFamily, VersionedRecord,
};

pub(crate) const MAX_RUN_INPUT_RECORD_BYTES: usize = 1024 * 1024;
pub(crate) const MAX_RUN_POLICY_RECORD_BYTES: usize = 16 * 1024;
pub(crate) const MAX_RUN_LOCATOR_RECORD_BYTES: usize = 16 * 1024;
pub(crate) const MAX_REQUEST_BINDING_RECORD_BYTES: usize = 16 * 1024;

pub(crate) static RUN_INPUT_FAMILY: RecordFamily = family("run_input");
pub(crate) static RUN_POLICY_FAMILY: RecordFamily = family("run_policy");
pub(crate) static RUN_LOCATOR_FAMILY: RecordFamily = family("run_locator");
pub(crate) static REQUEST_BINDING_FAMILY: RecordFamily = family("request_binding");

const fn family(name: &'static str) -> RecordFamily {
    RecordFamily {
        name,
        owning_module: "orchestrator::internal_metadata",
        emitted_version: 1,
        supported_versions: &[1],
        algorithm_versions: &[],
        durability: DurabilityClass::ImmutableArtifact,
        migration: MigrationPolicy::PureUpcast,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub(crate) enum RunInputRecord {
    V1(RunInputRecordV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RunInputRecordV1 {
    definition: String,
    public_variables: BTreeMap<String, String>,
    /// Authenticated Graph actor responsible for this run. This is engine
    /// metadata, never part of the user-authored pipeline definition.
    owner_actor_id: String,
    /// Digest of the fully resolved semantic definition. The resolved
    /// definition itself may contain credentials and is never persisted.
    resolved_definition_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub(crate) enum RunPolicyRecord {
    V1(RunPolicyRecordV1),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RunPolicyRecordV1 {
    max_handler_failures: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub(crate) enum RunLocatorRecord {
    V1(RunLocatorRecordV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RunLocatorRecordV1 {
    integration_id: CanonicalIntegrationId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub(crate) enum RequestBindingRecord {
    V1(RequestBindingRecordV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RequestBindingRecordV1 {
    fingerprint: String,
    protocol_request_id: RequestId,
}

impl RunInputRecord {
    pub(crate) fn current(
        definition: String,
        public_variables: BTreeMap<String, String>,
        owner_actor_id: String,
        resolved_definition_digest: String,
    ) -> Self {
        Self::V1(RunInputRecordV1 {
            definition,
            public_variables,
            owner_actor_id,
            resolved_definition_digest,
        })
    }

    /// Normalizes a supported wire version at the codec boundary.
    pub(crate) fn into_current(self) -> CurrentRunInputRecord {
        let Self::V1(value) = self;
        CurrentRunInputRecord {
            definition: value.definition,
            public_variables: value.public_variables,
            owner_actor_id: value.owner_actor_id,
            resolved_definition_digest: value.resolved_definition_digest,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CurrentRunInputRecord {
    pub(crate) definition: String,
    pub(crate) public_variables: BTreeMap<String, String>,
    pub(crate) owner_actor_id: String,
    pub(crate) resolved_definition_digest: String,
}

impl RunPolicyRecord {
    pub(crate) const fn current(max_handler_failures: u32) -> Self {
        Self::V1(RunPolicyRecordV1 {
            max_handler_failures,
        })
    }

    /// Normalizes a supported wire version at the codec boundary.
    pub(crate) const fn max_handler_failures(&self) -> u32 {
        let Self::V1(value) = self;
        value.max_handler_failures
    }
}

impl RunLocatorRecord {
    /// Constructs the immutable stable-key locator written before admission.
    pub(crate) fn current(integration_id: CanonicalIntegrationId) -> Self {
        Self::V1(RunLocatorRecordV1 { integration_id })
    }

    /// Normalizes a supported wire version at the codec boundary.
    pub(crate) fn into_current(self) -> CanonicalIntegrationId {
        let Self::V1(value) = self;
        value.integration_id
    }
}

impl RequestBindingRecord {
    /// Production bindings are written by the durable submission path; only
    /// the port adapter and migration fixtures construct them directly.
    #[cfg(test)]
    pub(crate) fn current(fingerprint: String, protocol_request_id: RequestId) -> Self {
        Self::V1(RequestBindingRecordV1 {
            fingerprint,
            protocol_request_id,
        })
    }

    /// Normalizes a supported wire version at the codec boundary.
    fn into_current(self) -> (String, RequestId) {
        let Self::V1(value) = self;
        (value.fingerprint, value.protocol_request_id)
    }
}

/// Semantic equality for immutable records stored at a stable CAS key.
///
/// After V1 is frozen, a newer wire variant may be a pure upcast of an older
/// one. Lost-ack recovery must compare their normalized meaning rather than
/// falsely conflicting solely because their envelope versions differ.
#[cfg(test)]
pub(crate) trait StableKeyRecord: PureUpcastRecord + Sync {
    fn same_current_value(&self, other: &Self) -> bool;
}

#[cfg(test)]
impl StableKeyRecord for RunLocatorRecord {
    fn same_current_value(&self, other: &Self) -> bool {
        self.clone().into_current() == other.clone().into_current()
    }
}

#[cfg(test)]
impl StableKeyRecord for RequestBindingRecord {
    fn same_current_value(&self, other: &Self) -> bool {
        self.clone().into_current() == other.clone().into_current()
    }
}

impl VersionedRecord for RunInputRecord {
    type Current = CurrentRunInputRecord;

    fn normalize(self) -> Result<Self::Current, CompatError> {
        Ok(Self::into_current(self))
    }
}

impl PureUpcastRecord for RunInputRecord {}

impl VersionedRecord for RunPolicyRecord {
    type Current = u32;

    fn normalize(self) -> Result<Self::Current, CompatError> {
        Ok(self.max_handler_failures())
    }
}

impl PureUpcastRecord for RunPolicyRecord {}

impl VersionedRecord for RunLocatorRecord {
    type Current = CanonicalIntegrationId;

    fn normalize(self) -> Result<Self::Current, CompatError> {
        Ok(Self::into_current(self))
    }
}

impl PureUpcastRecord for RunLocatorRecord {}

impl VersionedRecord for RequestBindingRecord {
    type Current = (String, RequestId);

    fn normalize(self) -> Result<Self::Current, CompatError> {
        Ok(Self::into_current(self))
    }
}

impl PureUpcastRecord for RequestBindingRecord {}

trait ValidateInternal {
    fn validate(&self) -> Result<(), CompatError>;
}

impl ValidateInternal for RunInputRecord {
    fn validate(&self) -> Result<(), CompatError> {
        let Self::V1(value) = self;
        if value.definition.trim().is_empty() {
            return Err(malformed(
                Self::FAMILY.name,
                "definition must not be empty".to_owned(),
            ));
        }
        if value.owner_actor_id.trim().is_empty()
            || value.owner_actor_id.len() > 256
            || value.owner_actor_id.chars().any(char::is_control)
        {
            return Err(malformed(
                Self::FAMILY.name,
                "owner_actor_id must be 1..=256 bytes without control characters".to_owned(),
            ));
        }
        validate_sha256(
            Self::FAMILY.name,
            "resolved_definition_digest",
            &value.resolved_definition_digest,
        )?;
        Ok(())
    }
}

impl ValidateInternal for RunPolicyRecord {
    fn validate(&self) -> Result<(), CompatError> {
        let Self::V1(value) = self;
        if value.max_handler_failures == 0 {
            return Err(malformed(
                Self::FAMILY.name,
                "max_handler_failures must be nonzero".to_owned(),
            ));
        }
        Ok(())
    }
}

impl ValidateInternal for RunLocatorRecord {
    fn validate(&self) -> Result<(), CompatError> {
        Ok(())
    }
}

impl ValidateInternal for RequestBindingRecord {
    fn validate(&self) -> Result<(), CompatError> {
        let Self::V1(value) = self;
        if value.fingerprint.len() != 64
            || !value
                .fingerprint
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(malformed(
                Self::FAMILY.name,
                "fingerprint must be 64 lowercase hexadecimal characters".to_owned(),
            ));
        }
        Ok(())
    }
}

macro_rules! durable_record {
    ($record:ty, $family:ident, $max:ident, [$($field:literal),* $(,)?]) => {
        impl super::registry::sealed::Sealed for $record {}

        impl DurableRecord for $record {
            const FAMILY: &'static RecordFamily = &$family;
            const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::PureUpcast;

            fn encode(&self) -> Result<Vec<u8>, CompatError> {
                self.validate()?;
                let bytes = serde_json::to_vec(self).map_err(|error| malformed(
                    Self::FAMILY.name,
                    error.to_string(),
                ))?;
                validate_size(Self::FAMILY.name, bytes.len(), $max)?;
                Ok(bytes)
            }

            fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
                decode_v1(bytes, Self::FAMILY.name, $max, &[$($field),*])
            }
        }
    };
}

durable_record!(
    RunInputRecord,
    RUN_INPUT_FAMILY,
    MAX_RUN_INPUT_RECORD_BYTES,
    [
        "definition",
        "public_variables",
        "owner_actor_id",
        "resolved_definition_digest"
    ]
);
durable_record!(
    RunPolicyRecord,
    RUN_POLICY_FAMILY,
    MAX_RUN_POLICY_RECORD_BYTES,
    ["max_handler_failures"]
);
durable_record!(
    RunLocatorRecord,
    RUN_LOCATOR_FAMILY,
    MAX_RUN_LOCATOR_RECORD_BYTES,
    ["integration_id"]
);
durable_record!(
    RequestBindingRecord,
    REQUEST_BINDING_FAMILY,
    MAX_REQUEST_BINDING_RECORD_BYTES,
    ["fingerprint", "protocol_request_id"]
);

fn decode_v1<T: DeserializeOwned + ValidateInternal>(
    bytes: &[u8],
    family: &'static str,
    maximum: usize,
    fields: &[&str],
) -> Result<T, CompatError> {
    validate_size(family, bytes.len(), maximum)?;
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
    let data = value
        .get("data")
        .ok_or_else(|| malformed(family, "data is required".to_owned()))?;
    reject_unknown_fields(family, "data", data, fields)?;
    let decoded: T =
        serde_json::from_value(value).map_err(|error| malformed(family, error.to_string()))?;
    decoded.validate()?;
    Ok(decoded)
}

fn validate_size(family: &'static str, actual: usize, maximum: usize) -> Result<(), CompatError> {
    if actual <= maximum {
        Ok(())
    } else {
        Err(malformed(
            family,
            format!("record is {actual} bytes; maximum is {maximum}"),
        ))
    }
}

fn malformed(family: &'static str, message: String) -> CompatError {
    CompatError::Malformed { family, message }
}

fn validate_sha256(family: &'static str, field: &str, value: &str) -> Result<(), CompatError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(malformed(
            family,
            format!("{field} must be 64 lowercase hexadecimal characters"),
        ))
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    fn assert_v1_strict<T>(record: &T)
    where
        T: DurableRecord + PartialEq + std::fmt::Debug,
    {
        let bytes = record.encode().expect("encode record");
        let decoded = T::decode(&bytes).expect("decode V1");
        assert_eq!(&decoded, record);
        let mut future: Value = serde_json::from_slice(&bytes).expect("parse record");
        future["version"] = Value::String("v2".to_owned());
        assert!(matches!(
            T::decode(&serde_json::to_vec(&future).expect("encode future")),
            Err(CompatError::UnsupportedVersion { .. })
        ));
        let mut drift: Value = serde_json::from_slice(&bytes).expect("parse record");
        drift["data"]["unexpected"] = Value::Bool(true);
        assert!(matches!(
            T::decode(&serde_json::to_vec(&drift).expect("encode drift")),
            Err(CompatError::ExtraField { .. })
        ));
    }

    #[test]
    fn every_internal_family_is_v1_strict_and_explicit() {
        assert_v1_strict(&RunInputRecord::V1(RunInputRecordV1 {
            definition: "pipeline: metadata".to_owned(),
            public_variables: BTreeMap::new(),
            owner_actor_id: "actor:owner".to_owned(),
            resolved_definition_digest: "c".repeat(64),
        }));
        assert_v1_strict(&RunPolicyRecord::V1(RunPolicyRecordV1 {
            max_handler_failures: 3,
        }));
        assert_v1_strict(&RunLocatorRecord::V1(RunLocatorRecordV1 {
            integration_id: CanonicalIntegrationId::parse("alice:metadata")
                .expect("valid integration"),
        }));
        assert_v1_strict(&RequestBindingRecord::V1(RequestBindingRecordV1 {
            fingerprint: "a".repeat(64),
            protocol_request_id: RequestId::parse("b".repeat(64)).expect("valid request ID"),
        }));
    }

    #[test]
    fn internal_v1_bytes_match_the_independent_fixture() {
        let fixture: Value = serde_json::from_slice(include_bytes!(
            "../../tests/golden/internal-metadata-v1.json"
        ))
        .expect("valid independent fixture");
        let records = [
            (
                "runInput",
                RunInputRecord::current(
                    "pipeline: metadata".to_owned(),
                    BTreeMap::from([("mode".to_owned(), "full".to_owned())]),
                    "actor:owner".to_owned(),
                    "c".repeat(64),
                )
                .encode()
                .expect("encode run input"),
            ),
            (
                "runPolicy",
                RunPolicyRecord::current(3)
                    .encode()
                    .expect("encode run policy"),
            ),
            (
                "runLocator",
                RunLocatorRecord::current(
                    CanonicalIntegrationId::parse("alice:metadata").expect("valid integration"),
                )
                .encode()
                .expect("encode run locator"),
            ),
            (
                "requestBinding",
                RequestBindingRecord::current(
                    "a".repeat(64),
                    RequestId::parse("b".repeat(64)).expect("valid request ID"),
                )
                .encode()
                .expect("encode request binding"),
            ),
        ];
        for (name, encoded) in records {
            assert_eq!(
                encoded,
                serde_json::to_vec(&fixture[name]).expect("encode fixture member"),
                "{name} wire bytes changed"
            );
        }
    }

    #[test]
    fn stable_key_conflict_adoption_uses_the_normalized_value_boundary() {
        let locator = RunLocatorRecord::current(
            CanonicalIntegrationId::parse("alice:metadata").expect("valid integration"),
        );
        assert!(locator.same_current_value(&locator.clone()));

        let binding = RequestBindingRecord::current(
            "a".repeat(64),
            RequestId::parse("b".repeat(64)).expect("valid request ID"),
        );
        assert!(binding.same_current_value(&binding.clone()));
    }
}
