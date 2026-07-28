//! Throttled human progress and dependency-free operational observations.
//!
//! Durable execution never depends on this module. Producers update bounded
//! process-local counters and gauges from outcomes they already observed; no
//! Graph or object-store read is performed merely to populate telemetry.

use std::collections::BTreeMap;
use std::fmt;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;

const LOG_INTERVAL_MS: u64 = 10_000;
const MAX_OBSERVED_INTEGRATIONS: usize = 4_096;
const MAX_SIGNAL_ID_BYTES: usize = 1_024;
const INTEGRATIONS_PER_LOG_EVENT: usize = 8;

pub const OPERATIONAL_SIGNAL_SCHEMA_VERSION: u8 = 1;
pub const OPERATIONAL_EVENT_NAME: &str = "integrations.runtime.v1";
pub const OPERATIONAL_LANES_EVENT_NAME: &str = "integrations.runtime.lanes.v1";

/// Stable paths consumed by dashboards and alerts. The contract test compares
/// this manifest with a representative serialized observation, preventing a
/// field rename from silently breaking a scrape.
pub const OPERATIONAL_SIGNAL_PATHS: &[&str] = &[
    "disk.cache_bytes",
    "disk.duckdb_bytes",
    "disk.free_reserve_bytes",
    "disk.staging_bytes",
    "disk.workspace_available_bytes",
    "gc.inventoried_artifacts_total",
    "gc.inventoried_bytes_total",
    "gc.last_completed_at",
    "gc.quarantine_candidates_total",
    "gc.quarantine_bytes_total",
    "integrations[].active_work_kind",
    "integrations[].applied_state_id",
    "integrations[].attempt",
    "integrations[].blocked_age_ms",
    "integrations[].candidate_state_id",
    "integrations[].durable_cursor",
    "integrations[].effect_count",
    "integrations[].graph_429_total",
    "integrations[].graph_actor_mismatch",
    "integrations[].graph_requests_total",
    "integrations[].integration_path",
    "integrations[].last_completed_sweep_at",
    "integrations[].latest_trusted_graph_actor",
    "integrations[].maintenance",
    "integrations[].rate_class",
    "integrations[].rate_utilization_basis_points",
    "integrations[].reconciliation_lag_ms",
    "integrations[].resend_count",
    "integrations[].retry_ready_age_ms",
    "integrations[].run_id",
    "integrations[].runnable_queue_age_ms",
    "integrations[].work_id",
    "leases.fencing_errors_total",
    "leases.ownership_churn_total",
    "leases.renewal_failures_total",
    "object_store.copy_operations_total",
    "object_store.delete_operations_total",
    "object_store.failed_operations_total",
    "object_store.get_bytes_total",
    "object_store.get_operations_total",
    "object_store.head_operations_total",
    "object_store.list_operations_total",
    "object_store.multipart_aborts_total",
    "object_store.multipart_completions_total",
    "object_store.multipart_parts_total",
    "object_store.operation_latency_ms_total",
    "object_store.put_bytes_total",
    "object_store.put_operations_total",
    "observed_at",
    "rate.adaptive_rate_basis_points",
    "schema_version",
    "shards.known",
    "shards.oldest_unowned_age_ms",
    "shards.owned",
    "shards.unowned",
    "snapshots.corruption_fallbacks_total",
    "snapshots.latest_age_ms",
    "snapshots.published_total",
    "snapshots.replay_events_total",
    "snapshots.replay_time_ms_total",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObservationError {
    OwnedShardsExceedKnown,
    UnownedAgeWithoutUnownedShard,
    MissingUnownedAge,
    IntegrationPathEmpty,
    SignalIdTooLarge,
    SignalIdContainsControl,
    CursorExceedsEffectCount,
    UtilizationOutOfRange,
    TooManyIntegrations,
}

impl fmt::Display for ObservationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::OwnedShardsExceedKnown => "owned shard count exceeds known shard count",
            Self::UnownedAgeWithoutUnownedShard => {
                "oldest-unowned age is present when every known shard is owned"
            }
            Self::MissingUnownedAge => "oldest-unowned age is absent while shards are unowned",
            Self::IntegrationPathEmpty => "observed integration path is empty",
            Self::SignalIdTooLarge => "observability identifier exceeds its byte bound",
            Self::SignalIdContainsControl => {
                "observability identifier contains a control character"
            }
            Self::CursorExceedsEffectCount => "durable work cursor exceeds effect count",
            Self::UtilizationOutOfRange => "rate utilization exceeds 10000 basis points",
            Self::TooManyIntegrations => {
                "observability integration count exceeds its process-local bound"
            }
        })
    }
}

