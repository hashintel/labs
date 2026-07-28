//! Process-death and replay proofs across delivery boundaries.
//!
//! Every restart scenario uses the same remote blob prefix, a brand-new
//! process-local cache and workspace root, and a newly opened journal writer,
//! exactly as a real takeover would. The Graph mock records the authoritative
//! request trace.

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::{mount_permissions, orders_definition, wait_for, WorkerHarness, WorkerLocal};
use integrations_rs::orchestrator::CommandRunState;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

const TWO_ORDERS_SQL: &str =
    "SELECT 'one' AS id, 'Order one' AS name UNION ALL SELECT 'two' AS id, 'Order two' AS name";

/// Lease timing tight enough that a killed owner expires quickly, while every
/// feasibility inequality still holds.
const FAST_LEASE: &[(&str, &str)] = &[
    ("INTEGRATIONS_LEASE_SECONDS", "6"),
    ("INTEGRATIONS_LEASE_RENEW_SECONDS", "1"),
    ("INTEGRATIONS_LEASE_RENEW_TIMEOUT_SECONDS", "1"),
    ("INTEGRATIONS_GRAPH_CHUNK_DEADLINE_SECONDS", "2"),
    ("INTEGRATIONS_CURSOR_COMMIT_DEADLINE_SECONDS", "1"),
    ("INTEGRATIONS_LEASE_SAFETY_SECONDS", "1"),
    // Both workers share this machine's clock, so the takeover proof asserts
    // zero skew explicitly to keep the tight lease window feasible.
    ("INTEGRATIONS_CLOCK_SKEW_SECONDS", "0"),
];

/// Responds 200 to the first entity create and stalls every later request
/// beyond the worker's send deadline, freezing delivery exactly after the
/// first durable cursor.
struct FirstThenStall {
    served: AtomicUsize,
    bodies: Mutex<Vec<String>>,
}

