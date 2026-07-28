//! Exact static-share Graph request rates and atomic class-token admission.
//!
//! Time is represented as monotonic nanoseconds supplied by the caller. The
//! pure core is intended to sit behind one process-local mutex shared by every
//! owned shard for a web.
use std::fmt;

use super::drr::{
    DrrAdmission, DrrConfig, DrrDecision, DrrError, DrrScheduler, GraphRequestCharge,
    LaneAfterTurn, LaneClass, RunnableLane,
};

const RATE_DENOMINATOR: u128 = 10_000;
const NANOS_PER_SECOND: u128 = 1_000_000_000;
const MAX_MONOTONIC_NANOS: u128 = u64::MAX as u128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct StaticShareConfig {
    pub(crate) settings_revision: u64,
    pub(crate) runner_rate: u64,
    pub(crate) parent_numerator: u128,
    pub(crate) parent_denominator: u128,
    pub(crate) general_numerator: u128,
    pub(crate) reconcile_numerator: u128,
    pub(crate) class_denominator: u128,
    pub(crate) drr: DrrConfig,
}

impl StaticShareConfig {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        settings_revision: u64,
        global_graph_rate: u64,
        configured_max_active_runners: u32,
        reconciliation_basis_points: u16,
        max_graph_requests_per_chunk: u32,
        drr_quantum: u32,
        known_shards: u32,
        per_runner_shard_capacity: u32,
    ) -> Result<Self, StaticShareError> {
        if configured_max_active_runners == 0 {
            return Err(StaticShareError::ZeroConfiguredRunners);
        }
        if per_runner_shard_capacity == 0 {
            return Err(StaticShareError::ZeroShardCapacity);
        }
        if !(1..=9_999).contains(&reconciliation_basis_points) {
            return Err(StaticShareError::InvalidReconciliationShare);
        }
        let runner_rate = global_graph_rate / u64::from(configured_max_active_runners);
        if runner_rate == 0 {
            return Err(StaticShareError::NoUsableRunnerRate);
        }
        let minimum_runners = if known_shards == 0 {
            0
        } else {
            known_shards
                .checked_add(per_runner_shard_capacity - 1)
                .ok_or(StaticShareError::CoverageArithmeticOverflow)?
                / per_runner_shard_capacity
        };
        if minimum_runners > configured_max_active_runners {
            return Err(StaticShareError::InsufficientCoverage);
        }
        let reconcile_numerator = u128::from(runner_rate)
            .checked_mul(u128::from(reconciliation_basis_points))
            .ok_or(StaticShareError::RateArithmeticOverflow)?;
        let general_numerator = u128::from(runner_rate)
            .checked_mul(RATE_DENOMINATOR - u128::from(reconciliation_basis_points))
            .ok_or(StaticShareError::RateArithmeticOverflow)?;
        validate_rational_rate(u128::from(runner_rate), 1)?;
        validate_rational_rate(general_numerator, RATE_DENOMINATOR)?;
        validate_rational_rate(reconcile_numerator, RATE_DENOMINATOR)?;
        let drr = DrrConfig::new(drr_quantum, max_graph_requests_per_chunk)
            .map_err(StaticShareError::Drr)?;
        Ok(Self {
            settings_revision,
            runner_rate,
            parent_numerator: u128::from(runner_rate),
            parent_denominator: 1,
            general_numerator,
            reconcile_numerator,
            class_denominator: RATE_DENOMINATOR,
            drr,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TokenDecision {
    Granted,
    WaitUntil(u64),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FairAdmission {
    drr: DrrAdmission,
    prepaid_graph_requests: u32,
}

impl FairAdmission {
    pub(crate) fn integration_path(&self) -> &str {
        self.drr.integration_path()
    }

    pub(crate) const fn class(&self) -> LaneClass {
        self.drr.class()
    }

    pub(crate) const fn max_graph_requests(&self) -> u32 {
        self.drr.max_graph_requests()
    }

    /// Admission already consumed this turn's first parent+class token.
    pub(crate) const fn prepaid_graph_requests(&self) -> u32 {
        self.prepaid_graph_requests
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum FairDecision {
    Admitted(FairAdmission),
    NoRunnableLane,
    TokenStarved,
    YieldedToForeground,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StaticShareError {
    ZeroConfiguredRunners,
    ZeroShardCapacity,
    InvalidReconciliationShare,
    NoUsableRunnerRate,
    InsufficientCoverage,
    CoverageArithmeticOverflow,
    RateArithmeticOverflow,
    UnrepresentableRefill,
    Drr(super::drr::DrrError),
}

impl fmt::Display for StaticShareError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::ZeroConfiguredRunners => "configured maximum active runners is zero",
            Self::ZeroShardCapacity => "per-runner shard capacity is zero",
            Self::InvalidReconciliationShare => {
                "reconciliation basis points are outside 1 through 9999"
            }
            Self::NoUsableRunnerRate => "static rate share yields no usable runner rate",
            Self::InsufficientCoverage => {
                "runner ceiling cannot cover every shard at the configured per-runner capacity"
            }
            Self::CoverageArithmeticOverflow => "runner coverage arithmetic overflowed",
            Self::RateArithmeticOverflow => "static-share rate arithmetic overflowed",
            Self::UnrepresentableRefill => {
                "static-share refill interval is not representable at nanosecond precision"
            }
            Self::Drr(error) => return error.fmt(formatter),
        })
    }
}

impl std::error::Error for StaticShareError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FairScheduleError {
    Rate(StaticShareError),
    Drr(DrrError),
    StaleSettingsRevision,
}

impl fmt::Display for FairScheduleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Rate(error) => error.fmt(formatter),
            Self::Drr(error) => error.fmt(formatter),
            Self::StaleSettingsRevision => {
                formatter.write_str("Graph scheduling settings revision regressed")
            }
        }
    }
}

