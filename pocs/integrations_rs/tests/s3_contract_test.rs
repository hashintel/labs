//! Opt-in contract tests for the real S3-compatible provider used in production.
//!
//! Set `INTEGRATIONS_S3_CONTRACT_URL=s3://bucket/scratch-prefix`. Every run
//! confines writes to a fresh child prefix and removes that prefix afterwards.
#![allow(clippy::print_stdout)]

use std::sync::Arc;

use bytes::Bytes;
use futures::StreamExt as _;
use integrations_rs::blob::{ArtifactStore, CasWrite};
use integrations_rs::orchestrator::baseline::{
    ensure_control_baseline, BaselineStartup, ControlBaseline,
};
use integrations_rs::orchestrator::ids::TenantNamespace;
use object_store::aws::AmazonS3Builder;
use object_store::buffered::BufWriter;
use object_store::path::Path;
use object_store::ObjectStore;
use serde_json::json;
use sha2::{Digest as _, Sha256};
use tempfile::tempdir;

const MULTIPART_PART_SIZE: usize = 8 * 1024 * 1024;
const CRASH_HELPER_MARKER: &str = "INTEGRATIONS_S3_CRASH_HELPER";
const CRASH_HELPER_URL: &str = "INTEGRATIONS_S3_CRASH_HELPER_URL";
const CRASH_HELPER_EXIT: i32 = 86;
const EVIDENCE_PREFIX: &str = "INTEGRATIONS_CONTRACT_EVIDENCE ";

#[tokio::test]
#[ignore = "requires an explicit real-S3 scratch prefix and provider credentials"]
async fn real_s3_provider_contract() {
    let base_url = std::env::var("INTEGRATIONS_S3_CONTRACT_URL")
        .expect("set INTEGRATIONS_S3_CONTRACT_URL=s3://bucket/scratch-prefix");
    let (bucket, base_prefix) = parse_s3_url(&base_url);
    assert!(
        !base_prefix.is_empty(),
        "INTEGRATIONS_S3_CONTRACT_URL must include a non-empty scratch prefix"
    );

    let run = format!("contract-{}", uuid::Uuid::new_v4());
    let run_prefix = format!("{base_prefix}/{run}");
    let run_url = format!("s3://{bucket}/{run_prefix}");
    let raw: Arc<dyn ObjectStore> = Arc::new(
        AmazonS3Builder::from_env()
            .with_bucket_name(bucket)
            .build()
            .expect("build S3 contract backend"),
    );

    let result = exercise_contract(&run_url, Arc::clone(&raw), &run_prefix).await;
    let cleanup = delete_prefix(raw.as_ref(), &run_prefix).await;
    if let Err(error) = cleanup {
        panic!("S3 contract cleanup failed for unique prefix {run_prefix:?}: {error}");
    }
    if let Err(error) = result {
        panic!("S3 provider contract failed: {error}");
    }
    let evidence = serde_json::json!({
        "evidenceVersion": 1,
        "suite": "s3-provider-v1",
        "binaryVersion": env!("CARGO_PKG_VERSION"),
        "blobStoreUrlSha256": hex::encode(Sha256::digest(
            base_url.trim_end_matches('/').as_bytes()
        )),
        "graphUrlSha256": null
    });
    println!("{EVIDENCE_PREFIX}{evidence}");
}

async fn exercise_contract(
    run_url: &str,
    raw: Arc<dyn ObjectStore>,
    run_prefix: &str,
) -> Result<(), String> {
    let cache = tempdir().map_err(|error| error.to_string())?;
    let store = ArtifactStore::from_url(run_url, cache.path()).map_err(report)?;
    control_baseline_contract(&store).await?;
    conditional_put_contract(&store).await?;
    prefix_isolation_contract(run_url).await?;
    artifact_round_trip_contract(&store).await?;
    multipart_abort_contract(Arc::clone(&raw), run_prefix).await?;
    multipart_process_crash_contract(raw, run_prefix, run_url).await?;
    slatedb_fencing_contract(run_url).await
}

