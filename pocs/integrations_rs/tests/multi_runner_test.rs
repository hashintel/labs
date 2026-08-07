//! Multi-runner ownership: greedy capped acquisition across real worker
//! processes sharing one remote prefix.

mod common;

use std::time::Duration;

use common::{orders_definition, WorkerHarness, WorkerLocal, WEB_ID};
use integrations_rs::orchestrator::ids::CanonicalIntegrationId;
use integrations_rs::orchestrator::routing;
use integrations_rs::orchestrator::routing::TenantKeyspace as _;
use integrations_rs::orchestrator::CommandRunState;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Three connectors whose canonical integrations route to three distinct
/// shards, discovered deterministically from the pinned routing algorithm.
fn three_distinct_shard_connectors() -> Vec<String> {
    let mut connectors = Vec::new();
    let mut shards = std::collections::BTreeSet::new();
    for index in 0_u32..10_000 {
        let connector = format!("fleet-{index}");
        let Ok(integration) = CanonicalIntegrationId::parse(format!("{WEB_ID}:{connector}")) else {
            continue;
        };
        if shards.insert(routing::shard(&integration)) {
            connectors.push(connector);
            if connectors.len() == 3 {
                return connectors;
            }
        }
    }
    panic!("routing produced fewer than three distinct shards in 10000 candidates")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn four_capped_runners_split_three_shards_with_one_owner_each() {
    let graph = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/entities"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
        .mount(&graph)
        .await;

    let harness = WorkerHarness::start(graph);
    let connectors = three_distinct_shard_connectors();
    let mut runs = Vec::new();
    for connector in &connectors {
        runs.push(
            harness
                .submit(orders_definition(
                    connector,
                    "SELECT 'one' AS id, 'Order one' AS name",
                ))
                .await,
        );
    }

    let locals = (0..4).map(|_| WorkerLocal::fresh()).collect::<Vec<_>>();
    let mut workers = locals
        .iter()
        .enumerate()
        .map(|(index, local)| {
            let runner_id = format!("runner-{index}");
            harness.spawn_worker(
                local,
                &[
                    ("INTEGRATIONS_RUNNER_ID", runner_id.as_str()),
                    ("INTEGRATIONS_SHARD_CAPACITY", "1"),
                    ("INTEGRATIONS_CONFIGURED_RUNNERS", "4"),
                ],
            )
        })
        .collect::<Vec<_>>();

    let surface = harness.surface();
    let completed = tokio::time::timeout(Duration::from_secs(90), async {
        loop {
            let mut done = 0;
            for run in &runs {
                let status = surface
                    .status(run.run_id.as_str())
                    .await
                    .expect("query status");
                match status.state {
                    CommandRunState::Completed => done += 1,
                    CommandRunState::Terminated => {
                        panic!("run terminated: {:?}", status.failure)
                    }
                    _ => {}
                }
            }
            if done == runs.len() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    })
    .await;
    for worker in &mut workers {
        worker.kill().expect("stop worker");
        let _ = worker.wait();
    }
    completed.expect("all three integrations completed across the fleet");

    // Every shard has exactly one lease owner, and a cap of one shard per
    // runner forces three distinct owners out of the four candidates.
    let mut owners = std::collections::BTreeSet::new();
    for connector in &connectors {
        let integration =
            CanonicalIntegrationId::parse(format!("{WEB_ID}:{connector}")).expect("integration");
        let shard = routing::shard(&integration);
        let lease_key = routing::Keyspace::for_tenant(
            &integrations_rs::orchestrator::ids::TenantNamespace::parse(WEB_ID).expect("tenant"),
        )
        .lease(shard);
        let lease: serde_json::Value = serde_json::from_slice(
            &std::fs::read(harness.remote.path().join(&lease_key)).expect("lease object"),
        )
        .expect("lease JSON");
        let owner = lease["data"]["owner_id"]
            .as_str()
            .expect("lease owner")
            .to_owned();
        assert!(
            owner.starts_with("runner-"),
            "lease owner is one of the fleet: {owner}"
        );
        owners.insert(owner);
    }
    assert_eq!(
        owners.len(),
        3,
        "a cap of one shard per runner yields one distinct owner per shard: {owners:?}"
    );
}
