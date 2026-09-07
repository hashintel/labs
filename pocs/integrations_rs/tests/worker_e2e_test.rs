//! One complete V1 submission through the public operator commands, the real
//! activation boundary, and the production runner, in process: submit before
//! the worker exists, activate, recover the admission, plan, deliver one
//! Graph request, and observe a terminal run on attempt one.

mod common;

use std::time::Duration;

use common::{orders_definition, wait_for, WorkerHarness};
use integrations_rs::orchestrator::CommandRunState;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn mount_rotating_secret(graph: &MockServer, rotated: Arc<AtomicBool>, secret_uuid: &str) {
    let vault_path = format!("users/{}/rest/credentials", common::WEB_ID);
    Mock::given(method("POST"))
        .and(path("/entities/query"))
        .and(header("x-authenticated-user-actor-id", common::ACTOR_ID))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "entities": [{
                "metadata": {
                    "recordId": {"entityId": format!("{}~{secret_uuid}", common::WEB_ID)},
                    "entityTypeIds": ["https://hash.ai/@h/types/entity-type/user-secret/v/1"],
                    "archived": false
                },
                "properties": {
                    "https://hash.ai/@h/types/property-type/expired-at/": "2999-01-01T00:00:00Z",
                    "https://hash.ai/@h/types/property-type/vault-path/": vault_path
                }
            }]
        })))
        .expect(3)
        .mount(graph)
        .await;
    let vault_rotation = rotated;
    Mock::given(method("GET"))
        .and(path(format!("/v1/secret/data/{vault_path}")))
        .and(header("x-vault-token", "test-vault-token"))
        .respond_with(move |_: &wiremock::Request| {
            let token = if vault_rotation.load(Ordering::SeqCst) {
                "new-token"
            } else {
                "old-token"
            };
            ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": {"data": {"value": serde_json::json!({"value": token}).to_string()}}
            }))
        })
        .expect(3)
        .mount(graph)
        .await;
    Mock::given(method("POST"))
        .and(path("/entities"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
        .mount(graph)
        .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn retry_reads_rotated_credentials_and_reuses_completed_captures() {
    let graph = MockServer::start().await;
    let source = MockServer::start().await;
    let rotated = Arc::new(AtomicBool::new(false));
    let secret_uuid = "22222222-2222-4222-8222-222222222222";
    mount_rotating_secret(&graph, Arc::clone(&rotated), secret_uuid).await;
    Mock::given(method("GET"))
        .and(path("/first"))
        .and(header("authorization", "Bearer old-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            {"id": "first", "name": "First captured row"}
        ])))
        .expect(1)
        .mount(&source)
        .await;
    let source_rotation = Arc::clone(&rotated);
    Mock::given(method("GET"))
        .and(path("/second"))
        .respond_with(move |request: &wiremock::Request| {
            if !source_rotation.swap(true, Ordering::SeqCst) {
                return ResponseTemplate::new(503);
            }
            if request
                .headers
                .get("authorization")
                .and_then(|value| value.to_str().ok())
                != Some("Bearer new-token")
            {
                return ResponseTemplate::new(401);
            }
            ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {"id": "second", "name": "Second captured row"}
            ]))
        })
        .expect(2)
        .mount(&source)
        .await;

    let harness = WorkerHarness::start(graph);
    let mut definition = orders_definition("rotating-rest", "SELECT 1");
    definition["sources"] = serde_json::json!({});
    definition["connector"] = serde_json::json!({
        "id": "rotating-rest", "mode": "rest-api",
        "auth": {"type": "bearer", "secretEntityUuid": secret_uuid},
        "endpoints": {
            "first": {"url": format!("{}/first", source.uri()), "primaryKey": "id", "maxPages": 1},
            "second": {"url": format!("{}/second", source.uri()), "primaryKey": "id", "maxPages": 1}
        }
    });
    let mut first = definition["pipelines"]["entities"][0].clone();
    first["source"] = "first".into();
    first["steps"][0]["id"] = "first-sink".into();
    let mut second = first.clone();
    second["source"] = "second".into();
    second["steps"][0]["id"] = "second-sink".into();
    definition["pipelines"]["entities"] = serde_json::json!([first, second]);
    let submitted = harness.submit(definition).await;
    let graph_url = reqwest::Url::parse(&harness.graph.uri()).expect("mock Graph URL should parse");
    let vault_host = format!(
        "http://{}",
        graph_url.host_str().expect("mock Graph should have a host")
    );
    let vault_port = graph_url
        .port()
        .expect("mock Graph should have a port")
        .to_string();
    let env = harness.surface_env_with(&[
        ("HASH_GRAPH_SERVICE_SECRET", "test-service-secret"),
        ("HASH_VAULT_HOST", &vault_host),
        ("HASH_VAULT_PORT", &vault_port),
        ("HASH_VAULT_MOUNT_PATH", "secret"),
        ("HASH_VAULT_TOKEN", "test-vault-token"),
        ("INTEGRATIONS_ALLOW_PRIVATE_HOSTS", "1"),
    ]);
    let worker = tokio::spawn(async move { integrations_rs::production::run_worker(&env).await });
    let completed = wait_for(
        &harness.surface(),
        submitted.run_id.as_str(),
        Duration::from_secs(45),
        |status| {
            assert_ne!(
                status.state,
                CommandRunState::Terminated,
                "retry should complete with the rotated credential: {:?}",
                status.failure
            );
            status.state == CommandRunState::Completed
        },
    )
    .await;
    worker.abort();
    let _ = worker.await;
    assert_eq!(completed.attempt, 2);
    source.verify().await;
    harness.graph.verify().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn v1_submission_recovers_plans_delivers_and_completes_without_process_local_authority() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter("warn,integrations_rs=debug")
        .with_test_writer()
        .try_init();
    let graph = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/entities"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
        .expect(1)
        .mount(&graph)
        .await;

    let harness = WorkerHarness::start(graph);
    let submitted = harness
        .submit(orders_definition(
            "worker-e2e",
            "SELECT 'one' AS id, 'Order one' AS name",
        ))
        .await;
    let surface = harness.surface();

    let worker_env = harness.surface_env();
    let worker =
        tokio::spawn(async move { integrations_rs::production::run_worker(&worker_env).await });
    let completed = wait_for(
        &surface,
        submitted.run_id.as_str(),
        Duration::from_secs(30),
        |status| {
            assert_ne!(
                status.state,
                CommandRunState::Terminated,
                "run terminated: {:?}",
                status.failure
            );
            status.state == CommandRunState::Completed
        },
    )
    .await;
    assert_eq!(completed.attempt, 1);
    assert!(completed.active_work_id.is_none());

    worker.abort();
    let _ = worker.await;
}

