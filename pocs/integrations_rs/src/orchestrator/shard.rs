//! Lease-gated startup for one shard writer and command loop.

use std::fmt;
use std::num::NonZeroUsize;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use error_stack::{Report, ResultExt as _};
use tokio::sync::RwLock;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use super::ids::{CanonicalIntegrationId, TenantNamespace};
use super::inbox::{AuthorizeControl, ControlInbox};
use super::lease::{self, AcquireOutcome, AcquiredLease, LeaseTiming, RenewOutcome, ShardLeaseV1};
use super::routing::ControlPaths;
use super::shard_log::{
    OpenedShard, RunView, ShardCommandConfig, ShardCommandHandle, ShardLogLocation, StartedShard,
    StartupRecovery, StateChangeFeed, WorkRecoveryIntent,
};
use super::submission::{admitted_run_record, delete_ready_receipt, discover_ready_receipts};
use super::work::WorkKind;
use crate::blob::ArtifactStore;
use crate::graph::executor::EffectTurnPermit;
use crate::throttle::drr::LaneClass;

/// Idle-turn cadence for the structural reconcile-candidates probe.
const RECONCILE_PROBE_INTERVAL: Duration = Duration::from_secs(1);

pub(crate) trait HandshakeClock: Send + Sync {
    fn now(&self) -> DateTime<Utc>;
}

struct SystemClock;

impl HandshakeClock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HandshakeStage {
    LeaseAcquired,
    WriterOpened,
    RecoveryComplete,
}

#[async_trait]
pub(crate) trait HandshakeObserver: Send + Sync {
    async fn reached(&self, stage: HandshakeStage);
}

struct NoopObserver;

#[async_trait]
impl HandshakeObserver for NoopObserver {
    async fn reached(&self, _stage: HandshakeStage) {}
}

#[derive(Debug)]
pub(crate) struct OwnedShard {
    pub(crate) lease: AcquiredLease,
    pub(crate) started: StartedShard,
    location: ShardLogLocation,
    timing: LeaseTiming,
}

#[derive(Debug, Clone)]
pub(crate) struct LeaseGuard {
    current: Arc<RwLock<AcquiredLease>>,
    lost: CancellationToken,
    timing: LeaseTiming,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ChunkAdmission {
    RenewFirst,
    OwnershipLost,
}

#[derive(Debug, Clone)]
pub(crate) struct LeaseChunkPermit {
    lost: CancellationToken,
    send_deadline: Instant,
    cursor_deadline: Instant,
}

impl EffectTurnPermit for LeaseChunkPermit {
    fn send_allowed(&self) -> bool {
        !self.lost.is_cancelled() && Instant::now() < self.send_deadline
    }

    fn cursor_allowed(&self) -> bool {
        !self.lost.is_cancelled() && Instant::now() < self.cursor_deadline
    }

    fn send_deadline(&self) -> Option<Instant> {
        Some(self.send_deadline)
    }

    fn cursor_deadline(&self) -> Option<Instant> {
        Some(self.cursor_deadline)
    }
}

/// A lease chunk permit paced by the process-wide fair scheduler. Lease
/// deadlines still bound the turn; every Graph request beyond the admission's
/// prepaid first send consumes one parent+class token as it starts, and a
/// token that cannot arrive before the send deadline yields the turn at its
/// durable cursor.
pub(crate) struct PacedChunkPermit {
    lease: LeaseChunkPermit,
    tokens: crate::throttle::coordinator::TurnTokens,
}

impl PacedChunkPermit {
    pub(crate) fn new(
        lease: LeaseChunkPermit,
        tokens: crate::throttle::coordinator::TurnTokens,
    ) -> Self {
        Self { lease, tokens }
    }
}

#[async_trait]
impl EffectTurnPermit for PacedChunkPermit {
    fn send_allowed(&self) -> bool {
        self.lease.send_allowed()
    }

    fn cursor_allowed(&self) -> bool {
        self.lease.cursor_allowed()
    }

    fn send_deadline(&self) -> Option<Instant> {
        EffectTurnPermit::send_deadline(&self.lease)
    }

    fn cursor_deadline(&self) -> Option<Instant> {
        EffectTurnPermit::cursor_deadline(&self.lease)
    }

    async fn acquire_request(&self) -> bool {
        self.tokens
            .acquire(EffectTurnPermit::send_deadline(&self.lease))
            .await
    }
}

impl LeaseGuard {
    fn new(acquired: AcquiredLease, timing: LeaseTiming) -> Self {
        Self {
            current: Arc::new(RwLock::new(acquired)),
            lost: CancellationToken::new(),
            timing,
        }
    }

    pub(crate) async fn admit_chunk(
        &self,
        now: DateTime<Utc>,
    ) -> Result<LeaseChunkPermit, ChunkAdmission> {
        if self.lost.is_cancelled() {
            return Err(ChunkAdmission::OwnershipLost);
        }
        let expires_at = self
            .current
            .read()
            .await
            .expires_at()
            .map_err(|_error| ChunkAdmission::OwnershipLost)?;
        let remaining = expires_at
            .signed_duration_since(now)
            .to_std()
            .map_err(|_error| ChunkAdmission::RenewFirst)?;
        if remaining <= self.timing.chunk_window() {
            return Err(ChunkAdmission::RenewFirst);
        }
        let admitted_at = Instant::now();
        let send_deadline = admitted_at
            .checked_add(self.timing.graph_chunk_deadline())
            .ok_or(ChunkAdmission::OwnershipLost)?;
        let cursor_deadline = send_deadline
            .checked_add(self.timing.cursor_commit_deadline())
            .ok_or(ChunkAdmission::OwnershipLost)?;
        Ok(LeaseChunkPermit {
            lost: self.lost.clone(),
            send_deadline,
            cursor_deadline,
        })
    }

    async fn acquired(&self) -> AcquiredLease {
        self.current.read().await.clone()
    }

    async fn replace(&self, renewed: AcquiredLease) {
        *self.current.write().await = renewed;
    }

    fn mark_lost(&self) {
        self.lost.cancel();
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LeaseLossReason {
    Conflict,
    Expired,
    RenewalTimedOut,
    RenewalFailed,
    WriterStopped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RenewalError {
    WorkspaceCleanup,
    CommandTaskJoin,
}

impl fmt::Display for RenewalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::WorkspaceCleanup => "discard lease-lost shard workspace failed",
            Self::CommandTaskJoin => "join lease-lost shard command task failed",
        })
    }
}

impl std::error::Error for RenewalError {}

#[async_trait]
pub(crate) trait ShardWorkspaceCleaner: Send + Sync {
    async fn discard(
        &self,
        location: &ShardLogLocation,
    ) -> Result<(), Report<crate::local_disk::LocalDiskError>>;
}

#[async_trait]
trait RenewalClock: Send + Sync {
    fn now(&self) -> DateTime<Utc>;
    async fn wait(&self, duration: Duration);
}

struct TokioRenewalClock;

#[async_trait]
impl RenewalClock for TokioRenewalClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }

    async fn wait(&self, duration: Duration) {
        tokio::time::sleep(duration).await;
    }
}

#[derive(Debug)]
pub(crate) struct RenewingShard {
    pub(crate) handle: ShardCommandHandle,
    pub(crate) recovery: StartupRecovery,
    pub(crate) state_changes: Option<StateChangeFeed>,
    pub(crate) lease_guard: LeaseGuard,
    pub(crate) task: tokio::task::JoinHandle<Result<LeaseLossReason, Report<RenewalError>>>,
    store: ArtifactStore,
    tenant: TenantNamespace,
    shard: super::routing::Shard,
}

impl RenewingShard {
    pub(crate) fn take_state_changes(&mut self) -> Option<StateChangeFeed> {
        self.state_changes.take()
    }

    /// Publishes at most one snapshot once the requested journal sequence span
    /// has accumulated. An unchanged projection returns `None`.
    pub(crate) async fn snapshot_projection(
        &self,
        created_at: DateTime<Utc>,
        minimum_sequence_span: u64,
    ) -> Result<
        Option<super::projection_snapshot::ControlProjectionSnapshot>,
        Report<super::projection_snapshot::SnapshotError>,
    > {
        self.handle
            .publish_projection_snapshot(
                &self.store,
                &self.tenant,
                created_at,
                minimum_sequence_span,
            )
            .await
    }

    pub(crate) fn scheduler(
        &self,
        authorize: Arc<dyn AuthorizeControl>,
        control_batch_size: NonZeroUsize,
        reconcile_interval: Option<Duration>,
    ) -> RecoveryScheduler {
        RecoveryScheduler::new(
            self.store.clone(),
            self.tenant.clone(),
            self.shard,
            self.handle.clone(),
            self.lease_guard.clone(),
            authorize,
            control_batch_size,
            reconcile_interval,
        )
        .with_recovered_work(self.recovery.live_work.clone())
    }
}

/// Non-delivery scheduling decisions for one owned shard. Delivery turns are
/// admitted separately through the process-wide fair scheduler:
/// `delivery_candidates` discovers runnable lanes and `admit_work` converts
/// one DRR admission into a lease chunk permit.
#[derive(Debug)]
pub(crate) enum SchedulerAction {
    PlanRestore(CanonicalIntegrationId),
    /// Initiates one new reconciliation cycle for an applied, healthy
    /// integration whose operator-configured sweep interval has elapsed.
    PlanReconcile(CanonicalIntegrationId),
    FinalizeRun {
        integration_id: CanonicalIntegrationId,
        run_id: super::ids::RunId,
        result: crate::blob::BlobRef,
    },
    AcceptedRun(RunView),
    ReceiptPromoted,
    Idle,
}