impl std::error::Error for FairScheduleError {}

#[derive(Debug, Clone)]
struct ExactOneTokenBucket {
    rate_numerator: u128,
    rate_denominator: u128,
    next_token_units: u128,
}

impl ExactOneTokenBucket {
    fn new(rate_numerator: u128, rate_denominator: u128) -> Self {
        Self {
            rate_numerator,
            rate_denominator,
            next_token_units: 0,
        }
    }

    fn available_at(&self, now_nanos: u64) -> Result<u64, StaticShareError> {
        let now_units = u128::from(now_nanos)
            .checked_mul(self.rate_numerator)
            .ok_or(StaticShareError::RateArithmeticOverflow)?;
        if now_units >= self.next_token_units {
            return Ok(now_nanos);
        }
        ceil_div(self.next_token_units, self.rate_numerator).and_then(|value| {
            u64::try_from(value).map_err(|_error| StaticShareError::UnrepresentableRefill)
        })
    }

    fn take(&mut self, now_nanos: u64) -> Result<(), StaticShareError> {
        let now_units = u128::from(now_nanos)
            .checked_mul(self.rate_numerator)
            .ok_or(StaticShareError::RateArithmeticOverflow)?;
        if now_units < self.next_token_units {
            return Err(StaticShareError::UnrepresentableRefill);
        }
        let period_units = NANOS_PER_SECOND
            .checked_mul(self.rate_denominator)
            .ok_or(StaticShareError::RateArithmeticOverflow)?;
        let next_without_idle_reset = self
            .next_token_units
            .checked_add(period_units)
            .ok_or(StaticShareError::RateArithmeticOverflow)?;
        self.next_token_units = if next_without_idle_reset <= now_units {
            now_units
                .checked_add(period_units)
                .ok_or(StaticShareError::RateArithmeticOverflow)?
        } else {
            next_without_idle_reset
        };
        Ok(())
    }

    fn preserve_not_before(&mut self, due_nanos: u64) -> Result<(), StaticShareError> {
        self.next_token_units = u128::from(due_nanos)
            .checked_mul(self.rate_numerator)
            .ok_or(StaticShareError::RateArithmeticOverflow)?;
        Ok(())
    }
}

/// Parent and class tokens are examined and consumed together. A failed class
/// attempt cannot debit the parent bucket.
#[derive(Debug, Clone)]
pub(crate) struct StaticShareBuckets {
    parent: ExactOneTokenBucket,
    general: ExactOneTokenBucket,
    reconcile: ExactOneTokenBucket,
}

impl StaticShareBuckets {
    pub(crate) fn new(config: StaticShareConfig) -> Self {
        Self {
            parent: ExactOneTokenBucket::new(config.parent_numerator, config.parent_denominator),
            general: ExactOneTokenBucket::new(config.general_numerator, config.class_denominator),
            reconcile: ExactOneTokenBucket::new(
                config.reconcile_numerator,
                config.class_denominator,
            ),
        }
    }

