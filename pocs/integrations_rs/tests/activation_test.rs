//! Subprocess proofs for the explicit activation boundary.
//!
//! Every failure case asserts the disposable remote prefix afterwards: a
//! refused or failed activation must leave no persistent object behind, and
//! activation itself must never mutate the Graph, GET an entity, or delete
//! storage.

mod common;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::Duration;

use common::WEB_ID;
use wiremock::MockServer;

struct Fixture {
    remote: tempfile::TempDir,
    cache: tempfile::TempDir,
    local: tempfile::TempDir,
    graph: MockServer,
    attestation: PathBuf,
}

impl Fixture {
    async fn new() -> Self {
        let fixture = Self {
            remote: tempfile::tempdir().expect("remote object store"),
            cache: tempfile::tempdir().expect("verified cache"),
            local: tempfile::tempdir().expect("runner local state"),
            graph: MockServer::start().await,
            attestation: PathBuf::new(),
        };
        let mut fixture = fixture;
        fixture.attestation = fixture.local.path().join("release-attestation.json");
        fixture.write_attestation(&AttestationShape::Valid);
        fixture
    }

    fn blob_url(&self) -> String {
        format!("file://{}", self.remote.path().display())
    }

    fn write_attestation(&self, shape: &AttestationShape) {
        // Every shape is the canonical document with exactly one field
        // made invalid.
        let (blob_url, binary_version, valid_until) = match shape {
            AttestationShape::Valid => (
                self.blob_url(),
                env!("CARGO_PKG_VERSION"),
                "2099-01-01T00:00:00Z",
            ),
            AttestationShape::Expired => (
                self.blob_url(),
                env!("CARGO_PKG_VERSION"),
                "2001-01-01T00:00:00Z",
            ),
            AttestationShape::WrongBinary => (
                self.blob_url(),
                "0.0.0-not-this-binary",
                "2099-01-01T00:00:00Z",
            ),
            AttestationShape::WrongProvider => (
                "s3://a-different-provider/prefix".to_owned(),
                env!("CARGO_PKG_VERSION"),
                "2099-01-01T00:00:00Z",
            ),
        };
        let bytes = serde_json::to_vec(&common::attestation_document(
            &blob_url,
            &self.graph.uri(),
            binary_version,
            valid_until,
        ))
        .expect("attestation JSON");
        std::fs::write(&self.attestation, bytes).expect("write release attestation");
    }

    fn env(&self) -> HashMap<String, String> {
        common::base_worker_env(
            &self.graph.uri(),
            &self.blob_url(),
            self.cache.path(),
            &self.local.path().join("runner"),
            &self.attestation,
        )
    }

    fn command(&self, overrides: &[(&str, &str)]) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_integrations_rs"));
        for (name, value) in self.env() {
            command.env(name, value);
        }
        for (name, value) in overrides {
            command.env(name, value);
        }
        command
    }

    fn run_worker(&self, args: &[&str], overrides: &[(&str, &str)]) -> Output {
        let mut command = self.command(overrides);
        command.arg("worker").args(args);
        command.output().expect("run worker subprocess")
    }

    fn remote_objects(&self) -> Vec<String> {
        let mut objects = Vec::new();
        collect_files(self.remote.path(), self.remote.path(), &mut objects);
        objects.sort();
        objects
    }

    fn baseline_path(&self) -> PathBuf {
        self.remote
            .path()
            .join(format!("tenants/{WEB_ID}/control/v1/baseline.json"))
    }

    async fn graph_requests(&self) -> Vec<(String, String)> {
        self.graph
            .received_requests()
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|request| (request.method.to_string(), request.url.path().to_owned()))
            .collect()
    }
}

enum AttestationShape {
    Valid,
    Expired,
    WrongBinary,
    WrongProvider,
}

fn collect_files(root: &Path, dir: &Path, into: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(root, &path, into);
        } else if let Ok(relative) = path.strip_prefix(root) {
            let relative = relative.display().to_string();
            // The local backend's CAS coordination lock is process metadata,
            // not a persistent object.
            if !relative.starts_with('.') {
                into.push(relative);
            }
        }
    }
}

#[tokio::test]
async fn worker_refuses_by_default_and_unknown_flags_exit_64_without_persistent_operations() {
    let fixture = Fixture::new().await;

    let refused = fixture.run_worker(&[], &[]);
    assert_eq!(refused.status.code(), Some(1), "{refused:?}");
    assert!(String::from_utf8_lossy(&refused.stderr).contains("refuses"));

    let unknown = fixture.run_worker(&["--force"], &[]);
    assert_eq!(unknown.status.code(), Some(64), "{unknown:?}");

    let also_unknown = fixture.run_worker(&["--activate-baseline", "--and-more"], &[]);
    assert_eq!(also_unknown.status.code(), Some(64), "{also_unknown:?}");

    assert!(fixture.remote_objects().is_empty());
    assert!(fixture.graph_requests().await.is_empty());
}

#[tokio::test]
async fn invalid_configuration_fails_before_any_baseline_write_or_graph_request() {
    let fixture = Fixture::new().await;
    for (name, value) in [
        ("INTEGRATIONS_MAX_GRAPH_REQUESTS_PER_CHUNK", "1"),
        ("INTEGRATIONS_LEASE_SECONDS", "1"),
        ("RUNNER_MAX_WORKSPACE_BYTES", "not-a-size"),
        ("INTEGRATIONS_RECONCILE_INTERVAL_SECONDS", "0"),
        ("INTEGRATIONS_CONFIGURED_RUNNERS", "0"),
        ("INTEGRATIONS_GRAPH_REQUESTS_PER_SECOND", "0"),
        ("INTEGRATIONS_GRAPH_REQUESTS_PER_SECOND", "not-a-rate"),
    ] {
        let output = fixture.run_worker(&["--activate-baseline"], &[(name, value)]);
        assert_eq!(output.status.code(), Some(1), "{name}={value}: {output:?}");
    }
    assert!(fixture.remote_objects().is_empty());
    assert!(fixture.graph_requests().await.is_empty());
}