/// The result of converting one process-wide admission into shard execution
/// capacity.
pub(crate) enum WorkAdmission {
    Admitted {
        work: WorkRecoveryIntent,
        permit: LeaseChunkPermit,
    },
    /// The lease window cannot fit another chunk; renewal must land first.
    /// The lane stays runnable.
    RenewFirst,
    /// The work item changed between discovery and admission and is no longer
    /// a planned lane.
    NoLongerRunnable,
}

#[derive(Debug)]
pub(crate) struct SchedulerTurn {
    pub(crate) controls_processed: usize,
    pub(crate) action: SchedulerAction,
}

/// The process-wide DRR identity of one durable work item. Routing supplies
/// the only integration-path encoding, and Restore is structurally foreground.
pub(crate) fn delivery_lane_identity(work: &WorkRecoveryIntent) -> (LaneClass, String) {
    let class = match &work.kind {
        WorkKind::Apply(_) | WorkKind::Restore(_) => LaneClass::Foreground,
        WorkKind::Reconcile(_) => LaneClass::Reconcile,
    };
    (
        class,
        super::routing::integration_path(&work.integration_id).to_hex(),
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SchedulerError {
    ControlInbox,
    WorkQuery,
    RestoreQuery,
    RunQuery,
    ReceiptDiscovery,
    ReceiptValidation,
    ReceiptPromotion,
    ReceiptDeletion,
    OwnershipLost,
}

impl fmt::Display for SchedulerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::ControlInbox => "process bounded shard control batch failed",
            Self::WorkQuery => "query committed shard work failed",
            Self::RestoreQuery => "query required shard restore failed",
            Self::RunQuery => "query accepted shard run failed",
            Self::ReceiptDiscovery => "discover ready receipts failed",
            Self::ReceiptValidation => "validate admitted ready receipt failed",
            Self::ReceiptPromotion => "promote ready receipt through shard journal failed",
            Self::ReceiptDeletion => "delete durably promoted ready receipt failed",
            Self::OwnershipLost => "shard scheduler ownership was lost",
        })
    }
}

impl std::error::Error for SchedulerError {}

pub(crate) struct RecoveryScheduler {
    store: ArtifactStore,
    tenant: TenantNamespace,
    shard: super::routing::Shard,
    command: ShardCommandHandle,
    inbox: ControlInbox,
    lease: LeaseGuard,
    recovered_work: Vec<WorkRecoveryIntent>,
    /// Operator opt-in for initiating reconciliation cycles. `None` disables
    /// initiation entirely; existing durable cycles still execute.
    reconcile_interval: Option<Duration>,
    /// Process-monotonic pacing anchors. An integration absent from this map
    /// is eligible immediately: after recovery nobody knows how long the
    /// previous process had waited, and one early level-triggered sweep is
    /// safe by construction.
    reconcile_eligible_at: std::collections::BTreeMap<CanonicalIntegrationId, Instant>,
    /// Last structural candidates probe, bounding the projection query to a
    /// coarse cadence: sweep intervals are minutes while idle turns are
    /// milliseconds.
    last_reconcile_probe: Option<Instant>,
    /// Whether the startup sweep of stale terminal admissions has completed.
    /// The dispatcher retires admissions inline when runs reach terminal; the
    /// sweep covers a crash between the terminal append and retirement.
    admissions_swept: bool,
}

impl RecoveryScheduler {
    #[allow(clippy::too_many_arguments)]
    fn new(
        store: ArtifactStore,
        tenant: TenantNamespace,
        shard: super::routing::Shard,
        command: ShardCommandHandle,
        lease: LeaseGuard,
        authorize: Arc<dyn AuthorizeControl>,
        control_batch_size: NonZeroUsize,
        reconcile_interval: Option<Duration>,
    ) -> Self {
        let inbox = ControlInbox::new(
            store.clone(),
            tenant.clone(),
            shard,
            command.clone(),
            authorize,
            control_batch_size,
        );
        Self {
            store,
            tenant,
            shard,
            command,
            inbox,
            lease,
            recovered_work: Vec::new(),
            reconcile_interval,
            reconcile_eligible_at: std::collections::BTreeMap::new(),
            last_reconcile_probe: None,
            admissions_swept: false,
        }
    }

    fn with_recovered_work(mut self, recovered_work: Vec<WorkRecoveryIntent>) -> Self {
        self.recovered_work = recovered_work;
        self
    }

    /// Runs exactly one bounded scheduling turn. A control flood gets one
    /// wrapping batch, after which already durable work gets an explicit turn
    /// before any newly discovered receipt.
    pub(crate) async fn next(
        &mut self,
        now: DateTime<Utc>,
    ) -> Result<SchedulerTurn, Report<SchedulerError>> {
        let recovered_work = std::mem::take(&mut self.recovered_work);
        self.observe_recovered_work(&recovered_work, now);

        if !self.admissions_swept {
            self.sweep_terminal_admissions().await?;
        }

        let controls_processed = self
            .inbox
            .process_batch()
            .await
            .change_context(SchedulerError::ControlInbox)?
            .len();

        if let Some(integration_id) = self
            .command
            .next_restore_required()
            .await
            .change_context(SchedulerError::RestoreQuery)?
        {
            return Ok(SchedulerTurn {
                controls_processed,
                action: SchedulerAction::PlanRestore(integration_id),
            });
        }

        if let Some(run) = self
            .command
            .next_runnable_run()
            .await
            .change_context(SchedulerError::RunQuery)?
        {
            self.observe_run(&run, now).await;
            if let Some(result) = run.completion_result.clone() {
                return Ok(SchedulerTurn {
                    controls_processed,
                    action: SchedulerAction::FinalizeRun {
                        integration_id: run.integration_id,
                        run_id: run.run_id,
                        result,
                    },
                });
            }
            return Ok(SchedulerTurn {
                controls_processed,
                action: SchedulerAction::AcceptedRun(run),
            });
        }

        let receipts = discover_ready_receipts(&self.store, &self.tenant)
            .await
            .change_context(SchedulerError::ReceiptDiscovery)?;
        for receipt in receipts
            .into_iter()
            .filter(|receipt| receipt.shard == self.shard)
        {
            let Some(record) = admitted_run_record(&self.store, &self.tenant, &receipt)
                .await
                .change_context(SchedulerError::ReceiptValidation)?
            else {
                continue;
            };
            self.command
                .propose(record)
                .await
                .change_context(SchedulerError::ReceiptPromotion)?;
            delete_ready_receipt(
                &self.store,
                &self.tenant,
                self.shard,
                &receipt.receipt.run_id,
            )
            .await
            .change_context(SchedulerError::ReceiptDeletion)?;
            return Ok(SchedulerTurn {
                controls_processed,
                action: SchedulerAction::ReceiptPromoted,
            });
        }

        if let Some(integration_id) = self.next_reconcile_initiation().await? {
            return Ok(SchedulerTurn {
                controls_processed,
                action: SchedulerAction::PlanReconcile(integration_id),
            });
        }
        Ok(SchedulerTurn {
            controls_processed,
            action: SchedulerAction::Idle,
        })
    }

    /// Startup crash-window repair: an admission whose run reached terminal
    /// before the previous owner could retire its stable pointer would
    /// otherwise absorb every future submission for that integration.
    async fn sweep_terminal_admissions(&mut self) -> Result<(), Report<SchedulerError>> {
        let terminal = self
            .command
            .terminal_runs_by_integration()
            .await
            .change_context(SchedulerError::RunQuery)?;
        for (integration_id, runs) in terminal {
            let retired = super::submission::retire_admission_for_terminal_runs(
                &self.store,
                &self.tenant,
                &integration_id,
                &runs,
            )
            .await
            .change_context(SchedulerError::ReceiptDiscovery)?;
            if retired {
                tracing::info!(
                    integration_id = %integration_id,
                    "retired a stale terminal admission during startup sweep"
                );
            }
        }
        self.admissions_swept = true;
        Ok(())
    }

    /// Selects at most one integration whose new reconciliation cycle is due.
    /// This runs only after the restore, run, and receipt branches declined
    /// the turn. Foreground deferral is per integration: the candidates query
    /// excludes any integration with a foreground slot in use, and the DRR
    /// Reconcile class additionally yields to runnable foreground lanes at
    /// execution time.
    async fn next_reconcile_initiation(
        &mut self,
    ) -> Result<Option<CanonicalIntegrationId>, Report<SchedulerError>> {
        let Some(interval) = self.reconcile_interval else {
            return Ok(None);
        };
        let monotonic_now = Instant::now();
        if self
            .last_reconcile_probe
            .is_some_and(|last| monotonic_now.duration_since(last) < RECONCILE_PROBE_INTERVAL)
        {
            return Ok(None);
        }
        self.last_reconcile_probe = Some(monotonic_now);
        let candidates = self
            .command
            .reconcile_candidates()
            .await
            .change_context(SchedulerError::WorkQuery)?;
        Ok(self.select_reconcile_initiation(candidates, interval, monotonic_now))
    }

