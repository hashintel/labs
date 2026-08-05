//! Immutable control-inbox requests and their replay-stable identities.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ids::{
    canonical_digest, CanonicalIntegrationId, EventId, RequestDigest, RequestId, RunId,
    TenantNamespace, WorkId,
};
use super::registry::{
    reject_unknown_fields, AlgorithmVersion, CompatError, DurabilityClass, DurableRecord,
    MigrationPolicy, PureUpcastRecord, RecordDeclaration, VersionedRecord,
};
use crate::blob::BlobRef;

const MAX_CONTROL_REQUEST_BYTES: usize = 64 * 1024;
const MAX_ACTOR_BYTES: usize = 1024;
const CONTROL_REQUEST_IDENTITY_VERSION: u32 = 1;
const REQUEST_DIGEST_VERSION: u32 = 1;

pub(crate) static CONTROL_REQUEST_DECLARATION: RecordDeclaration = RecordDeclaration {
    name: "control_request",
    owning_module: "orchestrator::control",
    emitted_version: 1,
    supported_versions: &[1],
    algorithm_versions: &[
        AlgorithmVersion {
            name: "control_request_identity",
            version: CONTROL_REQUEST_IDENTITY_VERSION,
        },
        AlgorithmVersion {
            name: "request_digest",
            version: REQUEST_DIGEST_VERSION,
        },
    ],
    durability: DurabilityClass::ImmutableArtifact,
    migration: MigrationPolicy::PureUpcast,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub enum ControlRequest {
    V1(ControlRequestV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlRequestV1 {
    pub tenant: TenantNamespace,
    pub integration_id: CanonicalIntegrationId,
    pub request_id: RequestId,
    pub actor: String,
    pub command: ControlCommandV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum ControlCommandV1 {
    CancelRun(CancelRunV1),
    RetryWork(RetryWorkV1),
    SetIntegrationDesiredState(SetIntegrationDesiredStateV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CancelRunV1 {
    pub run_id: RunId,
    pub expected_run_revision: EventId,
    pub expected_failed_work: Option<WorkId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RetryWorkV1 {
    pub work_id: WorkId,
    pub expected_work_revision: EventId,
    pub settings_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetIntegrationDesiredStateV1 {
    pub desired: IntegrationDesiredState,
    pub definition_ref: BlobRef,
    pub expected_desired_revision: Option<EventId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntegrationDesiredState {
    Enabled,
    Disabled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlRequestContextV1 {
    pub request_id: RequestId,
    pub request_digest: RequestDigest,
    pub expected_revision: Option<EventId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum ControlRequestTargetV1 {
    Run(RunId),
    Work(WorkId),
    DesiredState(CanonicalIntegrationId),
}

impl ControlRequestV1 {
    pub fn new(
        tenant: TenantNamespace,
        integration_id: CanonicalIntegrationId,
        actor: String,
        command: ControlCommandV1,
    ) -> Result<Self, CompatError> {
        let mut request = Self {
            tenant,
            integration_id,
            request_id: RequestId::from_digest("0".repeat(64)),
            actor,
            command,
        };
        validate_request_fields(&request)?;
        request.request_id = derive_request_id(&request)?;
        Ok(request)
    }

    pub fn verify_identity(&self) -> Result<(), CompatError> {
        let expected = derive_request_id(self)?;
        if self.request_id == expected {
            Ok(())
        } else {
            Err(CompatError::Conflict {
                name: ControlRequest::declaration().name,
                message: format!(
                    "request ID mismatch: expected {expected}, found {}",
                    self.request_id
                ),
            })
        }
    }

    pub fn digest(&self) -> Result<RequestDigest, CompatError> {
        canonical_digest(
            "control-request-digest:v1",
            &ControlRequest::V1(self.clone()),
        )
        .map(RequestDigest::from_digest)
        .map_err(|error| malformed(error.to_string()))
    }

    pub fn context(&self) -> Result<ControlRequestContextV1, CompatError> {
        Ok(ControlRequestContextV1 {
            request_id: self.request_id.clone(),
            request_digest: self.digest()?,
            expected_revision: self.expected_revision().cloned(),
        })
    }

    pub fn target(&self) -> ControlRequestTargetV1 {
        match &self.command {
            ControlCommandV1::CancelRun(command) => {
                ControlRequestTargetV1::Run(command.run_id.clone())
            }
            ControlCommandV1::RetryWork(command) => {
                ControlRequestTargetV1::Work(command.work_id.clone())
            }
            ControlCommandV1::SetIntegrationDesiredState(_) => {
                ControlRequestTargetV1::DesiredState(self.integration_id.clone())
            }
        }
    }

    pub(crate) fn expected_revision(&self) -> Option<&EventId> {
        match &self.command {
            ControlCommandV1::CancelRun(command) => Some(&command.expected_run_revision),
            ControlCommandV1::RetryWork(command) => Some(&command.expected_work_revision),
            ControlCommandV1::SetIntegrationDesiredState(command) => {
                command.expected_desired_revision.as_ref()
            }
        }
    }
}

impl ControlRequest {
    pub fn into_current(self) -> Result<ControlRequestV1, CompatError> {
        let Self::V1(request) = self;
        validate_request(&request)?;
        Ok(request)
    }

    pub fn try_current(&self) -> Result<&ControlRequestV1, CompatError> {
        let request = self.wire();
        validate_request(request)?;
        Ok(request)
    }

    fn wire(&self) -> &ControlRequestV1 {
        match self {
            Self::V1(request) => request,
        }
    }
}

#[derive(Serialize)]
struct RequestIdentity<'a> {
    tenant: &'a TenantNamespace,
    integration_id: &'a CanonicalIntegrationId,
    actor: &'a str,
    command: &'a ControlCommandV1,
}

fn derive_request_id(request: &ControlRequestV1) -> Result<RequestId, CompatError> {
    canonical_digest(
        "control-request:v1",
        &RequestIdentity {
            tenant: &request.tenant,
            integration_id: &request.integration_id,
            actor: &request.actor,
            command: &request.command,
        },
    )
    .map(RequestId::from_digest)
    .map_err(|error| malformed(error.to_string()))
}

fn validate_request(request: &ControlRequestV1) -> Result<(), CompatError> {
    validate_request_fields(request)?;
    request.verify_identity()
}

fn validate_request_fields(request: &ControlRequestV1) -> Result<(), CompatError> {
    if request.actor.is_empty()
        || request.actor.len() > MAX_ACTOR_BYTES
        || request.actor.chars().any(char::is_control)
    {
        return Err(malformed(format!(
            "actor must be 1..={MAX_ACTOR_BYTES} UTF-8 bytes without control characters"
        )));
    }
    match &request.command {
        ControlCommandV1::RetryWork(command) if command.settings_revision == 0 => {
            return Err(malformed("settings_revision must be nonzero".to_owned()));
        }
        ControlCommandV1::SetIntegrationDesiredState(command) => {
            let definition = command.definition_ref.current();
            if definition.key.is_empty()
                || definition.media_type.is_empty()
                || definition.sha256.len() != 64
                || !definition
                    .sha256
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            {
                return Err(malformed(
                    "definition_ref must have a key, media type, and lowercase SHA-256".to_owned(),
                ));
            }
        }
        ControlCommandV1::CancelRun(_) | ControlCommandV1::RetryWork(_) => {}
    }
    Ok(())
}

fn malformed(message: String) -> CompatError {
    CompatError::Malformed {
        name: ControlRequest::declaration().name,
        message,
    }
}

impl super::registry::sealed::Sealed for ControlRequest {}

impl DurableRecord for ControlRequest {
    fn declaration() -> &'static RecordDeclaration {
        &CONTROL_REQUEST_DECLARATION
    }
    const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::PureUpcast;

    fn encode(&self) -> Result<Vec<u8>, CompatError> {
        validate_request(self.wire())?;
        serde_json::to_vec(self).map_err(|error| malformed(error.to_string()))
    }

    fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
        if bytes.len() > MAX_CONTROL_REQUEST_BYTES {
            return Err(malformed(format!(
                "record is {} bytes; maximum is {MAX_CONTROL_REQUEST_BYTES}",
                bytes.len()
            )));
        }
        let value: Value =
            serde_json::from_slice(bytes).map_err(|error| malformed(error.to_string()))?;
        reject_unknown_fields(Self::declaration().name, "", &value, &["version", "data"])?;
        let version = value
            .get("version")
            .and_then(Value::as_str)
            .ok_or_else(|| malformed("version must be a string".to_owned()))?;
        if version != "v1" {
            return Err(CompatError::UnsupportedVersion {
                name: Self::declaration().name,
                version: version.to_owned(),
            });
        }
        let request: Self =
            serde_json::from_value(value).map_err(|error| malformed(error.to_string()))?;
        validate_request(request.wire())?;
        Ok(request)
    }
}

impl VersionedRecord for ControlRequest {
    type Current = ControlRequestV1;

    fn normalize(self) -> Result<Self::Current, CompatError> {
        Self::into_current(self)
    }
}

impl PureUpcastRecord for ControlRequest {}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use crate::blob::BlobRefV1;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct IdentityGoldens {
        control_request_id: String,
        control_request_digest: String,
    }

    fn identities() -> IdentityGoldens {
        serde_json::from_slice(include_bytes!(
            "../../tests/golden/protocol-identities-v1.json"
        ))
        .expect("valid independent identity fixture")
    }

    fn request() -> ControlRequestV1 {
        ControlRequestV1::new(
            TenantNamespace::parse("alice").expect("valid tenant"),
            CanonicalIntegrationId::parse("alice:supply-chain").expect("valid integration"),
            "actor:alice".to_owned(),
            ControlCommandV1::CancelRun(CancelRunV1 {
                run_id: RunId::parse("00000000-0000-4000-8000-000000000001").expect("valid run ID"),
                expected_run_revision: EventId::parse("3".repeat(64)).expect("valid event ID"),
                expected_failed_work: None,
            }),
        )
        .expect("valid request")
    }

    #[test]
    fn wire_id_digest_context_and_target_match_independent_golden() {
        let request = request();
        let identities = identities();
        assert_eq!(request.request_id.as_str(), identities.control_request_id);
        assert_eq!(
            request.digest().expect("request digest").as_str(),
            identities.control_request_digest
        );
        assert_eq!(
            request
                .context()
                .expect("request context")
                .expected_revision,
            Some(EventId::parse("3".repeat(64)).expect("valid event ID"))
        );
        assert_eq!(
            request.target(),
            ControlRequestTargetV1::Run(
                RunId::parse("00000000-0000-4000-8000-000000000001").expect("valid run ID")
            )
        );

        let wire = ControlRequest::V1(request);
        assert_eq!(
            wire.encode().expect("encode request"),
            include_bytes!("../../tests/golden/control-request-v1.json")
                .strip_suffix(b"\n")
                .expect("fixture newline")
        );
        assert_eq!(
            ControlRequest::decode(&wire.encode().expect("encode request"))
                .expect("decode request"),
            wire
        );
    }

    #[test]
    fn malformed_ids_and_unknown_fields_fail_at_typed_boundary() {
        assert!(serde_json::from_str::<ControlRequest>(
            r#"{"version":"v1","data":{"tenant":"alice","integration_id":"alice:supply-chain","request_id":"BAD","actor":"a","command":{"kind":"cancel_run","data":{"run_id":"00000000-0000-4000-8000-000000000001","expected_run_revision":"3333333333333333333333333333333333333333333333333333333333333333","expected_failed_work":null}}}}"#
        )
        .is_err());
        let mut value = serde_json::to_value(ControlRequest::V1(request())).expect("serialize");
        value
            .get_mut("data")
            .and_then(Value::as_object_mut)
            .expect("data object")
            .insert("surprise".to_owned(), Value::Bool(true));
        assert!(ControlRequest::decode(
            &serde_json::to_vec(&value).expect("serialize malformed request")
        )
        .is_err());
    }

    #[test]
    fn every_command_normalizes_its_exact_causal_revision_and_target() {
        let tenant = TenantNamespace::parse("alice").expect("valid tenant");
        let integration =
            CanonicalIntegrationId::parse("alice:supply-chain").expect("valid integration");
        let revision = EventId::parse("4".repeat(64)).expect("valid revision");
        let work_id = WorkId::parse("5".repeat(64)).expect("valid work ID");
        let retry = ControlRequestV1::new(
            tenant.clone(),
            integration.clone(),
            "actor:alice".to_owned(),
            ControlCommandV1::RetryWork(RetryWorkV1 {
                work_id: work_id.clone(),
                expected_work_revision: revision.clone(),
                settings_revision: 7,
            }),
        )
        .expect("valid retry");
        assert_eq!(
            retry.context().expect("retry context").expected_revision,
            Some(revision.clone())
        );
        assert_eq!(retry.target(), ControlRequestTargetV1::Work(work_id));

        let desired = ControlRequestV1::new(
            tenant,
            integration.clone(),
            "actor:alice".to_owned(),
            ControlCommandV1::SetIntegrationDesiredState(SetIntegrationDesiredStateV1 {
                desired: IntegrationDesiredState::Enabled,
                definition_ref: BlobRef::V1(BlobRefV1 {
                    key: "definitions/supply-chain.json".to_owned(),
                    sha256: "6".repeat(64),
                    size: 10,
                    media_type: "application/json".to_owned(),
                    e_tag: None,
                    provider_version: None,
                }),
                expected_desired_revision: None,
            }),
        )
        .expect("valid desired-state request");
        assert_eq!(
            desired
                .context()
                .expect("desired context")
                .expected_revision,
            None
        );
        assert_eq!(
            desired.target(),
            ControlRequestTargetV1::DesiredState(integration)
        );
    }

    #[test]
    fn retry_rejects_unpinned_settings_revision() {
        let error = ControlRequestV1::new(
            TenantNamespace::parse("alice").expect("valid tenant"),
            CanonicalIntegrationId::parse("alice:supply-chain").expect("valid integration"),
            "actor:alice".to_owned(),
            ControlCommandV1::RetryWork(RetryWorkV1 {
                work_id: WorkId::parse("5".repeat(64)).expect("valid work ID"),
                expected_work_revision: EventId::parse("4".repeat(64)).expect("valid revision"),
                settings_revision: 0,
            }),
        )
        .expect_err("zero settings revision is invalid");
        assert!(error.to_string().contains("settings_revision"));
    }
}
