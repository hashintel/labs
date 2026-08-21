//! The kernel runtime opens a configured [`Kernel`], registers a domain, and
//! starts its executor. The resulting [`RunningKernel`] accepts submissions,
//! serves reads, and supports an orderly shutdown.
//!
//! Each shard driver recovers its projection, reads that state, plans work,
//! executes the work, and appends the returned events. There is no durable
//! effect bookkeeping. Completion is represented in the domain events an effect
//! returns, and a per-session executed set prevents hot loops. The
//! `Executor` contract in [`crate::domain`] describes this requirement.
//!
//! The coordination model runs exactly one process per shard set. The SlateDB
//! writer epoch fences a misdeployment because a second writer makes the first
//! fail closed. There is no lease arbitration, so two processes on one
//! shard fence each other instead of taking turns.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::num::NonZeroUsize;
use std::sync::Arc;
use std::time::Duration;

use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::domain::{self, effect_id, EventRecordV1, Executor, Hosted, PartitionKey, SimpleDomain};
use crate::keyspace::{Keyspace, Namespace};
use crate::registry::CompatError;
use crate::routing::Shard;
use crate::shard_log::{
    LogStorageOptions, OpenedShard, RecoveredShard, ShardCommandConfig, ShardCommandError,
    ShardCommandErrorKind, ShardCommandHandle, ShardCommandOutcome, ShardLogLocation,
    StateChangeFeed,
};

/// Every variant is kernel-owned, so no internal error type or identifier
/// escapes to a library user.
#[derive(Debug)]
pub enum KernelError {
    Config(String),
    Registration(String),
    InvalidEvent(String),
    Storage(String),
    NotOwned { shard: u16 },
    Rejected { message: String },
    Internal(String),
}

impl fmt::Display for KernelError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Config(message) => write!(formatter, "kernel configuration invalid: {message}"),
            Self::Registration(message) => {
                write!(formatter, "kernel registration failed: {message}")
            }
            Self::InvalidEvent(message) => write!(formatter, "kernel record invalid: {message}"),
            Self::Storage(message) => write!(formatter, "kernel storage failed: {message}"),
            Self::NotOwned { shard } => write!(
                formatter,
                "partition routes to shard {shard}, which this kernel does not own"
            ),
            Self::Rejected { message } => write!(formatter, "event rejected: {message}"),
            Self::Internal(message) => write!(formatter, "kernel internal failure: {message}"),
        }
    }
}

impl std::error::Error for KernelError {}

#[derive(Debug, Clone)]
pub struct KernelConfig {
    /// Instance namespace that provides the validated root prefix for every
    /// key and log.
    pub name: String,
    /// Storage location expressed as a local file URL or an S3 URL.
    pub blob_url: String,
    pub aws_region: Option<String>,
    /// Shards this process owns. Partitions hashing elsewhere are refused.
    pub shards: Vec<u16>,
    /// Commit a snapshot after this many folded events. `0` disables.
    pub snapshot_every_events: u64,
    /// Driver idle wake-up that also provides the default effect retry backoff.
    pub poll_interval: Duration,
    pub channel_capacity: NonZeroUsize,
    pub safe_append_retries: u32,
    pub block_cache_bytes: u64,
    pub meta_cache_bytes: u64,
}

impl KernelConfig {
    pub fn new(name: impl Into<String>, blob_url: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            blob_url: blob_url.into(),
            aws_region: None,
            shards: Vec::new(),
            snapshot_every_events: 512,
            poll_interval: Duration::from_millis(250),
            channel_capacity: NonZeroUsize::new(64).unwrap_or(NonZeroUsize::MIN),
            safe_append_retries: 3,
            block_cache_bytes: 64 * 1024 * 1024,
            meta_cache_bytes: 8 * 1024 * 1024,
        }
    }
}

/// An opened kernel instance whose storage is validated and whose names can
/// be registered before execution starts.
pub struct Kernel {
    config: KernelConfig,
    keyspace: Keyspace,
    shards: Vec<Shard>,
}

impl Kernel {
    pub fn open(config: KernelConfig) -> Result<Self, KernelError> {
        let namespace = Namespace::parse(&config.name)
            .map_err(|error| KernelError::Config(error.to_string()))?;
        if config.shards.is_empty() {
            return Err(KernelError::Config(
                "at least one owned shard is required".to_owned(),
            ));
        }
        let shards = config
            .shards
            .iter()
            .map(|&value| Shard::try_from(value))
            .collect::<Result<BTreeSet<_>, _>>()
            .map_err(|error| KernelError::Config(error.to_string()))?
            .into_iter()
            .collect();
        Ok(Self {
            keyspace: Keyspace::new(namespace),
            config,
            shards,
        })
    }