    pub(crate) fn try_take(
        &mut self,
        class: LaneClass,
        now_nanos: u64,
    ) -> Result<TokenDecision, StaticShareError> {
        let parent_at = self.parent.available_at(now_nanos)?;
        let class_at = self.class(class).available_at(now_nanos)?;
        let available_at = parent_at.max(class_at);
        if available_at > now_nanos {
            return Ok(TokenDecision::WaitUntil(available_at));
        }
        self.parent.take(now_nanos)?;
        self.class_mut(class).take(now_nanos)?;
        Ok(TokenDecision::Granted)
    }

    pub(crate) fn available(
        &self,
        class: LaneClass,
        now_nanos: u64,
    ) -> Result<bool, StaticShareError> {
        Ok(self.parent.available_at(now_nanos)? <= now_nanos
            && self.class(class).available_at(now_nanos)? <= now_nanos)
    }

    fn reconfigured(
        &self,
        config: StaticShareConfig,
        now_nanos: u64,
    ) -> Result<Self, StaticShareError> {
        let parent_due = self.parent.available_at(now_nanos)?;
        let general_due = self.general.available_at(now_nanos)?;
        let reconcile_due = self.reconcile.available_at(now_nanos)?;
        let mut next = Self::new(config);
        next.parent.preserve_not_before(parent_due)?;
        next.general.preserve_not_before(general_due)?;
        next.reconcile.preserve_not_before(reconcile_due)?;
        Ok(next)
    }

    fn class(&self, class: LaneClass) -> &ExactOneTokenBucket {
        match class {
            LaneClass::Foreground => &self.general,
            LaneClass::Reconcile => &self.reconcile,
        }
    }

    fn class_mut(&mut self, class: LaneClass) -> &mut ExactOneTokenBucket {
        match class {
            LaneClass::Foreground => &mut self.general,
            LaneClass::Reconcile => &mut self.reconcile,
        }
    }
}

/// One lock around this value is the process-local serialization point for
/// lane admission and parent+class token consumption across all owned shards.
#[derive(Debug)]
pub(crate) struct FairGraphScheduler {
    settings_revision: u64,
    drr: DrrScheduler,
    buckets: StaticShareBuckets,
    telemetry: Option<crate::progress::OperationalTelemetry>,
}

impl FairGraphScheduler {
    pub(crate) fn new(config: StaticShareConfig) -> Self {
        Self {
            settings_revision: config.settings_revision,
            drr: DrrScheduler::new(config.drr),
            buckets: StaticShareBuckets::new(config),
            telemetry: None,
        }
    }

    pub(crate) fn with_telemetry(
        mut self,
        telemetry: crate::progress::OperationalTelemetry,
    ) -> Self {
        self.telemetry = Some(telemetry);
        self
    }

    /// Applies one fully validated settings boundary without manufacturing a
    /// fresh token. Durable settings revisions may only advance.
    pub(crate) fn reconfigure(
        &mut self,
        config: StaticShareConfig,
        now_nanos: u64,
    ) -> Result<(), FairScheduleError> {
        if config.settings_revision < self.settings_revision {
            return Err(FairScheduleError::StaleSettingsRevision);
        }
        self.drr
            .validate_reconfigure(config.drr)
            .map_err(FairScheduleError::Drr)?;
        let buckets = self
            .buckets
            .reconfigured(config, now_nanos)
            .map_err(FairScheduleError::Rate)?;
        self.drr.reconfigure(config.drr);
        self.buckets = buckets;
        self.settings_revision = config.settings_revision;
        Ok(())
    }

    pub(crate) fn synchronize(
        &mut self,
        lanes: impl IntoIterator<Item = RunnableLane>,
    ) -> Result<(), FairScheduleError> {
        self.drr.synchronize(lanes).map_err(FairScheduleError::Drr)
    }

