//! Opt-in contract test against a real, isolated HASH Graph web.
//!
//! Set `INTEGRATIONS_GRAPH_CONTRACT=1` plus the ordinary worker environment
//! (`HASH_GRAPH_URL`, `HASH_WEB_ID`, `HASH_ACTOR_ID`, and a disposable
//! `INTEGRATIONS_BLOB_URL`). The web must be disposable
//! or explicitly approved: the contract performs real entity writes with the
//! configured machine actor.
//!
//! Coverage: actor-scoped create authority and create-conflict convergence
//! (the second identical run
//! replays the same deterministic identity, so the Graph answers 409 and the
//! engine converges through the update path). Provider throttling (429 with
//! `Retry-After`) and bounded error handling cannot be forced against a real
//! Graph and stay covered by the hermetic client and executor suites.
#![allow(clippy::print_stdout)]

mod common;

use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use integrations_rs::config::Env;
use integrations_rs::orchestrator::{
    prepare_task, CommandRunState, CommandSurface, InvocationV1, SubmissionTriggerV1,
};
use integrations_rs::yaml::Source;
use sha2::{Digest as _, Sha256};

const FORWARDED: &[&str] = &[
    "HASH_GRAPH_URL",
    "HASH_WEB_ID",
    "HASH_ACTOR_ID",
    "INTEGRATIONS_BLOB_URL",
];

const OPTIONAL_BLOB_PROVIDER: &[&str] = &["AWS_REGION", "AWS_DEFAULT_REGION"];

/// A real Graph validates entity types against its ontology, so the contract
/// requires an existing versioned entity type (with one text property) in the
/// target web, supplied by the operator.
const ENTITY_TYPE_VAR: &str = "INTEGRATIONS_GRAPH_CONTRACT_ENTITY_TYPE";
const NAME_PROPERTY_VAR: &str = "INTEGRATIONS_GRAPH_CONTRACT_NAME_PROPERTY";

struct WorkerGuard(Child);

