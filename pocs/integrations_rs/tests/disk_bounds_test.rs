//! Disk-bound validation through a real worker lifecycle: peak workspace,
//! staging, and cache bytes stay inside the configured limits, and a verified
//! remote publication releases the local workspace.

mod common;

use std::path::Path;
use std::time::Duration;

use common::{mount_permissions, orders_definition, WorkerHarness, WorkerLocal};
use integrations_rs::orchestrator::CommandRunState;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const WORKSPACE_BOUND: u64 = 256 * 1024 * 1024;
const STAGING_BOUND: u64 = 256 * 1024 * 1024;
const CACHE_BOUND: u64 = 256 * 1024 * 1024;

fn tree_size(root: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(root) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            let path = entry.path();
            if path.is_dir() {
                tree_size(&path)
            } else {
                entry.metadata().map_or(0, |metadata| metadata.len())
            }
        })
        .sum()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn lifecycle_load_stays_inside_disk_bounds_and_releases_the_workspace() {
    let graph = MockServer::start().await;
    mount_permissions(&graph).await;
    Mock::given(method("POST"))
        .and(path("/entities"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
        .mount(&graph)
        .await;
    let harness = WorkerHarness::start(graph);
    let submitted = harness
        .submit(orders_definition(
            "disk-bounds",
            "SELECT 'id-' || range AS id, 'Order ' || range AS name FROM range(500)",
        ))
        .await;
    let surface = harness.surface();
    let local = WorkerLocal::fresh();
    let workspace_root = local.base.path().join("runner").join("workspaces");
    let staging_root = local.cache.path().join("staging");
    let cache_root = local.cache.path().to_path_buf();
    let mut worker = harness.spawn_worker(
        &local,
        &[
            ("RUNNER_MAX_WORKSPACE_BYTES", "256MiB"),
            ("RUNNER_MAX_STAGING_BYTES", "256MiB"),
            ("INTEGRATIONS_BLOB_CACHE_MAX_BYTES", "256MiB"),
        ],
    );

    let mut peak_workspace = 0_u64;
    let mut peak_staging = 0_u64;
    let mut peak_cache = 0_u64;
    let completed = tokio::time::timeout(Duration::from_secs(60), async {
        loop {
            peak_workspace = peak_workspace.max(tree_size(&workspace_root));
            peak_staging = peak_staging.max(tree_size(&staging_root));
            peak_cache = peak_cache.max(tree_size(&cache_root));
            let status = surface
                .status(submitted.run_id.as_str())
                .await
                .expect("query status");
            match status.state {
                CommandRunState::Completed => break status,
                CommandRunState::Terminated => panic!("run terminated: {:?}", status.failure),
                _ => tokio::time::sleep(Duration::from_millis(20)).await,
            }
        }
    })
    .await
    .expect("worker completed the 500-row integration");
    assert_eq!(completed.attempt, 1);

    // A verified remote publication permits local cleanup: the candidate
    // workspace is removed once its durable state exists remotely.
    let emptied = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if tree_size(&workspace_root) == 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await;
    worker.kill().expect("stop worker");
    let _ = worker.wait();
    emptied.expect("the published candidate workspace was released");

    assert!(
        peak_workspace > 0,
        "the sampler observed the live candidate workspace"
    );
    assert!(
        peak_workspace <= WORKSPACE_BOUND,
        "peak workspace bytes {peak_workspace} exceeded the configured bound"
    );
    assert!(
        peak_staging <= STAGING_BOUND,
        "peak staging bytes {peak_staging} exceeded the configured bound"
    );
    assert!(
        peak_cache > 0,
        "the sampler observed materialized cache objects"
    );
    assert!(
        peak_cache <= CACHE_BOUND,
        "peak cache bytes {peak_cache} exceeded the configured bound"
    );
}