    /// Pure pacing decision over the structural candidates. Anchors are kept
    /// even while an integration is temporarily not a candidate (live cycle,
    /// foreground work): dropping them would make every cycle completion
    /// immediately eligible again. The map is bounded by the integrations
    /// routed to this shard.
    fn select_reconcile_initiation(
        &mut self,
        candidates: Vec<CanonicalIntegrationId>,
        interval: Duration,
        monotonic_now: Instant,
    ) -> Option<CanonicalIntegrationId> {
        let selected = candidates.into_iter().find(|integration_id| {
            self.reconcile_eligible_at
                .get(integration_id)
                .is_none_or(|eligible_at| *eligible_at <= monotonic_now)
        });
        if let Some(integration_id) = &selected {
            self.reconcile_eligible_at
                .insert(integration_id.clone(), monotonic_now + interval);
        }
        selected
    }

    /// Discovers every runnable planned work item in this shard for the
    /// process-wide fair scheduler. Discovery reserves nothing: capacity is
    /// consumed only by DRR admission followed by `admit_work`.
    pub(crate) async fn delivery_candidates(
        &self,
    ) -> Result<Vec<WorkRecoveryIntent>, Report<SchedulerError>> {
        self.command
            .runnable_delivery_work()
            .await
            .change_context(SchedulerError::WorkQuery)
    }

    /// Converts one process-wide DRR admission into a lease chunk permit. The
    /// work item is re-inspected at admission time so a turn never starts
    /// from a stale discovery snapshot.
    ///
    /// The lease window is evaluated first, against the caller's fresh `now`:
    /// the command-loop round trips below can queue behind a slow append, and
    /// a `now` sampled before them would overstate the remaining lease by the
    /// whole queueing delay. Evaluating early only shrinks the usable window,
    /// never widens it, and the permit's monotonic deadlines start at permit
    /// creation.
    pub(crate) async fn admit_work(
        &self,
        work_id: &super::ids::WorkId,
        now: DateTime<Utc>,
    ) -> Result<WorkAdmission, Report<SchedulerError>> {
        let permit = match self.lease.admit_chunk(now).await {
            Ok(permit) => permit,
            Err(ChunkAdmission::RenewFirst) => return Ok(WorkAdmission::RenewFirst),
            Err(ChunkAdmission::OwnershipLost) => {
                return Err(Report::new(SchedulerError::OwnershipLost));
            }
        };
        let Some(work) = self
            .command
            .inspect_work(work_id.clone())
            .await
            .change_context(SchedulerError::WorkQuery)?
            .filter(|work| work.status == super::projection::WorkStatus::Planned)
        else {
            return Ok(WorkAdmission::NoLongerRunnable);
        };
        self.observe_work(&work).await;
        Ok(WorkAdmission::Admitted { work, permit })
    }

    async fn observe_run(&self, run: &RunView, observed_at: DateTime<Utc>) {
        let Ok(Some(delivery)) = self
            .command
            .inspect_delivery(run.integration_id.clone())
            .await
        else {
            return;
        };
        let Ok(mut observation) = crate::progress::IntegrationSignalsV1::new(
            super::routing::integration_path(&run.integration_id).to_string(),
            Some(run.run_id.to_string()),
            run.active_work_id.as_ref().map(ToString::to_string),
            None,
            None,
            None,
            delivery
                .applied_state
                .as_ref()
                .map(|state| state.id.to_string()),
            delivery
                .checkpoint_state
                .as_ref()
                .map(|state| state.id.to_string()),
            observed_maintenance(delivery.maintenance),
        ) else {
            return;
        };
        observation.attempt = Some(run.attempt);
        let telemetry = self.store.telemetry();
        let integration_path = super::routing::integration_path(&run.integration_id).to_string();
        telemetry.observe_runnable_run(
            &integration_path,
            &run.run_id.to_string(),
            run.handler_failures > 0,
            observed_at,
        );
        let _ = telemetry.upsert_integration(observation);
    }

    async fn observe_work(&self, work: &WorkRecoveryIntent) {
        let Ok(Some(delivery)) = self
            .command
            .inspect_delivery(work.integration_id.clone())
            .await
        else {
            return;
        };
        let (run_id, kind, class) = match &work.kind {
            WorkKind::Apply(apply) => (
                Some(apply.run_id.to_string()),
                crate::progress::ObservedWorkKind::Apply,
                crate::progress::ObservedRateClass::Foreground,
            ),
            WorkKind::Restore(restore) => (
                Some(restore.failed_run_id.to_string()),
                crate::progress::ObservedWorkKind::Restore,
                crate::progress::ObservedRateClass::Foreground,
            ),
            WorkKind::Reconcile(_) => (
                None,
                crate::progress::ObservedWorkKind::Reconcile,
                crate::progress::ObservedRateClass::Reconcile,
            ),
        };
        let Ok(mut observation) = crate::progress::IntegrationSignalsV1::new(
            super::routing::integration_path(&work.integration_id).to_string(),
            run_id,
            Some(work.work_id.to_string()),
            Some(kind),
            Some(work.effect_count),
            Some(work.completed_effect_count),
            delivery
                .applied_state
                .as_ref()
                .map(|state| state.id.to_string()),
            delivery
                .checkpoint_state
                .as_ref()
                .map(|state| state.id.to_string()),
            observed_maintenance(delivery.maintenance),
        ) else {
            return;
        };
        observation.rate_class = Some(class);
        let telemetry = self.store.telemetry();
        let integration_path = super::routing::integration_path(&work.integration_id).to_string();
        if let WorkKind::Apply(apply) = &work.kind {
            telemetry.clear_runnable_run(&integration_path, &apply.run_id.to_string());
        }
        telemetry.clear_blocked_work(&integration_path, &work.work_id.to_string());
        let _ = telemetry.upsert_integration(observation);
    }

    fn observe_recovered_work(
        &self,
        recovered_work: &[WorkRecoveryIntent],
        observed_at: DateTime<Utc>,
    ) {
        for work in recovered_work {
            if work.status == super::projection::WorkStatus::Blocked {
                self.store.telemetry().observe_blocked_work(
                    &super::routing::integration_path(&work.integration_id).to_string(),
                    &work.work_id.to_string(),
                    observed_at,
                );
            }
        }
    }
}

fn observed_maintenance(
    value: super::projection::MaintenanceStatus,
) -> crate::progress::ObservedMaintenance {
    match value {
        super::projection::MaintenanceStatus::Healthy => {
            crate::progress::ObservedMaintenance::Healthy
        }
        super::projection::MaintenanceStatus::RestoreRequired => {
            crate::progress::ObservedMaintenance::RestoreRequired
        }
        super::projection::MaintenanceStatus::Restoring => {
            crate::progress::ObservedMaintenance::Restoring
        }
        super::projection::MaintenanceStatus::Blocked => {
            crate::progress::ObservedMaintenance::RestoreBlocked
        }
    }
}

impl OwnedShard {
    pub(crate) fn start_renewing(
        self,
        store: ArtifactStore,
        tenant: TenantNamespace,
        cleaner: Arc<dyn ShardWorkspaceCleaner>,
    ) -> RenewingShard {
        self.start_renewing_with_clock(store, tenant, cleaner, Arc::new(TokioRenewalClock))
    }

    fn start_renewing_with_clock(
        self,
        store: ArtifactStore,
        tenant: TenantNamespace,
        cleaner: Arc<dyn ShardWorkspaceCleaner>,
        clock: Arc<dyn RenewalClock>,
    ) -> RenewingShard {
        let Self {
            lease,
            started,
            location,
            timing,
        } = self;
        let shard = location.shard();
        let StartedShard {
            handle,
            recovery,
            state_changes,
            task: command_task,
        } = started;
        let lease_guard = LeaseGuard::new(lease, timing);
        let task = tokio::spawn(supervise_renewal(
            store.clone(),
            tenant.clone(),
            location,
            timing,
            cleaner,
            clock,
            handle.clone(),
            lease_guard.clone(),
            command_task,
        ));
        RenewingShard {
            handle,
            recovery,
            state_changes: Some(state_changes),
            lease_guard,
            task,
            store,
            tenant,
            shard,
        }
    }
}

#[allow(
    clippy::too_many_arguments,
    reason = "the renewal owner receives every explicit loss-ladder dependency"
)]
async fn supervise_renewal(
    store: ArtifactStore,
    tenant: TenantNamespace,
    location: ShardLogLocation,
    timing: LeaseTiming,
    cleaner: Arc<dyn ShardWorkspaceCleaner>,
    clock: Arc<dyn RenewalClock>,
    handle: ShardCommandHandle,
    guard: LeaseGuard,
    mut command_task: tokio::task::JoinHandle<Result<(), super::shard_log::ShardCommandError>>,
) -> Result<LeaseLossReason, Report<RenewalError>> {
    let lease_key = ControlPaths::new(tenant).lease(location.shard());
    let reason = loop {
        tokio::select! {
            command_result = &mut command_task => {
                let _command_result =
                    command_result.change_context(RenewalError::CommandTaskJoin)?;
                break LeaseLossReason::WriterStopped;
            }
            () = clock.wait(timing.renew_interval()) => {
                let acquired = guard.acquired().await;
                let renewal = tokio::time::timeout(
                    timing.renewal_timeout(),
                    lease::renew(
                        &store,
                        &lease_key,
                        &acquired,
                        clock.now(),
                        timing.lease_duration(),
                    ),
                )
                .await;
                match renewal {
                    Ok(Ok(RenewOutcome::Renewed(renewed))) => guard.replace(renewed).await,
                    Ok(Ok(RenewOutcome::Lost)) => break LeaseLossReason::Conflict,
                    Ok(Ok(RenewOutcome::Expired)) => break LeaseLossReason::Expired,
                    Ok(Err(_error)) => break LeaseLossReason::RenewalFailed,
                    Err(_elapsed) => break LeaseLossReason::RenewalTimedOut,
                }
            }
        }
    };
    if !matches!(reason, LeaseLossReason::WriterStopped) {
        store.telemetry().record_lease_renewal_failure();
    }

    // Loss ladder: admission first, then cooperative work and Graph permits,
    // then the append-capable loop, and only then disposable local state.
    handle.stop_admission();
    guard.mark_lost();
    handle.cancel_owned_writer();
    if !command_task.is_finished() {
        let _ = command_task
            .await
            .change_context(RenewalError::CommandTaskJoin)?;
    }
    cleaner
        .discard(&location)
        .await
        .change_context(RenewalError::WorkspaceCleanup)?;
    Ok(reason)
}

