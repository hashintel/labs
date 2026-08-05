//! Single-process V1 worker composition.
//!
//! Shards are discovered from immutable markers, acquired through the full
//! lease handshake, and recovered before their scheduler is exposed. A lost
//! shard is removed and can only return through a fresh acquisition.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use error_stack::{Report, ResultExt as _};
use futures::{stream, StreamExt as _};

use super::activation::{self, ActivationReadiness};
use super::shard::{
    self, PacedChunkPermit, RecoveryScheduler, RenewingShard, SchedulerAction, ShardAcquisition,
    ShardWorkspaceCleaner, WorkAdmission,
};
use super::shard_log::{ShardLogLocation, WorkRecoveryIntent};
use super::state::{self, JournalStateAuthority, StateAuthority};
use super::worker_dispatch::{
    Executor, LaneDisposition, WorkerDispatchOutcome, WorkerDispatcher,
};
use crate::config::Env;
use crate::graph::client::{HttpClient, HttpClientOptions};
use crate::graph::executor::{
    BoundedEffectExecutor, ChunkBudget, EffectLaneRegistry, GraphEffectTransport,
    ShardWorkCursorCommitter, TokioRetryDelay, WorkCursorCommitter,
};
use crate::local_disk::{LocalDiskError, WorkspaceBudget};
use crate::orchestrator::routing::Shard;
use crate::runtime_settings::RuntimeSettingsCache;
use crate::throttle::coordinator::{GraphTokenCoordinator, TurnTokens};
use crate::throttle::drr::{LaneAfterTurn, LaneClass, RunnableLane};
use crate::throttle::rate::{FairAdmission, FairDecision};
use crate::throttle::{GraphRequestCharge as _, RateLimiter, Throttle};
use tokio_util::sync::CancellationToken;

const DISCOVERY_INTERVAL: Duration = Duration::from_secs(2);
const ACTIVE_POLL_INTERVAL: Duration = Duration::from_millis(25);
const IDLE_POLL_INTERVAL: Duration = Duration::from_millis(250);
/// How long a known shard may stay unowned across acquisition rounds before
/// aggregate coverage health is considered degraded. Contention and CAS
/// conflicts within this window are ordinary fleet behavior.
const ACQUISITION_GRACE: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkerError {
    Activation,
    LocalDisk,
    ShardLocation,
    ShardHandshake,
    Planner,
    Executor,
    Shutdown,
}

impl fmt::Display for WorkerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Activation => "worker activation readiness failed",
            Self::LocalDisk => "worker local disk initialization failed",
            Self::ShardLocation => "worker shard storage configuration failed",
            Self::ShardHandshake => "worker shard acquisition handshake failed",
            Self::Planner => "worker run planner construction failed",
            Self::Executor => "worker effect executor construction failed",
            Self::Shutdown => "worker graceful shutdown failed",
        })
    }
}

impl std::error::Error for WorkerError {}

struct ScavengingCleaner {
    workspaces: Arc<WorkspaceBudget>,
}

#[async_trait]
impl ShardWorkspaceCleaner for ScavengingCleaner {
    async fn discard(&self, _location: &ShardLogLocation) -> Result<(), Report<LocalDiskError>> {
        self.workspaces.scavenge_abandoned().map(|_removed| ())
    }
}

struct ShardRuntime {
    renewing: RenewingShard,
    scheduler: RecoveryScheduler,
    /// The kernel/domain execution seam; integrations is the first impl.
    dispatcher: Box<dyn Executor>,
    _state_hint_task: tokio::task::JoinHandle<()>,
    snapshot_interval: Duration,
    snapshot_events: u64,
    next_snapshot_at: tokio::time::Instant,
}

pub async fn run(env: &Env) -> Result<(), Report<WorkerError>> {
    let shutdown = CancellationToken::new();
    let worker = Box::pin(run_until(env, shutdown.clone()));
    tokio::pin!(worker);
    tokio::select! {
        result = &mut worker => result,
        signal = tokio::signal::ctrl_c() => {
            signal.change_context(WorkerError::Shutdown)?;
            shutdown.cancel();
            worker.await
        }
    }
}

