//! Immutable run-input verification at the worker boundary.
//!
//! Submission persists the unresolved definition and a digest of its resolved
//! meaning. A worker resolves the definition again using its explicitly
//! allowed environment, then refuses to plan if either representation or the
//! canonical integration identity drifted.
use std::collections::BTreeMap;
use std::fmt;

use error_stack::{Report, ResultExt as _};
use serde_json::Value;
use sha2::Digest as _;

use super::events::{InputRef, PolicyRef};
use super::ids::{CanonicalIntegrationId, TenantNamespace};
use super::internal_metadata::{
    CurrentRunInputRecord, RunInputRecord, RunPolicyRecord, MAX_RUN_INPUT_RECORD_BYTES,
    MAX_RUN_POLICY_RECORD_BYTES,
};
use super::metadata::{self, InvocationV1};
use super::registry::DurableRecord;
use crate::blob::ArtifactStore;
use crate::build::Integration;
use crate::config::Env;
use crate::kernel::keyspace::Keyspace;

pub(crate) const DEFINITION_DIGEST_ENCODING_VERSION: u32 = 1;
pub(crate) const PLANNER_VERSION: u32 = 1;
const RUN_INPUT_MEDIA_TYPE: &str = "application/json";
const LINKS_ONLY_VARIABLE: &str = "integrations.invocation.links_only";
const REPLAY_VARIABLE: &str = "integrations.invocation.replay.v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RunInputError {
    UnsupportedProtocol,
    InvalidReference,
    ArtifactRead,
    RecordDecode,
    InvalidDefinition,
    UnsafeDefinition,
    EnvironmentDrift,
    IdentityMismatch,
    InvalidInvocation,
    InvalidPolicy,
}

impl fmt::Display for RunInputError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::UnsupportedProtocol => "run input uses an unsupported protocol version",
            Self::InvalidReference => "run input artifact reference is invalid",
            Self::ArtifactRead => "read immutable run input failed",
            Self::RecordDecode => "decode immutable run input failed",
            Self::InvalidDefinition => "run input definition is invalid",
            Self::UnsafeDefinition => "run input definition violates the durable secret policy",
            Self::EnvironmentDrift => {
                "worker environment resolves the definition differently from submission"
            }
            Self::IdentityMismatch => {
                "resolved definition does not match the admitted integration identity"
            }
            Self::InvalidInvocation => "run invocation metadata is invalid",
            Self::InvalidPolicy => "run retry policy is invalid",
        })
    }
}

pub(crate) async fn load_run_policy(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
    reference: &PolicyRef,
) -> Result<u32, Report<RunInputError>> {
    let artifact = reference.artifact.current();
    let expected_prefix = Keyspace::for_tenant(tenant).run_policies_digest_prefix();
    if artifact.size > MAX_RUN_POLICY_RECORD_BYTES as u64
        || artifact.media_type != RUN_INPUT_MEDIA_TYPE
        || !artifact.key.starts_with(&expected_prefix)
    {
        return Err(Report::new(RunInputError::InvalidPolicy)
            .attach_printable(format!("artifact key: {}", artifact.key)));
    }
    let path = store
        .materialize(&reference.artifact)
        .await
        .change_context(RunInputError::ArtifactRead)?;
    let bytes = tokio::fs::read(path)
        .await
        .change_context(RunInputError::ArtifactRead)?;
    let digest = hex::encode(sha2::Sha256::digest(&bytes));
    if digest != reference.policy_digest {
        return Err(Report::new(RunInputError::InvalidPolicy)
            .attach_printable(format!(
                "admitted policy digest: {}",
                reference.policy_digest
            ))
            .attach_printable(format!("observed policy digest: {digest}")));
    }
    RunPolicyRecord::decode(&bytes)
        .change_context(RunInputError::InvalidPolicy)
        .map(|policy| policy.max_handler_failures())
}

impl std::error::Error for RunInputError {}

