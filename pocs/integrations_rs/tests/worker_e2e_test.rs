//! One complete V1 submission through the public operator commands, the real
//! activation boundary, and the production runner, in process: submit before
//! the worker exists, activate, recover the admission, plan, deliver one
//! Graph request, and observe a terminal run on attempt one.

mod common;

use std::time::Duration;

use common::{orders_definition, wait_for, WorkerHarness};
use integrations_rs::orchestrator::CommandRunState;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

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