/// `SlateDB` writer fencing and durable append on the selected backend, through
/// the exact production open, recover, and append path.
async fn slatedb_fencing_contract(run_url: &str) -> Result<(), String> {
    let cache = tempdir().map_err(|error| error.to_string())?;
    let mut vars = std::collections::HashMap::from([
        ("INTEGRATIONS_BLOB_URL".to_owned(), run_url.to_owned()),
        (
            "INTEGRATIONS_BLOB_CACHE".to_owned(),
            cache.path().display().to_string(),
        ),
    ]);
    for name in ["AWS_REGION", "AWS_DEFAULT_REGION"] {
        if let Ok(value) = std::env::var(name) {
            vars.insert(name.to_owned(), value);
        }
    }
    let env = integrations_rs::config::Env::from_map(vars);
    integrations_rs::production::slatedb_fencing_contract(&env)
        .await
        .map_err(report)
}

/// The fencing probe itself is proven hermetically so a broken probe can
/// never masquerade as a passing provider contract.
#[tokio::test]
async fn fencing_probe_reports_fencing_on_the_local_backend() {
    let remote = tempdir().expect("disposable local backend");
    let cache = tempdir().expect("probe cache");
    let env = integrations_rs::config::Env::from_map(std::collections::HashMap::from([
        (
            "INTEGRATIONS_BLOB_URL".to_owned(),
            format!("file://{}", remote.path().display()),
        ),
        (
            "INTEGRATIONS_BLOB_CACHE".to_owned(),
            cache.path().display().to_string(),
        ),
    ]));
    integrations_rs::production::slatedb_fencing_contract(&env)
        .await
        .expect("local backend fences the stale writer");
}

async fn control_baseline_contract(store: &ArtifactStore) -> Result<(), String> {
    let tenant = TenantNamespace::parse("contract").map_err(|error| error.to_string())?;
    let expected = ControlBaseline::canonical(&tenant);
    let first = ensure_control_baseline(store, &tenant)
        .await
        .map_err(report)?;
    if first != BaselineStartup::Initialized {
        return Err(format!(
            "fresh S3 control prefix did not initialize its baseline: {first:?}"
        ));
    }
    let second = ensure_control_baseline(store, &tenant)
        .await
        .map_err(report)?;
    if second != BaselineStartup::Recovered {
        return Err(format!(
            "existing S3 control baseline did not recover: {second:?}"
        ));
    }
    let key = format!("tenants/{tenant}/control/v1/baseline.json");
    let observed = store
        .get_json::<ControlBaseline>(&key)
        .await
        .map_err(report)?
        .map(|(baseline, _version)| baseline);
    if observed.as_ref() != Some(&expected) {
        return Err("S3 baseline read-back differs from canonical identity".to_owned());
    }
    if !matches!(
        store.create_json(&key, &expected).await.map_err(report)?,
        CasWrite::Conflict
    ) {
        return Err("S3 provider accepted a second baseline create".to_owned());
    }
    Ok(())
}

async fn conditional_put_contract(store: &ArtifactStore) -> Result<(), String> {
    let key = "control/contract/cas.json";
    let first = json!({"generation": 1, "writer": "first"});
    let second = json!({"generation": 2, "writer": "second"});
    let created = store.create_json(key, &first).await.map_err(report)?;
    let CasWrite::Written(created_version) = created else {
        return Err("create-only PUT conflicted under a fresh prefix".to_owned());
    };
    let (observed, read_version) = store
        .get_json::<serde_json::Value>(key)
        .await
        .map_err(report)?
        .ok_or("create-only PUT was not immediately readable")?;
    if observed != first || read_version != created_version {
        return Err("read-after-create changed the value or provider version".to_owned());
    }
    if !matches!(
        store.create_json(key, &second).await.map_err(report)?,
        CasWrite::Conflict
    ) {
        return Err("provider accepted a second create-only PUT".to_owned());
    }
    if !matches!(
        store
            .compare_and_swap_json(key, &read_version, &second)
            .await
            .map_err(report)?,
        CasWrite::Written(_)
    ) {
        return Err("current-version conditional PUT conflicted".to_owned());
    }
    if !matches!(
        store
            .compare_and_swap_json(key, &read_version, &first)
            .await
            .map_err(report)?,
        CasWrite::Conflict
    ) {
        return Err("provider accepted a stale conditional PUT".to_owned());
    }
    let winner = store
        .get_json::<serde_json::Value>(key)
        .await
        .map_err(report)?
        .map(|(value, _)| value);
    if winner.as_ref() != Some(&second) {
        return Err("stale conflict changed the winning value".to_owned());
    }
    Ok(())
}

