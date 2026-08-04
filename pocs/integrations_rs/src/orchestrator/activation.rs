//! Fail-closed production activation checks.
//!
//! Every non-storage check completes before the canonical baseline is the
//! first remote write. Passing the explicit CLI flag authorizes baseline
//! initialization, but never bypasses registry, configuration, release
//! contract validation.
use std::fmt;
use std::num::{NonZeroU64, NonZeroUsize};
use std::path::PathBuf;
use std::time::Duration;

use chrono::{DateTime, Utc};
use error_stack::{Report, ResultExt as _};
use serde::Deserialize;
use sha2::{Digest as _, Sha256};

use super::ids::TenantNamespace;
use super::lease::LeaseTiming;
use super::routing::Shard;
use super::shard_log::ShardCommandConfig;
use crate::blob::ArtifactStore;
use crate::config::{self, Env};
use crate::throttle::rate::StaticShareConfig;

const MAX_ATTESTATION_BYTES: u64 = 64 * 1024;
const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ActivationCheck {
    RegistryManifest,
    MigrationCapabilities,
    Configuration,
    ProviderAttestation,
    ControlBaseline,
    KnownShards,
}

impl fmt::Display for ActivationCheck {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::RegistryManifest => "compiled durable-record registry validation failed",
            Self::MigrationCapabilities => {
                "durable metadata migration-capability validation failed"
            }
            Self::Configuration => "worker configuration validation failed",
            Self::ProviderAttestation => "release-contract attestation validation failed",
            Self::ControlBaseline => "canonical control baseline activation failed",
            Self::KnownShards => "known-shard discovery failed",
        })
    }
}

impl std::error::Error for ActivationCheck {}

/// The validated raw inputs of the static rate share. The final coverage
/// check runs against the discovered known-shard count, so activation keeps
/// these inputs and revalidates after discovery.
#[derive(Debug, Clone, Copy)]
pub(crate) struct RateInputs {
    global_graph_rate: u64,
    configured_runners: u32,
    reconciliation_basis_points: u16,
    max_graph_requests_per_chunk: u32,
    drr_quantum: u32,
    per_runner_shard_capacity: u32,
}

impl RateInputs {
    pub(crate) fn share(
        &self,
        known_shards: u32,
    ) -> Result<StaticShareConfig, crate::throttle::rate::StaticShareError> {
        self.share_at(known_shards, 0, self.global_graph_rate)
    }

    pub(crate) fn share_at(
        &self,
        known_shards: u32,
        settings_revision: u64,
        global_graph_rate: u64,
    ) -> Result<StaticShareConfig, crate::throttle::rate::StaticShareError> {
        StaticShareConfig::new(
            settings_revision,
            global_graph_rate,
            self.configured_runners,
            self.reconciliation_basis_points,
            self.max_graph_requests_per_chunk,
            self.drr_quantum,
            known_shards,
            self.per_runner_shard_capacity,
        )
    }