impl Drop for WorkerGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[allow(
    clippy::too_many_lines,
    reason = "one linear two-round contract scenario reads better unfragmented"
)]
#[ignore = "requires a real Graph URL and a disposable or explicitly approved web"]
async fn real_graph_delivery_contract() {
    assert_eq!(
        std::env::var("INTEGRATIONS_GRAPH_CONTRACT").as_deref(),
        Ok("1"),
        "set INTEGRATIONS_GRAPH_CONTRACT=1 to confirm the target web is disposable"
    );
    let mut variables = HashMap::new();
    for name in FORWARDED {
        let value = std::env::var(name)
            .unwrap_or_else(|_missing| panic!("{name} is required for the Graph contract"));
        variables.insert((*name).to_owned(), value);
    }
    for name in OPTIONAL_BLOB_PROVIDER {
        if let Ok(value) = std::env::var(name) {
            variables.insert((*name).to_owned(), value);
        }
    }
    let web_id = variables["HASH_WEB_ID"].clone();
    let entity_type = std::env::var(ENTITY_TYPE_VAR)
        .unwrap_or_else(|_missing| panic!("{ENTITY_TYPE_VAR} is required for the Graph contract"));
    let name_property = std::env::var(NAME_PROPERTY_VAR).unwrap_or_else(|_missing| {
        panic!("{NAME_PROPERTY_VAR} is required for the Graph contract")
    });
    let cache = tempfile::tempdir().expect("cache");
    let local = tempfile::tempdir().expect("local state");
    let attestation = local.path().join("release-attestation.json");
    let blob_url = variables["INTEGRATIONS_BLOB_URL"].clone();
    let attestation_bytes =
        common::valid_attestation_bytes(&blob_url, &variables["HASH_GRAPH_URL"]);
    std::fs::write(&attestation, attestation_bytes).expect("write contract attestation");
    variables.extend([
        (
            "INTEGRATIONS_BLOB_CACHE".to_owned(),
            cache.path().display().to_string(),
        ),
        (
            "RUNNER_BASE_DIR".to_owned(),
            local.path().join("runner").display().to_string(),
        ),
        (
            "INTEGRATIONS_RELEASE_ATTESTATION".to_owned(),
            attestation.display().to_string(),
        ),
    ]);
    variables.extend(common::resource_bounds_env());
    // The in-test command surface (submit and status polling) must not share
    // local state with the workers: only the remote prefix is common, exactly
    // like WorkerHarness. A shared RUNNER_BASE_DIR lets the surface's
    // read-only projection opens collide with the worker's shard-log writer.
    let surface_cache = tempfile::tempdir().expect("surface cache");
    let surface_local = tempfile::tempdir().expect("surface local state");
    let mut surface_variables = variables.clone();
    surface_variables.extend([
        (
            "INTEGRATIONS_BLOB_CACHE".to_owned(),
            surface_cache.path().display().to_string(),
        ),
        (
            "RUNNER_BASE_DIR".to_owned(),
            surface_local.path().join("runner").display().to_string(),
        ),
    ]);
    let env = Env::from_map(surface_variables);

    integrations_rs::production::doctor(&env)
        .await
        .expect("object-store diagnostics pass");

    let connector = format!("graph-contract-{}", uuid::Uuid::new_v4());
    // Round 0 proves machine-actor create authority for a brand-new entity.
    // Round 1 changes the property value behind the same stable identity: the
    // engine plans an upsert, the create conflicts with round 0's entity, and
    // delivery must converge through the update path.
    let mut sink_properties = serde_json::Map::new();
    sink_properties.insert(
        name_property.clone(),
        serde_json::Value::String("name".to_owned()),
    );
    for round in 0..2 {
        let definition = serde_json::json!({
            "connector": {"id": connector, "mode": "batch"},
            "sources": {
                "orders": {
                    "kind": "sql",
                    "primaryKey": "id",
                    "sql": format!(
                        "SELECT 'contract-one' AS id, 'Contract order round {round}' AS name"
                    )
                }
            },
            "pipelines": {
                "entities": [{
                    "source": "orders",
                    "steps": [{
                        "id": "orders-sink",
                        "kind": "graph-sink",
                        "config": {
                            "entityType": entity_type,
                            "entityId": "id",
                            "webId": web_id,
                            "properties": sink_properties.clone()
                        }
                    }]
                }]
            }
        });
        let prepared = prepare_task(
            &Source::Definition(definition),
            InvocationV1::default(),
            SubmissionTriggerV1::Manual,
            serde_json::Map::new(),
            &env,
        )
        .expect("prepare contract submission");
        let surface = CommandSurface::open(&env).expect("open command surface");
        let submitted = surface.submit(prepared).await.expect("submit contract run");
        let mut worker = Command::new(env!("CARGO_BIN_EXE_integrations_rs"));
        for (name, value) in &variables {
            worker.env(name, value);
        }
        let worker = WorkerGuard(
            worker
                .args(["worker", "--activate-baseline"])
                .stdout(Stdio::inherit())
                .stderr(Stdio::inherit())
                .spawn()
                .expect("spawn contract worker"),
        );
        let completed = common::wait_for(
            &surface,
            submitted.run_id.as_str(),
            Duration::from_secs(120),
            |status| {
                assert_ne!(
                    status.state,
                    CommandRunState::Terminated,
                    "contract round {round} terminated: {:?}",
                    status.failure
                );
                status.state == CommandRunState::Completed
            },
        )
        .await;
        drop(worker);
        assert_eq!(completed.attempt, 1, "round {round} completed on attempt 1");
    }
    let evidence = serde_json::json!({
        "evidenceVersion": 1,
        "suite": "graph-delivery-v1",
        "binaryVersion": env!("CARGO_PKG_VERSION"),
        "blobStoreUrlSha256": hex::encode(Sha256::digest(
            blob_url.trim_end_matches('/').as_bytes()
        )),
        "graphUrlSha256": hex::encode(Sha256::digest(
            variables["HASH_GRAPH_URL"].trim_end_matches('/').as_bytes()
        ))
    });
    println!("INTEGRATIONS_CONTRACT_EVIDENCE {evidence}");
}