#[derive(Debug)]
pub(crate) enum ShardAcquisition {
    Acquired(OwnedShard),
    Contended(ShardLeaseV1),
    Conflict,
    LeaseLost(LeaseLossStage),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LeaseLossStage {
    AfterOpen,
    BeforeEnable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HandshakeError {
    AcquireLease,
    OpenWriter,
    RevalidateAfterOpen,
    RecoverPrefix,
    RevalidateBeforeEnable,
    CloseWriter,
}

impl fmt::Display for HandshakeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::AcquireLease => "shard lease acquisition failed",
            Self::OpenWriter => "shard writer open failed",
            Self::RevalidateAfterOpen => "shard lease was not revalidated after writer open",
            Self::RecoverPrefix => "shard durable-prefix recovery failed",
            Self::RevalidateBeforeEnable => {
                "shard lease was not revalidated before command admission"
            }
            Self::CloseWriter => "shard writer close after failed acquisition failed",
        })
    }
}

impl std::error::Error for HandshakeError {}

pub(crate) async fn acquire(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
    location: ShardLogLocation,
    owner_id: &str,
    timing: LeaseTiming,
    command_config: ShardCommandConfig,
) -> Result<ShardAcquisition, Report<HandshakeError>> {
    acquire_with(
        store,
        tenant,
        location,
        owner_id,
        timing,
        command_config,
        &SystemClock,
        &NoopObserver,
    )
    .await
}

#[allow(
    clippy::too_many_arguments,
    reason = "clock and observer are explicit deterministic-simulation inputs"
)]
pub(crate) async fn acquire_with(
    store: &ArtifactStore,
    tenant: &TenantNamespace,
    location: ShardLogLocation,
    owner_id: &str,
    timing: LeaseTiming,
    command_config: ShardCommandConfig,
    clock: &dyn HandshakeClock,
    observer: &dyn HandshakeObserver,
) -> Result<ShardAcquisition, Report<HandshakeError>> {
    let lease_key = ControlPaths::new(tenant.clone()).lease(location.shard());
    let acquired = match lease::try_acquire(
        store,
        &lease_key,
        owner_id,
        clock.now(),
        timing.lease_duration(),
        timing.clock_skew(),
    )
    .await
    .change_context(HandshakeError::AcquireLease)?
    {
        AcquireOutcome::Acquired(acquired) => {
            if acquired.lease.lease_epoch > 1 {
                store.telemetry().record_ownership_churn();
            }
            acquired
        }
        AcquireOutcome::Contended(lease) => return Ok(ShardAcquisition::Contended(lease)),
        AcquireOutcome::Conflict => return Ok(ShardAcquisition::Conflict),
    };
    observer.reached(HandshakeStage::LeaseAcquired).await;

    let opened = OpenedShard::open(location.clone())
        .await
        .change_context(HandshakeError::OpenWriter)?;
    observer.reached(HandshakeStage::WriterOpened).await;
    let current = match lease::is_current(store, &lease_key, &acquired, clock.now()).await {
        Ok(current) => current,
        Err(error) => {
            opened
                .close()
                .await
                .change_context(HandshakeError::CloseWriter)?;
            return Err(error.change_context(HandshakeError::RevalidateAfterOpen));
        }
    };
    if !current {
        opened
            .close()
            .await
            .change_context(HandshakeError::CloseWriter)?;
        return Ok(ShardAcquisition::LeaseLost(LeaseLossStage::AfterOpen));
    }

    let recovered = opened
        .recover_with_snapshots(store, tenant)
        .await
        .change_context(HandshakeError::RecoverPrefix)?;
    observer.reached(HandshakeStage::RecoveryComplete).await;
    let current = match lease::is_current(store, &lease_key, &acquired, clock.now()).await {
        Ok(current) => current,
        Err(error) => {
            recovered
                .close()
                .await
                .change_context(HandshakeError::CloseWriter)?;
            return Err(error.change_context(HandshakeError::RevalidateBeforeEnable));
        }
    };
    if !current {
        recovered
            .close()
            .await
            .change_context(HandshakeError::CloseWriter)?;
        return Ok(ShardAcquisition::LeaseLost(LeaseLossStage::BeforeEnable));
    }

    let started = recovered.enable(command_config.require_full_lease_handshake());
    Ok(ShardAcquisition::Acquired(OwnedShard {
        lease: acquired,
        started,
        location,
        timing,
    }))
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic)]
mod tests {
    use std::sync::atomic::{AtomicI64, Ordering};
    use std::sync::Arc;

    use sha2::{Digest as _, Sha256};
    use tokio::sync::{Mutex, Semaphore};

    use super::*;
    use crate::blob::{BlobRef, BlobRefV1, CasWrite, StateSnapshot, StateSnapshotV1};
    use crate::orchestrator::baseline::ensure_control_baseline;
    use crate::orchestrator::control::{CancelRunV1, ControlCommandV1, ControlRequestV1};
    use crate::orchestrator::events::{
        AttemptStartedV1, InputRef, JournalEvent, JournalEventV1, JournalRecordV1, PolicyRef,
        RunAcceptedV1, WorkChunkCompletedV1, WorkManifestRef, WorkPlannedV1,
    };
    use crate::orchestrator::ids::{
        derive_attempt_id, CanonicalIntegrationId, EffectId, RunId, WorkId,
    };
    use crate::orchestrator::inbox::publish_control_request;
    use crate::orchestrator::lease::{ShardLease, MAX_SHARD_LEASE_BYTES};
    use crate::orchestrator::record_io;
    use crate::orchestrator::routing::Shard;
    use crate::orchestrator::shard_log::ShardCommandErrorKind;
    use crate::orchestrator::submission::submit_durable_for_run;
    use crate::orchestrator::work::{
        ApplyWorkV1, DesiredProjectionRef, StatePhase, StatePhaseV1, StateVersion, StateVersionRef,
        StateVersionV1, WorkKind, WorkManifest, WorkManifestV1,
    };
    use tempfile::tempdir;

    struct FixedClock(AtomicI64);

    impl FixedClock {
        fn new(seconds: i64) -> Self {
            Self(AtomicI64::new(seconds))
        }

        fn set(&self, seconds: i64) {
            self.0.store(seconds, Ordering::SeqCst);
        }
    }

    impl HandshakeClock for FixedClock {
        fn now(&self) -> DateTime<Utc> {
            DateTime::from_timestamp(self.0.load(Ordering::SeqCst), 0)
                .expect("fixture clock is representable")
        }
    }

    struct ManualRenewalClock {
        now: AtomicI64,
        ticks: Semaphore,
    }

    impl ManualRenewalClock {
        fn new(seconds: i64) -> Self {
            Self {
                now: AtomicI64::new(seconds),
                ticks: Semaphore::new(0),
            }
        }

        fn tick(&self, seconds: i64) {
            self.now.store(seconds, Ordering::SeqCst);
            self.ticks.add_permits(1);
        }
    }

    #[async_trait]
    impl RenewalClock for ManualRenewalClock {
        fn now(&self) -> DateTime<Utc> {
            DateTime::from_timestamp(self.now.load(Ordering::SeqCst), 0)
                .expect("fixture renewal clock is representable")
        }

        async fn wait(&self, _duration: Duration) {
            self.ticks
                .acquire()
                .await
                .expect("renewal clock remains open")
                .forget();
        }
    }

    struct AssertingCleaner {
        handle: Mutex<Option<ShardCommandHandle>>,
        discarded: Semaphore,
    }

    impl AssertingCleaner {
        fn new() -> Self {
            Self {
                handle: Mutex::new(None),
                discarded: Semaphore::new(0),
            }
        }
    }

    #[async_trait]
    impl ShardWorkspaceCleaner for AssertingCleaner {
        async fn discard(
            &self,
            _location: &ShardLogLocation,
        ) -> Result<(), Report<crate::local_disk::LocalDiskError>> {
            let handle = self
                .handle
                .lock()
                .await
                .clone()
                .expect("test installs command handle before renewal");
            let error = handle
                .propose(accepted_record())
                .await
                .expect_err("cleanup runs only after command admission and writer stop");
            assert!(matches!(
                error.kind,
                ShardCommandErrorKind::Closed | ShardCommandErrorKind::Fenced
            ));
            self.discarded.add_permits(1);
            Ok(())
        }
    }

    struct StageGate {
        stage: HandshakeStage,
        entered: Semaphore,
        release: Semaphore,
    }

    impl StageGate {
        fn new(stage: HandshakeStage) -> Self {
            Self {
                stage,
                entered: Semaphore::new(0),
                release: Semaphore::new(0),
            }
        }

        async fn wait_until_entered(&self) {
            self.entered
                .acquire()
                .await
                .expect("stage gate remains open")
                .forget();
        }