impl std::error::Error for ObservationError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservedWorkKind {
    Apply,
    Restore,
    Reconcile,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservedMaintenance {
    Healthy,
    RestoreRequired,
    Restoring,
    RestoreBlocked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservedRateClass {
    Foreground,
    Reconcile,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct ShardSignalsV1 {
    pub known: u64,
    pub owned: u64,
    pub unowned: u64,
    pub oldest_unowned_age_ms: Option<u64>,
}

impl ShardSignalsV1 {
    pub fn new(
        known: u64,
        owned: u64,
        oldest_unowned_age: Option<Duration>,
    ) -> Result<Self, ObservationError> {
        let unowned = known
            .checked_sub(owned)
            .ok_or(ObservationError::OwnedShardsExceedKnown)?;
        match (unowned, oldest_unowned_age) {
            (0, Some(_)) => return Err(ObservationError::UnownedAgeWithoutUnownedShard),
            (_, None) if unowned > 0 => return Err(ObservationError::MissingUnownedAge),
            _ => {}
        }
        Ok(Self {
            known,
            owned,
            unowned,
            oldest_unowned_age_ms: oldest_unowned_age.map(duration_millis),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct DiskSignalsV1 {
    pub duckdb_bytes: u64,
    pub cache_bytes: u64,
    pub staging_bytes: u64,
    pub workspace_available_bytes: u64,
    pub free_reserve_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IntegrationSignalsV1 {
    pub integration_path: String,
    pub run_id: Option<String>,
    pub work_id: Option<String>,
    pub runnable_queue_age_ms: Option<u64>,
    pub attempt: Option<u64>,
    pub retry_ready_age_ms: Option<u64>,
    pub active_work_kind: Option<ObservedWorkKind>,
    pub effect_count: Option<u64>,
    pub durable_cursor: Option<u64>,
    pub resend_count: u64,
    pub blocked_age_ms: Option<u64>,
    pub applied_state_id: Option<String>,
    pub candidate_state_id: Option<String>,
    pub maintenance: Option<ObservedMaintenance>,
    pub reconciliation_lag_ms: Option<u64>,
    pub last_completed_sweep_at: Option<String>,
    pub latest_trusted_graph_actor: Option<String>,
    pub graph_actor_mismatch: bool,
    pub rate_class: Option<ObservedRateClass>,
    pub graph_requests_total: u64,
    pub graph_429_total: u64,
    pub rate_utilization_basis_points: u16,
}

impl IntegrationSignalsV1 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        integration_path: impl Into<String>,
        run_id: Option<String>,
        work_id: Option<String>,
        active_work_kind: Option<ObservedWorkKind>,
        effect_count: Option<u64>,
        durable_cursor: Option<u64>,
        applied_state_id: Option<String>,
        candidate_state_id: Option<String>,
        maintenance: ObservedMaintenance,
    ) -> Result<Self, ObservationError> {
        let value = Self {
            integration_path: integration_path.into(),
            run_id,
            work_id,
            runnable_queue_age_ms: None,
            attempt: None,
            retry_ready_age_ms: None,
            active_work_kind,
            effect_count,
            durable_cursor,
            resend_count: 0,
            blocked_age_ms: None,
            applied_state_id,
            candidate_state_id,
            maintenance: Some(maintenance),
            reconciliation_lag_ms: None,
            last_completed_sweep_at: None,
            latest_trusted_graph_actor: None,
            graph_actor_mismatch: false,
            rate_class: None,
            graph_requests_total: 0,
            graph_429_total: 0,
            rate_utilization_basis_points: 0,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), ObservationError> {
        if self.integration_path.is_empty() {
            return Err(ObservationError::IntegrationPathEmpty);
        }
        validate_signal_id(&self.integration_path)?;
        for value in [
            self.run_id.as_deref(),
            self.work_id.as_deref(),
            self.applied_state_id.as_deref(),
            self.candidate_state_id.as_deref(),
            self.latest_trusted_graph_actor.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            validate_signal_id(value)?;
        }
        if self
            .durable_cursor
            .zip(self.effect_count)
            .is_some_and(|(cursor, count)| cursor > count)
        {
            return Err(ObservationError::CursorExceedsEffectCount);
        }
        if self.rate_utilization_basis_points > 10_000 {
            return Err(ObservationError::UtilizationOutOfRange);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct LeaseSignalsV1 {
    pub renewal_failures_total: u64,
    pub ownership_churn_total: u64,
    pub fencing_errors_total: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SnapshotSignalsV1 {
    pub latest_age_ms: Option<u64>,
    pub published_total: u64,
    pub replay_events_total: u64,
    pub replay_time_ms_total: u64,
    pub corruption_fallbacks_total: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct ObjectStoreSignalsV1 {
    pub get_operations_total: u64,
    pub put_operations_total: u64,
    pub head_operations_total: u64,
    pub list_operations_total: u64,
    pub delete_operations_total: u64,
    pub copy_operations_total: u64,
    pub failed_operations_total: u64,
    pub get_bytes_total: u64,
    pub put_bytes_total: u64,
    pub operation_latency_ms_total: u64,
    pub multipart_parts_total: u64,
    pub multipart_completions_total: u64,
    pub multipart_aborts_total: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RateSignalsV1 {
    pub adaptive_rate_basis_points: u16,
}

impl Default for RateSignalsV1 {
    fn default() -> Self {
        Self {
            adaptive_rate_basis_points: 10_000,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct GcSignalsV1 {
    pub last_completed_at: Option<String>,
    pub inventoried_artifacts_total: u64,
    pub inventoried_bytes_total: u64,
    pub quarantine_candidates_total: u64,
    pub quarantine_bytes_total: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OperationalSnapshotV1 {
    pub schema_version: u8,
    pub observed_at: String,
    pub shards: ShardSignalsV1,
    pub leases: LeaseSignalsV1,
    pub integrations: Vec<IntegrationSignalsV1>,
    pub snapshots: SnapshotSignalsV1,
    pub disk: DiskSignalsV1,
    pub object_store: ObjectStoreSignalsV1,
    pub rate: RateSignalsV1,
    pub gc: GcSignalsV1,
}

#[derive(Serialize)]
struct IntegrationSignalBatchV1<'a> {
    schema_version: u8,
    observed_at: &'a str,
    integrations: &'a [IntegrationSignalsV1],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ObjectStoreOperation {
    Get,
    Put,
    Head,
    List,
    Delete,
    Copy,
}

#[derive(Debug, Default)]
struct Counters {
    lease_renewal_failures: AtomicU64,
    ownership_churn: AtomicU64,
    fencing_errors: AtomicU64,
    snapshots_published: AtomicU64,
    snapshot_replay_events: AtomicU64,
    snapshot_replay_time_ms: AtomicU64,
    snapshot_corruption_fallbacks: AtomicU64,
    store_gets: AtomicU64,
    store_puts: AtomicU64,
    store_heads: AtomicU64,
    store_lists: AtomicU64,
    store_deletes: AtomicU64,
    store_copies: AtomicU64,
    store_failures: AtomicU64,
    store_get_bytes: AtomicU64,
    store_put_bytes: AtomicU64,
    store_latency_ms: AtomicU64,
    multipart_parts: AtomicU64,
    multipart_completions: AtomicU64,
    multipart_aborts: AtomicU64,
}

#[derive(Debug, Default)]
struct Gauges {
    shards: ShardSignalsV1,
    integrations: BTreeMap<String, IntegrationSignalsV1>,
    integration_ages: BTreeMap<String, IntegrationAgeAnchors>,
    latest_snapshot_created_at: Option<DateTime<Utc>>,
    disk: DiskSignalsV1,
    rate: RateSignalsV1,
    gc: GcSignalsV1,
}

#[derive(Debug, Clone)]
struct AgeAnchor {
    identity: String,
    observed_at: DateTime<Utc>,
}

impl AgeAnchor {
    fn observe(slot: &mut Option<Self>, identity: &str, observed_at: DateTime<Utc>) {
        if slot
            .as_ref()
            .is_none_or(|current| current.identity != identity)
        {
            *slot = Some(Self {
                identity: identity.to_owned(),
                observed_at,
            });
        }
    }

    fn age_ms(&self, observed_at: DateTime<Utc>) -> u64 {
        observed_at
            .signed_duration_since(self.observed_at)
            .to_std()
            .map_or(0, duration_millis)
    }
}

#[derive(Debug, Clone, Default)]
struct IntegrationAgeAnchors {
    runnable: Option<AgeAnchor>,
    retry_ready: Option<AgeAnchor>,
    blocked: Option<AgeAnchor>,
    last_reconciliation_completed_at: Option<DateTime<Utc>>,
}

/// Cloneable process-local instrumentation handle. Counters saturate rather
/// than wrap and poisoned gauge locks recover their last value. Neither
/// recording nor rendering can stop durable execution.
#[derive(Debug, Clone, Default)]
pub struct OperationalTelemetry {
    counters: Arc<Counters>,
    gauges: Arc<Mutex<Gauges>>,
}

impl OperationalTelemetry {
    pub fn set_shards(&self, value: ShardSignalsV1) {
        self.with_gauges(|gauges| gauges.shards = value);
    }

    pub fn set_disk(&self, value: DiskSignalsV1) {
        self.with_gauges(|gauges| gauges.disk = value);
    }

    pub fn set_adaptive_rate_basis_points(
        &self,
        basis_points: u16,
    ) -> Result<(), ObservationError> {
        if basis_points > 10_000 {
            return Err(ObservationError::UtilizationOutOfRange);
        }
        self.with_gauges(|gauges| gauges.rate.adaptive_rate_basis_points = basis_points);
        Ok(())
    }

    pub fn upsert_integration(
        &self,
        mut value: IntegrationSignalsV1,
    ) -> Result<(), ObservationError> {
        value.validate()?;
        self.with_gauges_result(|gauges| {
            if !gauges.integrations.contains_key(&value.integration_path)
                && gauges.integrations.len() >= MAX_OBSERVED_INTEGRATIONS
            {
                return Err(ObservationError::TooManyIntegrations);
            }
            if let Some(previous) = gauges.integrations.get(&value.integration_path) {
                value.resend_count = value.resend_count.max(previous.resend_count);
                value.graph_requests_total = value
                    .graph_requests_total
                    .max(previous.graph_requests_total);
                value.graph_429_total = value.graph_429_total.max(previous.graph_429_total);
                if value.rate_utilization_basis_points == 0 {
                    value.rate_utilization_basis_points = previous.rate_utilization_basis_points;
                }
                if value.rate_class.is_none() {
                    value.rate_class = previous.rate_class;
                }
                // Lifecycle, reconciliation, actor-audit, and rate owners all
                // contribute disjoint fields to one lane. A scheduler refresh
                // must not erase evidence supplied by another owner.
                if value.runnable_queue_age_ms.is_none() {
                    value.runnable_queue_age_ms = previous.runnable_queue_age_ms;
                }
                if value.retry_ready_age_ms.is_none() {
                    value.retry_ready_age_ms = previous.retry_ready_age_ms;
                }
                if value.blocked_age_ms.is_none() {
                    value.blocked_age_ms = previous.blocked_age_ms;
                }
                if value.reconciliation_lag_ms.is_none() {
                    value.reconciliation_lag_ms = previous.reconciliation_lag_ms;
                }
                if value.last_completed_sweep_at.is_none() {
                    value.last_completed_sweep_at = previous.last_completed_sweep_at.clone();
                }
                if value.latest_trusted_graph_actor.is_none() {
                    value.latest_trusted_graph_actor = previous.latest_trusted_graph_actor.clone();
                    value.graph_actor_mismatch = previous.graph_actor_mismatch;
                }
            }
            gauges
                .integrations
                .insert(value.integration_path.clone(), value);
            Ok(())
        })
    }

    pub fn remove_integration(&self, integration_path: &str) {
        self.with_gauges(|gauges| {
            gauges.integrations.remove(integration_path);
            gauges.integration_ages.remove(integration_path);
        });
    }

    pub(crate) fn observe_runnable_run(
        &self,
        integration_path: &str,
        run_id: &str,
        retry_ready: bool,
        observed_at: DateTime<Utc>,
    ) {
        if integration_path.is_empty()
            || validate_signal_id(integration_path).is_err()
            || validate_signal_id(run_id).is_err()
        {
            return;
        }
        self.with_gauges(|gauges| {
            if !gauges.integrations.contains_key(integration_path)
                && gauges.integrations.len() >= MAX_OBSERVED_INTEGRATIONS
            {
                return;
            }
            gauges
                .integrations
                .entry(integration_path.to_owned())
                .or_insert_with(|| minimal_integration_signals(integration_path));
            let anchors = gauges
                .integration_ages
                .entry(integration_path.to_owned())
                .or_default();
            AgeAnchor::observe(&mut anchors.runnable, run_id, observed_at);
            if retry_ready {
                AgeAnchor::observe(&mut anchors.retry_ready, run_id, observed_at);
            } else {
                anchors.retry_ready = None;
            }
        });
    }

    pub(crate) fn clear_runnable_run(&self, integration_path: &str, run_id: &str) {
        self.with_gauges(|gauges| {
            let Some(anchors) = gauges.integration_ages.get_mut(integration_path) else {
                return;
            };
            if anchors
                .runnable
                .as_ref()
                .is_some_and(|anchor| anchor.identity == run_id)
            {
                anchors.runnable = None;
            }
            if anchors
                .retry_ready
                .as_ref()
                .is_some_and(|anchor| anchor.identity == run_id)
            {
                anchors.retry_ready = None;
            }
        });
    }

    pub(crate) fn observe_blocked_work(
        &self,
        integration_path: &str,
        work_id: &str,
        observed_at: DateTime<Utc>,
    ) {
        if integration_path.is_empty()
            || validate_signal_id(integration_path).is_err()
            || validate_signal_id(work_id).is_err()
        {
            return;
        }
        self.with_gauges(|gauges| {
            if !gauges.integrations.contains_key(integration_path)
                && gauges.integrations.len() >= MAX_OBSERVED_INTEGRATIONS
            {
                return;
            }
            gauges
                .integrations
                .entry(integration_path.to_owned())
                .or_insert_with(|| minimal_integration_signals(integration_path));
            let anchors = gauges
                .integration_ages
                .entry(integration_path.to_owned())
                .or_default();
            AgeAnchor::observe(&mut anchors.blocked, work_id, observed_at);
        });
    }

    pub(crate) fn clear_blocked_work(&self, integration_path: &str, work_id: &str) {
        self.with_gauges(|gauges| {
            let Some(anchors) = gauges.integration_ages.get_mut(integration_path) else {
                return;
            };
            if anchors
                .blocked
                .as_ref()
                .is_some_and(|anchor| anchor.identity == work_id)
            {
                anchors.blocked = None;
            }
        });
    }

    pub(crate) fn record_lane_settlement(
        &self,
        integration_path: &str,
        class: ObservedRateClass,
        used_requests: u32,
    ) {
        if validate_signal_id(integration_path).is_err() || integration_path.is_empty() {
            return;
        }
        self.with_gauges(|gauges| {
            if !gauges.integrations.contains_key(integration_path)
                && gauges.integrations.len() >= MAX_OBSERVED_INTEGRATIONS
            {
                return;
            }
            let lane = gauges
                .integrations
                .entry(integration_path.to_owned())
                .or_insert_with(|| minimal_integration_signals(integration_path));
            lane.rate_class = Some(class);
            lane.graph_requests_total = lane
                .graph_requests_total
                .saturating_add(u64::from(used_requests));
        });
    }

    /// Sets utilization measured by the rate owner's reporting window. It is
    /// deliberately separate from chunk settlement: used/max-chunk is budget
    /// efficiency, not rate utilization.
    pub fn set_lane_rate_utilization(
        &self,
        integration_path: &str,
        class: ObservedRateClass,
        basis_points: u16,
    ) -> Result<(), ObservationError> {
        if integration_path.is_empty() {
            return Err(ObservationError::IntegrationPathEmpty);
        }
        validate_signal_id(integration_path)?;
        if basis_points > 10_000 {
            return Err(ObservationError::UtilizationOutOfRange);
        }
        self.with_gauges_result(|gauges| {
            if !gauges.integrations.contains_key(integration_path)
                && gauges.integrations.len() >= MAX_OBSERVED_INTEGRATIONS
            {
                return Err(ObservationError::TooManyIntegrations);
            }
            let lane = gauges
                .integrations
                .entry(integration_path.to_owned())
                .or_insert_with(|| minimal_integration_signals(integration_path));
            lane.rate_class = Some(class);
            lane.rate_utilization_basis_points = basis_points;
            Ok(())
        })
    }

    pub(crate) fn record_graph_429(&self, integration_path: &str) {
        if validate_signal_id(integration_path).is_err() || integration_path.is_empty() {
            return;
        }
        self.with_gauges(|gauges| {
            if !gauges.integrations.contains_key(integration_path)
                && gauges.integrations.len() >= MAX_OBSERVED_INTEGRATIONS
            {
                return;
            }
            let lane = gauges
                .integrations
                .entry(integration_path.to_owned())
                .or_insert_with(|| minimal_integration_signals(integration_path));
            lane.graph_429_total = lane.graph_429_total.saturating_add(1);
        });
    }

    pub(crate) fn record_resend(&self, integration_path: &str) {
        if validate_signal_id(integration_path).is_err() || integration_path.is_empty() {
            return;
        }
        self.with_gauges(|gauges| {
            if !gauges.integrations.contains_key(integration_path)
                && gauges.integrations.len() >= MAX_OBSERVED_INTEGRATIONS
            {
                return;
            }
            let lane = gauges
                .integrations
                .entry(integration_path.to_owned())
                .or_insert_with(|| minimal_integration_signals(integration_path));
            lane.resend_count = lane.resend_count.saturating_add(1);
        });
    }

    pub(crate) fn record_reconciliation_completed(
        &self,
        integration_path: &str,
        completed_at: DateTime<Utc>,
    ) {
        if validate_signal_id(integration_path).is_err() || integration_path.is_empty() {
            return;
        }
        self.with_gauges(|gauges| {
            if !gauges.integrations.contains_key(integration_path)
                && gauges.integrations.len() >= MAX_OBSERVED_INTEGRATIONS
            {
                return;
            }
            let lane = gauges
                .integrations
                .entry(integration_path.to_owned())
                .or_insert_with(|| minimal_integration_signals(integration_path));
            lane.reconciliation_lag_ms = Some(0);
            lane.last_completed_sweep_at =
                Some(completed_at.to_rfc3339_opts(SecondsFormat::Millis, true));
            gauges
                .integration_ages
                .entry(integration_path.to_owned())
                .or_default()
                .last_reconciliation_completed_at = Some(completed_at);
        });
    }

    pub fn record_graph_actor_audit(
        &self,
        integration_path: &str,
        trusted_actor: &str,
        configured_actor: &str,
    ) -> Result<(), ObservationError> {
        if integration_path.is_empty() {
            return Err(ObservationError::IntegrationPathEmpty);
        }
        validate_signal_id(integration_path)?;
        validate_signal_id(trusted_actor)?;
        validate_signal_id(configured_actor)?;
        self.with_gauges_result(|gauges| {
            if !gauges.integrations.contains_key(integration_path)
                && gauges.integrations.len() >= MAX_OBSERVED_INTEGRATIONS
            {
                return Err(ObservationError::TooManyIntegrations);
            }
            let lane = gauges
                .integrations
                .entry(integration_path.to_owned())
                .or_insert_with(|| minimal_integration_signals(integration_path));
            lane.latest_trusted_graph_actor = Some(trusted_actor.to_owned());
            lane.graph_actor_mismatch = trusted_actor != configured_actor;
            Ok(())
        })
    }

    pub(crate) fn record_lease_renewal_failure(&self) {
        saturating_increment(&self.counters.lease_renewal_failures, 1);
    }

    pub(crate) fn record_ownership_churn(&self) {
        saturating_increment(&self.counters.ownership_churn, 1);
    }

    pub(crate) fn record_fencing_error(&self) {
        saturating_increment(&self.counters.fencing_errors, 1);
    }

    pub(crate) fn record_snapshot_published(&self, created_at: DateTime<Utc>) {
        saturating_increment(&self.counters.snapshots_published, 1);
        self.with_gauges(|gauges| gauges.latest_snapshot_created_at = Some(created_at));
    }

    pub(crate) fn record_snapshot_recovery(
        &self,
        replayed_events: u64,
        elapsed: Duration,
        corruption_fallbacks: u64,
        latest_snapshot_created_at: Option<DateTime<Utc>>,
    ) {
        saturating_increment(&self.counters.snapshot_replay_events, replayed_events);
        saturating_increment(
            &self.counters.snapshot_replay_time_ms,
            duration_millis(elapsed),
        );
        saturating_increment(
            &self.counters.snapshot_corruption_fallbacks,
            corruption_fallbacks,
        );
        self.with_gauges(|gauges| {
            gauges.latest_snapshot_created_at = latest_snapshot_created_at;
        });
    }

    pub(crate) fn record_object_store_operation(
        &self,
        operation: ObjectStoreOperation,
        bytes: u64,
        elapsed: Duration,
        succeeded: bool,
    ) {
        let operations = match operation {
            ObjectStoreOperation::Get => &self.counters.store_gets,
            ObjectStoreOperation::Put => &self.counters.store_puts,
            ObjectStoreOperation::Head => &self.counters.store_heads,
            ObjectStoreOperation::List => &self.counters.store_lists,
            ObjectStoreOperation::Delete => &self.counters.store_deletes,
            ObjectStoreOperation::Copy => &self.counters.store_copies,
        };
        saturating_increment(operations, 1);
        if !succeeded {
            saturating_increment(&self.counters.store_failures, 1);
        }
        match operation {
            ObjectStoreOperation::Get => {
                saturating_increment(&self.counters.store_get_bytes, bytes);
            }
            ObjectStoreOperation::Put => {
                saturating_increment(&self.counters.store_put_bytes, bytes);
            }
            ObjectStoreOperation::Head
            | ObjectStoreOperation::List
            | ObjectStoreOperation::Delete
            | ObjectStoreOperation::Copy => {}
        }
        saturating_increment(&self.counters.store_latency_ms, duration_millis(elapsed));
    }

    pub(crate) fn record_multipart_part(&self, bytes: u64, elapsed: Duration, succeeded: bool) {
        saturating_increment(&self.counters.multipart_parts, 1);
        self.record_object_store_operation(ObjectStoreOperation::Put, bytes, elapsed, succeeded);
    }

    pub(crate) fn record_multipart_complete(&self, elapsed: Duration, succeeded: bool) {
        saturating_increment(&self.counters.multipart_completions, 1);
        if !succeeded {
            saturating_increment(&self.counters.store_failures, 1);
        }
        saturating_increment(&self.counters.store_latency_ms, duration_millis(elapsed));
    }

    pub(crate) fn record_multipart_abort(&self, elapsed: Duration, succeeded: bool) {
        saturating_increment(&self.counters.multipart_aborts, 1);
        if !succeeded {
            saturating_increment(&self.counters.store_failures, 1);
        }
        saturating_increment(&self.counters.store_latency_ms, duration_millis(elapsed));
    }

    pub(crate) fn record_gc(
        &self,
        completed_at: String,
        inventoried_artifacts: u64,
        inventoried_bytes: u64,
        quarantine_candidates: u64,
        quarantine_bytes: u64,
    ) {
        self.with_gauges(|gauges| {
            gauges.gc = GcSignalsV1 {
                last_completed_at: Some(completed_at),
                inventoried_artifacts_total: inventoried_artifacts,
                inventoried_bytes_total: inventoried_bytes,
                quarantine_candidates_total: quarantine_candidates,
                quarantine_bytes_total: quarantine_bytes,
            };
        });
    }

    pub fn snapshot(&self, observed_at: DateTime<Utc>) -> OperationalSnapshotV1 {
        let gauges = self
            .gauges
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let integrations = gauges
            .integrations
            .values()
            .cloned()
            .map(|mut integration| {
                if let Some(anchors) = gauges.integration_ages.get(&integration.integration_path) {
                    integration.runnable_queue_age_ms = anchors
                        .runnable
                        .as_ref()
                        .map(|anchor| anchor.age_ms(observed_at));
                    integration.retry_ready_age_ms = anchors
                        .retry_ready
                        .as_ref()
                        .map(|anchor| anchor.age_ms(observed_at));
                    integration.blocked_age_ms = anchors
                        .blocked
                        .as_ref()
                        .map(|anchor| anchor.age_ms(observed_at));
                    if let Some(completed_at) = anchors.last_reconciliation_completed_at {
                        integration.reconciliation_lag_ms = Some(
                            observed_at
                                .signed_duration_since(completed_at)
                                .to_std()
                                .map_or(0, duration_millis),
                        );
                    }
                }
                integration
            })
            .collect();
        OperationalSnapshotV1 {
            schema_version: OPERATIONAL_SIGNAL_SCHEMA_VERSION,
            observed_at: observed_at.to_rfc3339_opts(SecondsFormat::Millis, true),
            shards: gauges.shards.clone(),
            leases: LeaseSignalsV1 {
                renewal_failures_total: self
                    .counters
                    .lease_renewal_failures
                    .load(Ordering::Relaxed),
                ownership_churn_total: self.counters.ownership_churn.load(Ordering::Relaxed),
                fencing_errors_total: self.counters.fencing_errors.load(Ordering::Relaxed),
            },
            integrations,
            snapshots: SnapshotSignalsV1 {
                latest_age_ms: gauges.latest_snapshot_created_at.and_then(|created_at| {
                    observed_at
                        .signed_duration_since(created_at)
                        .to_std()
                        .ok()
                        .map(duration_millis)
                }),
                published_total: self.counters.snapshots_published.load(Ordering::Relaxed),
                replay_events_total: self.counters.snapshot_replay_events.load(Ordering::Relaxed),
                replay_time_ms_total: self
                    .counters
                    .snapshot_replay_time_ms
                    .load(Ordering::Relaxed),
                corruption_fallbacks_total: self
                    .counters
                    .snapshot_corruption_fallbacks
                    .load(Ordering::Relaxed),
            },
            disk: gauges.disk.clone(),
            object_store: ObjectStoreSignalsV1 {
                get_operations_total: self.counters.store_gets.load(Ordering::Relaxed),
                put_operations_total: self.counters.store_puts.load(Ordering::Relaxed),
                head_operations_total: self.counters.store_heads.load(Ordering::Relaxed),
                list_operations_total: self.counters.store_lists.load(Ordering::Relaxed),
                delete_operations_total: self.counters.store_deletes.load(Ordering::Relaxed),
                copy_operations_total: self.counters.store_copies.load(Ordering::Relaxed),
                failed_operations_total: self.counters.store_failures.load(Ordering::Relaxed),
                get_bytes_total: self.counters.store_get_bytes.load(Ordering::Relaxed),
                put_bytes_total: self.counters.store_put_bytes.load(Ordering::Relaxed),
                operation_latency_ms_total: self.counters.store_latency_ms.load(Ordering::Relaxed),
                multipart_parts_total: self.counters.multipart_parts.load(Ordering::Relaxed),
                multipart_completions_total: self
                    .counters
                    .multipart_completions
                    .load(Ordering::Relaxed),
                multipart_aborts_total: self.counters.multipart_aborts.load(Ordering::Relaxed),
            },
            rate: gauges.rate.clone(),
            gc: gauges.gc.clone(),
        }
    }

    /// Emits one bounded structured event. The JSON field is intentional: it
    /// preserves the nested V1 schema across tracing backends without adding a
    /// metrics exporter dependency. Serialization failure is non-fatal.
    pub fn emit(&self, observed_at: DateTime<Utc>) {
        let mut snapshot = self.snapshot(observed_at);
        let integrations = std::mem::take(&mut snapshot.integrations);
        match serde_json::to_string(&snapshot) {
            Ok(signals) => tracing::info!(
                target: "integrations_rs::operations",
                event = OPERATIONAL_EVENT_NAME,
                schema_version = OPERATIONAL_SIGNAL_SCHEMA_VERSION,
                signals = %signals,
                "runtime operational observation"
            ),
            Err(_error) => tracing::warn!(
                target: "integrations_rs::operations",
                event = "integrations.runtime.encode_failed",
                "runtime operational observation could not be encoded"
            ),
        }
        for integrations in integrations.chunks(INTEGRATIONS_PER_LOG_EVENT) {
            let batch = IntegrationSignalBatchV1 {
                schema_version: OPERATIONAL_SIGNAL_SCHEMA_VERSION,
                observed_at: &snapshot.observed_at,
                integrations,
            };
            match serde_json::to_string(&batch) {
                Ok(signals) => tracing::info!(
                    target: "integrations_rs::operations",
                    event = OPERATIONAL_LANES_EVENT_NAME,
                    schema_version = OPERATIONAL_SIGNAL_SCHEMA_VERSION,
                    signals = %signals,
                    "runtime integration-lane observation"
                ),
                Err(_error) => tracing::warn!(
                    target: "integrations_rs::operations",
                    event = "integrations.runtime.lanes.encode_failed",
                    "runtime integration-lane observation could not be encoded"
                ),
            }
        }
    }

    fn with_gauges(&self, update: impl FnOnce(&mut Gauges)) {
        let mut gauges = self
            .gauges
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        update(&mut gauges);
    }

    fn with_gauges_result<T>(
        &self,
        update: impl FnOnce(&mut Gauges) -> Result<T, ObservationError>,
    ) -> Result<T, ObservationError> {
        let mut gauges = self
            .gauges
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        update(&mut gauges)
    }
}

fn duration_millis(value: Duration) -> u64 {
    u64::try_from(value.as_millis()).unwrap_or(u64::MAX)
}

fn minimal_integration_signals(integration_path: &str) -> IntegrationSignalsV1 {
    IntegrationSignalsV1 {
        integration_path: integration_path.to_owned(),
        run_id: None,
        work_id: None,
        runnable_queue_age_ms: None,
        attempt: None,
        retry_ready_age_ms: None,
        active_work_kind: None,
        effect_count: None,
        durable_cursor: None,
        resend_count: 0,
        blocked_age_ms: None,
        applied_state_id: None,
        candidate_state_id: None,
        maintenance: None,
        reconciliation_lag_ms: None,
        last_completed_sweep_at: None,
        latest_trusted_graph_actor: None,
        graph_actor_mismatch: false,
        rate_class: None,
        graph_requests_total: 0,
        graph_429_total: 0,
        rate_utilization_basis_points: 0,
    }
}

fn validate_signal_id(value: &str) -> Result<(), ObservationError> {
    if value.len() > MAX_SIGNAL_ID_BYTES {
        return Err(ObservationError::SignalIdTooLarge);
    }
    if value.chars().any(char::is_control) {
        return Err(ObservationError::SignalIdContainsControl);
    }
    Ok(())
}

fn saturating_increment(counter: &AtomicU64, amount: u64) {
    let _ = counter.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
        Some(current.saturating_add(amount))
    });
}

pub struct Progress {
    label: String,
    total: Option<i64>,
    done: AtomicI64,
    started: Instant,
    last_log_ms: AtomicU64,
}

impl Progress {
    pub fn start(label: impl Into<String>, total: Option<i64>) -> Self {
        Self {
            label: label.into(),
            total,
            done: AtomicI64::new(0),
            started: Instant::now(),
            last_log_ms: AtomicU64::new(0),
        }
    }

    pub fn tick(&self, count: i64) {
        let done = self.done.fetch_add(count, Ordering::Relaxed) + count;
        let elapsed = self.started.elapsed().as_millis() as u64;
        let last = self.last_log_ms.load(Ordering::Relaxed);

        // saturating_sub: concurrent ticks can load a `last` newer than this
        // thread's `elapsed`, which would underflow a plain subtraction.
        if elapsed.saturating_sub(last) >= LOG_INTERVAL_MS
            && self
                .last_log_ms
                .compare_exchange(last, elapsed, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
        {
            match self.total {
                Some(total) if total > 0 => {
                    let eta = if done > 0 {
                        (elapsed as i64 * (total - done) / done) / 1000
                    } else {
                        0
                    };
                    tracing::info!(
                        "{}: {done}/{total} ({}%) eta {eta}s{}",
                        self.label,
                        done * 100 / total,
                        rate_suffix(done, elapsed as i64)
                    );
                }
                _ => tracing::info!(
                    "{}: {done}{}",
                    self.label,
                    rate_suffix(done, elapsed as i64)
                ),
            }
        }
    }

    pub fn elapsed_ms(&self) -> i64 {
        self.started.elapsed().as_millis() as i64
    }
}

pub fn duration(ms: i64) -> String {
    if ms < 10_000 {
        format!("{:.1}s", ms as f64 / 1000.0)
    } else if ms < 600_000 {
        format!("{}s", ms / 1000)
    } else {
        format!("{:.1}m", ms as f64 / 60_000.0)
    }
}

pub fn rate_suffix(ops: i64, elapsed_ms: i64) -> String {
    if ops <= 0 || elapsed_ms <= 0 {
        return String::new();
    }
    let rate = ops as f64 * 1000.0 / elapsed_ms as f64;
    if rate >= 10.0 {
        format!(" ({} ops/s)", rate.round() as i64)
    } else {
        format!(" ({rate:.1} ops/s)")
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn representative_integration() -> IntegrationSignalsV1 {
        let mut value = IntegrationSignalsV1::new(
            "27".repeat(32),
            Some("019c0000-0000-7000-8000-000000000001".to_owned()),
            Some("a".repeat(64)),
            Some(ObservedWorkKind::Restore),
            Some(12),
            Some(7),
            Some("b".repeat(64)),
            Some("c".repeat(64)),
            ObservedMaintenance::RestoreBlocked,
        )
        .unwrap();
        value.runnable_queue_age_ms = Some(1_000);
        value.attempt = Some(3);
        value.retry_ready_age_ms = Some(500);
        value.resend_count = 2;
        value.blocked_age_ms = Some(250);
        value.reconciliation_lag_ms = Some(5_000);
        value.last_completed_sweep_at = Some("2026-07-23T10:00:00Z".to_owned());
        value.latest_trusted_graph_actor = Some("019c0000-0000-7000-8000-000000000002".to_owned());
        value.graph_actor_mismatch = true;
        value.rate_class = Some(ObservedRateClass::Foreground);
        value.graph_requests_total = 9;
        value.graph_429_total = 1;
        value.rate_utilization_basis_points = 7_500;
        value
    }

    #[test]
    fn every_required_signal_has_one_stable_structured_field() {
        let telemetry = OperationalTelemetry::default();
        telemetry.set_shards(ShardSignalsV1::new(4, 3, Some(Duration::from_secs(2))).unwrap());
        telemetry
            .upsert_integration(representative_integration())
            .unwrap();
        telemetry.set_disk(DiskSignalsV1 {
            duckdb_bytes: 1,
            cache_bytes: 2,
            staging_bytes: 3,
            workspace_available_bytes: 4,
            free_reserve_bytes: 5,
        });
        telemetry.set_adaptive_rate_basis_points(8_000).unwrap();
        telemetry.record_lease_renewal_failure();
        telemetry.record_ownership_churn();
        telemetry.record_fencing_error();
        let snapshot_created_at = DateTime::parse_from_rfc3339("2026-07-23T09:59:59Z")
            .unwrap()
            .with_timezone(&Utc);
        telemetry.record_snapshot_published(snapshot_created_at);
        telemetry.record_snapshot_recovery(
            11,
            Duration::from_millis(12),
            1,
            Some(snapshot_created_at),
        );
        for operation in [
            ObjectStoreOperation::Get,
            ObjectStoreOperation::Put,
            ObjectStoreOperation::Head,
            ObjectStoreOperation::List,
            ObjectStoreOperation::Delete,
            ObjectStoreOperation::Copy,
        ] {
            telemetry.record_object_store_operation(
                operation,
                17,
                Duration::from_millis(19),
                operation != ObjectStoreOperation::Delete,
            );
        }
        telemetry.record_multipart_part(23, Duration::from_millis(29), true);
        telemetry.record_multipart_complete(Duration::from_millis(31), true);
        telemetry.record_multipart_abort(Duration::from_millis(37), true);
        telemetry.record_gc("2026-07-23T10:00:01Z".to_owned(), 41, 43, 47, 53);

        let observed_at = DateTime::parse_from_rfc3339("2026-07-23T10:00:02Z")
            .unwrap()
            .with_timezone(&Utc);
        let value = serde_json::to_value(telemetry.snapshot(observed_at)).unwrap();
        let mut actual = Vec::new();
        collect_paths("", &value, &mut actual);
        actual.sort_unstable();
        let mut expected = OPERATIONAL_SIGNAL_PATHS.to_vec();
        expected.sort_unstable();
        assert_eq!(actual, expected);
    }

    #[test]
    fn observations_are_bounded_sorted_and_reject_invalid_claims() {
        assert_eq!(
            ShardSignalsV1::new(1, 2, None),
            Err(ObservationError::OwnedShardsExceedKnown)
        );
        assert_eq!(
            ShardSignalsV1::new(2, 1, None),
            Err(ObservationError::MissingUnownedAge)
        );
        let telemetry = OperationalTelemetry::default();
        telemetry
            .upsert_integration(
                IntegrationSignalsV1::new(
                    "b",
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    ObservedMaintenance::Healthy,
                )
                .unwrap(),
            )
            .unwrap();
        telemetry
            .upsert_integration(
                IntegrationSignalsV1::new(
                    "a",
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    ObservedMaintenance::Healthy,
                )
                .unwrap(),
            )
            .unwrap();
        let snapshot = telemetry.snapshot(Utc::now());
        assert_eq!(
            snapshot
                .integrations
                .iter()
                .map(|value| value.integration_path.as_str())
                .collect::<Vec<_>>(),
            ["a", "b"]
        );

        let mut invalid = representative_integration();
        invalid.durable_cursor = Some(13);
        assert_eq!(
            telemetry.upsert_integration(invalid),
            Err(ObservationError::CursorExceedsEffectCount)
        );
    }

    #[test]
    fn trusted_snapshot_age_advances_at_report_time() {
        let telemetry = OperationalTelemetry::default();
        let created_at = DateTime::parse_from_rfc3339("2026-07-23T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        telemetry.record_snapshot_recovery(0, Duration::ZERO, 0, Some(created_at));
        let first = telemetry.snapshot(created_at + chrono::Duration::seconds(1));
        let second = telemetry.snapshot(created_at + chrono::Duration::seconds(3));
        assert_eq!(first.snapshots.latest_age_ms, Some(1_000));
        assert_eq!(second.snapshots.latest_age_ms, Some(3_000));
    }

    #[test]
    fn scheduler_refresh_preserves_reconciliation_and_actor_evidence() {
        let telemetry = OperationalTelemetry::default();
        let integration_path = "27".repeat(32);
        let completed_at = DateTime::parse_from_rfc3339("2026-07-23T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        telemetry.record_reconciliation_completed(&integration_path, completed_at);
        telemetry
            .record_graph_actor_audit(&integration_path, "trusted-actor", "configured-actor")
            .unwrap();

        telemetry
            .upsert_integration(
                IntegrationSignalsV1::new(
                    integration_path,
                    Some("019c0000-0000-7000-8000-000000000001".to_owned()),
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    ObservedMaintenance::Healthy,
                )
                .unwrap(),
            )
            .unwrap();

        let snapshot = telemetry.snapshot(completed_at + chrono::Duration::seconds(2));
        let lane = snapshot.integrations.first().unwrap();
        assert_eq!(lane.reconciliation_lag_ms, Some(2_000));
        assert_eq!(
            lane.last_completed_sweep_at.as_deref(),
            Some("2026-07-23T10:00:00.000Z")
        );
        assert_eq!(
            lane.latest_trusted_graph_actor.as_deref(),
            Some("trusted-actor")
        );
        assert!(lane.graph_actor_mismatch);
    }

    #[test]
    fn process_observed_queue_retry_and_blocked_ages_are_live_gauges() {
        let telemetry = OperationalTelemetry::default();
        let integration_path = "27".repeat(32);
        let observed_at = DateTime::parse_from_rfc3339("2026-07-23T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        telemetry.observe_runnable_run(
            &integration_path,
            "019c0000-0000-7000-8000-000000000001",
            true,
            observed_at,
        );
        telemetry.observe_blocked_work(
            &integration_path,
            &"a".repeat(64),
            observed_at + chrono::Duration::milliseconds(250),
        );

        let snapshot = telemetry.snapshot(observed_at + chrono::Duration::seconds(2));
        let lane = snapshot.integrations.first().unwrap();
        assert_eq!(lane.runnable_queue_age_ms, Some(2_000));
        assert_eq!(lane.retry_ready_age_ms, Some(2_000));
        assert_eq!(lane.blocked_age_ms, Some(1_750));

        telemetry.clear_runnable_run(&integration_path, "019c0000-0000-7000-8000-000000000001");
        telemetry.clear_blocked_work(&integration_path, &"a".repeat(64));
        let cleared = telemetry.snapshot(observed_at + chrono::Duration::seconds(3));
        let lane = cleared.integrations.first().unwrap();
        assert_eq!(lane.runnable_queue_age_ms, None);
        assert_eq!(lane.retry_ready_age_ms, None);
        assert_eq!(lane.blocked_age_ms, None);
    }

    #[test]
    fn worst_case_lane_batches_remain_below_64_kib() {
        let mut integrations = Vec::new();
        for index in 0..INTEGRATIONS_PER_LOG_EVENT {
            let mut value = IntegrationSignalsV1::new(
                format!("{index}{}", "i".repeat(MAX_SIGNAL_ID_BYTES - 1)),
                Some("r".repeat(MAX_SIGNAL_ID_BYTES)),
                Some("w".repeat(MAX_SIGNAL_ID_BYTES)),
                Some(ObservedWorkKind::Apply),
                Some(u64::MAX),
                Some(u64::MAX),
                Some("a".repeat(MAX_SIGNAL_ID_BYTES)),
                Some("c".repeat(MAX_SIGNAL_ID_BYTES)),
                ObservedMaintenance::Healthy,
            )
            .unwrap();
            value.latest_trusted_graph_actor = Some("g".repeat(MAX_SIGNAL_ID_BYTES));
            value.validate().unwrap();
            integrations.push(value);
        }
        let batch = IntegrationSignalBatchV1 {
            schema_version: OPERATIONAL_SIGNAL_SCHEMA_VERSION,
            observed_at: "2026-07-23T10:00:00.000Z",
            integrations: &integrations,
        };
        let bytes = serde_json::to_vec(&batch).unwrap();
        assert!(bytes.len() < 64 * 1024, "batch was {} bytes", bytes.len());
    }

    #[test]
    fn operational_schema_has_no_free_form_failure_or_graph_body_field() {
        let encoded =
            serde_json::to_string(&OperationalTelemetry::default().snapshot(Utc::now())).unwrap();
        for forbidden in [
            "authorization",
            "credential",
            "definition",
            "diagnostic",
            "graph_response_body",
            "request_body",
            "secret",
        ] {
            assert!(!encoded.contains(forbidden));
            assert!(!OPERATIONAL_SIGNAL_PATHS
                .iter()
                .any(|path| path.contains(forbidden)));
        }
    }

    fn collect_paths(prefix: &str, value: &Value, output: &mut Vec<String>) {
        match value {
            Value::Object(values) => {
                for (key, value) in values {
                    let path = if prefix.is_empty() {
                        key.clone()
                    } else {
                        format!("{prefix}.{key}")
                    };
                    collect_paths(&path, value, output);
                }
            }
            Value::Array(values) => {
                let path = format!("{prefix}[]");
                if let Some(value) = values.first() {
                    collect_paths(&path, value, output);
                }
            }
            Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
                output.push(prefix.to_owned());
            }
        }
    }
}