pub async fn run_until(env: &Env, shutdown: CancellationToken) -> Result<(), Report<WorkerError>> {
    let readiness = activation::activate(env)
        .await
        .change_context(WorkerError::Activation)?;
    let known_shard_count = u32::try_from(readiness.known_shards.len())
        .map_err(|_error| Report::new(WorkerError::Activation))?;
    let runtime_settings =
        RuntimeSettingsCache::open(env).change_context(WorkerError::Activation)?;
    let workspace_root =
        std::path::PathBuf::from(crate::config::runner_base_dir(env)).join("workspaces");
    let workspaces = Arc::new(
        WorkspaceBudget::new(
            &workspace_root,
            crate::config::local_disk_limits(env)
                .map_err(|message| Report::new(WorkerError::LocalDisk).attach_printable(message))?,
        )
        .change_context(WorkerError::LocalDisk)?,
    );
    workspaces
        .scavenge_abandoned()
        .change_context(WorkerError::LocalDisk)?;
    let cleaner: Arc<dyn ShardWorkspaceCleaner> = Arc::new(ScavengingCleaner {
        workspaces: Arc::clone(&workspaces),
    });
    let throttle: Arc<dyn RateLimiter> = Arc::new(Throttle::new());
    let transport: Arc<dyn GraphEffectTransport> = Arc::new(HttpClient::new(
        HttpClientOptions {
            base_url: required(env, "HASH_GRAPH_URL")?.to_owned(),
            actor_id: required(env, "HASH_ACTOR_ID")?.to_owned(),
            // DRR admission and the exact static-share buckets are the sole
            // Graph scheduling authority for the worker. A raw transport
            // limiter here would charge every admitted request a second time.
            rate_limit: None,
            throttle_scope: readiness.config.tenant.to_string(),
            throttle,
        },
        env,
    ));
    let lanes = Arc::new(EffectLaneRegistry::default());
    tracing::info!(
        runner_rate = readiness.config.rate.runner_rate,
        reconcile_numerator = readiness.config.rate.reconcile_numerator,
        class_denominator = readiness.config.rate.class_denominator,
        known_shards = readiness.known_shards.len(),
        "validated static Graph rate share"
    );
    let activation_shards = readiness.known_shards.clone();
    let delivery = Arc::new(
        GraphTokenCoordinator::new(readiness.config.rate)
            .with_telemetry(readiness.artifacts.telemetry()),
    );
    let mut runner = Runner {
        env: env.clone(),
        readiness,
        cleaner,
        transport,
        lanes,
        delivery,
        runtime_settings,
        delivery_settings_revision: 0,
        known_shard_count,
        lane_not_before: BTreeMap::new(),
        shards: BTreeMap::new(),
        last_discovery: None,
        activation_shards: Some(activation_shards),
        acquisition_conflicts: 0,
        lanes_declared: false,
        unowned_since: BTreeMap::new(),
    };
    Box::pin(runner.serve(shutdown)).await
}

struct Runner {
    env: Env,
    readiness: ActivationReadiness,
    cleaner: Arc<dyn ShardWorkspaceCleaner>,
    transport: Arc<dyn GraphEffectTransport>,
    lanes: Arc<EffectLaneRegistry>,
    /// The single process-wide fair Graph scheduler shared by every owned
    /// shard. Delivery capacity is admitted, paced, and settled only here.
    delivery: Arc<GraphTokenCoordinator>,
    runtime_settings: Arc<RuntimeSettingsCache>,
    delivery_settings_revision: u64,
    known_shard_count: u32,
    /// Process-local provider backoff. Losing the process may retry a hint
    /// early, but no live worker discards a bounded Retry-After response.
    lane_not_before: BTreeMap<(LaneClass, String), tokio::time::Instant>,
    shards: BTreeMap<Shard, ShardRuntime>,
    last_discovery: Option<tokio::time::Instant>,
    /// Shards discovered by activation, consumed by the first ownership pass
    /// so startup does not repeat the LIST that readiness already performed.
    activation_shards: Option<Vec<Shard>>,
    acquisition_conflicts: u64,
    /// Whether the previous delivery pass declared a non-empty lane set, so
    /// an idle worker skips redundant empty synchronizations.
    lanes_declared: bool,
    /// When each currently unowned known shard was first observed unowned,
    /// for the oldest-unowned coverage lower bound.
    unowned_since: BTreeMap<Shard, tokio::time::Instant>,
}