#[derive(Debug)]
pub(crate) struct LoadedRunInputV1 {
    pub(crate) integration: Integration,
    pub(crate) owner_actor_id: String,
    /// Tests assert the exact interpolated definition; production consumes
    /// only the built integration and the verified digests.
    #[cfg(test)]
    pub(crate) resolved_definition: Value,
    pub(crate) invocation: InvocationV1,
    pub(crate) definition_digest: String,
}

pub(crate) async fn load_run_input(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
    admitted_integration: &CanonicalIntegrationId,
    reference: &InputRef,
    env: &Env,
) -> Result<LoadedRunInputV1, Report<RunInputError>> {
    validate_reference(tenant, reference)?;
    let path = store
        .materialize(&reference.artifact)
        .await
        .change_context(RunInputError::ArtifactRead)?;
    let bytes = tokio::fs::read(path)
        .await
        .change_context(RunInputError::ArtifactRead)?;
    let current = RunInputRecord::decode(&bytes)
        .change_context(RunInputError::RecordDecode)?
        .into_current();
    load_current(admitted_integration, reference, current, env)
}

fn validate_reference(
    tenant: &TenantNamespace,
    reference: &InputRef,
) -> Result<(), Report<RunInputError>> {
    if reference.definition_digest_encoding_version != DEFINITION_DIGEST_ENCODING_VERSION
        || reference.planner_version != PLANNER_VERSION
    {
        return Err(Report::new(RunInputError::UnsupportedProtocol)
            .attach_printable(format!(
                "definition digest encoding version: {}",
                reference.definition_digest_encoding_version
            ))
            .attach_printable(format!("planner version: {}", reference.planner_version)));
    }
    let artifact = reference.artifact.current();
    let expected_prefix = Keyspace::for_tenant(tenant).run_inputs_digest_prefix();
    if artifact.size > MAX_RUN_INPUT_RECORD_BYTES as u64
        || artifact.media_type != RUN_INPUT_MEDIA_TYPE
        || !artifact.key.starts_with(&expected_prefix)
    {
        return Err(Report::new(RunInputError::InvalidReference)
            .attach_printable(format!("artifact key: {}", artifact.key))
            .attach_printable(format!("artifact media type: {}", artifact.media_type))
            .attach_printable(format!("artifact bytes: {}", artifact.size)));
    }
    Ok(())
}

fn load_current(
    admitted_integration: &CanonicalIntegrationId,
    reference: &InputRef,
    current: CurrentRunInputRecord,
    env: &Env,
) -> Result<LoadedRunInputV1, Report<RunInputError>> {
    if current.owner_actor_id.trim().is_empty() || current.owner_actor_id.len() > 256 {
        return Err(Report::new(RunInputError::InvalidReference)
            .attach_printable("run owner actor ID is missing or exceeds 256 bytes"));
    }
    let raw: Value = serde_json::from_str(&current.definition)
        .change_context(RunInputError::InvalidDefinition)?;
    if !raw.is_object() {
        return Err(Report::new(RunInputError::InvalidDefinition)
            .attach_printable("definition must be a JSON object"));
    }
    metadata::reject_inline_secrets(&raw).change_context(RunInputError::UnsafeDefinition)?;
    metadata::reject_unsafe_env_placeholders(&raw, env)
        .change_context(RunInputError::UnsafeDefinition)?;
    let raw_digest =
        metadata::definition_digest(&raw).change_context(RunInputError::InvalidDefinition)?;
    if raw_digest != reference.definition_digest {
        return Err(Report::new(RunInputError::InvalidReference)
            .attach_printable(format!(
                "admitted definition digest: {}",
                reference.definition_digest
            ))
            .attach_printable(format!("observed definition digest: {raw_digest}")));
    }

    let durable_env = env.durable_interpolation_scope();
    let resolved = crate::yaml::resolve_env(&raw, &durable_env)
        .change_context(RunInputError::InvalidDefinition)?;
    let resolved_digest =
        metadata::definition_digest(&resolved).change_context(RunInputError::InvalidDefinition)?;
    if resolved_digest != current.resolved_definition_digest {
        return Err(Report::new(RunInputError::EnvironmentDrift)
            .attach_printable(format!(
                "admitted resolved definition digest: {}",
                current.resolved_definition_digest
            ))
            .attach_printable(format!(
                "worker resolved definition digest: {resolved_digest}"
            )));
    }

    let web_id = admitted_integration
        .as_str()
        .split_once(':')
        .map(|(web_id, _connector_id)| web_id)
        .ok_or_else(|| Report::new(RunInputError::IdentityMismatch))?;
    if env.get("HASH_WEB_ID") != Some(web_id) {
        return Err(Report::new(RunInputError::IdentityMismatch)
            .attach_printable("HASH_WEB_ID disagrees with the admitted integration"));
    }
    let identity = crate::identity::integration_id(&resolved, web_id);
    if identity.canonical != admitted_integration.as_str() {
        return Err(Report::new(RunInputError::IdentityMismatch)
            .attach_printable(format!("admitted integration: {admitted_integration}"))
            .attach_printable(format!("definition integration: {}", identity.canonical)));
    }
    let integration =
        crate::build::build(&resolved, web_id).change_context(RunInputError::InvalidDefinition)?;
    if crate::connectors::is_stream_mode(&integration.connector_mode) {
        return Err(Report::new(RunInputError::InvalidDefinition)
            .attach_printable("protocol V1 accepts batch integrations only"));
    }
    let invocation = parse_invocation(&current.public_variables)?;

    Ok(LoadedRunInputV1 {
        integration,
        owner_actor_id: current.owner_actor_id,
        #[cfg(test)]
        resolved_definition: resolved,
        invocation,
        definition_digest: raw_digest,
    })
}

