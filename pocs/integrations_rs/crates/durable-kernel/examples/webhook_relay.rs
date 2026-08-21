//! A durable webhook relay in one file.
//!
//! Accepted webhooks live in a crash-safe journal, and an executor delivers
//! them over HTTP with bounded retries and dead-letters a delivery the
//! endpoint keeps refusing. The journal is the source of truth, and the
//! process is disposable.
//!
//! ```sh
//! cargo run -p durable-kernel --example webhook_relay -- crash   # die mid-delivery
//! cargo run -p durable-kernel --example webhook_relay            # recover, finish
//! cargo run -p durable-kernel --example webhook_relay -- reset   # wipe state
//! ```
//!
//! The demo endpoint refuses every webhook twice before accepting it, never
//! accepts the poison one, and persists its own state. Like a real external
//! service, it outlives the relay's crash.

#![allow(
    clippy::expect_used,
    clippy::print_stdout,
    clippy::significant_drop_tightening
)]

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use durable_kernel::domain::{
    effect_id, shard_of, DomainEvent, Executor, Fold, PartitionKey, Rejection, Retry, SimpleDomain,
};
use durable_kernel::runtime::{Kernel, KernelConfig, RunningKernel, Submitted};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};

const ENDPOINT: &str = "127.0.0.1:8929";
const MAX_ATTEMPTS: u32 = 4;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum RelayEvent {
    Accepted { delivery: String, body: String },
    AttemptFailed { delivery: String, attempt: u32 },
    Delivered { delivery: String, attempt: u32 },
    Abandoned { delivery: String, attempts: u32 },
}