async fn prefix_isolation_contract(run_url: &str) -> Result<(), String> {
    // Equal relative keys in different tenant prefixes must stay disjoint.
    let left_cache = tempdir().map_err(|error| error.to_string())?;
    let right_cache = tempdir().map_err(|error| error.to_string())?;
    let left =
        ArtifactStore::from_url(&format!("{run_url}/left"), left_cache.path()).map_err(report)?;
    let right =
        ArtifactStore::from_url(&format!("{run_url}/right"), right_cache.path()).map_err(report)?;
    let shared_key = "control/contract/identity.json";
    left.create_json(shared_key, &json!({"tenant": "left"}))
        .await
        .map_err(report)?;
    right
        .create_json(shared_key, &json!({"tenant": "right"}))
        .await
        .map_err(report)?;
    let left_value = left
        .get_json::<serde_json::Value>(shared_key)
        .await
        .map_err(report)?
        .map(|(value, _)| value);
    let right_value = right
        .get_json::<serde_json::Value>(shared_key)
        .await
        .map_err(report)?
        .map(|(value, _)| value);
    if left_value != Some(json!({"tenant": "left"}))
        || right_value != Some(json!({"tenant": "right"}))
    {
        return Err("provider leaked equal relative keys across prefixes".to_owned());
    }
    Ok(())
}

async fn artifact_round_trip_contract(store: &ArtifactStore) -> Result<(), String> {
    let staged = store.stage(".bin").map_err(report)?;
    let artifact_bytes = b"immutable read-after-write contract";
    tokio::fs::write(&staged, artifact_bytes)
        .await
        .map_err(|error| error.to_string())?;
    let reference = store
        .publish(&staged, "artifacts/contract", "application/octet-stream")
        .await
        .map_err(report)?;
    store.verify_content(&reference).await.map_err(report)?;
    let listed = store.list("artifacts/contract").await.map_err(report)?;
    let observed = listed
        .iter()
        .find(|object| object.key == reference.current().key)
        .ok_or("LIST omitted the freshly published content-addressed artifact")?;
    if observed.size != reference.current().size
        || observed.last_modified.is_empty()
        || (observed.e_tag.is_none() && observed.provider_version.is_none())
    {
        return Err(
            "LIST did not preserve artifact size, observation time, or provider identity"
                .to_owned(),
        );
    }
    let materialized = store.materialize(&reference).await.map_err(report)?;
    if tokio::fs::read(materialized)
        .await
        .map_err(|error| error.to_string())?
        != artifact_bytes
    {
        return Err("published artifact did not round-trip exactly".to_owned());
    }
    Ok(())
}