impl Runner {
    async fn serve(&mut self, shutdown: CancellationToken) -> Result<(), Report<WorkerError>> {
        loop {
            let progressed = Box::pin(self.tick()).await?;
            let delay = if progressed {
                ACTIVE_POLL_INTERVAL
            } else {
                IDLE_POLL_INTERVAL
            };
            tokio::select! {
                () = shutdown.cancelled() => {
                    return self.shutdown().await;
                }
                () = tokio::time::sleep(delay) => {}
            }
        }
    }

    async fn tick(&mut self) -> Result<bool, Report<WorkerError>> {
        self.reap_lost_shards().await;
        if self
            .last_discovery
            .is_none_or(|last| last.elapsed() >= DISCOVERY_INTERVAL)
        {
            Box::pin(self.discover_and_acquire()).await?;
            self.last_discovery = Some(tokio::time::Instant::now());
        }
        self.refresh_delivery_rate().await;

        let mut progressed = false;
        for runtime in self.shards.values_mut() {
            let turn = match runtime.scheduler.next(chrono::Utc::now()).await {
                Ok(turn) => turn,
                Err(error) => {
                    tracing::warn!(error = ?error, "owned shard scheduling turn failed");
                    continue;
                }
            };
            progressed |= turn.controls_processed > 0;
            let active_action = !matches!(turn.action, SchedulerAction::Idle);
            match runtime.dispatcher.dispatch(turn).await {
                Ok(WorkerDispatchOutcome::Idle) => {}
                Ok(_outcome) => progressed = true,
                Err(error) => {
                    tracing::warn!(error = ?error, "owned shard dispatch turn failed");
                }
            }
            progressed |= active_action;
            if tokio::time::Instant::now() >= runtime.next_snapshot_at {
                runtime.next_snapshot_at = tokio::time::Instant::now() + runtime.snapshot_interval;
                match runtime
                    .renewing
                    .snapshot_projection(chrono::Utc::now(), runtime.snapshot_events)
                    .await
                {
                    Ok(Some(snapshot)) => {
                        tracing::info!(
                            shard = %snapshot.current().shard,
                            through_log_sequence = snapshot.current().through_log_sequence,
                            "published control projection snapshot"
                        );
                        progressed = true;
                    }
                    Ok(None) => {}
                    Err(error) => {
                        tracing::warn!(error = ?error, "control projection snapshot failed");
                    }
                }
            }
        }
        progressed |= self.delivery_pass().await;
        Ok(progressed)
    }

    async fn refresh_delivery_rate(&mut self) {
        let scope = self.readiness.config.tenant.to_string();
        let (revision, setting) = self.runtime_settings.graph_delivery(&scope).await;
        if revision <= self.delivery_settings_revision {
            return;
        }
        self.delivery_settings_revision = revision;
        let requested_rate = setting.map(|value| value.requests_per_second);
        let config = match self.readiness.config.rate_inputs.share_with_override(
            self.known_shard_count,
            revision,
            requested_rate,
        ) {
            Ok(config) => config,
            Err(error) => {
                tracing::warn!(
                    settings_revision = revision,
                    requested_rate,
                    error = %error,
                    "invalid live Graph request rate; keeping the last valid limit"
                );
                return;
            }
        };
        let runner_rate = config.runner_rate;
        match self.delivery.reconfigure(config).await {
            Ok(()) => tracing::info!(
                settings_revision = revision,
                requested_rate,
                runner_rate,
                "applied live Graph request rate"
            ),
            Err(error) => tracing::warn!(
                settings_revision = revision,
                requested_rate,
                error = ?error,
                "live Graph request rate could not be applied; keeping the last valid limit"
            ),
        }
    }

