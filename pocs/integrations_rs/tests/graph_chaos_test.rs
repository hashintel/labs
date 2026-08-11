//! Opt-in fault-injection contract against a real, isolated HASH Graph web.
//!
//! Same environment contract as `graph_contract_test`, same warning: the web
//! must be disposable or explicitly approved. A scripted reverse proxy sits
//! between the worker and the Graph and injects provider throttling (429 with
//! `Retry-After`) and transient server errors (500) on entity mutations while
//! forwarding everything else untouched. Delivery must absorb every injected
//! fault and still converge on the real Graph.
//!
//! This is fault injection against running services, not deterministic
//! simulation: the schedule is scripted and reproducible, but wall-clock
//! interleaving is real. Deterministic coverage of the same faults lives in
//! the hermetic crash-replay suite.

mod common;

use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::body::{to_bytes, Body};
use axum::extract::State;
use axum::http::{Request, Response, StatusCode};
use axum::routing::any;
use axum::Router;
use integrations_rs::config::Env;
use integrations_rs::orchestrator::{
    prepare_task, CommandRunState, InvocationV1, OperatorCommands, SubmissionTriggerV1,
};
use integrations_rs::yaml::Source;

const FORWARDED: &[&str] = &["HASH_WEB_ID", "HASH_ACTOR_ID", "INTEGRATIONS_BLOB_URL"];
const ENTITY_TYPE_VAR: &str = "INTEGRATIONS_GRAPH_CONTRACT_ENTITY_TYPE";
const NAME_PROPERTY_VAR: &str = "INTEGRATIONS_GRAPH_CONTRACT_NAME_PROPERTY";

/// Scripted fault schedule over entity mutations: of every three mutation
/// requests, the first is throttled, the second fails transiently, and only
/// the third reaches the Graph. Every mutation therefore needs three
/// deliveries' worth of retries.
struct ChaosProxy {
    upstream: String,
    client: reqwest::Client,
    mutations_seen: AtomicUsize,
    throttles_injected: AtomicUsize,
    failures_injected: AtomicUsize,
    forwarded_mutations: AtomicUsize,
}

impl ChaosProxy {
    fn should_intercept(method: &axum::http::Method, path: &str) -> bool {
        path == "/entities"
            && (method == axum::http::Method::POST || method == axum::http::Method::PATCH)
    }
}