/// Mirror of the real-Graph contract cadence: worker A completes a run and
/// dies; a fresh worker B recovers the journal (completed run plus a newly
/// accepted one) and must deliver the second run.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fresh_worker_delivers_a_new_run_after_recovering_a_completed_one() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter("warn,integrations_rs=debug")
        .with_test_writer()
        .try_init();
    let graph = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/entities"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
        .expect(2..)
        .mount(&graph)
        .await;

    let harness = WorkerHarness::start(graph);
    let surface = harness.surface();
    // Worker A dies holding its shard lease; a short lease keeps worker B's
    // takeover wait inside the test budget.
    let lease_overrides: &[(&str, &str)] = &[
        ("INTEGRATIONS_LEASE_SECONDS", "12"),
        ("INTEGRATIONS_LEASE_RENEW_SECONDS", "3"),
        ("INTEGRATIONS_LEASE_RENEW_TIMEOUT_SECONDS", "2"),
        ("INTEGRATIONS_GRAPH_CHUNK_DEADLINE_SECONDS", "4"),
        ("INTEGRATIONS_CURSOR_COMMIT_DEADLINE_SECONDS", "2"),
        ("INTEGRATIONS_CLOCK_SKEW_SECONDS", "0"),
    ];

    let first = harness
        .submit(orders_definition(
            "worker-handoff",
            "SELECT 'one' AS id, 'Order round 0' AS name",
        ))
        .await;
    // A real subprocess: killing it stops lease renewal the way a crashed
    // production worker would, leaving the lease to expire.
    let local_a = common::WorkerLocal::fresh();
    let mut worker_a = harness.spawn_worker(&local_a, lease_overrides);
    wait_for(
        &surface,
        first.run_id.as_str(),
        Duration::from_secs(30),
        |status| {
            assert_ne!(
                status.state,
                CommandRunState::Terminated,
                "first run terminated: {:?}",
                status.failure
            );
            status.state == CommandRunState::Completed
        },
    )
    .await;
    worker_a.kill().expect("stop worker A");
    let _ = worker_a.wait();

    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    let second = loop {
        let second = harness
            .submit(orders_definition(
                "worker-handoff",
                "SELECT 'one' AS id, 'Order round 1' AS name",
            ))
            .await;
        if second.run_id != first.run_id {
            break second;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "second submission kept attaching to the completed run"
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
    };

    // Worker B inherits worker A's local disk (base dir and cache), exactly
    // like a restarted production worker on the same machine.
    let mut worker_b = harness.spawn_worker(&local_a, lease_overrides);
    let completed = wait_for(
        &surface,
        second.run_id.as_str(),
        Duration::from_secs(60),
        |status| {
            assert_ne!(
                status.state,
                CommandRunState::Terminated,
                "second run terminated: {:?}",
                status.failure
            );
            status.state == CommandRunState::Completed
        },
    )
    .await;
    assert_eq!(completed.attempt, 1);

    worker_b.kill().expect("stop worker B");
    let _ = worker_b.wait();
}