    /// Registers the domain's wire names and remains chainable before `start`.
    pub fn register<S: SimpleDomain>(self) -> Result<Self, KernelError> {
        domain::register::<S>().map_err(|error| KernelError::Registration(error.to_string()))?;
        Ok(self)
    }

    /// Recovers every owned shard and starts one effect driver per shard.
    pub async fn start<S, X>(&self, executor: X) -> Result<RunningKernel<S>, KernelError>
    where
        S: SimpleDomain,
        X: Executor<S>,
    {
        let executor = Arc::new(executor);
        let shutdown = CancellationToken::new();
        let storage = LogStorageOptions {
            blob_url: self.config.blob_url.clone(),
            aws_region: self.config.aws_region.clone(),
            shard_capacity: self.shards.len() as u64,
            block_cache_bytes: self.config.block_cache_bytes,
            meta_cache_bytes: self.config.meta_cache_bytes,
        };
        let mut shards = BTreeMap::new();
        let mut recovered_snapshots = BTreeMap::new();
        let mut drivers = Vec::new();
        let mut loops = Vec::new();
        for &shard in &self.shards {
            let location =
                ShardLogLocation::for_kernel(shard, &self.keyspace.shard_log(shard), &storage)
                    .map_err(|error| KernelError::Storage(format!("{error:?}")))?;
            let opened = OpenedShard::open(location).await.map_err(command_failure)?;
            let recovered: RecoveredShard<Hosted<S>> = opened
                .recover_with_snapshots(&())
                .await
                .map_err(command_failure)?;
            let started = recovered.enable(ShardCommandConfig::new(
                self.config.channel_capacity,
                self.config.safe_append_retries,
            ));
            let handle = started.handle.clone();
            recovered_snapshots.insert(shard.get(), started.recovery.snapshot_through_log_sequence);
            drivers.push(tokio::spawn(drive_shard::<S, X>(
                handle.clone(),
                started.state_changes,
                Arc::clone(&executor),
                DriverSettings {
                    poll_interval: self.config.poll_interval,
                    snapshot_every_events: self.config.snapshot_every_events,
                },
                shutdown.clone(),
            )));
            loops.push(started.task);
            shards.insert(shard.get(), handle);
        }
        Ok(RunningKernel {
            shards,
            recovered_snapshots,
            drivers,
            loops,
            shutdown,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Submitted {
    Applied,
    AlreadyDurable,
}

pub struct RunningKernel<S: SimpleDomain> {
    shards: BTreeMap<u8, ShardCommandHandle<Hosted<S>>>,
    recovered_snapshots: BTreeMap<u8, Option<u64>>,
    drivers: Vec<JoinHandle<Result<(), KernelError>>>,
    loops: Vec<JoinHandle<Result<(), ShardCommandError>>>,
    shutdown: CancellationToken,
}

impl<S: SimpleDomain> RunningKernel<S> {
    fn handle_for(
        &self,
        key: &PartitionKey,
    ) -> Result<&ShardCommandHandle<Hosted<S>>, KernelError> {
        let shard = domain::shard_of(key);
        self.shards.get(&shard.get()).ok_or(KernelError::NotOwned {
            shard: u16::from(shard.get()),
        })
    }

    /// Validates and durably appends one event. Idempotent by content
    /// identity. A rejection carries the fold's reason.
    pub async fn submit(&self, event: S::Event) -> Result<Submitted, KernelError> {
        let record = EventRecordV1::new(event).map_err(invalid_event)?;
        let handle = self.handle_for(&record.partition)?;
        match handle.propose(record).await {
            Ok(ShardCommandOutcome::Applied { .. }) => Ok(Submitted::Applied),
            Ok(ShardCommandOutcome::AlreadyDurable { .. }) => Ok(Submitted::AlreadyDurable),
            Err(error) if error.kind == ShardCommandErrorKind::InvalidCandidate => {
                Err(KernelError::Rejected {
                    message: error.message,
                })
            }
            Err(error) => Err(command_failure(error)),
        }
    }

    /// Runs a read-only closure against the partition's fold state.
    pub async fn read<R, F>(&self, key: &PartitionKey, read: F) -> Result<R, KernelError>
    where
        R: Send + 'static,
        F: FnOnce(&S::Projection) -> R + Send + 'static,
    {
        let handle = self.handle_for(key)?;
        handle
            .read(move |projection| read(projection.domain()))
            .await
            .map_err(command_failure)
    }

    /// Snapshot sequence restored during recovery for each shard. A value of
    /// `None` means recovery replayed the full journal.
    pub fn recovery_snapshots(&self) -> &BTreeMap<u8, Option<u64>> {
        &self.recovered_snapshots
    }

    pub async fn shutdown(self) -> Result<(), KernelError> {
        self.shutdown.cancel();
        let mut first_error = None;
        for driver in self.drivers {
            match driver.await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    first_error.get_or_insert(error);
                }
                Err(join_error) => {
                    first_error.get_or_insert(KernelError::Internal(join_error.to_string()));
                }
            }
        }
        for handle in self.shards.values() {
            // A loop that already stopped reports Closed here, which is an
            // expected outcome.
            let _ = handle.shutdown().await;
        }
        for task in self.loops {
            match task.await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    first_error.get_or_insert(command_failure(error));
                }
                Err(join_error) => {
                    first_error.get_or_insert(KernelError::Internal(join_error.to_string()));
                }
            }
        }
        match first_error {
            None => Ok(()),
            Some(error) => Err(error),
        }
    }
}