        fn resume(&self) {
            self.release.add_permits(1);
        }
    }

    #[async_trait]
    impl HandshakeObserver for StageGate {
        async fn reached(&self, stage: HandshakeStage) {
            if stage == self.stage {
                self.entered.add_permits(1);
                self.release
                    .acquire()
                    .await
                    .expect("stage gate remains open")
                    .forget();
            }
        }
    }

    fn tenant() -> TenantNamespace {
        TenantNamespace::parse("alice").expect("valid fixture tenant")
    }

    fn instant(seconds: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(seconds, 0).expect("fixture timestamp is representable")
    }

    fn lease_timing(lease_seconds: u64) -> LeaseTiming {
        LeaseTiming::new(
            Duration::from_secs(lease_seconds),
            Duration::from_secs(2),
            Duration::from_secs(1),
            Duration::from_secs(2),
            Duration::from_secs(1),
            Duration::from_secs(1),
            Duration::ZERO,
        )
        .expect("fixture timing is feasible")
    }

    fn shard() -> Shard {
        Shard::try_from(39).expect("valid fixture shard")
    }

    fn acquisition(result: ShardAcquisition) -> OwnedShard {
        match result {
            ShardAcquisition::Acquired(owned) => owned,
            other => panic!("expected acquired shard, got {other:?}"),
        }
    }

    async fn stop(owned: OwnedShard) {
        owned
            .started
            .handle
            .shutdown()
            .await
            .expect("request shard shutdown");
        owned
            .started
            .task
            .await
            .expect("shard task joins")
            .expect("shard stops cleanly");
    }

    fn blob(key: &str, value: char) -> BlobRef {
        BlobRef::V1(BlobRefV1 {
            key: key.to_owned(),
            sha256: value.to_string().repeat(64),
            size: 1,
            media_type: "application/json".to_owned(),
            e_tag: None,
            provider_version: None,
        })
    }

    fn accepted_record() -> JournalRecordV1 {
        let integration_id =
            CanonicalIntegrationId::parse("alice:supply-chain").expect("valid integration ID");
        assert_eq!(
            crate::orchestrator::routing::shard(&integration_id),
            shard()
        );
        JournalRecordV1::new(
            integration_id,
            JournalEvent::V1(JournalEventV1::RunAccepted(RunAcceptedV1 {
                run_id: RunId::parse("00000000-0000-4000-8000-000000000001").expect("valid run ID"),
                immutable_input: InputRef {
                    artifact: blob("inputs/one.json", 'a'),
                    definition_digest: "b".repeat(64),
                    definition_digest_encoding_version: 1,
                    planner_version: 1,
                },
                policy: PolicyRef {
                    artifact: blob("policies/one.json", 'c'),
                    policy_digest: "d".repeat(64),
                },
                submitted_at: "2026-07-22T00:00:00Z".to_owned(),
            })),
        )
        .expect("valid accepted record")
    }

    fn integration_on_fixture_shard(label: &str) -> CanonicalIntegrationId {
        (0_u32..10_000)
            .find_map(|index| {
                let candidate =
                    CanonicalIntegrationId::parse(format!("alice:{label}-{index}")).ok()?;
                (crate::orchestrator::routing::shard(&candidate) == shard()).then_some(candidate)
            })
            .expect("fixture integration routes to shard 39")
    }

    fn input_ref(label: &str) -> InputRef {
        InputRef {
            artifact: blob(&format!("inputs/{label}.json"), 'a'),
            definition_digest: "b".repeat(64),
            definition_digest_encoding_version: 1,
            planner_version: 1,
        }
    }

    fn policy_ref(label: &str) -> PolicyRef {
        PolicyRef {
            artifact: blob(&format!("policies/{label}.json"), 'c'),
            policy_digest: "d".repeat(64),
        }
    }

    fn apply_work_records(
        integration: CanonicalIntegrationId,
        run_id: RunId,
        effect_count: u64,
    ) -> (Vec<JournalRecordV1>, WorkId, String) {
        let state = StateVersionV1::new(
            None,
            StatePhase::V1(StatePhaseV1::SourcesCommitted),
            StateSnapshot::V1(StateSnapshotV1 {
                generation: 1,
                duckdb: blob("states/candidate.duckdb", '5'),
                accepted_batches: Vec::new(),
                created_at: "2026-07-21T10:00:00Z".to_owned(),
            }),
            DesiredProjectionRef {
                artifact: blob("states/desired.json", '6'),
            },
            "7".repeat(64),
            1,
            1,
            1,
            1,
        )
        .expect("valid candidate state");
        let state_record = StateVersion::V1(state.clone());
        let state_bytes = crate::orchestrator::registry::DurableRecord::encode(&state_record)
            .expect("encode state");
        let mut state_artifact = blob("states/candidate.json", '0');
        let BlobRef::V1(value) = &mut state_artifact;
        value.sha256 = hex::encode(Sha256::digest(&state_bytes));
        value.size = u64::try_from(state_bytes.len()).expect("state size");
        let candidate = StateVersionRef {
            id: state.id,
            artifact: state_artifact,
        };
        let manifest = WorkManifestV1::new(
            &integration,
            WorkKind::Apply(ApplyWorkV1 {
                run_id: run_id.clone(),
                candidate,
            }),
            blob("work/effects.ndjson", '8'),
            effect_count,
            1,
            1,
            "2026-07-21T10:01:00Z".to_owned(),
        )
        .expect("valid manifest");
        let work_id = manifest.work_id.clone();
        let manifest_record = WorkManifest::V1(manifest);
        let manifest_bytes = crate::orchestrator::registry::DurableRecord::encode(&manifest_record)
            .expect("encode manifest");
        let manifest_digest = hex::encode(Sha256::digest(&manifest_bytes));
        let mut manifest_artifact = blob("work/manifest.json", '0');
        let BlobRef::V1(value) = &mut manifest_artifact;
        value.sha256 = manifest_digest.clone();
        value.size = u64::try_from(manifest_bytes.len()).expect("manifest size");
        let manifest_ref = WorkManifestRef {
            work_id: work_id.clone(),
            artifact: manifest_artifact,
            manifest_digest: manifest_digest.clone(),
        };
        let record = |event| {
            JournalRecordV1::new(integration.clone(), JournalEvent::V1(event))
                .expect("valid work record")
        };
        (
            vec![
                JournalRecordV1::new(
                    integration.clone(),
                    JournalEvent::V1(JournalEventV1::RunAccepted(RunAcceptedV1 {
                        run_id: run_id.clone(),
                        immutable_input: input_ref("work"),
                        policy: policy_ref("work"),
                        submitted_at: "2026-07-22T00:00:00Z".to_owned(),
                    })),
                )
                .expect("accepted work run"),
                record(JournalEventV1::AttemptStarted(AttemptStartedV1 {
                    attempt_id: derive_attempt_id(&run_id, 1),
                    run_id,
                    attempt: 1,
                })),
                record(JournalEventV1::WorkPlanned(WorkPlannedV1 {
                    manifest: manifest_ref,
                    manifest_record,
                    candidate_state_record: Some(state_record),
                })),
            ],
            work_id,
            manifest_digest,
        )
    }

    #[tokio::test]
    async fn death_after_lease_cas_requires_and_allows_a_new_epoch() {
        let remote = tempdir().expect("create remote directory");
        let cache = tempdir().expect("create cache directory");
        let store = ArtifactStore::local(remote.path(), cache.path()).expect("open store");
        let tenant = tenant();
        let location = ShardLogLocation::disposable_local(shard(), &tenant, remote.path());
        let clock = Arc::new(FixedClock::new(1_700_000_000));
        let gate = Arc::new(StageGate::new(HandshakeStage::LeaseAcquired));

        let task = {
            let store = store.clone();
            let tenant = tenant.clone();
            let location = location.clone();
            let clock = clock.clone();
            let gate = gate.clone();
            tokio::spawn(async move {
                acquire_with(
                    &store,
                    &tenant,
                    location,
                    "runner-a",
                    lease_timing(10),
                    ShardCommandConfig::default(),
                    clock.as_ref(),
                    gate.as_ref(),
                )
                .await
            })
        };
        gate.wait_until_entered().await;

        let contended = acquire_with(
            &store,
            &tenant,
            location.clone(),
            "runner-b",
            lease_timing(10),
            ShardCommandConfig::default(),
            clock.as_ref(),
            &NoopObserver,
        )
        .await
        .expect("unexpired lease is ordinary contention");
        assert!(matches!(
            contended,
            ShardAcquisition::Contended(ref lease) if lease.lease_epoch == 1
        ));
        task.abort();
        assert!(task.await.expect_err("task is cancelled").is_cancelled());

        clock.set(1_700_000_010);
        let successor = acquisition(
            acquire_with(
                &store,
                &tenant,
                location,
                "runner-b",
                lease_timing(10),
                ShardCommandConfig::default(),
                clock.as_ref(),
                &NoopObserver,
            )
            .await
            .expect("successor completes a fresh handshake"),
        );
        assert_eq!(successor.lease.lease.lease_epoch, 2);
        stop(successor).await;
    }