    /// One bounded process-wide delivery pass. Every owned shard's runnable
    /// lanes are declared to the single fair scheduler; each DRR admission is
    /// converted into a lease chunk permit on its owning shard, executed as
    /// one bounded turn with per-request token pacing, and settled with the
    /// executor's authoritative request count on every exit path.
    async fn delivery_pass(&mut self) -> bool {
        let now = tokio::time::Instant::now();
        self.lane_not_before.retain(|_key, due| *due > now);
        let max_graph_requests = self.readiness.config.max_graph_requests_per_chunk;
        let mut lanes = Vec::new();
        let mut index: BTreeMap<(LaneClass, String), (Shard, WorkRecoveryIntent)> = BTreeMap::new();
        for (shard, runtime) in &self.shards {
            let candidates = match runtime.scheduler.delivery_candidates().await {
                Ok(candidates) => candidates,
                Err(error) => {
                    tracing::warn!(
                        shard = shard.get(),
                        error = ?error,
                        "owned shard delivery discovery failed"
                    );
                    continue;
                }
            };
            for work in candidates {
                // One identity computation per lane: the path is a fresh
                // SHA-256 hex, and this loop runs every tick.
                let (class, path) = shard::delivery_lane_identity(&work);
                if self
                    .lane_not_before
                    .get(&(class, path.clone()))
                    .is_some_and(|due| *due > now)
                {
                    continue;
                }
                lanes.push(RunnableLane::new(path.clone(), class, max_graph_requests));
                if index.insert((class, path), (*shard, work)).is_some() {
                    tracing::error!(
                        shard = shard.get(),
                        "duplicate delivery lane identity; skipping delivery pass"
                    );
                    return false;
                }
            }
        }
        // An idle worker declares an empty set once; re-synchronizing empty
        // over empty every tick is pure lock traffic.
        let lane_count = lanes.len();
        if lane_count == 0 && !self.lanes_declared {
            return false;
        }
        if lane_count > 0 && !self.lanes_declared {
            tracing::debug!(lanes = lane_count, "runnable delivery lanes discovered");
        }
        self.lanes_declared = lane_count > 0;
        if let Err(error) = self.delivery.synchronize(lanes).await {
            tracing::warn!(error = ?error, "delivery lane synchronization failed");
            return false;
        }

        // Bounded fairness: the admission loop runs at most one iteration
        // per runnable lane, so a hot shard cannot pin the worker loop. A
        // lane settled runnable with remaining deficit may legitimately win
        // more than one of those iterations.
        let mut progressed = false;
        for _turn in 0..lane_count {
            let Some(admission) = self.admit_next_turn().await else {
                break;
            };
            progressed = true;
            self.execute_admission(admission, &index).await;
        }
        progressed
    }

    /// Foreground admission is always attempted before Reconcile, so reserved
    /// maintenance capacity can never displace runnable foreground work.
    async fn admit_next_turn(&self) -> Option<FairAdmission> {
        for class in [LaneClass::Foreground, LaneClass::Reconcile] {
            match self.delivery.admit(class).await {
                Ok(FairDecision::Admitted(admission)) => return Some(admission),
                Ok(decision @ (FairDecision::TokenStarved | FairDecision::YieldedToForeground)) => {
                    tracing::trace!(class = ?class, decision = ?decision, "delivery lane not admitted");
                }
                Ok(FairDecision::NoRunnableLane) => {}
                Err(error) => {
                    tracing::warn!(class = ?class, error = ?error, "delivery admission failed");
                }
            }
        }
        None
    }