impl DomainEvent for RelayEvent {
    fn name() -> &'static str {
        "webhook_relay_event"
    }

    fn partition(&self) -> PartitionKey {
        PartitionKey::parse("relay").expect("static key should parse")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Pending {
    body: String,
    failed_attempts: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct RelayQueue {
    pending: BTreeMap<String, Pending>,
    delivered: BTreeMap<String, u32>,
    abandoned: BTreeMap<String, u32>,
}

impl Fold<RelayEvent> for RelayQueue {
    fn validate(&self, event: &RelayEvent) -> Result<(), Rejection> {
        match event {
            RelayEvent::Accepted { delivery, .. }
                if self.delivered.contains_key(delivery)
                    || self.abandoned.contains_key(delivery) =>
            {
                Err(Rejection::new(format!("{delivery} already settled")))
            }
            RelayEvent::AttemptFailed { delivery, .. }
            | RelayEvent::Delivered { delivery, .. }
            | RelayEvent::Abandoned { delivery, .. }
                if !self.pending.contains_key(delivery) =>
            {
                Err(Rejection::new(format!("{delivery} is not pending")))
            }
            _ => Ok(()),
        }
    }

    fn apply(&mut self, event: &RelayEvent) {
        match event {
            RelayEvent::Accepted { delivery, body } => {
                self.pending
                    .entry(delivery.clone())
                    .or_insert_with(|| Pending {
                        body: body.clone(),
                        failed_attempts: 0,
                    });
            }
            RelayEvent::AttemptFailed { delivery, attempt } => {
                if let Some(pending) = self.pending.get_mut(delivery) {
                    pending.failed_attempts = pending.failed_attempts.max(*attempt);
                }
            }
            RelayEvent::Delivered { delivery, attempt } => {
                self.pending.remove(delivery);
                self.delivered.insert(delivery.clone(), *attempt);
            }
            RelayEvent::Abandoned { delivery, attempts } => {
                self.pending.remove(delivery);
                self.abandoned.insert(delivery.clone(), *attempts);
            }
        }
    }
}

struct RelayDomain;

impl SimpleDomain for RelayDomain {
    type Event = RelayEvent;
    type Projection = RelayQueue;
}

#[derive(Debug, Clone, Serialize)]
struct DeliveryAttempt {
    delivery: String,
    body: String,
    attempt: u32,
}

struct HttpDeliverer {
    /// Exit after the endpoint accepts a webhook but before its completion
    /// event reaches the journal. This is the at-least-once window.
    crash_on_delivery: bool,
}

impl Executor<RelayDomain> for HttpDeliverer {
    type Effect = DeliveryAttempt;

    fn plan(&self, queue: &RelayQueue) -> Vec<DeliveryAttempt> {
        queue
            .pending
            .iter()
            .map(|(delivery, pending)| DeliveryAttempt {
                delivery: delivery.clone(),
                body: pending.body.clone(),
                attempt: pending.failed_attempts + 1,
            })
            .collect()
    }

    async fn execute(&self, effect: &DeliveryAttempt) -> Result<Vec<RelayEvent>, Retry> {
        let key = effect_id(effect).expect("effect should serialize");
        let delivery = effect.delivery.clone();
        match http_post(&effect.body, &key).await {
            Ok(status) if (200..300).contains(&status) => {
                if self.crash_on_delivery {
                    println!(
                        "\nThe endpoint accepted {delivery}, but its completion did not reach the journal."
                    );
                    println!("Run the example again to recover.\n");
                    std::process::exit(1);
                }
                println!(
                    "{delivery} was delivered on attempt {} of {}.",
                    effect.attempt, MAX_ATTEMPTS
                );
                Ok(vec![RelayEvent::Delivered {
                    delivery,
                    attempt: effect.attempt,
                }])
            }
            Ok(_status) if effect.attempt >= MAX_ATTEMPTS => {
                println!(
                    "{delivery} was dead-lettered after {} attempts.",
                    effect.attempt
                );
                Ok(vec![RelayEvent::Abandoned {
                    delivery,
                    attempts: effect.attempt,
                }])
            }
            Ok(status) => {
                println!(
                    "{delivery} returned HTTP {status} on attempt {} and will retry.",
                    effect.attempt
                );
                Ok(vec![RelayEvent::AttemptFailed {
                    delivery,
                    attempt: effect.attempt,
                }])
            }
            Err(error) => Err(Retry {
                reason: format!("endpoint unreachable: {error}"),
                after: Some(Duration::from_millis(250)),
            }),
        }
    }
}

async fn http_post(body: &str, idempotency_key: &str) -> std::io::Result<u16> {
    let mut stream = TcpStream::connect(ENDPOINT).await?;
    let request = format!(
        "POST /hooks HTTP/1.1\r\nHost: {ENDPOINT}\r\nIdempotency-Key: {idempotency_key}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes()).await?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await?;
    std::str::from_utf8(&response)
        .ok()
        .and_then(|text| text.split_whitespace().nth(1))
        .and_then(|code| code.parse().ok())
        .ok_or_else(|| std::io::Error::other("malformed response"))
}

#[derive(Default, Serialize, Deserialize)]
struct EndpointState {
    attempts: BTreeMap<String, u32>,
    accepted_keys: BTreeSet<String>,
}

async fn run_endpoint(listener: TcpListener) {
    let path = state_dir().join("endpoint.json");
    let state: EndpointState = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let state = Arc::new(Mutex::new(state));
    loop {
        let Ok((mut socket, _peer)) = listener.accept().await else {
            return;
        };
        let state = Arc::clone(&state);
        let path = path.clone();
        tokio::spawn(async move {
            let mut request = vec![0_u8; 4096];
            let Ok(length) = socket.read(&mut request).await else {
                return;
            };
            let text = String::from_utf8_lossy(&request[..length]);
            let key = text
                .lines()
                .find_map(|line| line.strip_prefix("Idempotency-Key: "))
                .unwrap_or("unkeyed")
                .to_owned();
            let body = text.split("\r\n\r\n").nth(1).unwrap_or("").to_owned();
            let status = {
                let mut state = state.lock().expect("endpoint mutex should not be poisoned");
                let status = if state.accepted_keys.contains(&key) {
                    println!("The endpoint reused the accepted result for {body}.");
                    200
                } else if body.contains("poison") {
                    503
                } else {
                    let seen = state.attempts.entry(body.clone()).or_insert(0);
                    *seen += 1;
                    if *seen >= 3 {
                        state.accepted_keys.insert(key);
                        200
                    } else {
                        503
                    }
                };
                let _ = std::fs::write(
                    &path,
                    serde_json::to_vec(&*state).expect("state should serialize"),
                );
                status
            };
            let _ = socket
                .write_all(
                    format!(
                        "HTTP/1.1 {status} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    )
                    .as_bytes(),
                )
                .await;
        });
    }
}

fn state_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/webhook_relay_demo")
}

async fn report_recovery(running: &RunningKernel<RelayDomain>, key: &PartitionKey) {
    let recovered = running
        .read(key, |queue: &RelayQueue| {
            let failed: u32 = queue.pending.values().map(|p| p.failed_attempts).sum();
            (
                queue.pending.len(),
                queue.delivered.len(),
                queue.abandoned.len(),
                failed,
            )
        })
        .await
        .expect("queue read should succeed");
    let snapshot = running
        .recovery_snapshots()
        .values()
        .next()
        .copied()
        .flatten();
    match recovered {
        (0, 0, 0, _) => println!("No journal state was recovered."),
        (pending, delivered, abandoned, failed) => println!(
            "Recovered {pending} pending deliveries with {failed} failed attempts. \
             {delivered} were delivered and {abandoned} were dead-lettered{}.",
            snapshot.map_or_else(String::new, |sequence| format!(
                " Recovery used snapshot sequence {sequence}"
            )),
        ),
    }
}

const WEBHOOKS: [(&str, &str); 6] = [
    ("delivery-1", r#"{"order":1}"#),
    ("delivery-2", r#"{"order":2}"#),
    ("delivery-3", r#"{"order":3}"#),
    ("delivery-4", r#"{"order":4}"#),
    ("delivery-5", r#"{"order":5}"#),
    ("poison-pill", r#"{"poison":true}"#),
];

async fn submit_demo_webhooks(running: &RunningKernel<RelayDomain>) {
    let mut accepted = 0;
    let mut deduplicated = 0;
    for (delivery, body) in WEBHOOKS {
        let event = RelayEvent::Accepted {
            delivery: delivery.to_owned(),
            body: body.to_owned(),
        };
        match running.submit(event).await {
            Ok(Submitted::Applied) => accepted += 1,
            Ok(Submitted::AlreadyDurable) => deduplicated += 1,
            Err(error) => println!("The webhook was rejected with {error}."),
        }
    }
    println!("Accepted {accepted} new webhooks. {deduplicated} were already durable.\n");
}

#[tokio::main]
async fn main() {
    let mode = std::env::args().nth(1).unwrap_or_default();
    if mode == "reset" {
        let _ = std::fs::remove_dir_all(state_dir());
        println!("The example state was removed.");
        return;
    }

    println!("Durable webhook relay");
    println!("The journal is stored at target/webhook_relay_demo.");
    let listener = TcpListener::bind(ENDPOINT)
        .await
        .expect("demo endpoint should bind");
    tokio::spawn(run_endpoint(listener));

    let key = PartitionKey::parse("relay").expect("static key should parse");
    let mut config = KernelConfig::new("webhookrelay", format!("file://{}", state_dir().display()));
    config.shards = vec![u16::from(shard_of(&key).get())];
    config.snapshot_every_events = 8;
    config.poll_interval = Duration::from_millis(50);

    let kernel = Kernel::open(config)
        .expect("kernel should open")
        .register::<RelayDomain>()
        .expect("relay domain should register");
    let running = kernel
        .start(HttpDeliverer {
            crash_on_delivery: mode == "crash",
        })
        .await
        .expect("kernel should start");

    report_recovery(&running, &key).await;
    submit_demo_webhooks(&running).await;

    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    loop {
        let pending = running
            .read(&key, |queue: &RelayQueue| queue.pending.len())
            .await
            .expect("queue read should succeed");
        if pending == 0 {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "demo did not settle in 30s"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let settled = running
        .read(&key, |queue: &RelayQueue| {
            let mut lines: Vec<String> = queue
                .delivered
                .iter()
                .map(|(id, attempts)| format!("{id} was delivered on attempt {attempts}."))
                .collect();
            lines.extend(queue.abandoned.iter().map(|(id, attempts)| {
                format!("{id} was dead-lettered after {attempts} attempts.")
            }));
            lines
        })
        .await
        .expect("summary read should succeed");
    println!("\nFinal delivery outcomes");
    for line in settled {
        println!("{line}");
    }
    if mode.is_empty() {
        println!("\nRun with `-- crash` to stop the relay during delivery.");
        println!("Run it again without an argument to finish the interrupted work.");
        println!("Run with `-- reset` to remove the example state.");
    }
    running.shutdown().await.expect("shutdown should be clean");
}