fn parse_invocation(
    variables: &BTreeMap<String, String>,
) -> Result<InvocationV1, Report<RunInputError>> {
    let links_only = variables
        .get(LINKS_ONLY_VARIABLE)
        .map(|value| {
            value
                .parse::<bool>()
                .change_context(RunInputError::InvalidInvocation)
        })
        .transpose()?
        .unwrap_or(false);
    let replay = variables
        .get(REPLAY_VARIABLE)
        .map(|value| serde_json::from_str(value).change_context(RunInputError::InvalidInvocation))
        .transpose()?
        .unwrap_or_default();
    Ok(InvocationV1 { links_only, replay })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::Sha256;

    fn definition() -> Value {
        serde_json::json!({
            "connector": {"id": "supply-chain", "mode": "batch"},
            "vars": {"TYPE_BASE": "${HASH_TYPE_BASE}"},
            "sources": {},
            "pipelines": {"entities": []}
        })
    }

    fn env(type_base: &str) -> Env {
        Env::from_map(std::collections::HashMap::from([
            ("HASH_WEB_ID".to_owned(), "alice".to_owned()),
            ("HASH_TYPE_BASE".to_owned(), type_base.to_owned()),
        ]))
    }

    async fn fixture(
        raw: &Value,
        submission_env: &Env,
    ) -> (
        tempfile::TempDir,
        tempfile::TempDir,
        ArtifactStore,
        TenantNamespace,
        CanonicalIntegrationId,
        InputRef,
    ) {
        let remote = tempfile::tempdir().expect("remote directory");
        let cache = tempfile::tempdir().expect("cache directory");
        let store = ArtifactStore::local(remote.path(), cache.path()).expect("artifact store");
        let tenant = TenantNamespace::parse("alice").expect("tenant");
        let integration = CanonicalIntegrationId::parse("alice:supply-chain").expect("integration");
        let resolved = crate::yaml::resolve_env(raw, &submission_env.durable_interpolation_scope())
            .expect("resolve definition");
        let resolved_digest = metadata::definition_digest(&resolved).expect("resolved digest");
        let record = RunInputRecord::current(
            serde_json::to_string(raw).expect("definition JSON"),
            BTreeMap::from([
                (LINKS_ONLY_VARIABLE.to_owned(), "true".to_owned()),
                (REPLAY_VARIABLE.to_owned(), r#"{"orders":null}"#.to_owned()),
            ]),
            "actor:owner".to_owned(),
            resolved_digest,
        );
        let prefix = Keyspace::for_tenant(&tenant).run_inputs();
        let artifact = store
            .publish_record(
                &record,
                MAX_RUN_INPUT_RECORD_BYTES,
                &prefix,
                RUN_INPUT_MEDIA_TYPE,
            )
            .await
            .expect("publish run input");
        let reference = InputRef {
            artifact,
            definition_digest: metadata::definition_digest(raw).expect("raw digest"),
            definition_digest_encoding_version: DEFINITION_DIGEST_ENCODING_VERSION,
            planner_version: PLANNER_VERSION,
        };
        (remote, cache, store, tenant, integration, reference)
    }

    #[tokio::test]
    async fn verified_input_reconstructs_the_exact_planning_semantics() {
        let raw = definition();
        let submission_env = env("https://hash.ai/@h/types");
        let (_remote, _cache, store, tenant, integration, reference) =
            fixture(&raw, &submission_env).await;
        let loaded = load_run_input(&store, &tenant, &integration, &reference, &submission_env)
            .await
            .expect("load verified input");

        assert_eq!(loaded.integration.connector_id, "supply-chain");
        assert_eq!(
            loaded.resolved_definition["vars"]["TYPE_BASE"],
            "https://hash.ai/@h/types"
        );
        assert!(loaded.invocation.links_only);
        assert!(loaded.invocation.replay.contains_key("orders"));
        assert_eq!(loaded.owner_actor_id, "actor:owner");
        assert_eq!(
            loaded.definition_digest,
            metadata::definition_digest(&raw).expect("digest")
        );
    }

    #[tokio::test]
    async fn changed_allowlisted_environment_is_detected_before_planning() {
        let raw = definition();
        let submission_env = env("https://hash.ai/@h/types");
        let (_remote, _cache, store, tenant, integration, reference) =
            fixture(&raw, &submission_env).await;
        let error = load_run_input(
            &store,
            &tenant,
            &integration,
            &reference,
            &env("https://example.test/types"),
        )
        .await
        .expect_err("resolved semantic drift must fail");
        assert_eq!(error.current_context(), &RunInputError::EnvironmentDrift);
    }

    #[tokio::test]
    async fn admitted_raw_digest_and_identity_are_reverified() {
        let raw = definition();
        let submission_env = env("https://hash.ai/@h/types");
        let (_remote, _cache, store, tenant, integration, mut reference) =
            fixture(&raw, &submission_env).await;
        reference.definition_digest = hex::encode(Sha256::digest(b"other definition"));
        let error = load_run_input(&store, &tenant, &integration, &reference, &submission_env)
            .await
            .expect_err("raw digest mismatch must fail");
        assert_eq!(error.current_context(), &RunInputError::InvalidReference);

        let (_remote, _cache, store, tenant, _integration, reference) =
            fixture(&raw, &submission_env).await;
        let other = CanonicalIntegrationId::parse("alice:other").expect("other integration");
        let error = load_run_input(&store, &tenant, &other, &reference, &submission_env)
            .await
            .expect_err("identity mismatch must fail");
        assert_eq!(error.current_context(), &RunInputError::IdentityMismatch);
    }

    #[tokio::test]
    async fn unsupported_planner_version_fails_before_artifact_io() {
        let raw = definition();
        let submission_env = env("https://hash.ai/@h/types");
        let (_remote, _cache, store, tenant, integration, mut reference) =
            fixture(&raw, &submission_env).await;
        reference.planner_version += 1;
        reference.artifact = crate::blob::BlobRef::V1(crate::blob::BlobRefV1 {
            key: "missing".to_owned(),
            sha256: "0".repeat(64),
            size: 1,
            media_type: RUN_INPUT_MEDIA_TYPE.to_owned(),
            e_tag: None,
            provider_version: None,
        });
        let error = load_run_input(&store, &tenant, &integration, &reference, &submission_env)
            .await
            .expect_err("future planner must fail");
        assert_eq!(error.current_context(), &RunInputError::UnsupportedProtocol);
    }
}