    async fn execute_admission(
        &mut self,
        admission: FairAdmission,
        index: &BTreeMap<(LaneClass, String), (Shard, WorkRecoveryIntent)>,
    ) {
        let key = (admission.class(), admission.integration_path().to_owned());
        let max_graph_requests = admission.max_graph_requests();
        // An admitted lane whose entry or shard vanished (reaped between
        // discovery and admission) settles as no longer runnable.
        let Some((shard, work, runtime)) = index
            .get(&key)
            .and_then(|(shard, work)| Some((*shard, work, self.shards.get(shard)?)))
        else {
            self.settle_admission(admission, 0, LaneAfterTurn::EmptyOrBlocked)
                .await;
            return;
        };
        tracing::trace!(work_id = %work.work_id, "requesting lease chunk for admitted lane");
        match runtime
            .scheduler
            .admit_work(&work.work_id, chrono::Utc::now())
            .await
        {
            Ok(WorkAdmission::Admitted { work, permit }) => {
                tracing::trace!(work_id = %work.work_id, "lease chunk admitted; executing turn");
                let paced = PacedChunkPermit::new(
                    permit,
                    TurnTokens::new(
                        Arc::clone(&self.delivery),
                        admission.class(),
                        admission.prepaid_graph_requests(),
                    ),
                );
                match runtime
                    .dispatcher
                    .execute_admitted_work(&work, &paced)
                    .await
                {
                    Ok(turn) => {
                        let after = match turn.lane_after {
                            LaneDisposition::Runnable => {
                                LaneAfterTurn::Runnable { max_graph_requests }
                            }
                            LaneDisposition::Yielded { retry_after } => {
                                if let Some(delay) = retry_after {
                                    self.lane_not_before
                                        .insert(key.clone(), tokio::time::Instant::now() + delay);
                                }
                                LaneAfterTurn::Yield { max_graph_requests }
                            }
                            LaneDisposition::Settled => LaneAfterTurn::EmptyOrBlocked,
                        };
                        self.settle_admission(admission, turn.graph_requests_used, after)
                            .await;
                    }
                    Err(error) => {
                        let requests_used = error.graph_requests_used();
                        tracing::warn!(
                            work_id = %work.work_id,
                            requests_used,
                            error = ?error,
                            "admitted delivery turn failed"
                        );
                        self.settle_admission(
                            admission,
                            requests_used,
                            LaneAfterTurn::Runnable { max_graph_requests },
                        )
                        .await;
                    }
                }
            }
            Ok(WorkAdmission::RenewFirst) => {
                self.settle_admission(admission, 0, LaneAfterTurn::Yield { max_graph_requests })
                    .await;
            }
            Ok(WorkAdmission::NoLongerRunnable) => {
                runtime.dispatcher.forget_work_conflicts(&work.work_id);
                self.settle_admission(admission, 0, LaneAfterTurn::EmptyOrBlocked)
                    .await;
            }
            Err(error) => {
                tracing::warn!(
                    shard = shard.get(),
                    error = ?error,
                    "shard chunk admission failed after DRR admission"
                );
                self.settle_admission(admission, 0, LaneAfterTurn::EmptyOrBlocked)
                    .await;
            }
        }
    }

    async fn settle_admission(
        &self,
        admission: FairAdmission,
        requests_used: u32,
        after: LaneAfterTurn,
    ) {
        if let Err(error) = self.delivery.settle(admission, requests_used, after).await {
            tracing::error!(error = ?error, "delivery settlement failed");
        }
    }