    pub(crate) fn share_with_override(
        &self,
        known_shards: u32,
        settings_revision: u64,
        global_graph_rate: Option<u64>,
    ) -> Result<StaticShareConfig, crate::throttle::rate::StaticShareError> {
        self.share_at(
            known_shards,
            settings_revision,
            global_graph_rate.unwrap_or(self.global_graph_rate),
        )
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ActivationConfig {
    pub(crate) tenant: TenantNamespace,
    pub(crate) owner_id: String,
    pub(crate) lease_timing: LeaseTiming,
    pub(crate) command: ShardCommandConfig,
    pub(crate) rate: StaticShareConfig,
    pub(crate) rate_inputs: RateInputs,
    pub(crate) control_batch_size: NonZeroUsize,
    pub(crate) max_graph_requests_per_chunk: u32,
    /// Per-runner ownership cap: the most shards one worker process may own
    /// simultaneously. Deployment coverage is validated as
    /// `configured_runners * shard_capacity >= known_shards`.
    pub(crate) shard_capacity: usize,
    /// Explicit opt-in for V1: reconciliation cycles are never initiated unless
    /// the operator configures a positive sweep interval.
    pub(crate) reconcile_interval: Option<Duration>,
}

pub(crate) struct ActivationReadiness {
    pub(crate) config: ActivationConfig,
    pub(crate) artifacts: ArtifactStore,
    pub(crate) known_shards: Vec<Shard>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReleaseContractAttestation {
    version: u32,
    protocol_version: u32,
    binary_version: String,
    valid_until: DateTime<Utc>,
    blob_store_url_sha256: String,
    graph_url_sha256: String,
    object_store_contract_passed: bool,
    slate_db_contract_passed: bool,
    graph_delivery_contract_passed: bool,
}

pub(crate) async fn activate(env: &Env) -> Result<ActivationReadiness, Report<ActivationCheck>> {
    super::registry::validate_expected_manifest(include_bytes!(
        "../../tests/golden/expected-record-families-v1.json"
    ))
    .change_context(ActivationCheck::RegistryManifest)?;
    super::registry::validate_migration_capabilities()
        .change_context(ActivationCheck::MigrationCapabilities)?;
    let mut config = activation_config(env).change_context(ActivationCheck::Configuration)?;
    validate_attestation(env, Utc::now()).change_context(ActivationCheck::ProviderAttestation)?;
    let artifacts =
        ArtifactStore::from_url(&config::blob_store_url(env), config::blob_cache_dir(env))
            .change_context(ActivationCheck::ControlBaseline)?;
    super::baseline::ensure_control_baseline(&artifacts, &config.tenant)
        .await
        .change_context(ActivationCheck::ControlBaseline)?;
    let known_shards = super::submission::discover_known_shards(&artifacts, &config.tenant)
        .await
        .change_context(ActivationCheck::KnownShards)?;
    // Deployment coverage: the configured fleet must be able to cover every
    // known shard without any single runner exceeding its ownership cap.
    let known_count = u32::try_from(known_shards.len())
        .map_err(|_error| Report::new(ActivationCheck::KnownShards))?;
    config.rate = config.rate_inputs.share(known_count).map_err(|error| {
        Report::new(ActivationCheck::KnownShards)
            .attach_printable(format!("known shards: {}", known_shards.len()))
            .attach_printable(format!(
                "per-runner ownership cap: {}",
                config.shard_capacity
            ))
            .attach_printable(error.to_string())
    })?;
    Ok(ActivationReadiness {
        config,
        artifacts,
        known_shards,
    })
}

fn activation_config(env: &Env) -> Result<ActivationConfig, Report<ActivationCheck>> {
    let tenant = TenantNamespace::parse(
        required(env, "HASH_WEB_ID")
            .change_context(ActivationCheck::Configuration)?
            .to_owned(),
    )
    .change_context(ActivationCheck::Configuration)?;
    let owner_id = env
        .get("INTEGRATIONS_RUNNER_ID")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("runner-{}", uuid::Uuid::new_v4()));
    if owner_id.len() > 256 || owner_id.chars().any(char::is_whitespace) {
        return Err(
            Report::new(ActivationCheck::Configuration).attach_printable(
                "INTEGRATIONS_RUNNER_ID must be at most 256 bytes without whitespace",
            ),
        );
    }

    let seconds = |name, default| {
        positive_u64(env, name, default)
            .map(Duration::from_secs)
            .change_context(ActivationCheck::Configuration)
    };
    // The declared inter-runner wall-clock skew envelope. Zero is a valid
    // explicit assertion of synchronized clocks; the default assumes ordinary
    // NTP drift. Takeover waits this long past observed expiry, and the owner
    // stops admitting chunks this long early.
    let clock_skew =
        Duration::from_secs(non_negative_u64(env, "INTEGRATIONS_CLOCK_SKEW_SECONDS", 5)?);
    let lease_timing = LeaseTiming::new(
        seconds("INTEGRATIONS_LEASE_SECONDS", 60)?,
        seconds("INTEGRATIONS_LEASE_RENEW_SECONDS", 15)?,
        seconds("INTEGRATIONS_LEASE_RENEW_TIMEOUT_SECONDS", 5)?,
        seconds("INTEGRATIONS_GRAPH_CHUNK_DEADLINE_SECONDS", 20)?,
        seconds("INTEGRATIONS_CURSOR_COMMIT_DEADLINE_SECONDS", 10)?,
        seconds("INTEGRATIONS_LEASE_SAFETY_SECONDS", 5)?,
        clock_skew,
    )
    .change_context(ActivationCheck::Configuration)?;
    let max_graph_requests_per_chunk = u32::try_from(positive_u64(
        env,
        "INTEGRATIONS_MAX_GRAPH_REQUESTS_PER_CHUNK",
        64,
    )?)
    .change_context(ActivationCheck::Configuration)?;
    if max_graph_requests_per_chunk < 2 {
        return Err(Report::new(ActivationCheck::Configuration)
            .attach_printable("maximum Graph requests per chunk must be at least 2"));
    }
    let drr_quantum = u32::try_from(positive_u64(
        env,
        "INTEGRATIONS_DRR_QUANTUM",
        u64::from(max_graph_requests_per_chunk),
    )?)
    .change_context(ActivationCheck::Configuration)?;
    let shard_capacity = usize::try_from(positive_u64(env, "INTEGRATIONS_SHARD_CAPACITY", 256)?)
        .change_context(ActivationCheck::Configuration)?;
    let configured_runners =
        u32::try_from(positive_u64(env, "INTEGRATIONS_CONFIGURED_RUNNERS", 1)?)
            .change_context(ActivationCheck::Configuration)?;
    let reconciliation_basis_points = u16::try_from(positive_u64(
        env,
        "INTEGRATIONS_RECONCILIATION_BASIS_POINTS",
        1_000,
    )?)
    .change_context(ActivationCheck::Configuration)?;
    let global_graph_rate = positive_u64(env, "INTEGRATIONS_GRAPH_REQUESTS_PER_SECOND", 500)?;
    let rate_inputs = RateInputs {
        global_graph_rate,
        configured_runners,
        reconciliation_basis_points,
        max_graph_requests_per_chunk,
        drr_quantum,
        per_runner_shard_capacity: u32::try_from(shard_capacity)
            .change_context(ActivationCheck::Configuration)?,
    };
    // Rates and arithmetic are validated up front against an empty tenant;
    // the deployment coverage inequality is revalidated after discovery with
    // the actual known-shard count.
    let rate = rate_inputs
        .share(0)
        .change_context(ActivationCheck::Configuration)?;
    let control_batch_size = NonZeroUsize::new(
        usize::try_from(positive_u64(env, "INTEGRATIONS_CONTROL_BATCH_SIZE", 64)?)
            .change_context(ActivationCheck::Configuration)?,
    )
    .ok_or_else(|| Report::new(ActivationCheck::Configuration))?;
    let command_capacity = NonZeroUsize::new(
        usize::try_from(positive_u64(
            env,
            "INTEGRATIONS_COMMAND_CHANNEL_CAPACITY",
            256,
        )?)
        .change_context(ActivationCheck::Configuration)?,
    )
    .ok_or_else(|| Report::new(ActivationCheck::Configuration))?;
    let safe_append_retries =
        u32::try_from(positive_u64(env, "INTEGRATIONS_SAFE_APPEND_RETRIES", 3)?)
            .change_context(ActivationCheck::Configuration)?;
    let reconcile_interval = optional_positive_u64(env, "INTEGRATIONS_RECONCILE_INTERVAL_SECONDS")?
        .map(Duration::from_secs);
    config::local_disk_limits(env)
        .map_err(|message| Report::new(ActivationCheck::Configuration).attach_printable(message))?;
    let _ = config::duckdb_max_database_bytes(env)
        .map_err(|message| Report::new(ActivationCheck::Configuration).attach_printable(message))?;
    Ok(ActivationConfig {
        tenant,
        owner_id,
        lease_timing,
        command: ShardCommandConfig::new(command_capacity, safe_append_retries),
        rate,
        rate_inputs,
        control_batch_size,
        max_graph_requests_per_chunk,
        shard_capacity,
        reconcile_interval,
    })
}

fn validate_attestation(env: &Env, now: DateTime<Utc>) -> Result<(), Report<ActivationCheck>> {
    let path = PathBuf::from(required(env, "INTEGRATIONS_RELEASE_ATTESTATION")?);
    let metadata = std::fs::metadata(&path).change_context(ActivationCheck::ProviderAttestation)?;
    if metadata.len() > MAX_ATTESTATION_BYTES {
        return Err(Report::new(ActivationCheck::ProviderAttestation)
            .attach_printable(format!("attestation bytes: {}", metadata.len())));
    }
    let bytes = std::fs::read(&path).change_context(ActivationCheck::ProviderAttestation)?;
    let attestation: ReleaseContractAttestation =
        serde_json::from_slice(&bytes).change_context(ActivationCheck::ProviderAttestation)?;
    let blob_digest = digest(config::blob_store_url(env).trim_end_matches('/').as_bytes());
    let graph_digest = digest(
        required(env, "HASH_GRAPH_URL")?
            .trim_end_matches('/')
            .as_bytes(),
    );
    if attestation.version != 1
        || attestation.protocol_version != PROTOCOL_VERSION
        || attestation.binary_version != env!("CARGO_PKG_VERSION")
        || attestation.valid_until <= now
        || attestation.blob_store_url_sha256 != blob_digest
        || attestation.graph_url_sha256 != graph_digest
        || !attestation.object_store_contract_passed
        || !attestation.slate_db_contract_passed
        || !attestation.graph_delivery_contract_passed
    {
        return Err(Report::new(ActivationCheck::ProviderAttestation)
            .attach_printable("attestation is expired, mismatched, or incomplete"));
    }
    Ok(())
}

fn required<'a>(env: &'a Env, name: &'static str) -> Result<&'a str, Report<ActivationCheck>> {
    env.get(name)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            Report::new(ActivationCheck::Configuration)
                .attach_printable(format!("{name} is required"))
        })
}

