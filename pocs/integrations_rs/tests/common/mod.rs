//! Shared worker fixture for the E2E, crash/replay, multi-runner, disk, and
//! activation suites: one disposable remote prefix, a mock Graph, a valid
//! release attestation, and helpers to run real worker processes against
//! them.
//!
//! Every test binary includes this module and uses its own subset of it.
#![allow(
    dead_code,
    reason = "each integration-test crate compiles this shared harness independently and uses a different subset"
)]

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use integrations_rs::config::Env;
use integrations_rs::orchestrator::{
    prepare_task, CommandRunStatus, CommandSubmission, CommandSurface, InvocationV1,
    SubmissionTriggerV1,
};
use integrations_rs::yaml::Source;
use sha2::{Digest as _, Sha256};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

pub(crate) const WEB_ID: &str = "00000000-0000-4000-8000-000000000001";
pub(crate) const ACTOR_ID: &str = "00000000-0000-4000-8000-000000000002";
pub(crate) const ENTITY_CANARY: &str =
    "00000000-0000-4000-8000-000000000001~00000000-0000-4000-8000-000000000003";
pub(crate) const LINK_CANARY: &str =
    "00000000-0000-4000-8000-000000000001~00000000-0000-4000-8000-000000000004";

pub(crate) struct WorkerHarness {
    pub(crate) remote: tempfile::TempDir,
    pub(crate) graph: MockServer,
    pub(crate) surface_cache: tempfile::TempDir,
    pub(crate) surface_local: tempfile::TempDir,
    attestation_dir: tempfile::TempDir,
    attestation: PathBuf,
}

impl WorkerHarness {
    pub(crate) fn start(graph: MockServer) -> Self {
        let remote = tempfile::tempdir().expect("remote object store");
        let attestation_dir = tempfile::tempdir().expect("attestation directory");
        let attestation = attestation_dir.path().join("release-attestation.json");
        let harness = Self {
            remote,
            graph,
            surface_cache: tempfile::tempdir().expect("surface cache"),
            surface_local: tempfile::tempdir().expect("surface local state"),
            attestation_dir,
            attestation,
        };
        let bytes = valid_attestation_bytes(&harness.blob_url(), &harness.graph.uri());
        std::fs::write(&harness.attestation, bytes).expect("write release attestation");
        harness
    }

    pub(crate) fn blob_url(&self) -> String {
        format!("file://{}", self.remote.path().display())
    }

    /// Environment for in-test command-surface use (submission, status). The
    /// surface only reads and writes the shared remote prefix.
    pub(crate) fn surface_env(&self) -> Env {
        Env::from_map(self.env_map(
            &self.surface_local.path().join("runner"),
            self.surface_cache.path(),
        ))
    }

    /// Like `surface_env`, with test-specific overrides applied on top.
    pub(crate) fn surface_env_with(&self, overrides: &[(&str, &str)]) -> Env {
        let mut map = self.env_map(
            &self.surface_local.path().join("runner"),
            self.surface_cache.path(),
        );
        for (name, value) in overrides {
            map.insert((*name).to_owned(), (*value).to_owned());
        }
        Env::from_map(map)
    }

    fn env_map(
        &self,
        base_dir: &std::path::Path,
        cache: &std::path::Path,
    ) -> HashMap<String, String> {
        base_worker_env(
            &self.graph.uri(),
            &self.blob_url(),
            cache,
            base_dir,
            &self.attestation,
        )
    }

    /// Spawns one real worker process with its own local state and verified
    /// cache; only the remote prefix is shared with everything else.
    pub(crate) fn spawn_worker(&self, local: &WorkerLocal, overrides: &[(&str, &str)]) -> Child {
        let mut command = Command::new(env!("CARGO_BIN_EXE_integrations_rs"));
        for (name, value) in self.env_map(&local.base.path().join("runner"), local.cache.path()) {
            command.env(name, value);
        }
        for (name, value) in overrides {
            command.env(name, value);
        }
        command
            .args(["worker", "--activate-baseline"])
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("spawn worker process")
    }

    pub(crate) async fn submit(&self, definition: serde_json::Value) -> CommandSubmission {
        let env = self.surface_env();
        let prepared = prepare_task(
            &Source::Definition(definition),
            InvocationV1::default(),
            SubmissionTriggerV1::Manual,
            serde_json::Map::new(),
            &env,
        )
        .expect("prepare V1 submission");
        let surface = CommandSurface::open(&env).expect("open command surface");
        surface.submit(prepared).await.expect("submit run")
    }

    pub(crate) fn surface(&self) -> CommandSurface {
        CommandSurface::open(&self.surface_env()).expect("open command surface")
    }
}

/// One worker process's private local disk: base dir plus verified cache.
pub(crate) struct WorkerLocal {
    pub(crate) base: tempfile::TempDir,
    pub(crate) cache: tempfile::TempDir,
}

impl WorkerLocal {
    pub(crate) fn fresh() -> Self {
        Self {
            base: tempfile::tempdir().expect("worker local state"),
            cache: tempfile::tempdir().expect("worker cache"),
        }
    }
}