    #[tokio::test]
    async fn exact_cas_version_is_revalidated_after_recovery_before_enable() {
        let remote = tempdir().expect("create remote directory");
        let cache = tempdir().expect("create cache directory");
        let store = ArtifactStore::local(remote.path(), cache.path()).expect("open store");
        let tenant = tenant();
        let location = ShardLogLocation::disposable_local(shard(), &tenant, remote.path());
        let clock = Arc::new(FixedClock::new(1_700_000_000));
        let gate = Arc::new(StageGate::new(HandshakeStage::RecoveryComplete));
        let lease_key = ControlPaths::new(tenant.clone()).lease(shard());

        let task = {
            let store = store.clone();
            let tenant = tenant.clone();
            let clock = clock.clone();
            let gate = gate.clone();
            tokio::spawn(async move {
                acquire_with(
                    &store,
                    &tenant,
                    location,
                    "runner-a",
                    lease_timing(10),
                    ShardCommandConfig::default(),
                    clock.as_ref(),
                    gate.as_ref(),
                )
                .await
            })
        };
        gate.wait_until_entered().await;

        let (record, version) =
            record_io::read_strict::<ShardLease>(&store, &lease_key, MAX_SHARD_LEASE_BYTES)
                .await
                .expect("read acquired lease")
                .expect("lease exists");
        let mut renewed = record.into_current().expect("valid current lease");
        renewed.expires_at = "2023-11-14T22:13:31.000000Z".to_owned();
        assert!(matches!(
            record_io::compare_and_swap(&store, &lease_key, &version, &ShardLease::V1(renewed))
                .await
                .expect("replace lease using exact version"),
            CasWrite::Written(_)
        ));
        gate.resume();

        let result = task
            .await
            .expect("handshake task joins")
            .expect("lease replacement is an ordinary loss");
        assert!(matches!(
            result,
            ShardAcquisition::LeaseLost(LeaseLossStage::BeforeEnable)
        ));
    }

    #[tokio::test]
    async fn abandoned_acquirer_churn_fences_then_recovers_through_a_fresh_handshake() {
        let remote = tempdir().expect("create remote directory");
        let cache_a = tempdir().expect("create first cache");
        let cache_b = tempdir().expect("create second cache");
        let store_a =
            ArtifactStore::local(remote.path(), cache_a.path()).expect("open first store");
        let store_b =
            ArtifactStore::local(remote.path(), cache_b.path()).expect("open second store");
        let tenant = tenant();
        let location = ShardLogLocation::disposable_local(shard(), &tenant, remote.path());
        let clock = Arc::new(FixedClock::new(1_700_000_000));
        let gate = Arc::new(StageGate::new(HandshakeStage::LeaseAcquired));

        let abandoned = {
            let store = store_a.clone();
            let tenant = tenant.clone();
            let location = location.clone();
            let clock = clock.clone();
            let gate = gate.clone();
            tokio::spawn(async move {
                acquire_with(
                    &store,
                    &tenant,
                    location,
                    "runner-a",
                    lease_timing(10),
                    ShardCommandConfig::default(),
                    clock.as_ref(),
                    gate.as_ref(),
                )
                .await
            })
        };
        gate.wait_until_entered().await;

        clock.set(1_700_000_010);
        let legitimate = acquisition(
            acquire_with(
                &store_b,
                &tenant,
                location.clone(),
                "runner-b",
                lease_timing(10),
                ShardCommandConfig::default(),
                clock.as_ref(),
                &NoopObserver,
            )
            .await
            .expect("legitimate successor acquires epoch two"),
        );
        assert_eq!(legitimate.lease.lease.lease_epoch, 2);

        gate.resume();
        let abandoned_result = abandoned
            .await
            .expect("abandoned handshake task joins")
            .expect("stale acquisition is an ordinary lease loss");
        assert!(matches!(
            abandoned_result,
            ShardAcquisition::LeaseLost(LeaseLossStage::AfterOpen)
        ));

        let fenced = legitimate
            .started
            .handle
            .propose(accepted_record())
            .await
            .expect_err("stale open fences the prior writer");
        assert_eq!(fenced.kind, ShardCommandErrorKind::Fenced);
        let terminal = legitimate
            .started
            .task
            .await
            .expect("fenced task joins")
            .expect_err("fenced owner terminates");
        assert_eq!(terminal.kind, ShardCommandErrorKind::Fenced);

        clock.set(1_700_000_020);
        let recovered = acquisition(
            acquire_with(
                &store_b,
                &tenant,
                location,
                "runner-c",
                lease_timing(10),
                ShardCommandConfig::default(),
                clock.as_ref(),
                &NoopObserver,
            )
            .await
            .expect("fresh epoch restores shard ownership"),
        );
        assert_eq!(recovered.lease.lease.lease_epoch, 3);
        clock.set(1_700_000_021);
        let mut scheduler = RecoveryScheduler::new(
            store_b,
            tenant,
            shard(),
            recovered.started.handle.clone(),
            LeaseGuard::new(recovered.lease.clone(), lease_timing(10)),
            Arc::new(|_request: &ControlRequestV1| true),
            NonZeroUsize::MIN,
            None,
        );
        assert!(matches!(
            scheduler
                .next(clock.now())
                .await
                .expect("fresh handshake enables scheduler")
                .action,
            SchedulerAction::Idle
        ));
        drop(scheduler);
        stop(recovered).await;
    }

