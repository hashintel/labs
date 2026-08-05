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
use tokio::io::AsyncWriteExt as _;

const MULTIPART_PART_SIZE: usize = 8 * 1024 * 1024;
const CRASH_HELPER_MARKER: &str = "INTEGRATIONS_S3_CRASH_HELPER";
const CRASH_HELPER_URL: &str = "INTEGRATIONS_S3_CRASH_HELPER_URL";
const CRASH_HELPER_EXIT: i32 = 86;
const EVIDENCE_PREFIX: &str = "INTEGRATIONS_CONTRACT_EVIDENCE ";

/// Bounded end-to-end S3 transfer probe for roles that intentionally lack
/// bucket listing. It touches one exact key, verifies the downloaded bytes,
/// and deletes that key before returning.
#[tokio::test]
#[ignore = "requires an explicit real-S3 scratch key and provider credentials"]
async fn real_s3_throughput_probe() {
    let url = std::env::var("INTEGRATIONS_S3_THROUGHPUT_URL")
        .expect("set INTEGRATIONS_S3_THROUGHPUT_URL=s3://bucket/exact-scratch-prefix");
    let (bucket, prefix) = parse_s3_url(&url);
    assert!(
        !prefix.is_empty(),
        "throughput URL requires a scratch prefix"
    );
    let bytes = std::env::var("INTEGRATIONS_S3_THROUGHPUT_BYTES")
        .ok()
        .map_or(256 * 1024 * 1024, |value| {
            value
                .parse::<usize>()
                .expect("throughput bytes must be usize")
        });
    assert!(bytes > 0, "throughput bytes must be positive");
    let raw: Arc<dyn ObjectStore> = Arc::new(
        AmazonS3Builder::from_env()
            .with_bucket_name(bucket)
            .build()
            .expect("build S3 throughput backend"),
    );
    let key = Path::from(format!("{prefix}/object.bin"));
    raw.delete(&key).await.expect("delete stale benchmark key");

    let result = throughput_round_trip(Arc::clone(&raw), &key, bytes).await;
    let cleanup = raw.delete(&key).await;
    cleanup.expect("delete exact throughput object");
    result.expect("S3 throughput round trip");
}

async fn throughput_round_trip(
    raw: Arc<dyn ObjectStore>,
    key: &Path,
    bytes: usize,
) -> Result<(), String> {
    let chunk_size = MULTIPART_PART_SIZE.min(bytes);
    let chunk = Bytes::from(
        (0..chunk_size)
            .map(|index| {
                u8::try_from(index.wrapping_mul(31) % 251).expect("modulo 251 always fits in u8")
            })
            .collect::<Vec<_>>(),
    );
    let mut expected_hash = Sha256::new();
    let upload_started = std::time::Instant::now();
    let mut writer = BufWriter::with_capacity(Arc::clone(&raw), key.clone(), MULTIPART_PART_SIZE);
    let mut remaining = bytes;
    while remaining > 0 {
        let count = remaining.min(chunk.len());
        let part = chunk.slice(..count);
        expected_hash.update(&part);
        writer.put(part).await.map_err(|error| error.to_string())?;
        remaining -= count;
    }
    writer.shutdown().await.map_err(|error| error.to_string())?;
    let upload_seconds = upload_started.elapsed().as_secs_f64();

    let download_started = std::time::Instant::now();
    let result = raw.get(key).await.map_err(|error| error.to_string())?;
    let mut stream = result.into_stream();
    let mut observed_hash = Sha256::new();
    let mut observed_bytes = 0_usize;
    while let Some(part) = stream.next().await {
        let part = part.map_err(|error| error.to_string())?;
        observed_hash.update(&part);
        observed_bytes = observed_bytes
            .checked_add(part.len())
            .ok_or("download byte count overflow")?;
    }
    let download_seconds = download_started.elapsed().as_secs_f64();
    if observed_bytes != bytes || observed_hash.finalize() != expected_hash.finalize() {
        return Err("downloaded payload failed size or SHA-256 verification".to_owned());
    }
    #[allow(clippy::cast_precision_loss, reason = "benchmark rate is approximate")]
    let mebibytes = bytes as f64 / (1024.0 * 1024.0);
    println!(
        "INTEGRATIONS_S3_THROUGHPUT {}",
        serde_json::json!({
            "bytes": bytes,
            "uploadSeconds": upload_seconds,
            "uploadMiBPerSecond": mebibytes / upload_seconds,
            "downloadSeconds": download_seconds,
            "downloadMiBPerSecond": mebibytes / download_seconds,
            "sha256Verified": true,
        })
    );
    Ok(())
}

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

/// End-to-end artifact pipeline against the real provider: publish a 5,000
/// object desired projection and its effect index, then load the effects in
/// delivery-sized windows. Prints per-phase timings so page-format changes
/// can be compared across runs.
#[tokio::test]
#[ignore = "requires an explicit real-S3 scratch prefix and provider credentials"]
async fn real_s3_artifact_page_throughput() {
    let base_url = std::env::var("INTEGRATIONS_S3_CONTRACT_URL")
        .expect("set INTEGRATIONS_S3_CONTRACT_URL=s3://bucket/scratch-prefix");
    let (bucket, base_prefix) = parse_s3_url(&base_url);
    assert!(
        !base_prefix.is_empty(),
        "INTEGRATIONS_S3_CONTRACT_URL must include a non-empty scratch prefix"
    );
    let run = format!("artifact-pages-{}", uuid::Uuid::new_v4());
    let run_prefix = format!("{base_prefix}/{run}");
    let run_url = format!("s3://{bucket}/{run_prefix}");
    let raw: Arc<dyn ObjectStore> = Arc::new(
        AmazonS3Builder::from_env()
            .with_bucket_name(bucket)
            .build()
            .expect("build S3 contract backend"),
    );

    let result = exercise_artifact_pages(&run_url).await;
    let cleanup = delete_prefix(raw.as_ref(), &run_prefix).await;
    if let Err(error) = cleanup {
        panic!("S3 artifact page cleanup failed for unique prefix {run_prefix:?}: {error}");
    }
    if let Err(error) = result {
        panic!("S3 artifact page throughput run failed: {error}");
    }
}