async fn multipart_abort_contract(
    raw: Arc<dyn ObjectStore>,
    run_prefix: &str,
) -> Result<(), String> {
    // Exceeding one part forces multipart initiation. Abort must remove both
    // the upload session and any reader-visible object at the destination.
    let multipart_key = Path::from(format!("{run_prefix}/multipart/interrupted.bin"));
    let mut upload =
        BufWriter::with_capacity(Arc::clone(&raw), multipart_key.clone(), MULTIPART_PART_SIZE);
    upload
        .put(Bytes::from(vec![0x5a; MULTIPART_PART_SIZE + 1]))
        .await
        .map_err(|error| error.to_string())?;
    upload.abort().await.map_err(|error| error.to_string())?;
    match raw.head(&multipart_key).await {
        Err(object_store::Error::NotFound { .. }) => {}
        Ok(_) => return Err("aborted multipart upload became reader-visible".to_owned()),
        Err(error) => return Err(format!("HEAD after multipart abort failed: {error}")),
    }
    Ok(())
}

async fn multipart_process_crash_contract(
    raw: Arc<dyn ObjectStore>,
    run_prefix: &str,
    run_url: &str,
) -> Result<(), String> {
    let key = Path::from(format!("{run_prefix}/multipart/process-crash.bin"));
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let run_url = run_url.to_owned();
    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new(executable)
            .args([
                "--ignored",
                "--exact",
                "crash_mid_multipart_upload_helper",
                "--nocapture",
            ])
            .env(CRASH_HELPER_MARKER, "1")
            .env(CRASH_HELPER_URL, run_url)
            .output()
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    if output.status.code() != Some(CRASH_HELPER_EXIT) {
        return Err(format!(
            "multipart crash helper exited {:?}; stdout={}; stderr={}",
            output.status.code(),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    match raw.head(&key).await {
        Err(object_store::Error::NotFound { .. }) => Ok(()),
        Ok(_) => Err("crashed multipart upload published a reader-visible object".to_owned()),
        Err(error) => Err(format!(
            "HEAD after multipart process crash failed: {error}"
        )),
    }
}

/// Subprocess-only helper. `process::exit` intentionally skips `BufWriter`'s
/// destructor so the provider sees a real abandoned multipart upload rather
/// than the graceful abort exercised above.
#[test]
#[ignore = "invoked only by real_s3_provider_contract in a subprocess"]
#[allow(clippy::exit)]
fn crash_mid_multipart_upload_helper() {
    if std::env::var(CRASH_HELPER_MARKER).as_deref() != Ok("1") {
        return;
    }
    let run_url = std::env::var(CRASH_HELPER_URL).expect("missing crash-helper S3 URL");
    let (bucket, run_prefix) = parse_s3_url(&run_url);
    let raw: Arc<dyn ObjectStore> = Arc::new(
        AmazonS3Builder::from_env()
            .with_bucket_name(bucket)
            .build()
            .expect("build crash-helper S3 backend"),
    );
    let key = Path::from(format!("{run_prefix}/multipart/process-crash.bin"));
    tokio::runtime::Runtime::new()
        .expect("build crash-helper runtime")
        .block_on(async move {
            let mut upload = BufWriter::with_capacity(raw, key, MULTIPART_PART_SIZE);
            upload
                .put(Bytes::from(vec![0x33; MULTIPART_PART_SIZE + 1]))
                .await
                .expect("upload first multipart part");
        });
    std::process::exit(CRASH_HELPER_EXIT);
}

async fn delete_prefix(store: &dyn ObjectStore, prefix: &str) -> Result<(), String> {
    let prefix = Path::from(prefix);
    let mut objects = store.list(Some(&prefix));
    let mut locations = Vec::new();
    while let Some(object) = objects.next().await {
        locations.push(object.map_err(|error| error.to_string())?.location);
    }
    for location in locations {
        store
            .delete(&location)
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn parse_s3_url(url: &str) -> (&str, String) {
    let value = url
        .strip_prefix("s3://")
        .expect("INTEGRATIONS_S3_CONTRACT_URL must start with s3://");
    let (bucket, prefix) = value.split_once('/').unwrap_or((value, ""));
    assert!(!bucket.is_empty(), "S3 contract bucket must not be empty");
    (bucket, prefix.trim_matches('/').to_owned())
}

fn report<E: std::fmt::Debug>(error: E) -> String {
    format!("{error:?}")
}