    async fn discover_and_acquire(&mut self) -> Result<(), Report<WorkerError>> {
        let discovered = match self.activation_shards.take() {
            Some(known) => known,
            None => super::submission::discover_known_shards(
                &self.readiness.artifacts,
                &self.readiness.config.tenant,
            )
            .await
            .change_context(WorkerError::ShardHandshake)?,
        };
        // A tenant can outgrow the deployment after activation. Coverage is a
        // fleet property: this runner keeps serving what it owns and reports
        // degraded aggregate health instead of failing its own pod.
        if let Ok(known_count) = u32::try_from(discovered.len()) {
            self.known_shard_count = known_count;
            if let Err(error) = self.readiness.config.rate_inputs.share(known_count) {
                tracing::warn!(
                    known_shards = discovered.len(),
                    per_runner_capacity = self.readiness.config.shard_capacity,
                    error = %error,
                    "deployment coverage is no longer sufficient for the known shard count"
                );
            }
        }
        // Greedy, capped, randomized: each round visits the unowned shards in
        // a fresh random order so concurrent runners spread instead of
        // stampeding the same candidate, and stops at the per-runner cap.
        let mut candidates = discovered
            .iter()
            .copied()
            .filter(|shard| !self.shards.contains_key(shard))
            .collect::<Vec<_>>();
        candidates.sort_by_cached_key(|_shard| uuid::Uuid::new_v4());
        let available = self
            .readiness
            .config
            .shard_capacity
            .saturating_sub(self.shards.len());
        candidates.truncate(available);
        let mut locations = Vec::with_capacity(candidates.len());
        for shard in candidates {
            locations.push((
                shard,
                ShardLogLocation::production(&self.env, shard, &self.readiness.config.tenant)
                    .change_context(WorkerError::ShardLocation)?,
            ));
        }
        let acquisition_concurrency = crate::config::shard_acquisition_concurrency(&self.env)
            .max(1)
            .min(locations.len().max(1));
        let artifacts = self.readiness.artifacts.clone();
        let tenant = self.readiness.config.tenant.clone();
        let owner_id = self.readiness.config.owner_id.clone();
        let lease_timing = self.readiness.config.lease_timing;
        let command = self.readiness.config.command;
        let acquired = stream::iter(locations)
            .map(|(shard, location)| {
                let artifacts = artifacts.clone();
                let tenant = tenant.clone();
                let owner_id = owner_id.clone();
                async move {
                    let result = Box::pin(shard::acquire(
                        &artifacts,
                        &tenant,
                        location,
                        &owner_id,
                        lease_timing,
                        command,
                    ))
                    .await
                    .change_context(WorkerError::ShardHandshake)?;
                    Ok::<_, Report<WorkerError>>((shard, result))
                }
            })
            .buffer_unordered(acquisition_concurrency)
            .collect::<Vec<_>>()
            .await;
        for acquired in acquired {
            let (shard, acquired) = acquired?;
            let owned = match acquired {
                ShardAcquisition::Acquired(owned) => owned,
                ShardAcquisition::Contended(lease) => {
                    tracing::debug!(
                        shard = shard.get(),
                        owner = %lease.owner_id,
                        lease_epoch = lease.lease_epoch,
                        expires_at = %lease.expires_at,
                        "known shard lease is held by another owner"
                    );
                    continue;
                }
                ShardAcquisition::Conflict => {
                    self.acquisition_conflicts = self.acquisition_conflicts.saturating_add(1);
                    tracing::debug!(
                        shard = shard.get(),
                        total_conflicts = self.acquisition_conflicts,
                        "known shard lease acquisition lost a benign CAS race"
                    );
                    continue;
                }
                ShardAcquisition::LeaseLost(stage) => {
                    tracing::warn!(
                        shard = shard.get(),
                        stage = ?stage,
                        "shard lease was lost during the acquisition handshake"
                    );
                    continue;
                }
            };
            let runtime = self.build_runtime(owned.start_renewing(
                self.readiness.artifacts.clone(),
                self.readiness.config.tenant.clone(),
                Arc::clone(&self.cleaner),
            ))?;
            self.shards.insert(shard, runtime);
        }
        self.observe_coverage(&discovered);
        Ok(())
    }

    /// Aggregate coverage health: known against owned shards, with the oldest
    /// unowned age as a lower bound. Pod readiness stays separate by design:
    /// an unowned known shard degrades fleet health without making this
    /// otherwise healthy runner report itself broken.
    fn observe_coverage(&mut self, discovered: &[Shard]) {
        let now = tokio::time::Instant::now();
        let known = discovered.iter().copied().collect::<BTreeSet<Shard>>();
        let owned = &self.shards;
        self.unowned_since
            .retain(|shard, _since| known.contains(shard) && !owned.contains_key(shard));
        for shard in &known {
            if !self.shards.contains_key(shard) {
                self.unowned_since.entry(*shard).or_insert(now);
            }
        }
        let oldest_unowned = self
            .unowned_since
            .values()
            .map(|since| now.duration_since(*since))
            .max();
        if let Some(age) = oldest_unowned.filter(|age| *age >= ACQUISITION_GRACE) {
            tracing::warn!(
                unowned = self.unowned_since.len(),
                oldest_unowned_ms = u64::try_from(age.as_millis()).unwrap_or(u64::MAX),
                "known shards remain unowned past the acquisition grace period"
            );
        }
        match crate::progress::ShardSignalsV1::new(
            known.len() as u64,
            self.shards.len() as u64,
            oldest_unowned,
        ) {
            Ok(signals) => self.readiness.artifacts.telemetry().set_shards(signals),
            Err(error) => {
                tracing::debug!(error = %error, "shard coverage observation was not recordable");
            }
        }
    }