#[allow(
    clippy::too_many_lines,
    reason = "one linear publish/warm-load/cold-load benchmark reads better unfragmented"
)]
async fn exercise_artifact_pages(run_url: &str) -> Result<(), String> {
    use integrations_rs::graph::artifacts::{
        ArtifactEffectRepository, DesiredDispositionV1, DesiredObjectInputDispositionV1,
        DesiredObjectInputV1, EffectRepository as _, GraphObjectKindV1,
    };
    use integrations_rs::graph::effects::{GraphEffectV1, GraphOperationV1};

    const ENTITIES: u64 = 5_000;
    const WINDOW: usize = 2_048;

    let cache = tempdir().map_err(|error| error.to_string())?;
    let store = ArtifactStore::from_url(run_url, cache.path()).map_err(report)?;
    let repository =
        ArtifactEffectRepository::new(store, "tenants/contract/integration").map_err(report)?;

    let inputs = (0..ENTITIES)
        .map(|index| DesiredObjectInputV1 {
            kind: GraphObjectKindV1::Entity,
            graph_identity: format!("https://graph.example/entities/{index:08}"),
            disposition: DesiredObjectInputDispositionV1::Live(
                format!(r#"{{"entityId":"{index:08}","properties":{{"name":"entity {index}"}}}}"#)
                    .into_bytes(),
            ),
        })
        .collect::<Vec<_>>();

    let started = std::time::Instant::now();
    let published = repository
        .publish_desired_projection(inputs)
        .await
        .map_err(report)?;
    let desired_elapsed = started.elapsed();

    let target = "1".repeat(64);
    let effects = published
        .objects
        .iter()
        .map(|object| {
            let (DesiredDispositionV1::Live {
                payload_digest,
                payload,
            }
            | DesiredDispositionV1::Archived {
                payload_digest,
                payload,
            }) = &object.disposition;
            GraphEffectV1::new(
                target.clone(),
                GraphOperationV1::UpsertEntity,
                object.graph_identity.clone(),
                Some(payload_digest.clone()),
                Some(payload.clone()),
            )
            .map_err(report)
        })
        .collect::<Result<Vec<_>, String>>()?;

    let started = std::time::Instant::now();
    let index = repository
        .publish_effect_index(&target, effects)
        .await
        .map_err(report)?;
    let effects_elapsed = started.elapsed();

    let started = std::time::Instant::now();
    let mut loaded = 0_u64;
    let mut windows = 0_u32;
    while loaded < ENTITIES {
        let window = repository
            .load_effect_window(&index, loaded, WINDOW)
            .await
            .map_err(report)?;
        if window.effect_count != ENTITIES {
            return Err(format!(
                "window declares {} effects, expected {ENTITIES}",
                window.effect_count
            ));
        }
        if window.effects.is_empty() {
            return Err(format!("empty window at offset {loaded}"));
        }
        loaded += window.effects.len() as u64;
        windows += 1;
    }
    let load_elapsed = started.elapsed();

    // A fresh cache directory models another worker taking over: every page
    // and pack must be fetched and verified from the provider.
    let cold_cache = tempdir().map_err(|error| error.to_string())?;
    let cold_store = ArtifactStore::from_url(run_url, cold_cache.path()).map_err(report)?;
    let cold_repository = ArtifactEffectRepository::new(cold_store, "tenants/contract/integration")
        .map_err(report)?;
    let started = std::time::Instant::now();
    let mut cold_loaded = 0_u64;
    while cold_loaded < ENTITIES {
        let window = cold_repository
            .load_effect_window(&index, cold_loaded, WINDOW)
            .await
            .map_err(report)?;
        if window.effects.is_empty() {
            return Err(format!("empty cold window at offset {cold_loaded}"));
        }
        cold_loaded += window.effects.len() as u64;
    }
    let cold_load_elapsed = started.elapsed();
    let started = std::time::Instant::now();
    let cold_desired = cold_repository
        .load_desired_projection(&published.reference)
        .await
        .map_err(report)?;
    if cold_desired.len() as u64 != ENTITIES {
        return Err(format!(
            "cold desired load returned {} objects, expected {ENTITIES}",
            cold_desired.len()
        ));
    }
    let cold_desired_elapsed = started.elapsed();

    println!(
        "artifact page throughput: {ENTITIES} entities, desired publish {:.3}s, \
         effect publish {:.3}s, {windows} windows of {WINDOW} loaded warm in \
         {:.3}s, cold in {:.3}s, cold desired load {:.3}s",
        desired_elapsed.as_secs_f64(),
        effects_elapsed.as_secs_f64(),
        load_elapsed.as_secs_f64(),
        cold_load_elapsed.as_secs_f64(),
        cold_desired_elapsed.as_secs_f64(),
    );
    Ok(())
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