/// Regression: the depth-one admission pointer must be retired once its run
/// is terminal, or every later submission for the integration attaches to the
/// finished run and the engine silently never runs again.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn second_submission_after_completion_starts_and_completes_a_new_run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter("warn,integrations_rs=debug")
        .with_test_writer()
        .try_init();
    let graph = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/entities"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
        .expect(2..)
        .mount(&graph)
        .await;

    let harness = WorkerHarness::start(graph);
    let surface = harness.surface();
    let worker_env = harness.surface_env();
    let worker =
        tokio::spawn(async move { integrations_rs::production::run_worker(&worker_env).await });

    let first = harness
        .submit(orders_definition(
            "resubmission-e2e",
            "SELECT 'one' AS id, 'Order round 0' AS name",
        ))
        .await;
    wait_for(
        &surface,
        first.run_id.as_str(),
        Duration::from_secs(30),
        |status| {
            assert_ne!(
                status.state,
                CommandRunState::Terminated,
                "first run terminated: {:?}",
                status.failure
            );
            status.state == CommandRunState::Completed
        },
    )
    .await;

    // Admission retirement lands right after completion becomes durable,
    // so a submission racing that window may still attach to the finished
    // run; resubmitting is safe (attach is a read) and must yield a fresh
    // run promptly.
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    let second = loop {
        let second = harness
            .submit(orders_definition(
                "resubmission-e2e",
                "SELECT 'one' AS id, 'Order round 1' AS name",
            ))
            .await;
        if second.run_id != first.run_id {
            break second;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "second submission kept attaching to the completed run: the \
             admission pointer was never retired"
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
    };

    let completed = wait_for(
        &surface,
        second.run_id.as_str(),
        Duration::from_secs(30),
        |status| {
            assert_ne!(
                status.state,
                CommandRunState::Terminated,
                "second run terminated: {:?}",
                status.failure
            );
            status.state == CommandRunState::Completed
        },
    )
    .await;
    assert_eq!(completed.attempt, 1);

    worker.abort();
    let _ = worker.await;
}