    fn build_runtime(
        &self,
        mut renewing: RenewingShard,
    ) -> Result<ShardRuntime, Report<WorkerError>> {
        let commands = renewing.handle.clone();
        let state: Arc<dyn StateAuthority> = Arc::new(JournalStateAuthority::new(
            self.readiness.artifacts.clone(),
            self.readiness.config.tenant.clone(),
            commands.clone(),
        ));
        let state_hint_task = state::start_state_hint_repairer(
            self.readiness.artifacts.clone(),
            self.readiness.config.tenant.clone(),
            Arc::clone(&state),
            renewing
                .take_state_changes()
                .ok_or_else(|| Report::new(WorkerError::Planner))?,
        );
        let committer: Arc<dyn WorkCursorCommitter> =
            Arc::new(ShardWorkCursorCommitter::new(commands.clone()));
        let executor = Arc::new(
            BoundedEffectExecutor::new(
                Arc::clone(&self.transport),
                committer,
                Arc::new(TokioRetryDelay),
                Arc::clone(&self.lanes),
            )
            .with_telemetry(self.readiness.artifacts.telemetry()),
        );
        let planner = super::planning::RunPlanner::new(
            self.env.clone(),
            self.readiness.config.tenant.clone(),
            self.readiness.artifacts.clone(),
            Arc::clone(&state),
            commands.clone(),
        )
        .change_context(WorkerError::Planner)?;
        let dispatcher: Box<dyn Executor> = Box::new(WorkerDispatcher::new(
            self.readiness.config.tenant.clone(),
            self.readiness.artifacts.clone(),
            planner,
            state,
            commands,
            executor,
            ChunkBudget::new(self.readiness.config.max_graph_requests_per_chunk)
                .change_context(WorkerError::Executor)?,
        ));
        let scheduler = renewing.scheduler(
            // The HTTP boundary is private and authenticated. Per-run owners
            // vary, so a process-wide actor comparison would incorrectly
            // reject legitimate controls for every other owner.
            Arc::new(|_request: &super::control::ControlRequestV1| true),
            self.readiness.config.control_batch_size,
            self.readiness.config.reconcile_interval,
        );
        Ok(ShardRuntime {
            renewing,
            scheduler,
            dispatcher,
            _state_hint_task: state_hint_task,
            snapshot_interval: Duration::from_secs(
                crate::config::projection_snapshot_interval_seconds(&self.env),
            ),
            snapshot_events: crate::config::projection_snapshot_events(&self.env),
            next_snapshot_at: tokio::time::Instant::now()
                + Duration::from_secs(crate::config::projection_snapshot_interval_seconds(
                    &self.env,
                )),
        })
    }

    async fn reap_lost_shards(&mut self) {
        let lost = self
            .shards
            .iter()
            .filter_map(|(shard, runtime)| runtime.renewing.task.is_finished().then_some(*shard))
            .collect::<Vec<_>>();
        for shard in lost {
            let Some(runtime) = self.shards.remove(&shard) else {
                continue;
            };
            self.readiness
                .artifacts
                .telemetry()
                .record_ownership_churn();
            match runtime.renewing.task.await {
                Ok(Ok(reason)) => {
                    tracing::warn!(shard = shard.get(), ?reason, "shard ownership ended");
                }
                Ok(Err(error)) => {
                    tracing::error!(shard = shard.get(), error = ?error, "shard renewal failed");
                }
                Err(error) => {
                    tracing::error!(shard = shard.get(), error = ?error, "shard task panicked");
                }
            }
        }
    }

    async fn shutdown(&mut self) -> Result<(), Report<WorkerError>> {
        for runtime in self.shards.values() {
            if let Err(error) = runtime
                .renewing
                .snapshot_projection(chrono::Utc::now(), 1)
                .await
            {
                tracing::warn!(error = ?error, "final control projection snapshot failed");
            }
            if let Err(error) = runtime.renewing.handle.shutdown().await {
                tracing::warn!(error = ?error, "shard shutdown request failed");
            }
        }
        let tasks = std::mem::take(&mut self.shards)
            .into_values()
            .map(|runtime| runtime.renewing.task)
            .collect::<Vec<_>>();
        let wait = async {
            for task in tasks {
                let result = task.await.change_context(WorkerError::Shutdown)?;
                result.change_context(WorkerError::Shutdown)?;
            }
            Ok::<(), Report<WorkerError>>(())
        };
        tokio::time::timeout(
            Duration::from_secs(crate::config::worker_drain_timeout_seconds(&self.env)),
            wait,
        )
        .await
        .change_context(WorkerError::Shutdown)??;
        Ok(())
    }
}

fn required<'a>(env: &'a Env, name: &'static str) -> Result<&'a str, Report<WorkerError>> {
    env.get(name)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            Report::new(WorkerError::Activation).attach_printable(format!("{name} is required"))
        })
}
