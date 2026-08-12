//! One-shot production diagnostics and authoritative-store verification.
//!
//! These checks are CLI/operator tools and are unsuitable as health
//! probes: the CAS probe
//! performs writes and a full store verification may download large objects.

use crate::orchestrator::routing::TenantKeyspace as _;
use error_stack::{Report, ResultExt as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::blob::{ArtifactStore, BoundedCasDocument, CasWrite};
use crate::config::{self, Env};
use crate::error::DiagnosticsError;

pub async fn run_worker(env: &Env) -> Result<(), Report<crate::orchestrator::runner::WorkerError>> {
    Box::pin(crate::orchestrator::runner::run(env)).await
}

pub async fn run_worker_until(
    env: &Env,
    shutdown: tokio_util::sync::CancellationToken,
) -> Result<(), Report<crate::orchestrator::runner::WorkerError>> {
    Box::pin(crate::orchestrator::runner::run_until(env, shutdown)).await
}

/// Release-contract probe: proves writer fencing at the storage epoch on the
/// configured journal backend, through the same open, recover, and append
/// path production uses.
///
/// The probe writes only under a random disposable tenant namespace inside
/// the configured blob URL. It must never be pointed at a live tenant's
/// control prefix; use a scratch bucket or prefix.
pub async fn slatedb_fencing_contract(env: &Env) -> Result<(), Report<DiagnosticsError>> {
    use crate::orchestrator::events::{
        InputRef, JournalEvent, JournalEventV1, JournalRecordV1, PolicyRef, RunAcceptedV1,
    };
    use crate::orchestrator::ids::{RunId, TenantNamespace};
    use crate::orchestrator::shard_log::{
        OpenedShard, ShardCommandConfig, ShardCommandErrorKind, ShardLogLocation,
    };

    let tenant = TenantNamespace::parse(format!("contract-{}", uuid::Uuid::new_v4()))
        .change_context(DiagnosticsError)
        .attach_printable("construct disposable contract tenant")?;
    let store = ArtifactStore::from_url(&config::blob_store_url(env), config::blob_cache_dir(env))
        .change_context(DiagnosticsError)?;
    // Three probe integrations on one shard: each append targets a fresh
    // integration so depth-one run admission never masks the fencing signal,
    // and every proposal is a real append rather than a durable-duplicate
    // noop.
    let mut probes = Vec::new();
    let mut probe_shard = None;
    for index in 0_u32..100_000 {
        let candidate = crate::orchestrator::ids::CanonicalIntegrationId::parse(format!(
            "{tenant}:fencing-probe-{index}"
        ))
        .change_context(DiagnosticsError)?;
        let candidate_shard = crate::orchestrator::routing::shard(&candidate);
        match probe_shard {
            None => {
                probe_shard = Some(candidate_shard);
                probes.push(candidate);
            }
            Some(shard) if shard == candidate_shard => probes.push(candidate),
            Some(_other) => {}
        }
        if probes.len() == 3 {
            break;
        }
    }
    let [first_probe, second_probe, stale_probe]: [_; 3] = probes
        .try_into()
        .map_err(|_probes| Report::new(DiagnosticsError))?;
    let shard = probe_shard.ok_or_else(|| Report::new(DiagnosticsError))?;
    let location = crate::orchestrator::shard_log::production_location(env, shard, &tenant)
        .change_context(DiagnosticsError)
        .attach_printable("build disposable shard-log location")?;

    let blob = |key: &str, fill: char| {
        crate::blob::BlobRef::V1(crate::blob::BlobRefV1 {
            key: key.to_owned(),
            sha256: fill.to_string().repeat(64),
            size: 1,
            media_type: "application/json".to_owned(),
            e_tag: None,
            provider_version: None,
        })
    };
    let record = |probe: &crate::orchestrator::ids::CanonicalIntegrationId, run: &str| {
        JournalRecordV1::new(
            probe.clone(),
            JournalEvent::V1(JournalEventV1::RunAccepted(RunAcceptedV1 {
                run_id: RunId::parse(run).expect("probe run ID literal"),
                immutable_input: InputRef {
                    artifact: blob("inputs/probe.json", 'a'),
                    definition_digest: "b".repeat(64),
                    definition_digest_encoding_version: 1,
                    planner_version: 1,
                },
                policy: PolicyRef {
                    artifact: blob("policies/probe.json", 'c'),
                    policy_digest: "d".repeat(64),
                },
                submitted_at: "2026-01-01T00:00:00Z".to_owned(),
            })),
        )
        .expect("probe record is structurally valid")
    };

    let start = |location: ShardLogLocation, store: ArtifactStore, tenant: TenantNamespace| async move {
        let opened = OpenedShard::open(location)
            .await
            .map_err(|error| Report::new(DiagnosticsError).attach_printable(error.to_string()))?;
        let recovered: crate::orchestrator::shard_log::RecoveredShard = opened
            .recover_with_snapshots(
                &crate::orchestrator::shard_log::IntegrationsSnapshotContext {
                    store: store.clone(),
                    tenant: tenant.clone(),
                },
            )
            .await
            .map_err(|error| Report::new(DiagnosticsError).attach_printable(error.to_string()))?;
        // Fail-closed recovery: the probe must never resolve an ambiguous
        // append by locally reopening a newer writer epoch against the
        // configured backend.
        Ok::<_, Report<DiagnosticsError>>(
            recovered.enable(ShardCommandConfig::default().require_full_lease_handshake()),
        )
    };

    let first = start(location.clone(), store.clone(), tenant.clone()).await?;
    first
        .handle
        .propose(record(&first_probe, "00000000-0000-4000-8000-000000000001"))
        .await
        .map_err(|error| {
            Report::new(DiagnosticsError)
                .attach_printable("first writer must append before takeover")
                .attach_printable(error.to_string())
        })?;

    let second = start(location, store, tenant).await?;
    second
        .handle
        .propose(record(
            &second_probe,
            "00000000-0000-4000-8000-000000000002",
        ))
        .await
        .map_err(|error| {
            Report::new(DiagnosticsError)
                .attach_printable("second writer must append at the newer storage epoch")
                .attach_printable(error.to_string())
        })?;

    let stale = first
        .handle
        .propose(record(&stale_probe, "00000000-0000-4000-8000-000000000003"))
        .await;
    let fenced = matches!(
        &stale,
        Err(error) if error.kind == ShardCommandErrorKind::Fenced
    );
    // A fenced loop already stopped itself; shutdown on a stopped loop is a
    // benign refusal either way.
    let _ = first.handle.shutdown().await;
    let _ = first.task.await;
    second
        .handle
        .shutdown()
        .await
        .map_err(|error| Report::new(DiagnosticsError).attach_printable(error.to_string()))?;
    let _ = second.task.await;
    if !fenced {
        return Err(Report::new(DiagnosticsError).attach_printable(format!(
            "stale writer was not fenced at the storage epoch: {stale:?}"
        )));
    }
    Ok(())
}

const DIAGNOSTICS_ROOT: &str = "control/diagnostics/v1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
    pub status: &'static str,
    pub blob_url: String,
    pub cache_directory: String,
    pub cas_contract: &'static str,
    pub baseline_initialized: bool,
    pub baseline_compatible: bool,
    pub duckdb_max_bytes: u64,
    pub startup_concurrency_ceiling: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreVerification {
    pub status: &'static str,
    pub tenant_namespace: String,
    pub baseline_compatible: bool,
    pub full_document_validation: bool,
    pub objects_scanned: usize,
    pub known_shards: usize,
    pub ready_receipts: usize,
    pub admissions: usize,
    pub run_locators: usize,
    pub control_requests: usize,
    pub control_results: usize,
    pub leases: usize,
    pub shard_log_objects: usize,
    pub projection_objects: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticProbe {
    nonce: String,
    generation: u8,
}

/// Emits one dependency-free operational observation from process-local
/// counters and local disk accounting. Shard and integration gauges are
/// updated by their owners before this call. It performs no Graph or remote
/// object-store request, so scrape cadence cannot become delivery traffic.
pub fn emit_operational_snapshot(
    blobs: &ArtifactStore,
    workspace_budget: &crate::local_disk::WorkspaceBudget,
    observed_at: chrono::DateTime<chrono::Utc>,
) -> Result<crate::progress::OperationalSnapshotV1, Report<DiagnosticsError>> {
    let usage = workspace_budget.usage().change_context(DiagnosticsError)?;
    let telemetry = blobs.telemetry();
    telemetry.set_disk(
        blobs
            .local_disk_signals(usage.workspace_bytes, usage.available_bytes)
            .change_context(DiagnosticsError)?,
    );
    telemetry.emit(observed_at);
    Ok(telemetry.snapshot(observed_at))
}

/// Validates local resource settings and exercises the provider's actual
/// create/read/update/conflict/delete behavior with a unique disposable key.
pub async fn doctor(env: &Env) -> Result<DoctorReport, Report<DiagnosticsError>> {
    let duckdb_max_bytes = config::duckdb_max_database_bytes(env)
        .map_err(|message| Report::new(DiagnosticsError).attach_printable(message))?;
    let blob_url = config::blob_store_url(env);
    let blobs = ArtifactStore::from_url(&blob_url, config::blob_cache_dir(env))
        .change_context(DiagnosticsError)?;
    let nonce = uuid::Uuid::new_v4().to_string();
    let key = format!("{DIAGNOSTICS_ROOT}/{nonce}.json");
    let first = DiagnosticProbe {
        nonce: nonce.clone(),
        generation: 1,
    };
    let second = DiagnosticProbe {
        nonce,
        generation: 2,
    };

    let contract = async {
        let created = blobs.create_json(&key, &first).await?;
        let CasWrite::Written(created_version) = created else {
            return Err(Report::new(crate::error::BlobError)
                .attach_printable("unique diagnostics probe unexpectedly already existed"));
        };
        let (observed, read_version) =
            blobs
                .get_json::<DiagnosticProbe>(&key)
                .await?
                .ok_or_else(|| {
                    Report::new(crate::error::BlobError)
                        .attach_printable("diagnostics probe was not visible after create")
                })?;
        if observed != first || read_version != created_version {
            return Err(Report::new(crate::error::BlobError)
                .attach_printable("diagnostics create/read version mismatch"));
        }
        if !matches!(
            blobs
                .compare_and_swap_json(&key, &read_version, &second)
                .await?,
            CasWrite::Written(_)
        ) {
            return Err(Report::new(crate::error::BlobError)
                .attach_printable("diagnostics CAS update unexpectedly conflicted"));
        }
        if !matches!(
            blobs
                .compare_and_swap_json(&key, &read_version, &first)
                .await?,
            CasWrite::Conflict
        ) {
            return Err(Report::new(crate::error::BlobError).attach_printable(
                "provider accepted a stale CAS update; durable execution is unsafe",
            ));
        }
        let observed = blobs
            .get_json::<DiagnosticProbe>(&key)
            .await?
            .map(|(value, _)| value);
        if observed.as_ref() != Some(&second) {
            return Err(Report::new(crate::error::BlobError)
                .attach_printable("diagnostics CAS winner was not read back exactly"));
        }
        Ok::<(), Report<crate::error::BlobError>>(())
    }
    .await;
    let cleanup = blobs.delete_control(&key).await;
    contract.change_context(DiagnosticsError)?;
    cleanup.change_context(DiagnosticsError)?;
    if blobs
        .get_json::<Value>(&key)
        .await
        .change_context(DiagnosticsError)?
        .is_some()
    {
        return Err(Report::new(DiagnosticsError)
            .attach_printable("diagnostics probe remained visible after delete"));
    }
    let baseline = match env.get("HASH_WEB_ID") {
        Some(web_id) => {
            let tenant = crate::orchestrator::ids::TenantNamespace::parse(web_id.to_owned())
                .change_context(DiagnosticsError)?;
            crate::orchestrator::baseline::compatible_control_baseline_exists(&blobs, &tenant)
                .await
                .change_context(DiagnosticsError)?
        }
        None => false,
    };
    let warnings = if baseline {
        vec![]
    } else {
        vec![
            "V1 control baseline is not initialized; explicit activation initializes it".to_owned(),
        ]
    };
    Ok(DoctorReport {
        status: "ok",
        blob_url,
        cache_directory: config::blob_cache_dir(env).display().to_string(),
        cas_contract: "create/read/update/stale-conflict/delete",
        baseline_initialized: baseline,
        baseline_compatible: baseline,
        duckdb_max_bytes,
        startup_concurrency_ceiling: config::max_concurrent_integrations(env),
        warnings,
    })
}

/// Validates the V1 baseline and walks only the canonical tenant control
/// inventory. Foreign keys fail closed and no state-import path is consulted.
pub async fn verify_store(
    env: &Env,
    full: bool,
) -> Result<StoreVerification, Report<DiagnosticsError>> {
    let blobs = ArtifactStore::from_url(&config::blob_store_url(env), config::blob_cache_dir(env))
        .change_context(DiagnosticsError)?;
    let web_id = env
        .get("HASH_WEB_ID")
        .ok_or_else(|| Report::new(DiagnosticsError).attach_printable("HASH_WEB_ID is required"))?;
    let tenant = crate::orchestrator::ids::TenantNamespace::parse(web_id.to_owned())
        .change_context(DiagnosticsError)?;
    crate::orchestrator::baseline::verify_control_baseline(&blobs, &tenant)
        .await
        .change_context(DiagnosticsError)?;
    let known_shards = crate::orchestrator::discover_known_shards(&blobs, &tenant)
        .await
        .change_context(DiagnosticsError)?;
    let paths = crate::orchestrator::routing::Keyspace::for_tenant(&tenant);
    let objects = blobs
        .list(&paths.control_root())
        .await
        .change_context(DiagnosticsError)?;
    let mut counts = ControlInventoryCounts::default();
    for object in &objects {
        let class = classify_control_key(&paths.control_root(), &object.key).ok_or_else(|| {
            Report::new(DiagnosticsError).attach_printable(format!(
                "foreign object in canonical control prefix: {:?}",
                object.key
            ))
        })?;
        counts.increment(class);
        if full && class.is_json_document() {
            let bytes = match blobs
                .get_cas_document_bounded(&object.key, class.maximum_document_bytes())
                .await
                .change_context(DiagnosticsError)?
            {
                BoundedCasDocument::Present(bytes, _version) => bytes,
                BoundedCasDocument::Missing => {
                    return Err(Report::new(DiagnosticsError).attach_printable(format!(
                        "control document {:?} disappeared during verification",
                        object.key
                    )));
                }
                BoundedCasDocument::TooLarge {
                    actual_bytes,
                    max_bytes,
                } => {
                    return Err(Report::new(DiagnosticsError).attach_printable(format!(
                        "control document {:?} is {actual_bytes} bytes; maximum is {max_bytes}",
                        object.key
                    )));
                }
            };
            let value: Value = serde_json::from_slice(&bytes)
                .change_context(DiagnosticsError)
                .attach_printable(format!("decode control document {:?}", object.key))?;
            if !value.is_object() {
                return Err(Report::new(DiagnosticsError).attach_printable(format!(
                    "control document {:?} is not a JSON object",
                    object.key
                )));
            }
        }
    }
    if counts.known_shards != known_shards.len() {
        return Err(Report::new(DiagnosticsError)
            .attach_printable("validated known-shard count disagrees with canonical inventory"));
    }
    let warnings = if known_shards.is_empty() {
        vec!["baseline is valid but no integration shard is known yet".to_owned()]
    } else {
        Vec::new()
    };
    Ok(StoreVerification {
        status: "ok",
        tenant_namespace: tenant.to_string(),
        baseline_compatible: true,
        full_document_validation: full,
        objects_scanned: objects.len(),
        known_shards: counts.known_shards,
        ready_receipts: counts.ready_receipts,
        admissions: counts.admissions,
        run_locators: counts.run_locators,
        control_requests: counts.control_requests,
        control_results: counts.control_results,
        leases: counts.leases,
        shard_log_objects: counts.shard_log_objects,
        projection_objects: counts.projection_objects,
        warnings,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ControlInventoryClass {
    Baseline,
    KnownShard,
    ReadyReceipt,
    Admission,
    RunLocator,
    ControlRequest,
    ControlResult,
    Lease,
    ShardLog,
    Projection,
}

impl ControlInventoryClass {
    const fn is_json_document(self) -> bool {
        !matches!(self, Self::ShardLog)
    }

    const fn maximum_document_bytes(self) -> usize {
        match self {
            Self::Projection => 64 * 1024 * 1024,
            Self::Baseline
            | Self::KnownShard
            | Self::ReadyReceipt
            | Self::Admission
            | Self::RunLocator
            | Self::ControlRequest
            | Self::ControlResult
            | Self::Lease => 1024 * 1024,
            Self::ShardLog => 0,
        }
    }
}

#[derive(Debug, Default)]
struct ControlInventoryCounts {
    known_shards: usize,
    ready_receipts: usize,
    admissions: usize,
    run_locators: usize,
    control_requests: usize,
    control_results: usize,
    leases: usize,
    shard_log_objects: usize,
    projection_objects: usize,
}

impl ControlInventoryCounts {
    fn increment(&mut self, class: ControlInventoryClass) {
        match class {
            ControlInventoryClass::Baseline => {}
            ControlInventoryClass::KnownShard => self.known_shards += 1,
            ControlInventoryClass::ReadyReceipt => self.ready_receipts += 1,
            ControlInventoryClass::Admission => self.admissions += 1,
            ControlInventoryClass::RunLocator => self.run_locators += 1,
            ControlInventoryClass::ControlRequest => self.control_requests += 1,
            ControlInventoryClass::ControlResult => self.control_results += 1,
            ControlInventoryClass::Lease => self.leases += 1,
            ControlInventoryClass::ShardLog => self.shard_log_objects += 1,
            ControlInventoryClass::Projection => self.projection_objects += 1,
        }
    }
}

fn classify_control_key(root: &str, key: &str) -> Option<ControlInventoryClass> {
    let relative = key.strip_prefix(&format!("{root}/"))?;
    if relative == "baseline.json" {
        return Some(ControlInventoryClass::Baseline);
    }
    let components = relative.split('/').collect::<Vec<_>>();
    match components.as_slice() {
        ["known-shards", file] if canonical_shard_json(file) => {
            Some(ControlInventoryClass::KnownShard)
        }
        ["ready", shard, file] if canonical_shard(shard) && canonical_uuid_json(file) => {
            Some(ControlInventoryClass::ReadyReceipt)
        }
        ["admissions", file] if canonical_digest_json(file) => {
            Some(ControlInventoryClass::Admission)
        }
        ["run-locators", file] if canonical_uuid_json(file) => {
            Some(ControlInventoryClass::RunLocator)
        }
        ["requests", shard, file] if canonical_shard(shard) && canonical_digest_json(file) => {
            Some(ControlInventoryClass::ControlRequest)
        }
        ["request-results", shard, file]
            if canonical_shard(shard) && canonical_digest_json(file) =>
        {
            Some(ControlInventoryClass::ControlResult)
        }
        ["leases", file] if canonical_shard_json(file) => Some(ControlInventoryClass::Lease),
        ["shards", shard, "log", ..] if canonical_shard(shard) => {
            Some(ControlInventoryClass::ShardLog)
        }
        ["shards", shard, "projection", ..] if canonical_shard(shard) => {
            Some(ControlInventoryClass::Projection)
        }
        _ => None,
    }
}

fn canonical_shard(value: &str) -> bool {
    value.len() == 3
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        && u16::from_str_radix(value, 16).is_ok_and(|value| value < 256)
}

fn canonical_shard_json(value: &str) -> bool {
    value.strip_suffix(".json").is_some_and(canonical_shard)
}

fn canonical_digest_json(value: &str) -> bool {
    value.strip_suffix(".json").is_some_and(|value| {
        value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn canonical_uuid_json(value: &str) -> bool {
    value.strip_suffix(".json").is_some_and(|value| {
        uuid::Uuid::parse_str(value).is_ok_and(|id| id.hyphenated().to_string() == value)
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    const WEB: &str = "00000000-0000-4000-8000-000000000001";

    fn local_env(remote: &tempfile::TempDir, cache: &tempfile::TempDir) -> Env {
        Env::from_map(std::collections::HashMap::from([
            (
                "INTEGRATIONS_BLOB_URL".to_owned(),
                format!("file://{}", remote.path().display()),
            ),
            (
                "INTEGRATIONS_BLOB_CACHE".to_owned(),
                cache.path().display().to_string(),
            ),
            ("HASH_WEB_ID".to_owned(), WEB.to_owned()),
        ]))
    }

    #[tokio::test]
    async fn doctor_proves_the_cas_contract_and_cleans_its_probe() {
        let remote = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let env = local_env(&remote, &cache);
        let report = doctor(&env).await.unwrap();
        assert_eq!(
            report.cas_contract,
            "create/read/update/stale-conflict/delete"
        );
        assert!(!report.baseline_initialized);
        assert!(!report.baseline_compatible);
        assert_eq!(report.status, "ok");
        let diagnostics = remote.path().join(DIAGNOSTICS_ROOT);
        assert!(!diagnostics.exists() || std::fs::read_dir(diagnostics).unwrap().next().is_none());
    }

    #[test]
    fn operational_scrape_reads_only_local_accounting() {
        let cache = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        let blobs = ArtifactStore::in_memory(cache.path()).unwrap();
        let budget = crate::local_disk::WorkspaceBudget::new(
            workspace.path(),
            crate::local_disk::LocalDiskLimits {
                max_workspace_bytes: 1024 * 1024,
                max_cache_bytes: 1024 * 1024,
                min_free_bytes: 0,
                max_staging_bytes: 1024 * 1024,
                max_staging_age: std::time::Duration::from_secs(60),
            },
        )
        .unwrap();

        let report = emit_operational_snapshot(&blobs, &budget, chrono::Utc::now()).unwrap();
        assert_eq!(report.schema_version, 1);
        assert_eq!(
            report.object_store,
            crate::progress::ObjectStoreSignalsV1::default()
        );
    }

    #[tokio::test]
    async fn store_verification_is_baseline_aware_and_rejects_foreign_layout() {
        let remote = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let env = local_env(&remote, &cache);
        let blobs =
            ArtifactStore::from_url(&config::blob_store_url(&env), config::blob_cache_dir(&env))
                .unwrap();
        let tenant = crate::orchestrator::ids::TenantNamespace::parse(WEB).unwrap();
        crate::orchestrator::baseline::ensure_control_baseline(&blobs, &tenant)
            .await
            .unwrap();

        let report = verify_store(&env, true).await.unwrap();
        assert!(report.baseline_compatible);
        assert_eq!(report.tenant_namespace, WEB);
        assert_eq!(report.objects_scanned, 1);
        assert_eq!(report.known_shards, 0);

        blobs
            .create_json(
                &format!(
                    "{}/foreign-pointer.json",
                    crate::orchestrator::routing::Keyspace::for_tenant(&tenant).control_root()
                ),
                &serde_json::json!({"state": "retired"}),
            )
            .await
            .unwrap();
        assert!(verify_store(&env, false).await.is_err());
    }
}