#[tokio::test]
async fn attestation_failures_precede_baseline_creation_and_graph_contact() {
    let fixture = Fixture::new().await;
    for shape in [
        AttestationShape::Expired,
        AttestationShape::WrongBinary,
        AttestationShape::WrongProvider,
    ] {
        fixture.write_attestation(&shape);
        let output = fixture.run_worker(&["--activate-baseline"], &[]);
        assert_eq!(output.status.code(), Some(1), "{output:?}");
    }
    let absent = fixture.run_worker(
        &["--activate-baseline"],
        &[(
            "INTEGRATIONS_RELEASE_ATTESTATION",
            "/nonexistent/release.json",
        )],
    );
    assert_eq!(absent.status.code(), Some(1), "{absent:?}");
    assert!(fixture.remote_objects().is_empty());
    assert!(fixture.graph_requests().await.is_empty());
}

#[tokio::test]
async fn markerless_non_empty_prefix_fails_closed_and_deletes_nothing() {
    let fixture = Fixture::new().await;
    let stray = fixture
        .remote
        .path()
        .join(format!("tenants/{WEB_ID}/control/v1/foreign.json"));
    std::fs::create_dir_all(stray.parent().expect("stray parent")).expect("stray directories");
    std::fs::write(&stray, br#"{"foreign":true}"#).expect("seed foreign object");

    let output = fixture.run_worker(&["--activate-baseline"], &[]);
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    assert!(!fixture.baseline_path().exists());
    assert!(stray.exists(), "activation must never delete storage");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn successful_activation_creates_one_canonical_baseline_and_mutates_nothing() {
    let fixture = Fixture::new().await;
    let mut worker = fixture
        .command(&[])
        .args(["worker", "--activate-baseline"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn worker");
    let started = tokio::time::Instant::now();
    while !fixture.baseline_path().exists() {
        assert!(
            started.elapsed() < Duration::from_secs(20),
            "worker did not initialize the baseline in time"
        );
        if let Some(status) = worker.try_wait().expect("poll worker") {
            panic!("worker exited before initializing the baseline: {status:?}");
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    // Let discovery settle to prove activation writes nothing further on an
    // empty tenant.
    tokio::time::sleep(Duration::from_millis(500)).await;
    worker.kill().expect("stop worker");
    let _ = worker.wait();

    let objects = fixture.remote_objects();
    assert_eq!(
        objects,
        vec![format!("tenants/{WEB_ID}/control/v1/baseline.json")],
        "activation writes exactly the canonical baseline"
    );
    let baseline: serde_json::Value = serde_json::from_slice(
        &std::fs::read(fixture.baseline_path()).expect("read baseline object"),
    )
    .expect("baseline JSON");
    assert_eq!(baseline["version"], "v1");
    assert_eq!(baseline["data"]["tenant_namespace"], WEB_ID);
    assert_eq!(baseline["data"]["routing_version"], 1);
    assert_eq!(baseline["data"]["shard_count"], 256);

    assert!(
        fixture.graph_requests().await.is_empty(),
        "activation must not contact Graph"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_first_activation_adopts_the_same_baseline() {
    let fixture = Fixture::new().await;
    // Each runner gets its own local state and cache, as in a real
    // deployment: only the remote prefix is shared.
    let locals = (0..2)
        .map(|_index| {
            (
                tempfile::tempdir().expect("runner local state"),
                tempfile::tempdir().expect("runner cache"),
            )
        })
        .collect::<Vec<_>>();
    let mut workers = locals
        .iter()
        .enumerate()
        .map(|(index, (local, cache))| {
            fixture
                .command(&[
                    ("INTEGRATIONS_RUNNER_ID", format!("runner-{index}").as_str()),
                    (
                        "RUNNER_BASE_DIR",
                        local.path().join("runner").display().to_string().as_str(),
                    ),
                    (
                        "INTEGRATIONS_BLOB_CACHE",
                        cache.path().display().to_string().as_str(),
                    ),
                ])
                .args(["worker", "--activate-baseline"])
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .spawn()
                .expect("spawn concurrent worker")
        })
        .collect::<Vec<_>>();
    let started = tokio::time::Instant::now();
    while !fixture.baseline_path().exists() {
        assert!(
            started.elapsed() < Duration::from_secs(20),
            "no worker initialized the baseline in time"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    // Both workers must adopt the single canonical baseline and keep serving.
    tokio::time::sleep(Duration::from_secs(1)).await;
    for worker in &mut workers {
        if let Some(status) = worker.try_wait().expect("poll worker") {
            let mut stderr = String::new();
            if let Some(pipe) = worker.stderr.as_mut() {
                use std::io::Read as _;
                let _ = pipe.read_to_string(&mut stderr);
            }
            panic!(
                "a concurrent activator exited instead of adopting the baseline: {status:?}\n{stderr}"
            );
        }
    }
    for worker in &mut workers {
        worker.kill().expect("stop worker");
        let _ = worker.wait();
    }
    let objects = fixture.remote_objects();
    assert_eq!(
        objects,
        vec![format!("tenants/{WEB_ID}/control/v1/baseline.json")]
    );
}