fn positive_u64(
    env: &Env,
    name: &'static str,
    default: u64,
) -> Result<u64, Report<ActivationCheck>> {
    Ok(optional_positive_u64(env, name)?.unwrap_or(default))
}

/// A setting whose absence means "off" and whose presence must be positive.
fn optional_positive_u64(
    env: &Env,
    name: &'static str,
) -> Result<Option<u64>, Report<ActivationCheck>> {
    env.get(name)
        .map(|value| {
            value
                .trim()
                .parse::<NonZeroU64>()
                .map(NonZeroU64::get)
                .change_context(ActivationCheck::Configuration)
                .attach_printable(format!("{name} must be a positive integer"))
        })
        .transpose()
}

/// A setting where zero is a meaningful explicit value.
fn non_negative_u64(
    env: &Env,
    name: &'static str,
    default: u64,
) -> Result<u64, Report<ActivationCheck>> {
    match env.get(name) {
        None => Ok(default),
        Some(value) => value
            .trim()
            .parse::<u64>()
            .change_context(ActivationCheck::Configuration)
            .attach_printable(format!("{name} must be a non-negative integer")),
    }
}

fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn configuration_rejects_a_chunk_that_cannot_complete_conflict_recovery() {
        let env = Env::from_map(HashMap::from([
            ("HASH_WEB_ID".to_owned(), "alice".to_owned()),
            (
                "INTEGRATIONS_MAX_GRAPH_REQUESTS_PER_CHUNK".to_owned(),
                "1".to_owned(),
            ),
        ]));
        assert_eq!(
            activation_config(&env)
                .expect_err("one request cannot cover create then patch")
                .current_context(),
            &ActivationCheck::Configuration
        );
    }

    #[test]
    fn attestation_is_bound_to_binary_protocol_and_provider_origins() {
        let directory = tempfile::tempdir().expect("attestation directory");
        let path = directory.path().join("release.json");
        let blob_url = "s3://bucket/integrations";
        let graph_url = "https://graph.example";
        let bytes = serde_json::to_vec(&serde_json::json!({
            "version": 1,
            "protocolVersion": 1,
            "binaryVersion": env!("CARGO_PKG_VERSION"),
            "validUntil": "2099-01-01T00:00:00Z",
            "blobStoreUrlSha256": digest(blob_url.as_bytes()),
            "graphUrlSha256": digest(graph_url.as_bytes()),
            "objectStoreContractPassed": true,
            "slateDbContractPassed": true,
            "graphDeliveryContractPassed": true
        }))
        .expect("attestation");
        std::fs::write(&path, bytes).expect("write attestation");
        let env = Env::from_map(HashMap::from([
            ("INTEGRATIONS_BLOB_URL".to_owned(), blob_url.to_owned()),
            ("HASH_GRAPH_URL".to_owned(), graph_url.to_owned()),
            (
                "INTEGRATIONS_RELEASE_ATTESTATION".to_owned(),
                path.display().to_string(),
            ),
        ]));
        validate_attestation(&env, Utc::now()).expect("current matching attestation");

        let drifted = Env::from_map(HashMap::from([
            (
                "INTEGRATIONS_BLOB_URL".to_owned(),
                "s3://another-bucket/integrations".to_owned(),
            ),
            ("HASH_GRAPH_URL".to_owned(), graph_url.to_owned()),
            (
                "INTEGRATIONS_RELEASE_ATTESTATION".to_owned(),
                path.display().to_string(),
            ),
        ]));
        assert!(validate_attestation(&drifted, Utc::now()).is_err());
    }
}