    /// Admits on the first available token and consumes exactly that one token,
    /// never the declared full chunk bound.
    pub(crate) fn admit(
        &mut self,
        class: LaneClass,
        now_nanos: u64,
    ) -> Result<FairDecision, FairScheduleError> {
        let available = self
            .buckets
            .available(class, now_nanos)
            .map_err(FairScheduleError::Rate)?;
        let decision = self
            .drr
            .admit(class, available)
            .map_err(FairScheduleError::Drr)?;
        if matches!(decision, DrrDecision::Admitted(_)) {
            match self
                .buckets
                .try_take(class, now_nanos)
                .map_err(FairScheduleError::Rate)?
            {
                TokenDecision::Granted => {}
                TokenDecision::WaitUntil(_) => {
                    return Err(FairScheduleError::Rate(
                        StaticShareError::UnrepresentableRefill,
                    ));
                }
            }
        }
        Ok(match decision {
            DrrDecision::Admitted(drr) => FairDecision::Admitted(FairAdmission {
                drr,
                prepaid_graph_requests: 1,
            }),
            DrrDecision::NoRunnableLane => FairDecision::NoRunnableLane,
            DrrDecision::TokenStarved => FairDecision::TokenStarved,
            DrrDecision::YieldedToForeground => FairDecision::YieldedToForeground,
        })
    }

    /// Every request after the admission's prepaid first send acquires one
    /// parent+class pair as it arrives.
    pub(crate) fn take_request_token(
        &mut self,
        class: LaneClass,
        now_nanos: u64,
    ) -> Result<TokenDecision, FairScheduleError> {
        self.buckets
            .try_take(class, now_nanos)
            .map_err(FairScheduleError::Rate)
    }

    pub(crate) fn settle<C: GraphRequestCharge>(
        &mut self,
        admission: FairAdmission,
        charge: &C,
        after: LaneAfterTurn,
    ) -> Result<(), FairScheduleError> {
        let integration_path = admission.integration_path().to_owned();
        let class = admission.class();
        let used_requests = charge.graph_requests_used();
        self.drr
            .settle(admission.drr, charge, after)
            .map_err(FairScheduleError::Drr)?;
        if let Some(telemetry) = &self.telemetry {
            telemetry.record_lane_settlement(
                &integration_path,
                match class {
                    LaneClass::Foreground => crate::progress::ObservedRateClass::Foreground,
                    LaneClass::Reconcile => crate::progress::ObservedRateClass::Reconcile,
                },
                used_requests,
            );
        }
        Ok(())
    }
}

fn validate_rational_rate(numerator: u128, denominator: u128) -> Result<(), StaticShareError> {
    if numerator == 0 || denominator == 0 {
        return Err(StaticShareError::NoUsableRunnerRate);
    }
    let period = NANOS_PER_SECOND
        .checked_mul(denominator)
        .ok_or(StaticShareError::RateArithmeticOverflow)?;
    let interval = ceil_div(period, numerator)?;
    if interval == 0 || interval > MAX_MONOTONIC_NANOS {
        return Err(StaticShareError::UnrepresentableRefill);
    }
    if numerator > u128::MAX / MAX_MONOTONIC_NANOS {
        return Err(StaticShareError::UnrepresentableRefill);
    }
    Ok(())
}