impl Respond for FirstThenStall {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        self.bodies
            .lock()
            .expect("trace lock")
            .push(String::from_utf8_lossy(&request.body).into_owned());
        let index = self.served.fetch_add(1, Ordering::SeqCst);
        if index == 0 {
            ResponseTemplate::new(200).set_body_json(serde_json::json!({}))
        } else {
            ResponseTemplate::new(200)
                .set_delay(Duration::from_secs(120))
                .set_body_json(serde_json::json!({}))
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn process_death_mid_delivery_resumes_at_the_durable_cursor_on_a_fresh_machine() {
    let graph = MockServer::start().await;
    mount_permissions(&graph).await;
    let stall = Arc::new(FirstThenStall {
        served: AtomicUsize::new(0),
        bodies: Mutex::new(Vec::new()),
    });
    let respond = Arc::clone(&stall);
    Mock::given(method("POST"))
        .and(path("/entities"))
        .respond_with(move |request: &Request| respond.respond(request))
        .mount(&graph)
        .await;

    let harness = WorkerHarness::start(graph);
    let submitted = harness
        .submit(orders_definition("crash-cursor", TWO_ORDERS_SQL))
        .await;
    let surface = harness.surface();

    // One Graph request per chunk: each upsert costs two requests, so a
    // budget of two forces a durable cursor between the two entities.
    let first_local = WorkerLocal::fresh();
    let mut overrides = FAST_LEASE.to_vec();
    overrides.push(("INTEGRATIONS_MAX_GRAPH_REQUESTS_PER_CHUNK", "2"));
    let mut first_worker = harness.spawn_worker(&first_local, &overrides);

    // The second distinct create only starts after the first chunk's cursor
    // is durable; once it arrives, kill the process mid-request.
    tokio::time::timeout(Duration::from_secs(30), async {
        while stall.served.load(Ordering::SeqCst) < 2 {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("delivery reached the second entity");
    first_worker.kill().expect("kill first worker");
    let _ = first_worker.wait();
    let first_phase_bodies = stall.bodies.lock().expect("trace lock").clone();
    let status = surface
        .status(submitted.run_id.as_str())
        .await
        .expect("status after death");
    assert_eq!(status.attempt, 1, "process death consumes no attempt");

    // A brand-new worker on a brand-new machine: same remote prefix only.
    harness.graph.reset().await;
    mount_permissions(&harness.graph).await;
    let replay_bodies = Arc::new(Mutex::new(Vec::new()));
    let trace = Arc::clone(&replay_bodies);
    Mock::given(method("POST"))
        .and(path("/entities"))
        .respond_with(move |request: &Request| {
            trace
                .lock()
                .expect("trace lock")
                .push(String::from_utf8_lossy(&request.body).into_owned());
            ResponseTemplate::new(200).set_body_json(serde_json::json!({}))
        })
        .mount(&harness.graph)
        .await;
    let second_local = WorkerLocal::fresh();
    let mut second_worker = harness.spawn_worker(&second_local, FAST_LEASE);
    let completed = wait_for(
        &surface,
        submitted.run_id.as_str(),
        Duration::from_secs(60),
        |status| status.state == CommandRunState::Completed,
    )
    .await;
    second_worker.kill().expect("stop second worker");
    let _ = second_worker.wait();

    assert_eq!(completed.attempt, 1, "takeover resumes the same attempt");
    assert!(completed.active_work_id.is_none());
    let replayed = replay_bodies.lock().expect("trace lock").clone();
    // The first chunk's entity is behind the durable cursor: the replay never
    // resends it. Everything the replay sent was part of the interrupted
    // second chunk.
    let first_delivered = first_phase_bodies
        .first()
        .expect("first phase delivered an entity")
        .clone();
    assert!(
        !replayed.is_empty(),
        "the replay resends the in-flight entity"
    );
    assert!(
        replayed.iter().all(|body| *body != first_delivered),
        "cursor-complete work was resent after takeover: {replayed:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_restarted_owner_reclaims_its_unexpired_lease_in_seconds_not_a_lease_duration() {
    let graph = MockServer::start().await;
    mount_permissions(&graph).await;
    let stall = Arc::new(FirstThenStall {
        served: AtomicUsize::new(0),
        bodies: Mutex::new(Vec::new()),
    });
    let respond = Arc::clone(&stall);
    Mock::given(method("POST"))
        .and(path("/entities"))
        .respond_with(move |request: &Request| respond.respond(request))
        .mount(&graph)
        .await;

    let harness = WorkerHarness::start(graph);
    let submitted = harness
        .submit(orders_definition("crash-same-owner", TWO_ORDERS_SQL))
        .await;
    let surface = harness.surface();

    // Default lease timing: sixty seconds. The whole point of the proof is
    // that recovery does NOT wait it out.
    let owner = &[
        ("INTEGRATIONS_RUNNER_ID", "runner-fixed"),
        ("INTEGRATIONS_MAX_GRAPH_REQUESTS_PER_CHUNK", "2"),
    ];
    let first_local = WorkerLocal::fresh();
    let mut first_worker = harness.spawn_worker(&first_local, owner);
    tokio::time::timeout(Duration::from_secs(30), async {
        while stall.served.load(Ordering::SeqCst) < 2 {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("delivery reached the second entity");
    first_worker.kill().expect("kill owner mid-delivery");
    let _ = first_worker.wait();

    harness.graph.reset().await;
    mount_permissions(&harness.graph).await;
    Mock::given(method("POST"))
        .and(path("/entities"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
        .mount(&harness.graph)
        .await;

    // Same runner ID, brand-new machine state: the owner must replace its own
    // unexpired lease at the next epoch instead of waiting out the sixty
    // second expiry.
    let restart = std::time::Instant::now();
    let second_local = WorkerLocal::fresh();
    let mut second_worker = harness.spawn_worker(&second_local, owner);
    let completed = wait_for(
        &surface,
        submitted.run_id.as_str(),
        Duration::from_secs(25),
        |status| status.state == CommandRunState::Completed,
    )
    .await;
    let recovery = restart.elapsed();
    second_worker.kill().expect("stop restarted owner");
    let _ = second_worker.wait();

    assert_eq!(completed.attempt, 1);
    assert!(
        recovery < Duration::from_secs(25),
        "same-owner recovery took {recovery:?}, which means the owner waited out its own lease"
    );
}

/// One request trace entry per create attempt with its arrival instant.
struct ConflictScript {
    served: AtomicUsize,
    arrivals: Mutex<Vec<tokio::time::Instant>>,
}

impl Respond for ConflictScript {
    fn respond(&self, _request: &Request) -> ResponseTemplate {
        self.arrivals
            .lock()
            .expect("arrival lock")
            .push(tokio::time::Instant::now());
        match self.served.fetch_add(1, Ordering::SeqCst) {
            // Provider pushback with an explicit bounded delay.
            0 => ResponseTemplate::new(429).insert_header("Retry-After", "1"),
            // The retried create observes the previously applied write.
            1 => ResponseTemplate::new(409).set_body_string("entity already exists"),
            _ => ResponseTemplate::new(200).set_body_json(serde_json::json!({})),
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn lost_create_ack_converges_through_429_retry_conflict_and_patch() {
    let graph = MockServer::start().await;
    mount_permissions(&graph).await;
    let script = Arc::new(ConflictScript {
        served: AtomicUsize::new(0),
        arrivals: Mutex::new(Vec::new()),
    });
    let respond = Arc::clone(&script);
    Mock::given(method("POST"))
        .and(path("/entities"))
        .respond_with(move |request: &Request| respond.respond(request))
        .mount(&graph)
        .await;
    let patched = Arc::new(AtomicUsize::new(0));
    let patch_count = Arc::clone(&patched);
    Mock::given(method("PATCH"))
        .and(path("/entities"))
        .respond_with(move |_request: &Request| {
            patch_count.fetch_add(1, Ordering::SeqCst);
            ResponseTemplate::new(200).set_body_json(serde_json::json!({}))
        })
        .mount(&graph)
        .await;

    let harness = WorkerHarness::start(graph);
    let submitted = harness
        .submit(orders_definition(
            "crash-conflict",
            "SELECT 'one' AS id, 'Order one' AS name",
        ))
        .await;
    let surface = harness.surface();
    let local = WorkerLocal::fresh();
    let mut worker = harness.spawn_worker(&local, &[]);
    let completed = wait_for(
        &surface,
        submitted.run_id.as_str(),
        Duration::from_secs(30),
        |status| status.state == CommandRunState::Completed,
    )
    .await;
    worker.kill().expect("stop worker");
    let _ = worker.wait();

    assert_eq!(completed.attempt, 1);
    let arrivals = script.arrivals.lock().expect("arrival lock").clone();
    assert_eq!(arrivals.len(), 2, "one create plus exactly one retry");
    assert!(
        arrivals[1].duration_since(arrivals[0]) >= Duration::from_secs(1),
        "the retry honored the bounded Retry-After"
    );
    assert_eq!(
        patched.load(Ordering::SeqCst),
        1,
        "the create conflict converged through exactly one update"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cancellation_before_acceptance_promotes_the_exact_receipt() {
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
            "crash-cancel",
            "SELECT 'one' AS id, 'Order one' AS name",
        ))
        .await;
    let surface = harness.surface();
    let cancellation = surface
        .cancel(submitted.run_id.as_str())
        .await
        .expect("publish cancellation before the worker exists");
    assert_eq!(cancellation.run_id, submitted.run_id);

    let local = WorkerLocal::fresh();
    let mut worker = harness.spawn_worker(&local, &[]);
    let terminated = wait_for(
        &surface,
        submitted.run_id.as_str(),
        Duration::from_secs(30),
        |status| status.state == CommandRunState::Terminated,
    )
    .await;
    worker.kill().expect("stop worker");
    let _ = worker.wait();
    assert_eq!(terminated.attempt, 0, "the run never started an attempt");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn deterministic_planning_failure_consumes_the_durable_handler_budget() {
    let graph = MockServer::start().await;
    mount_permissions(&graph).await;
    let harness = WorkerHarness::start(graph);
    let submitted = harness
        .submit(orders_definition(
            "crash-budget",
            "SELECT id, name FROM this_table_does_not_exist",
        ))
        .await;
    let surface = harness.surface();
    let local = WorkerLocal::fresh();
    let mut worker = harness.spawn_worker(&local, &[]);
    let terminated = wait_for(
        &surface,
        submitted.run_id.as_str(),
        Duration::from_secs(60),
        |status| status.state == CommandRunState::Terminated,
    )
    .await;
    worker.kill().expect("stop worker");
    let _ = worker.wait();
    assert!(
        terminated.attempt >= 1,
        "planning failures consume durable attempts"
    );
    let failure = terminated.failure.expect("terminated run records failure");
    assert!(!failure.code.is_empty());
    assert!(
        harness
            .graph
            .received_requests()
            .await
            .unwrap_or_default()
            .iter()
            .all(|request| request.url.path() == "/entities/permissions"),
        "planning failures never reach entity delivery"
    );
}