async fn proxy_handler(
    State(proxy): State<Arc<ChaosProxy>>,
    request: Request<Body>,
) -> Response<Body> {
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let query = request
        .uri()
        .query()
        .map(|query| format!("?{query}"))
        .unwrap_or_default();

    if ChaosProxy::should_intercept(&method, &path) {
        let ordinal = proxy.mutations_seen.fetch_add(1, Ordering::SeqCst);
        match ordinal % 3 {
            0 => {
                proxy.throttles_injected.fetch_add(1, Ordering::SeqCst);
                tracing::info!(%method, %path, ordinal, "chaos proxy injected 429");
                return Response::builder()
                    .status(StatusCode::TOO_MANY_REQUESTS)
                    .header("Retry-After", "1")
                    .body(Body::from("chaos proxy injected throttle"))
                    .expect("build throttle response");
            }
            1 => {
                proxy.failures_injected.fetch_add(1, Ordering::SeqCst);
                tracing::info!(%method, %path, ordinal, "chaos proxy injected 500");
                return Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(Body::from("chaos proxy injected transient failure"))
                    .expect("build failure response");
            }
            _ => {
                proxy.forwarded_mutations.fetch_add(1, Ordering::SeqCst);
            }
        }
    }

    let (parts, body) = request.into_parts();
    let bytes = to_bytes(body, usize::MAX).await.expect("read request body");
    let mut upstream = proxy
        .client
        .request(
            parts.method.clone(),
            format!("{}{path}{query}", proxy.upstream),
        )
        .body(bytes);
    for (name, value) in &parts.headers {
        if name != axum::http::header::HOST && name != axum::http::header::CONTENT_LENGTH {
            upstream = upstream.header(name, value);
        }
    }
    let response = match upstream.send().await {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(%path, error = %error, "chaos proxy upstream forward failed");
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Body::from("chaos proxy upstream forward failed"))
                .expect("build bad-gateway response");
        }
    };
    let status = response.status();
    let headers = response.headers().clone();
    let body = response.bytes().await.unwrap_or_default();
    tracing::info!(method = %parts.method, %path, status = status.as_u16(), "chaos proxy forwarded");
    let mut builder = Response::builder().status(status);
    for (name, value) in &headers {
        if name != axum::http::header::TRANSFER_ENCODING
            && name != axum::http::header::CONTENT_LENGTH
        {
            builder = builder.header(name, value);
        }
    }
    builder
        .body(Body::from(body))
        .expect("build proxy response")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[allow(
    clippy::too_many_lines,
    reason = "one linear two-round chaos scenario reads better unfragmented"
)]
#[ignore = "requires a real Graph URL and a disposable or explicitly approved web"]
async fn real_graph_delivery_converges_under_injected_throttling_and_failures() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter("warn,graph_chaos_test=info,integrations_rs=info")
        .try_init();
    assert_eq!(
        std::env::var("INTEGRATIONS_GRAPH_CONTRACT").as_deref(),
        Ok("1"),
        "set INTEGRATIONS_GRAPH_CONTRACT=1 to confirm the target web is disposable"
    );
    let graph_url = std::env::var("HASH_GRAPH_URL").expect("HASH_GRAPH_URL is required");
    let mut variables = HashMap::new();
    for name in FORWARDED {
        let value = std::env::var(name)
            .unwrap_or_else(|_missing| panic!("{name} is required for the chaos contract"));
        variables.insert((*name).to_owned(), value);
    }
    let web_id = variables["HASH_WEB_ID"].clone();
    let entity_type = std::env::var(ENTITY_TYPE_VAR)
        .unwrap_or_else(|_missing| panic!("{ENTITY_TYPE_VAR} is required for the chaos contract"));
    let name_property = std::env::var(NAME_PROPERTY_VAR).unwrap_or_else(|_missing| {
        panic!("{NAME_PROPERTY_VAR} is required for the chaos contract")
    });

    // The scripted proxy is the only Graph endpoint the system under test
    // ever sees; all delivery traverses it.
    let proxy = Arc::new(ChaosProxy {
        upstream: graph_url.trim_end_matches('/').to_owned(),
        client: reqwest::Client::new(),
        mutations_seen: AtomicUsize::new(0),
        throttles_injected: AtomicUsize::new(0),
        failures_injected: AtomicUsize::new(0),
        forwarded_mutations: AtomicUsize::new(0),
    });
    let router = Router::new()
        .fallback(any(proxy_handler))
        .with_state(Arc::clone(&proxy));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind chaos proxy");
    let proxy_url = format!("http://{}", listener.local_addr().expect("proxy address"));
    let server = tokio::spawn(async move {
        axum::serve(listener, router)
            .await
            .expect("serve chaos proxy");
    });
    variables.insert("HASH_GRAPH_URL".to_owned(), proxy_url);

    let cache = tempfile::tempdir().expect("cache");
    let local = tempfile::tempdir().expect("local state");
    let attestation = local.path().join("release-attestation.json");
    let blob_url = variables["INTEGRATIONS_BLOB_URL"].clone();
    let attestation_bytes =
        common::valid_attestation_bytes(&blob_url, &variables["HASH_GRAPH_URL"]);
    std::fs::write(&attestation, attestation_bytes).expect("write chaos attestation");
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
    // The surface must not share local state with the workers; see the
    // graph contract test for why.
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

    let connector = format!("graph-chaos-{}", uuid::Uuid::new_v4());
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
                        "SELECT 'chaos-one' AS id, 'Chaos order round {round}' AS name"
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
        .expect("prepare chaos submission");
        let surface = OperatorCommands::open(&env).expect("open command surface");
        let submitted = surface.submit(prepared).await.expect("submit chaos run");
        tracing::info!(round, run_id = %submitted.run_id, "chaos round submitted; spawning worker");
        let mut worker = Command::new(env!("CARGO_BIN_EXE_integrations_rs"));
        for (name, value) in &variables {
            worker.env(name, value);
        }
        let mut worker = worker
            .args(["worker", "--activate-baseline"])
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("spawn chaos worker");
        let completed = common::wait_for(
            &surface,
            submitted.run_id.as_str(),
            Duration::from_secs(120),
            |status| {
                assert_ne!(
                    status.state,
                    CommandRunState::Terminated,
                    "chaos round {round} terminated: {:?}",
                    status.failure
                );
                status.state == CommandRunState::Completed
            },
        )
        .await;
        worker.kill().expect("stop chaos worker");
        let _ = worker.wait();
        assert_eq!(completed.attempt, 1, "round {round} completed on attempt 1");
    }

    let throttles = proxy.throttles_injected.load(Ordering::SeqCst);
    let failures = proxy.failures_injected.load(Ordering::SeqCst);
    let forwarded = proxy.forwarded_mutations.load(Ordering::SeqCst);
    assert!(
        throttles >= 1 && failures >= 1,
        "the schedule injected faults: {throttles} throttles, {failures} failures"
    );
    assert!(
        forwarded >= 2,
        "both rounds' mutations reached the real Graph: {forwarded} forwarded"
    );
    server.abort();
}