    #[tokio::test]
    async fn chunk_admission_is_strict_at_the_lease_window_boundary() {
        let timing = LeaseTiming::new(
            Duration::from_secs(100),
            Duration::from_secs(20),
            Duration::from_secs(10),
            Duration::from_secs(40),
            Duration::from_secs(10),
            Duration::from_secs(10),
            Duration::ZERO,
        )
        .expect("feasible timing");
        let acquired = AcquiredLease {
            lease: ShardLeaseV1 {
                owner_id: "runner-a".to_owned(),
                lease_epoch: 1,
                acquired_at: "1970-01-01T00:00:00.000000Z".to_owned(),
                expires_at: "1970-01-01T00:01:40.000000Z".to_owned(),
            },
            version: crate::blob::CasVersion::V1(crate::blob::CasVersionV1 {
                e_tag: Some("one".to_owned()),
                provider_version: None,
            }),
        };
        let guard = LeaseGuard::new(acquired, timing);
        assert!(guard.admit_chunk(instant(39)).await.is_ok());
        assert!(matches!(
            guard.admit_chunk(instant(40)).await,
            Err(ChunkAdmission::RenewFirst)
        ));
        guard.mark_lost();
        assert!(matches!(
            guard.admit_chunk(instant(1)).await,
            Err(ChunkAdmission::OwnershipLost)
        ));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn dedicated_renewal_detects_conflict_while_blocking_work_is_busy_and_runs_loss_ladder() {
        let remote = tempdir().expect("remote");
        let cache_a = tempdir().expect("cache a");
        let cache_b = tempdir().expect("cache b");
        let store_a = ArtifactStore::local(remote.path(), cache_a.path()).expect("store a");
        let store_b = ArtifactStore::local(remote.path(), cache_b.path()).expect("store b");
        let tenant = tenant();
        let location = ShardLogLocation::disposable_local(shard(), &tenant, remote.path());
        let handshake_clock = FixedClock::new(1_700_000_000);
        let timing = LeaseTiming::new(
            Duration::from_secs(100),
            Duration::from_secs(10),
            Duration::from_secs(10),
            Duration::from_secs(40),
            Duration::from_secs(10),
            Duration::from_secs(10),
            Duration::ZERO,
        )
        .expect("feasible timing");
        let owned = acquisition(
            acquire_with(
                &store_a,
                &tenant,
                location,
                "runner-a",
                timing,
                ShardCommandConfig::default(),
                &handshake_clock,
                &NoopObserver,
            )
            .await
            .expect("acquire shard"),
        );
        let lease_key = ControlPaths::new(tenant.clone()).lease(shard());
        let renewal_clock = Arc::new(ManualRenewalClock::new(1_700_000_020));
        let cleaner = Arc::new(AssertingCleaner::new());
        let renewing = owned.start_renewing_with_clock(
            store_a,
            tenant,
            cleaner.clone(),
            renewal_clock.clone(),
        );
        *cleaner.handle.lock().await = Some(renewing.handle.clone());
        let guard = renewing.lease_guard.clone();

        let busy = tokio::task::spawn_blocking(|| {
            std::thread::sleep(Duration::from_millis(150));
        });
        for (now, expected_expiry) in [
            (1_700_000_020, 1_700_000_120),
            (1_700_000_040, 1_700_000_140),
        ] {
            renewal_clock.tick(now);
            tokio::time::timeout(Duration::from_secs(1), async {
                loop {
                    if guard.acquired().await.expires_at().expect("renewed expiry")
                        == instant(expected_expiry)
                    {
                        break;
                    }
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("dedicated renewal advances on schedule");
        }
        let current = guard.acquired().await;
        let replacement = match lease::renew(
            &store_b,
            &lease_key,
            &current,
            instant(1_700_000_060),
            Duration::from_secs(100),
        )
        .await
        .expect("external exact-version renewal")
        {
            RenewOutcome::Renewed(value) => value,
            other => panic!("expected replacement renewal, got {other:?}"),
        };
        assert_eq!(replacement.lease.lease_epoch, current.lease.lease_epoch);
        renewal_clock.tick(1_700_000_061);
        let reason = renewing
            .task
            .await
            .expect("renewal task joins")
            .expect("loss ladder succeeds");
        assert_eq!(reason, LeaseLossReason::Conflict);
        assert!(matches!(
            guard.admit_chunk(instant(1_700_000_061)).await,
            Err(ChunkAdmission::OwnershipLost)
        ));
        cleaner
            .discarded
            .acquire()
            .await
            .expect("cleanup signal")
            .forget();
        busy.await.expect("blocking work joins");
    }

    #[tokio::test]
    async fn control_and_receipt_floods_cannot_overtake_an_accepted_run() {
        let remote = tempdir().expect("remote");
        let cache = tempdir().expect("cache");
        let store = ArtifactStore::local(remote.path(), cache.path()).expect("store");
        let tenant = tenant();
        ensure_control_baseline(&store, &tenant)
            .await
            .expect("initialize control baseline");
        let timing = lease_timing(30);
        let owned = acquisition(
            acquire_with(
                &store,
                &tenant,
                ShardLogLocation::disposable_local(shard(), &tenant, remote.path()),
                "runner-a",
                timing,
                ShardCommandConfig::default(),
                &FixedClock::new(1_700_000_000),
                &NoopObserver,
            )
            .await
            .expect("acquire shard"),
        );
        let accepted = accepted_record();
        let JournalEvent::V1(event) = &accepted.event;
        let JournalEventV1::RunAccepted(event) = event else {
            unreachable!("fixture is RunAccepted")
        };
        let accepted_run_id = event.run_id.clone();
        owned
            .started
            .handle
            .propose(accepted.clone())
            .await
            .expect("seed accepted run");

        let receipt_integration = integration_on_fixture_shard("receipt-flood");
        submit_durable_for_run(
            &store,
            &tenant,
            receipt_integration,
            RunId::parse("00000000-0000-4000-8000-000000000010").expect("run ID"),
            input_ref("receipt"),
            policy_ref("receipt"),
            "2026-07-22T00:00:00Z".to_owned(),
        )
        .await
        .expect("submit competing ready receipt");

        let accepted_integration = accepted.integration_id;
        for index in 0..3 {
            let request = ControlRequestV1::new(
                tenant.clone(),
                accepted_integration.clone(),
                format!("actor:control-flood-{index}"),
                ControlCommandV1::CancelRun(CancelRunV1 {
                    run_id: RunId::generate(),
                    expected_run_revision: accepted.event_id.clone(),
                    expected_failed_work: None,
                }),
            )
            .expect("control request");
            publish_control_request(&store, &request)
                .await
                .expect("publish control request");
        }

        let guard = LeaseGuard::new(owned.lease.clone(), timing);
        let telemetry = store.telemetry();
        let mut scheduler = RecoveryScheduler::new(
            store,
            tenant,
            shard(),
            owned.started.handle.clone(),
            guard,
            Arc::new(|_request: &ControlRequestV1| true),
            NonZeroUsize::MIN,
            None,
        );
        for _turn in 0..2 {
            let turn = scheduler
                .next(instant(1_700_000_001))
                .await
                .expect("scheduler turn");
            assert_eq!(turn.controls_processed, 1);
            let SchedulerAction::AcceptedRun(run) = turn.action else {
                panic!("accepted recovery run must precede new receipts")
            };
            assert_eq!(run.run_id, accepted_run_id);
        }
        let observation = telemetry.snapshot(instant(1_700_000_003));
        let lane = observation
            .integrations
            .iter()
            .find(|lane| lane.run_id.as_deref() == Some(accepted_run_id.as_str()))
            .expect("scheduler publishes accepted-run observation");
        assert_eq!(lane.runnable_queue_age_ms, Some(2_000));
        assert_eq!(lane.retry_ready_age_ms, None);
        drop(scheduler);
        stop(owned).await;
    }

    #[tokio::test]
    async fn cancellation_promotes_its_exact_receipt_before_ready_list_order_matters() {
        let remote = tempdir().expect("remote");
        let cache = tempdir().expect("cache");
        let store = ArtifactStore::local(remote.path(), cache.path()).expect("store");
        let tenant = tenant();
        ensure_control_baseline(&store, &tenant)
            .await
            .expect("initialize control baseline");
        let timing = lease_timing(30);
        let owned = acquisition(
            acquire_with(
                &store,
                &tenant,
                ShardLogLocation::disposable_local(shard(), &tenant, remote.path()),
                "runner-a",
                timing,
                ShardCommandConfig::default(),
                &FixedClock::new(1_700_000_000),
                &NoopObserver,
            )
            .await
            .expect("acquire shard"),
        );
        let target_integration = integration_on_fixture_shard("cancel-target");
        let target_run = RunId::parse("ffffffff-ffff-4fff-8fff-ffffffffffff").expect("run ID");
        let submitted = submit_durable_for_run(
            &store,
            &tenant,
            target_integration.clone(),
            target_run.clone(),
            input_ref("cancel-target"),
            policy_ref("cancel-target"),
            "2026-07-22T00:00:00Z".to_owned(),
        )
        .await
        .expect("submit target receipt");
        submit_durable_for_run(
            &store,
            &tenant,
            integration_on_fixture_shard("lower-sorting-receipt"),
            RunId::parse("00000000-0000-4000-8000-000000000001").expect("run ID"),
            input_ref("lower"),
            policy_ref("lower"),
            "2026-07-22T00:00:00Z".to_owned(),
        )
        .await
        .expect("submit lower-sorting receipt");
        let cancellation = ControlRequestV1::new(
            tenant.clone(),
            target_integration,
            "actor:cancel".to_owned(),
            ControlCommandV1::CancelRun(CancelRunV1 {
                run_id: target_run.clone(),
                expected_run_revision: submitted.initial_revision,
                expected_failed_work: None,
            }),
        )
        .expect("cancellation request");
        publish_control_request(&store, &cancellation)
            .await
            .expect("publish cancellation");

        let guard = LeaseGuard::new(owned.lease.clone(), timing);
        let mut scheduler = RecoveryScheduler::new(
            store,
            tenant,
            shard(),
            owned.started.handle.clone(),
            guard,
            Arc::new(|_request: &ControlRequestV1| true),
            NonZeroUsize::MIN,
            None,
        );
        let turn = scheduler
            .next(instant(1_700_000_001))
            .await
            .expect("scheduler turn");
        assert_eq!(turn.controls_processed, 1);
        let target = owned
            .started
            .handle
            .inspect_run(target_run)
            .await
            .expect("inspect target")
            .expect("cancellation promoted target receipt");
        assert_eq!(
            target.status,
            crate::orchestrator::projection::RunStatus::Terminated
        );
        drop(scheduler);
        stop(owned).await;
    }

    #[tokio::test]
    async fn acquisition_renewal_cursor_loss_and_takeover_resume_one_durable_work_item() {
        let remote = tempdir().expect("remote");
        let cache_a = tempdir().expect("cache a");
        let cache_b = tempdir().expect("cache b");
        let store_a = ArtifactStore::local(remote.path(), cache_a.path()).expect("store a");
        let store_b = ArtifactStore::local(remote.path(), cache_b.path()).expect("store b");
        let tenant = tenant();
        ensure_control_baseline(&store_a, &tenant)
            .await
            .expect("initialize baseline");
        let timing = lease_timing(30);
        let location = ShardLogLocation::disposable_local(shard(), &tenant, remote.path());
        let owner_a = acquisition(
            acquire_with(
                &store_a,
                &tenant,
                location.clone(),
                "runner-a",
                timing,
                ShardCommandConfig::default(),
                &FixedClock::new(1_700_000_000),
                &NoopObserver,
            )
            .await
            .expect("first owner acquires"),
        );
        let integration = integration_on_fixture_shard("whole-phase-work");
        let run_id = RunId::parse("00000007-0000-4000-8000-000000000001").expect("run ID");
        let (records, work_id, manifest_digest) =
            apply_work_records(integration.clone(), run_id, 2);
        for record in records {
            owner_a
                .started
                .handle
                .propose(record)
                .await
                .expect("seed durable work");
        }

        let renewal_clock = Arc::new(ManualRenewalClock::new(1_700_000_005));
        let cleaner = Arc::new(AssertingCleaner::new());
        let renewing = owner_a.start_renewing_with_clock(
            store_a.clone(),
            tenant.clone(),
            cleaner.clone(),
            renewal_clock.clone(),
        );
        *cleaner.handle.lock().await = Some(renewing.handle.clone());
        let first_guard = renewing.lease_guard.clone();
        renewal_clock.tick(1_700_000_005);
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if first_guard.acquired().await.expires_at().expect("expiry")
                    == instant(1_700_000_035)
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("dedicated renewal completes");

        let first_scheduler = RecoveryScheduler::new(
            store_a,
            tenant.clone(),
            shard(),
            renewing.handle.clone(),
            first_guard.clone(),
            Arc::new(|_request: &ControlRequestV1| true),
            NonZeroUsize::MIN,
            None,
        );
        let candidates = first_scheduler
            .delivery_candidates()
            .await
            .expect("first owner discovers delivery lanes");
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].work_id, work_id);
        let WorkAdmission::Admitted { work, permit } = first_scheduler
            .admit_work(&candidates[0].work_id, instant(1_700_000_006))
            .await
            .expect("first owner admits durable work")
        else {
            panic!("planned durable work admits a chunk inside the lease window")
        };
        assert_eq!(work.work_id, work_id);
        assert_eq!(work.completed_effect_count, 0);
        assert!(permit.send_allowed());
        assert!(permit.cursor_allowed());
        renewing
            .handle
            .propose(
                JournalRecordV1::new(
                    integration,
                    JournalEvent::V1(JournalEventV1::WorkChunkCompleted(WorkChunkCompletedV1 {
                        work_id: work_id.clone(),
                        manifest_digest: manifest_digest.clone(),
                        completed_effect_count: 1,
                        last_effect_id: EffectId::parse("9".repeat(64)).expect("effect ID"),
                    })),
                )
                .expect("cursor record"),
            )
            .await
            .expect("commit first durable cursor");
        drop(first_scheduler);

        let current = first_guard.acquired().await;
        let replacement = match lease::renew(
            &store_b,
            &ControlPaths::new(tenant.clone()).lease(shard()),
            &current,
            instant(1_700_000_010),
            timing.lease_duration(),
        )
        .await
        .expect("competing exact-version renewal")
        {
            RenewOutcome::Renewed(value) => value,
            other => panic!("expected competing renewal, got {other:?}"),
        };
        renewal_clock.tick(1_700_000_011);
        assert_eq!(
            renewing
                .task
                .await
                .expect("renewal task joins")
                .expect("loss ladder completes"),
            LeaseLossReason::Conflict
        );

        let owner_b = acquisition(
            acquire_with(
                &store_b,
                &tenant,
                location,
                "runner-b",
                timing,
                ShardCommandConfig::default(),
                &FixedClock::new(
                    replacement
                        .expires_at()
                        .expect("replacement expiry")
                        .timestamp(),
                ),
                &NoopObserver,
            )
            .await
            .expect("second owner takes over after expiry"),
        );
        assert_eq!(owner_b.lease.lease.lease_epoch, 2);
        assert_eq!(owner_b.started.recovery.live_work.len(), 1);
        assert_eq!(
            owner_b.started.recovery.live_work[0].completed_effect_count,
            1
        );
        assert_eq!(owner_b.started.recovery.live_work[0].work_id, work_id);

        let second_scheduler = RecoveryScheduler::new(
            store_b,
            tenant,
            shard(),
            owner_b.started.handle.clone(),
            LeaseGuard::new(owner_b.lease.clone(), timing),
            Arc::new(|_request: &ControlRequestV1| true),
            NonZeroUsize::MIN,
            None,
        );
        let candidates = second_scheduler
            .delivery_candidates()
            .await
            .expect("takeover discovers the durable lane");
        assert_eq!(candidates.len(), 1);
        let WorkAdmission::Admitted { work, .. } = second_scheduler
            .admit_work(
                &candidates[0].work_id,
                replacement.expires_at().expect("replacement expiry")
                    + chrono::Duration::seconds(1),
            )
            .await
            .expect("takeover admits the durable work")
        else {
            panic!("takeover must resume durable foreground work")
        };
        assert_eq!(work.work_id, work_id);
        assert_eq!(work.completed_effect_count, 1);
        drop(second_scheduler);
        stop(owner_b).await;
    }

    #[tokio::test]
    async fn every_runnable_integration_in_a_shard_is_a_simultaneous_delivery_candidate() {
        let remote = tempdir().expect("remote");
        let cache = tempdir().expect("cache");
        let store = ArtifactStore::local(remote.path(), cache.path()).expect("store");
        let tenant = tenant();
        ensure_control_baseline(&store, &tenant)
            .await
            .expect("initialize baseline");
        let timing = lease_timing(30);
        let owned = acquisition(
            acquire_with(
                &store,
                &tenant,
                ShardLogLocation::disposable_local(shard(), &tenant, remote.path()),
                "runner-a",
                timing,
                ShardCommandConfig::default(),
                &FixedClock::new(1_700_000_000),
                &NoopObserver,
            )
            .await
            .expect("acquire shard"),
        );
        let first = integration_on_fixture_shard("delivery-lane-one");
        let second = integration_on_fixture_shard("delivery-lane-two");
        assert_ne!(first, second);
        let mut expected = std::collections::BTreeSet::new();
        for (index, integration) in [first, second].into_iter().enumerate() {
            let run_id = RunId::parse(format!("00000009-0000-4000-8000-00000000000{index}"))
                .expect("run ID");
            let (records, work_id, _digest) = apply_work_records(integration, run_id, 1);
            for record in records {
                owned
                    .started
                    .handle
                    .propose(record)
                    .await
                    .expect("seed durable work");
            }
            expected.insert(work_id);
        }
        let scheduler = RecoveryScheduler::new(
            store,
            tenant,
            shard(),
            owned.started.handle.clone(),
            LeaseGuard::new(owned.lease.clone(), timing),
            Arc::new(|_request: &ControlRequestV1| true),
            NonZeroUsize::MIN,
            None,
        );
        let discovered = scheduler
            .delivery_candidates()
            .await
            .expect("delivery discovery")
            .into_iter()
            .map(|work| work.work_id)
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(discovered, expected);
        drop(scheduler);
        stop(owned).await;
    }

    #[tokio::test]
    async fn reconcile_initiation_is_opt_in_paced_and_defers_to_foreground() {
        let remote = tempdir().expect("remote");
        let cache = tempdir().expect("cache");
        let store = ArtifactStore::local(remote.path(), cache.path()).expect("store");
        let tenant = tenant();
        ensure_control_baseline(&store, &tenant)
            .await
            .expect("initialize baseline");
        let timing = lease_timing(30);
        let owned = acquisition(
            acquire_with(
                &store,
                &tenant,
                ShardLogLocation::disposable_local(shard(), &tenant, remote.path()),
                "runner-a",
                timing,
                ShardCommandConfig::default(),
                &FixedClock::new(1_700_000_000),
                &NoopObserver,
            )
            .await
            .expect("acquire shard"),
        );
        let integration = integration_on_fixture_shard("reconcile-initiation");
        let run_id = RunId::parse("00000008-0000-4000-8000-000000000001").expect("run ID");
        let (records, work_id, manifest_digest) =
            apply_work_records(integration.clone(), run_id.clone(), 0);
        for record in records {
            owned
                .started
                .handle
                .propose(record)
                .await
                .expect("seed durable work");
        }

        let interval = Duration::from_secs(600);
        let guard = LeaseGuard::new(owned.lease.clone(), timing);
        let mut scheduler = RecoveryScheduler::new(
            store.clone(),
            tenant.clone(),
            shard(),
            owned.started.handle.clone(),
            guard.clone(),
            Arc::new(|_request: &ControlRequestV1| true),
            NonZeroUsize::MIN,
            Some(interval),
        );

        // Foreground Apply work is runnable: it is a delivery candidate, and
        // no reconciliation cycle may be initiated for the integration.
        let candidates = scheduler
            .delivery_candidates()
            .await
            .expect("delivery discovery");
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].work_id, work_id);
        let turn = scheduler
            .next(instant(1_700_000_001))
            .await
            .expect("foreground turn");
        assert!(matches!(turn.action, SchedulerAction::Idle));

        owned
            .started
            .handle
            .propose(
                JournalRecordV1::new(
                    integration.clone(),
                    JournalEvent::V1(JournalEventV1::WorkCompleted(
                        crate::orchestrator::events::WorkCompletedV1 {
                            work_id: work_id.clone(),
                            manifest_digest,
                        },
                    )),
                )
                .expect("work completion record"),
            )
            .await
            .expect("complete Apply work");
        let turn = scheduler
            .next(instant(1_700_000_002))
            .await
            .expect("finalize turn");
        let SchedulerAction::FinalizeRun {
            integration_id,
            run_id: finalize_run,
            result,
        } = turn.action
        else {
            panic!("completed Apply must finalize its run before maintenance")
        };
        assert_eq!(integration_id, integration);
        assert_eq!(finalize_run, run_id);
        owned
            .started
            .handle
            .propose(
                JournalRecordV1::new(
                    integration.clone(),
                    JournalEvent::V1(JournalEventV1::RunCompleted(
                        crate::orchestrator::events::RunCompletedV1 { run_id, result },
                    )),
                )
                .expect("run completion record"),
            )
            .await
            .expect("finalize run");

        // The applied integration is seeded as eligible immediately after
        // recovery; the first idle turn past the probe cadence initiates one
        // cycle. (Earlier turns consumed the coarse candidates-probe window.)
        tokio::time::sleep(RECONCILE_PROBE_INTERVAL + Duration::from_millis(100)).await;
        let turn = scheduler
            .next(instant(1_700_000_003))
            .await
            .expect("initiation turn");
        assert!(
            matches!(turn.action, SchedulerAction::PlanReconcile(ref candidate) if *candidate == integration),
            "expected PlanReconcile, got {:?}",
            turn.action
        );

        // Initiation is paced: within the interval the shard stays idle.
        let turn = scheduler
            .next(instant(1_700_000_004))
            .await
            .expect("paced turn");
        assert!(matches!(turn.action, SchedulerAction::Idle));

        // After the configured interval elapses the next cycle is due. The
        // pacing decision is pure over monotonic instants, so it is proven
        // without pausing the runtime under real journal I/O.
        assert_eq!(
            scheduler.select_reconcile_initiation(
                vec![integration.clone()],
                interval,
                Instant::now() + interval,
            ),
            Some(integration.clone())
        );

        // Without the operator opt-in no cycle is ever initiated.
        drop(scheduler);
        let mut disabled = RecoveryScheduler::new(
            store,
            tenant,
            shard(),
            owned.started.handle.clone(),
            guard,
            Arc::new(|_request: &ControlRequestV1| true),
            NonZeroUsize::MIN,
            None,
        );
        let turn = disabled
            .next(instant(1_700_000_006))
            .await
            .expect("disabled turn");
        assert!(matches!(turn.action, SchedulerAction::Idle));
        drop(disabled);
        stop(owned).await;
    }
}