/// A batch definition delivering one entity per SQL row.
pub(crate) fn orders_definition(connector_id: &str, sql: &str) -> serde_json::Value {
    serde_json::json!({
        "connector": {"id": connector_id, "mode": "batch"},
        "sources": {
            "orders": {
                "kind": "sql",
                "primaryKey": "id",
                "sql": sql
            }
        },
        "pipelines": {
            "entities": [{
                "source": "orders",
                "steps": [{
                    "id": "orders-sink",
                    "kind": "graph-sink",
                    "config": {
                        "entityType": "https://example.test/types/entity-type/order/v/1",
                        "entityId": "id",
                        "webId": WEB_ID,
                        "properties": {
                            "https://example.test/types/property-type/name/": "name"
                        }
                    }
                }]
            }]
        }
    })
}

pub(crate) fn permitted_body() -> serde_json::Value {
    serde_json::json!({
        ENTITY_CANARY: ["00000000-0000-4000-8000-000000000010"],
        LINK_CANARY: ["00000000-0000-4000-8000-000000000011"]
    })
}

pub(crate) fn digest(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

/// The canonical release-contract attestation document. Every suite and the
/// activation failure shapes derive from this one builder, so the
/// producer/consumer field contract lives in a single place in the tests.
pub(crate) fn attestation_document(
    blob_url: &str,
    graph_url: &str,
    binary_version: &str,
    valid_until: &str,
) -> serde_json::Value {
    serde_json::json!({
        "version": 1,
        "protocolVersion": 1,
        "binaryVersion": binary_version,
        "validUntil": valid_until,
        "blobStoreUrlSha256": digest(blob_url.trim_end_matches('/')),
        "graphUrlSha256": digest(graph_url.trim_end_matches('/')),
        "objectStoreContractPassed": true,
        "slateDbContractPassed": true,
        "graphDeliveryContractPassed": true
    })
}

pub(crate) fn valid_attestation_bytes(blob_url: &str, graph_url: &str) -> Vec<u8> {
    serde_json::to_vec(&attestation_document(
        blob_url,
        graph_url,
        env!("CARGO_PKG_VERSION"),
        "2099-01-01T00:00:00Z",
    ))
    .expect("attestation JSON")
}

/// The complete worker environment against a graph URL, blob URL, and this
/// worker's private local paths.
pub(crate) fn base_worker_env(
    graph_url: &str,
    blob_url: &str,
    cache: &std::path::Path,
    base_dir: &std::path::Path,
    attestation: &std::path::Path,
) -> HashMap<String, String> {
    let mut env = HashMap::from([
        ("HASH_WEB_ID".to_owned(), WEB_ID.to_owned()),
        ("HASH_ACTOR_ID".to_owned(), ACTOR_ID.to_owned()),
        ("HASH_GRAPH_URL".to_owned(), graph_url.to_owned()),
        (
            "INTEGRATIONS_GRAPH_PERMISSION_ENTITY_ID".to_owned(),
            ENTITY_CANARY.to_owned(),
        ),
        (
            "INTEGRATIONS_GRAPH_PERMISSION_LINK_ID".to_owned(),
            LINK_CANARY.to_owned(),
        ),
        ("INTEGRATIONS_BLOB_URL".to_owned(), blob_url.to_owned()),
        (
            "INTEGRATIONS_BLOB_CACHE".to_owned(),
            cache.display().to_string(),
        ),
        ("RUNNER_BASE_DIR".to_owned(), base_dir.display().to_string()),
        (
            "INTEGRATIONS_RELEASE_ATTESTATION".to_owned(),
            attestation.display().to_string(),
        ),
    ]);
    env.extend(resource_bounds_env());
    env
}

/// The disk-bound and drain-timeout settings every worker test uses.
pub(crate) fn resource_bounds_env() -> [(String, String); 6] {
    [
        ("RUNNER_MAX_WORKSPACE_BYTES".to_owned(), "1GiB".to_owned()),
        (
            "INTEGRATIONS_BLOB_CACHE_MAX_BYTES".to_owned(),
            "1GiB".to_owned(),
        ),
        ("RUNNER_MIN_FREE_BYTES".to_owned(), "1B".to_owned()),
        ("RUNNER_MAX_STAGING_BYTES".to_owned(), "1GiB".to_owned()),
        ("DUCKDB_MAX_DATABASE_SIZE".to_owned(), "256MiB".to_owned()),
        (
            "INTEGRATIONS_WORKER_DRAIN_TIMEOUT_SECONDS".to_owned(),
            "2".to_owned(),
        ),
    ]
}

/// Mounts the verified permission-preflight response.
pub(crate) async fn mount_permissions(graph: &MockServer) {
    Mock::given(method("POST"))
        .and(path("/entities/permissions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(permitted_body()))
        .mount(graph)
        .await;
}

/// Polls a run's projected status until `accept` holds, panicking loudly on
/// timeout.
pub(crate) async fn wait_for(
    surface: &CommandSurface,
    run_id: &str,
    deadline: Duration,
    accept: impl Fn(&CommandRunStatus) -> bool + Send + Sync,
) -> CommandRunStatus {
    tokio::time::timeout(deadline, async {
        loop {
            let status = surface.status(run_id).await.unwrap_or_else(|error| {
                panic!("a successfully submitted run must remain queryable: {error:?}")
            });
            if accept(&status) {
                break status;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("run reached the expected state in time")
}