struct DriverSettings {
    poll_interval: Duration,
    snapshot_every_events: u64,
}

/// Converts an error into a normal exit when it only reflects shutdown.
fn command_failure(error: ShardCommandError) -> KernelError {
    KernelError::Internal(error.to_string())
}

fn invalid_event(error: CompatError) -> KernelError {
    KernelError::InvalidEvent(error.to_string())
}

fn settle_driver_error(
    error: ShardCommandError,
    shutdown: &CancellationToken,
) -> Result<(), KernelError> {
    if shutdown.is_cancelled() || error.kind == ShardCommandErrorKind::Closed {
        Ok(())
    } else {
        Err(command_failure(error))
    }
}

async fn drive_shard<S, X>(
    handle: ShardCommandHandle<Hosted<S>>,
    mut state_changes: StateChangeFeed<PartitionKey>,
    executor: Arc<X>,
    settings: DriverSettings,
    shutdown: CancellationToken,
) -> Result<(), KernelError>
where
    S: SimpleDomain,
    X: Executor<S>,
{
    let mut executed: BTreeSet<String> = BTreeSet::new();
    loop {
        if shutdown.is_cancelled() {
            return Ok(());
        }
        let planner = Arc::clone(&executor);
        let effects = match handle
            .read(move |projection| planner.plan(projection.domain()))
            .await
        {
            Ok(effects) => effects,
            Err(error) => return settle_driver_error(error, &shutdown),
        };
        let mut progressed = false;
        for effect in effects {
            if shutdown.is_cancelled() {
                return Ok(());
            }
            let id = effect_id(&effect)
                .map_err(|error| KernelError::Internal(format!("effect identity: {error}")))?;
            if executed.contains(&id) {
                continue;
            }
            match executor.execute(&effect).await {
                Ok(events) => {
                    executed.insert(id);
                    progressed = true;
                    for event in events {
                        let record = EventRecordV1::new(event).map_err(invalid_event)?;
                        match handle.propose(record).await {
                            Ok(_outcome) => {}
                            Err(error) if error.kind == ShardCommandErrorKind::InvalidCandidate => {
                                // Completion events must validate as part of
                                // the executor contract.
                                // The session set stops hot re-execution until the next restart.
                                tracing::warn!(
                                    error = %error,
                                    "effect completion event was rejected"
                                );
                            }
                            Err(error) => return settle_driver_error(error, &shutdown),
                        }
                    }
                }
                Err(retry) => {
                    tracing::debug!(reason = %retry.reason, "effect execution retries later");
                    tokio::select! {
                        () = shutdown.cancelled() => return Ok(()),
                        () = tokio::time::sleep(
                            retry.after.unwrap_or(settings.poll_interval),
                        ) => {}
                    }
                }
            }
        }
        maybe_snapshot(&handle, settings.snapshot_every_events).await;
        if !progressed {
            tokio::select! {
                () = shutdown.cancelled() => return Ok(()),
                _changed = state_changes.receiver.recv() => {}
                () = tokio::time::sleep(settings.poll_interval) => {}
            }
        }
    }
}

/// Snapshotting is best effort because a failed or skipped snapshot only
/// means longer replay.
async fn maybe_snapshot<S: SimpleDomain>(
    handle: &ShardCommandHandle<Hosted<S>>,
    every_events: u64,
) {
    if every_events == 0 {
        return;
    }
    match handle.capture_snapshot(every_events).await {
        Ok(Some(payload)) => {
            let record = payload.into_record(chrono::Utc::now().to_rfc3339());
            if let Err(error) = handle.commit_snapshot(record).await {
                tracing::warn!(error = %error, "snapshot commit failed; replay stays longer");
            }
        }
        Ok(None) => {}
        Err(error) => {
            tracing::debug!(error = %error, "snapshot capture unavailable");
        }
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used, clippy::panic)]
mod tests {
    use std::sync::Mutex;