fn ceil_div(numerator: u128, denominator: u128) -> Result<u128, StaticShareError> {
    numerator
        .checked_add(denominator - 1)
        .ok_or(StaticShareError::RateArithmeticOverflow)
        .map(|value| value / denominator)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::graph::executor::TurnOutcomeV1;

    fn config(rate: u64, runners: u32, reserve: u16) -> StaticShareConfig {
        StaticShareConfig::new(7, rate, runners, reserve, 8, 8, 256, 64).unwrap()
    }

    #[test]
    fn static_share_and_class_rates_are_exact_rationals() {
        let value = config(100, 4, 1_000);
        assert_eq!(value.settings_revision, 7);
        assert_eq!(value.runner_rate, 25);
        assert_eq!(value.parent_numerator, 25);
        assert_eq!(value.parent_denominator, 1);
        assert_eq!(value.general_numerator, 225_000);
        assert_eq!(value.reconcile_numerator, 25_000);
        assert_eq!(
            value.general_numerator + value.reconcile_numerator,
            u128::from(value.runner_rate) * value.class_denominator
        );
    }

    #[test]
    fn low_reserved_rate_arrives_eventually_without_rounding_up() {
        let value = StaticShareConfig::new(1, 1, 1, 1_000, 2, 2, 1, 1).unwrap();
        let mut buckets = StaticShareBuckets::new(value);
        assert_eq!(
            buckets.try_take(LaneClass::Reconcile, 0).unwrap(),
            TokenDecision::Granted
        );
        assert_eq!(
            buckets.try_take(LaneClass::Reconcile, 1).unwrap(),
            TokenDecision::WaitUntil(10_000_000_000)
        );
        assert_eq!(
            buckets
                .try_take(LaneClass::Reconcile, 10_000_000_000)
                .unwrap(),
            TokenDecision::Granted
        );
    }

    #[test]
    fn class_starvation_never_partially_debits_the_parent() {
        let value = StaticShareConfig::new(1, 1, 1, 5_000, 2, 2, 1, 1).unwrap();
        let mut buckets = StaticShareBuckets::new(value);
        assert_eq!(
            buckets.try_take(LaneClass::Reconcile, 0).unwrap(),
            TokenDecision::Granted
        );
        assert_eq!(
            buckets
                .try_take(LaneClass::Reconcile, 1_000_000_000)
                .unwrap(),
            TokenDecision::WaitUntil(2_000_000_000)
        );
        assert_eq!(
            buckets
                .try_take(LaneClass::Foreground, 1_000_000_000)
                .unwrap(),
            TokenDecision::Granted
        );
    }

    #[test]
    fn unused_reconcile_capacity_is_not_borrowed_by_foreground() {
        let value = StaticShareConfig::new(1, 1, 1, 5_000, 2, 2, 1, 1).unwrap();
        let mut buckets = StaticShareBuckets::new(value);
        assert_eq!(
            buckets.try_take(LaneClass::Foreground, 0).unwrap(),
            TokenDecision::Granted
        );
        assert_eq!(
            buckets
                .try_take(LaneClass::Foreground, 1_000_000_000)
                .unwrap(),
            TokenDecision::WaitUntil(2_000_000_000)
        );
    }

    #[test]
    fn foreground_and_reconcile_share_one_strict_parent_ceiling() {
        let value = StaticShareConfig::new(1, 10, 1, 5_000, 2, 2, 1, 1).unwrap();
        let mut buckets = StaticShareBuckets::new(value);

        for index in 0_u64..10 {
            let class = if index % 2 == 0 {
                LaneClass::Foreground
            } else {
                LaneClass::Reconcile
            };
            assert_eq!(
                buckets.try_take(class, index * 100_000_000).unwrap(),
                TokenDecision::Granted
            );
        }

        for class in [LaneClass::Foreground, LaneClass::Reconcile] {
            assert!(matches!(
                buckets.try_take(class, 999_999_999).unwrap(),
                TokenDecision::WaitUntil(1_000_000_000)
            ));
        }
        assert_eq!(
            buckets
                .try_take(LaneClass::Foreground, 1_000_000_000)
                .unwrap(),
            TokenDecision::Granted
        );
        assert_eq!(
            buckets
                .try_take(LaneClass::Reconcile, 1_000_000_000)
                .unwrap(),
            TokenDecision::WaitUntil(1_100_000_000)
        );
    }

    #[test]
    fn configured_worker_shares_cannot_sum_above_the_fleet_ceiling() {
        let global_rate = 101;
        let configured_workers = 4;
        let share =
            StaticShareConfig::new(1, global_rate, configured_workers, 1_000, 2, 2, 4, 1).unwrap();
        assert_eq!(share.runner_rate, 25);
        assert!(share.runner_rate * u64::from(configured_workers) <= global_rate);
    }

    #[test]
    fn invalid_coverage_and_runtime_shapes_fail_closed() {
        assert_eq!(
            StaticShareConfig::new(1, 100, 0, 1_000, 2, 2, 256, 64).unwrap_err(),
            StaticShareError::ZeroConfiguredRunners
        );
        assert_eq!(
            StaticShareConfig::new(1, 100, 4, 1_000, 2, 2, 256, 0).unwrap_err(),
            StaticShareError::ZeroShardCapacity
        );
        assert_eq!(
            StaticShareConfig::new(1, 3, 4, 1_000, 2, 2, 256, 64).unwrap_err(),
            StaticShareError::NoUsableRunnerRate
        );
        assert_eq!(
            StaticShareConfig::new(1, 100, 3, 1_000, 2, 2, 256, 64).unwrap_err(),
            StaticShareError::InsufficientCoverage
        );
    }

    #[test]
    fn live_rate_reduction_preserves_the_exact_class_ratio() {
        let base = config(100, 4, 1_000);
        let reduced = config(50, 4, 1_000);
        assert_eq!(
            reduced.general_numerator * base.reconcile_numerator,
            reduced.reconcile_numerator * base.general_numerator
        );
        assert_eq!(reduced.class_denominator, base.class_denominator);
        assert_eq!(reduced.parent_numerator, base.parent_numerator / 2);
    }

    #[test]
    fn fair_scheduler_starts_on_one_token_without_reserving_the_chunk_bound() {
        let value = StaticShareConfig::new(1, 10, 1, 1_000, 8, 8, 1, 1).unwrap();
        let mut scheduler = FairGraphScheduler::new(value);
        scheduler
            .synchronize([RunnableLane::new("alice", LaneClass::Foreground, 8)])
            .unwrap();
        let FairDecision::Admitted(admission) = scheduler.admit(LaneClass::Foreground, 0).unwrap()
        else {
            panic!("first available token must start the bounded chunk");
        };
        assert_eq!(admission.integration_path(), "alice");
        assert_eq!(admission.class(), LaneClass::Foreground);
        assert_eq!(admission.max_graph_requests(), 8);
        assert_eq!(admission.prepaid_graph_requests(), 1);
        assert!(matches!(
            scheduler
                .take_request_token(LaneClass::Foreground, 1)
                .unwrap(),
            TokenDecision::WaitUntil(_)
        ));
        let executor_outcome = TurnOutcomeV1::Progressed {
            completed_effect_count: 1,
            work_exhausted: true,
            requests_used: 1,
        };
        scheduler
            .settle(admission, &executor_outcome, LaneAfterTurn::EmptyOrBlocked)
            .unwrap();
    }

    #[test]
    fn settings_boundary_preserves_token_debt_and_rejects_revision_regression() {
        let base = config(100, 4, 1_000);
        let mut scheduler = FairGraphScheduler::new(base);
        scheduler
            .synchronize([RunnableLane::new("alice", LaneClass::Foreground, 8)])
            .unwrap();
        let FairDecision::Admitted(admission) = scheduler.admit(LaneClass::Foreground, 0).unwrap()
        else {
            panic!("initial token must admit");
        };

        let reduced = StaticShareConfig {
            settings_revision: 8,
            ..config(50, 4, 1_000)
        };
        scheduler.reconfigure(reduced, 10_000_000).unwrap();
        let TokenDecision::WaitUntil(due) = scheduler
            .take_request_token(LaneClass::Foreground, 10_000_000)
            .unwrap()
        else {
            panic!("reconfiguration must not manufacture a fresh token");
        };
        assert!(due > 10_000_000);

        let stale = StaticShareConfig {
            settings_revision: 6,
            ..base
        };
        assert_eq!(
            scheduler.reconfigure(stale, 10_000_000).unwrap_err(),
            FairScheduleError::StaleSettingsRevision
        );
        scheduler
            .settle(admission, &1, LaneAfterTurn::EmptyOrBlocked)
            .unwrap();
    }

    #[test]
    fn settlement_feeds_the_shared_observation() {
        let telemetry = crate::progress::OperationalTelemetry::default();
        let base = StaticShareConfig::new(1, 10, 1, 1_000, 8, 8, 1, 1).unwrap();
        let mut scheduler = FairGraphScheduler::new(base).with_telemetry(telemetry.clone());
        scheduler
            .synchronize([RunnableLane::new("alice", LaneClass::Foreground, 8)])
            .unwrap();
        let FairDecision::Admitted(admission) = scheduler.admit(LaneClass::Foreground, 0).unwrap()
        else {
            panic!("lane should be admitted");
        };
        scheduler
            .settle(admission, &2, LaneAfterTurn::EmptyOrBlocked)
            .unwrap();
        telemetry
            .set_lane_rate_utilization(
                "alice",
                crate::progress::ObservedRateClass::Foreground,
                2_500,
            )
            .unwrap();
        let observation = telemetry.snapshot(chrono::Utc::now());
        assert_eq!(observation.rate.adaptive_rate_basis_points, 10_000);
        assert_eq!(observation.integrations.len(), 1);
        assert_eq!(observation.integrations[0].graph_requests_total, 2);
        assert_eq!(
            observation.integrations[0].rate_utilization_basis_points,
            2_500
        );
    }
}