    use serde::{Deserialize, Serialize};

    use super::*;
    use crate::domain::{DomainEvent, Fold, Rejection, Retry};

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(tag = "kind", rename_all = "snake_case")]
    enum RtEvent {
        Incremented {
            counter: String,
            request: u32,
            amount: u64,
        },
        Archived {
            counter: String,
            total: u64,
        },
    }

    impl DomainEvent for RtEvent {
        fn name() -> &'static str {
            "runtime_counter_event"
        }

        fn partition(&self) -> PartitionKey {
            let counter = match self {
                Self::Incremented { counter, .. } | Self::Archived { counter, .. } => counter,
            };
            PartitionKey::parse(counter.as_str()).expect("test counters should be valid keys")
        }
    }

    #[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
    struct RtCounters {
        totals: BTreeMap<String, u64>,
        archived: Vec<u64>,
    }

    impl Fold<RtEvent> for RtCounters {
        fn validate(&self, event: &RtEvent) -> Result<(), Rejection> {
            match event {
                RtEvent::Incremented { amount: 0, .. } => {
                    Err(Rejection::new("increment must be nonzero"))
                }
                RtEvent::Incremented { .. } | RtEvent::Archived { .. } => Ok(()),
            }
        }

        fn apply(&mut self, event: &RtEvent) {
            match event {
                RtEvent::Incremented {
                    counter, amount, ..
                } => {
                    let total = self.totals.entry(counter.clone()).or_default();
                    *total = total.saturating_add(*amount);
                }
                RtEvent::Archived { counter, total } => {
                    self.totals.remove(counter);
                    self.archived.push(*total);
                }
            }
        }
    }

    struct RtDomain;

    impl SimpleDomain for RtDomain {
        type Event = RtEvent;
        type Projection = RtCounters;
    }

    #[derive(Debug, Clone, PartialEq, Serialize)]
    struct ArchiveEffect {
        counter: String,
        total: u64,
    }

    /// Archives any counter at or over the threshold. The returned
    /// `Archived` event removes the counter, so `plan` reaches a fixpoint.
    struct ArchiveExecutor {
        threshold: u64,
        external: Arc<Mutex<Vec<(String, u64)>>>,
    }

    impl Executor<RtDomain> for ArchiveExecutor {
        type Effect = ArchiveEffect;

        fn plan(&self, projection: &RtCounters) -> Vec<ArchiveEffect> {
            projection
                .totals
                .iter()
                .filter(|(_counter, &total)| total >= self.threshold)
                .map(|(counter, &total)| ArchiveEffect {
                    counter: counter.clone(),
                    total,
                })
                .collect()
        }

        async fn execute(&self, effect: &ArchiveEffect) -> Result<Vec<RtEvent>, Retry> {
            self.external
                .lock()
                .expect("test mutex should not be poisoned")
                .push((effect.counter.clone(), effect.total));
            Ok(vec![RtEvent::Archived {
                counter: effect.counter.clone(),
                total: effect.total,
            }])
        }
    }

    fn increment(counter: &str, request: u32, amount: u64) -> RtEvent {
        RtEvent::Incremented {
            counter: counter.to_owned(),
            request,
            amount,
        }
    }

    fn config(blob_url: &str, shard: u8) -> KernelConfig {
        let mut config = KernelConfig::new("kernelapp", blob_url);
        config.aws_region = std::env::var("AWS_REGION")
            .or_else(|_missing| std::env::var("AWS_DEFAULT_REGION"))
            .ok();
        config.shards = vec![u16::from(shard)];
        config.poll_interval = Duration::from_millis(20);
        config.snapshot_every_events = 2;
        config
    }

    async fn wait_until<F>(mut condition: F)
    where
        F: AsyncFnMut() -> bool,
    {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if condition().await {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("condition should hold within the timeout");
    }

    #[tokio::test]
    async fn kernel_end_to_end_executes_effects_once_and_recovers() {
        let blob = tempfile::tempdir().expect("blob root tempdir should be created");
        exercise_end_to_end(&format!("file://{}", blob.path().display())).await;
    }

    /// Runs the same sequence over an S3-compatible endpoint. The SlateDB shard
    /// log, snapshots, and artifact store all use object storage.
    #[tokio::test]
    #[ignore = "requires an S3-compatible endpoint and INTEGRATIONS_KERNEL_S3_URL=s3://bucket/scratch-prefix"]
    async fn kernel_end_to_end_on_s3() {
        let base_url = std::env::var("INTEGRATIONS_KERNEL_S3_URL")
            .expect("INTEGRATIONS_KERNEL_S3_URL should be set to s3://bucket/scratch-prefix");
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock should be after the epoch")
            .as_nanos();
        let run_url = format!(
            "{}/kernel-e2e-{}-{}",
            base_url.trim_end_matches('/'),
            std::process::id(),
            unique
        );
        exercise_end_to_end(&run_url).await;
    }

    async fn exercise_end_to_end(blob_url: &str) {
        let orders = PartitionKey::parse("orders").expect("key should be valid");
        let shard = domain::shard_of(&orders);
        let external = Arc::new(Mutex::new(Vec::new()));

        let kernel = Kernel::open(config(blob_url, shard.get()))
            .expect("kernel should open")
            .register::<RtDomain>()
            .expect("domain should register");
        let running = kernel
            .start(ArchiveExecutor {
                threshold: 10,
                external: Arc::clone(&external),
            })
            .await
            .expect("kernel should start");

        assert_eq!(
            running
                .submit(increment("orders", 1, 6))
                .await
                .expect("submit should succeed"),
            Submitted::Applied
        );
        assert_eq!(
            running
                .submit(increment("orders", 2, 5))
                .await
                .expect("submit should succeed"),
            Submitted::Applied
        );
        wait_until(async || {
            running
                .read(&orders, |projection| projection.archived.clone())
                .await
                .expect("read should succeed")
                == vec![11]
        })
        .await;
        assert_eq!(
            *external.lock().expect("test mutex should not be poisoned"),
            vec![("orders".to_owned(), 11)],
            "the effect must execute exactly once in this session"
        );
        assert_eq!(
            running
                .read(&orders, |projection| projection.totals.clone())
                .await
                .expect("read should succeed"),
            BTreeMap::new(),
            "archiving resets the counter"
        );
        assert_eq!(
            running
                .submit(increment("orders", 1, 6))
                .await
                .expect("resubmit should succeed"),
            Submitted::AlreadyDurable
        );
        let rejection = running
            .submit(increment("orders", 9, 0))
            .await
            .expect_err("zero increment should be rejected");
        assert!(rejection.to_string().contains("increment must be nonzero"));
        running.shutdown().await.expect("shutdown should succeed");

        // A fresh executor starts with state recovered through the snapshot.
        // The archived counter plans no work, so nothing executes again.
        let external_after = Arc::new(Mutex::new(Vec::new()));
        let kernel = Kernel::open(config(blob_url, shard.get()))
            .expect("kernel should reopen")
            .register::<RtDomain>()
            .expect("domain should re-register");
        let running = kernel
            .start(ArchiveExecutor {
                threshold: 10,
                external: Arc::clone(&external_after),
            })
            .await
            .expect("kernel should restart");
        assert!(
            running.recovery_snapshots()[&shard.get()].is_some(),
            "recovery must adopt a committed snapshot"
        );
        assert_eq!(
            running
                .read(&orders, |projection| projection.archived.clone())
                .await
                .expect("read after restart should succeed"),
            vec![11]
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(
            external_after
                .lock()
                .expect("test mutex should not be poisoned")
                .is_empty(),
            "a folded completion must not re-execute after restart"
        );
        running
            .shutdown()
            .await
            .expect("shutdown after restart should succeed");
    }

    #[tokio::test]
    async fn foreign_partitions_are_not_owned() {
        let blob = tempfile::tempdir().expect("blob root tempdir should be created");
        let blob_url = format!("file://{}", blob.path().display());
        let orders = PartitionKey::parse("orders").expect("key should be valid");
        let shard = domain::shard_of(&orders);
        let foreign = (0..1024_u32)
            .map(|attempt| format!("other-{attempt}"))
            .find(|candidate| {
                domain::shard_of(
                    &PartitionKey::parse(candidate.as_str()).expect("key should be valid"),
                ) != shard
            })
            .expect("some key should route elsewhere");

        let kernel = Kernel::open(config(&blob_url, shard.get()))
            .expect("kernel should open")
            .register::<RtDomain>()
            .expect("domain should register");
        let running = kernel
            .start(ArchiveExecutor {
                threshold: u64::MAX,
                external: Arc::new(Mutex::new(Vec::new())),
            })
            .await
            .expect("kernel should start");
        let error = running
            .submit(increment(&foreign, 1, 1))
            .await
            .expect_err("foreign partition should be refused");
        assert!(matches!(error, KernelError::NotOwned { .. }));
        running.shutdown().await.expect("shutdown should succeed");
    }
}
