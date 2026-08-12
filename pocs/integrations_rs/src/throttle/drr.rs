//! Pure deficit-round-robin scheduling for Graph delivery turns.
//!
//! Rate buckets own token timing. This module owns only fair lane selection and
//! exact settlement from executor-reported request counts. Keeping time and I/O
//! out of the core makes every scheduling decision reproducible as a trace.
use std::collections::{BTreeMap, VecDeque};
use std::fmt;

use error_stack::{Context, Report};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum LaneClass {
    /// Apply and Restore share this class.
    Foreground,
    /// Rolling Reconcile owns the reserved class.
    Reconcile,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DrrConfig {
    quantum: u32,
    deficit_cap: u32,
    max_graph_requests_per_chunk: u32,
}

impl DrrConfig {
    pub(crate) fn new(quantum: u32, max_graph_requests_per_chunk: u32) -> Result<Self, DrrError> {
        if max_graph_requests_per_chunk < 2 {
            return Err(DrrError::MaximumBelowSingleEffect);
        }
        if quantum < max_graph_requests_per_chunk {
            return Err(DrrError::QuantumBelowMaximum);
        }
        let deficit_cap = quantum.checked_mul(2).ok_or(DrrError::DeficitCapOverflow)?;
        Ok(Self {
            quantum,
            deficit_cap,
            max_graph_requests_per_chunk,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RunnableLane {
    integration_path: String,
    class: LaneClass,
    max_graph_requests: u32,
}

impl RunnableLane {
    pub(crate) fn new(
        integration_path: impl Into<String>,
        class: LaneClass,
        max_graph_requests: u32,
    ) -> Self {
        Self {
            integration_path: integration_path.into(),
            class,
            max_graph_requests,
        }
    }
}

/// The scheduler never derives cost from effects, chunks, or HTTP outcomes.
/// The delivery executor implements this trait for its authoritative outcome.
pub(crate) trait GraphRequestCharge {
    fn graph_requests_used(&self) -> u32;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct GraphRequestsUsed(u32);

impl GraphRequestsUsed {
    pub(crate) const fn new(value: u32) -> Self {
        Self(value)
    }
}

impl GraphRequestCharge for GraphRequestsUsed {
    fn graph_requests_used(&self) -> u32 {
        self.0
    }
}

impl<C: Context> GraphRequestCharge for Report<C> {
    fn graph_requests_used(&self) -> u32 {
        self.frames()
            .find_map(|frame| frame.downcast_ref::<GraphRequestsUsed>())
            .map_or(0, GraphRequestCharge::graph_requests_used)
    }
}

impl GraphRequestCharge for u32 {
    fn graph_requests_used(&self) -> u32 {
        *self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LaneAfterTurn {
    Runnable { max_graph_requests: u32 },
    Yield { max_graph_requests: u32 },
    EmptyOrBlocked,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DrrAdmission {
    ticket: u64,
    integration_path: String,
    class: LaneClass,
    max_graph_requests: u32,
}

impl DrrAdmission {
    pub(crate) fn integration_path(&self) -> &str {
        &self.integration_path
    }

    pub(crate) const fn class(&self) -> LaneClass {
        self.class
    }

    pub(crate) const fn max_graph_requests(&self) -> u32 {
        self.max_graph_requests
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DrrDecision {
    Admitted(DrrAdmission),
    NoRunnableLane,
    TokenStarved,
    YieldedToForeground,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DrrError {
    MaximumBelowSingleEffect,
    QuantumBelowMaximum,
    DeficitCapOverflow,
    EmptyIntegrationPath,
    WhitespaceIntegrationPath,
    DuplicateLane,
    ChunkBoundIsZero,
    ChunkBoundExceedsMaximum,
    LaneChangedWhileInFlight,
    AdmissionTicketOverflow,
    UnknownAdmission,
    AdmissionMismatch,
    ChargeExceedsAdmission,
    DeficitUnderflow,
}

impl fmt::Display for DrrError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::MaximumBelowSingleEffect => {
                "maximum Graph requests per chunk cannot complete one create-conflict-update effect"
            }
            Self::QuantumBelowMaximum => {
                "DRR quantum is below the maximum Graph requests per chunk"
            }
            Self::DeficitCapOverflow => "DRR two-quantum deficit cap overflows u32",
            Self::EmptyIntegrationPath => "DRR integration path is empty",
            Self::WhitespaceIntegrationPath => "DRR integration path contains whitespace",
            Self::DuplicateLane => "DRR runnable snapshot contains a duplicate lane",
            Self::ChunkBoundIsZero => "DRR chunk Graph-request bound is zero",
            Self::ChunkBoundExceedsMaximum => {
                "DRR chunk Graph-request bound exceeds the configured maximum"
            }
            Self::LaneChangedWhileInFlight => {
                "DRR runnable snapshot changed a lane while its turn is in flight"
            }
            Self::AdmissionTicketOverflow => "DRR admission ticket overflows u64",
            Self::UnknownAdmission => "DRR settlement does not name an in-flight lane",
            Self::AdmissionMismatch => "DRR settlement does not match its admission",
            Self::ChargeExceedsAdmission => {
                "executor Graph-request charge exceeds the admitted chunk bound"
            }
            Self::DeficitUnderflow => "executor Graph-request charge exceeds lane deficit",
        })
    }
}

impl std::error::Error for DrrError {}

#[derive(Debug, Clone)]
struct LaneState {
    max_graph_requests: u32,
    deficit: u32,
    needs_quantum: bool,
    in_flight: Option<u64>,
}

#[derive(Debug, Default)]
struct ClassRing {
    paths: VecDeque<String>,
}

#[derive(Debug)]
pub(crate) struct DrrScheduler {
    config: DrrConfig,
    lanes: BTreeMap<(LaneClass, String), LaneState>,
    foreground: ClassRing,
    reconcile: ClassRing,
    next_ticket: u64,
}

impl DrrScheduler {
    pub(crate) fn new(config: DrrConfig) -> Self {
        Self {
            config,
            lanes: BTreeMap::new(),
            foreground: ClassRing::default(),
            reconcile: ClassRing::default(),
            next_ticket: 1,
        }
    }

    pub(crate) fn validate_reconfigure(&self, config: DrrConfig) -> Result<(), DrrError> {
        if self.lanes.values().any(|state| {
            state.in_flight.is_none()
                && state.max_graph_requests > config.max_graph_requests_per_chunk
        }) {
            return Err(DrrError::ChunkBoundExceedsMaximum);
        }
        Ok(())
    }

    pub(crate) fn reconfigure(&mut self, config: DrrConfig) {
        self.config = config;
        for state in self
            .lanes
            .values_mut()
            .filter(|state| state.in_flight.is_none())
        {
            state.deficit = state.deficit.min(config.deficit_cap);
        }
    }

    /// Replaces the runnable-lane snapshot. New simultaneous arrivals are
    /// appended in ascending integration-path byte order. Empty or blocked
    /// lanes disappear and lose their accumulated deficit.
    pub(crate) fn synchronize(
        &mut self,
        lanes: impl IntoIterator<Item = RunnableLane>,
    ) -> Result<(), DrrError> {
        let mut desired = BTreeMap::new();
        for lane in lanes {
            self.validate_lane(&lane)?;
            let key = (lane.class, lane.integration_path);
            if desired.insert(key, lane.max_graph_requests).is_some() {
                return Err(DrrError::DuplicateLane);
            }
        }

        for (key, state) in &self.lanes {
            if state.in_flight.is_some()
                && desired
                    .get(key)
                    .is_some_and(|bound| *bound != state.max_graph_requests)
            {
                return Err(DrrError::LaneChangedWhileInFlight);
            }
        }

        let removed: Vec<_> = self
            .lanes
            .keys()
            .filter(|key| !desired.contains_key(*key))
            .cloned()
            .collect();
        for (class, path) in removed {
            let state = self
                .lanes
                .get(&(class, path.clone()))
                .expect("removed lane was collected from the map");
            if state.in_flight.is_some() {
                continue;
            }
            self.lanes.remove(&(class, path.clone()));
            self.remove_from_ring(class, &path);
        }

        let mut additions = Vec::new();
        for ((class, path), bound) in desired {
            match self.lanes.get_mut(&(class, path.clone())) {
                Some(state) => state.max_graph_requests = bound,
                None => {
                    self.lanes.insert(
                        (class, path.clone()),
                        LaneState {
                            max_graph_requests: bound,
                            deficit: 0,
                            needs_quantum: true,
                            in_flight: None,
                        },
                    );
                    additions.push((class, path));
                }
            }
        }
        additions.sort();
        for (class, path) in additions {
            self.ring_mut(class).paths.push_back(path);
        }
        Ok(())
    }

    /// Attempts one class-local admission. `class_token_available` represents
    /// the first parent+child token pair observed under the rate scheduler
    /// lock. A false value performs no ring mutation and accrues no quantum.
    pub(crate) fn admit(
        &mut self,
        class: LaneClass,
        class_token_available: bool,
    ) -> Result<DrrDecision, DrrError> {
        if !class_token_available {
            return Ok(if self.ring(class).paths.is_empty() {
                DrrDecision::NoRunnableLane
            } else {
                DrrDecision::TokenStarved
            });
        }
        let visit_limit = self.ring(class).paths.len();
        if visit_limit == 0 {
            return Ok(DrrDecision::NoRunnableLane);
        }

        let mut yielded_to_foreground = false;
        for _ in 0..visit_limit {
            let path = self
                .ring_mut(class)
                .paths
                .pop_front()
                .expect("visit limit was captured from this non-empty ring");
            if class == LaneClass::Reconcile && self.foreground_runnable(&path) {
                yielded_to_foreground = true;
                self.ring_mut(class).paths.push_back(path);
                continue;
            }

            let key = (class, path.clone());
            let state = self
                .lanes
                .get_mut(&key)
                .expect("ring entries always have lane state");
            if state.in_flight.is_some() {
                self.ring_mut(class).paths.push_back(path);
                continue;
            }
            if state.needs_quantum {
                state.deficit = state
                    .deficit
                    .saturating_add(self.config.quantum)
                    .min(self.config.deficit_cap);
                state.needs_quantum = false;
            }
            if state.max_graph_requests > state.deficit {
                state.needs_quantum = true;
                self.ring_mut(class).paths.push_back(path);
                continue;
            }
            let ticket = self.next_ticket;
            let Some(next_ticket) = self.next_ticket.checked_add(1) else {
                self.ring_mut(class).paths.push_front(path);
                return Err(DrrError::AdmissionTicketOverflow);
            };
            self.next_ticket = next_ticket;
            state.in_flight = Some(ticket);
            return Ok(DrrDecision::Admitted(DrrAdmission {
                ticket,
                integration_path: path,
                class,
                max_graph_requests: state.max_graph_requests,
            }));
        }
        Ok(if yielded_to_foreground {
            DrrDecision::YieldedToForeground
        } else {
            DrrDecision::NoRunnableLane
        })
    }

    /// Settles from the executor's authoritative request count. No effect or
    /// response inspection is accepted here, so the scheduler cannot invent a
    /// second accounting model.
    pub(crate) fn settle<C: GraphRequestCharge>(
        &mut self,
        admission: DrrAdmission,
        charge: &C,
        after: LaneAfterTurn,
    ) -> Result<(), DrrError> {
        let key = (admission.class, admission.integration_path.clone());
        let Some(mut state) = self.lanes.remove(&key) else {
            return Err(DrrError::UnknownAdmission);
        };
        if state.in_flight != Some(admission.ticket)
            || state.max_graph_requests != admission.max_graph_requests
        {
            // A foreign admission: the in-flight ticket belongs to someone
            // else and must stay theirs to settle.
            self.lanes.insert(key, state);
            return Err(DrrError::AdmissionMismatch);
        }
        // From here the admission owns the in-flight ticket, so every error
        // exit must still consume it and leave the lane schedulable:
        // a rejected settlement that strands `in_flight` would stall the lane
        // forever (admit skips in-flight lanes and synchronize cannot remove
        // them). `park_lane` is that single error tail.
        let used = charge.graph_requests_used();
        if used > admission.max_graph_requests {
            return Err(self.park_lane(key, state, &admission, DrrError::ChargeExceedsAdmission));
        }
        let Some(remaining_deficit) = state.deficit.checked_sub(used) else {
            return Err(self.park_lane(key, state, &admission, DrrError::DeficitUnderflow));
        };
        state.deficit = remaining_deficit.min(self.config.deficit_cap);
        state.in_flight = None;

        let (next_bound, must_yield) = match after {
            LaneAfterTurn::Runnable { max_graph_requests } => (max_graph_requests, false),
            LaneAfterTurn::Yield { max_graph_requests } => (max_graph_requests, true),
            LaneAfterTurn::EmptyOrBlocked => return Ok(()),
        };
        if let Err(error) = self.validate_bound(next_bound) {
            return Err(self.park_lane(key, state, &admission, error));
        }
        state.max_graph_requests = next_bound;
        let foreground_yield = admission.class == LaneClass::Reconcile
            && self.foreground_runnable(&admission.integration_path);
        if must_yield || foreground_yield || next_bound > state.deficit {
            state.needs_quantum = true;
            self.ring_mut(admission.class)
                .paths
                .push_back(admission.integration_path.clone());
        } else {
            state.needs_quantum = false;
            self.ring_mut(admission.class)
                .paths
                .push_front(admission.integration_path.clone());
        }
        self.lanes.insert(key, state);
        Ok(())
    }

    /// The single error tail for a settlement whose admission owned the
    /// in-flight ticket: consume the ticket, reset accumulated credit, and
    /// requeue the lane so a rejected settlement cannot stall it.
    fn park_lane(
        &mut self,
        key: (LaneClass, String),
        mut state: LaneState,
        admission: &DrrAdmission,
        error: DrrError,
    ) -> DrrError {
        state.in_flight = None;
        state.deficit = 0;
        state.needs_quantum = true;
        self.ring_mut(admission.class)
            .paths
            .push_back(admission.integration_path.clone());
        self.lanes.insert(key, state);
        error
    }

    #[cfg(test)]
    fn deficit(&self, class: LaneClass, path: &str) -> Option<u32> {
        self.lanes
            .get(&(class, path.to_owned()))
            .map(|state| state.deficit)
    }

    fn foreground_runnable(&self, path: &str) -> bool {
        self.lanes
            .contains_key(&(LaneClass::Foreground, path.to_owned()))
    }

    fn validate_lane(&self, lane: &RunnableLane) -> Result<(), DrrError> {
        if lane.integration_path.is_empty() {
            return Err(DrrError::EmptyIntegrationPath);
        }
        if lane.integration_path.chars().any(char::is_whitespace) {
            return Err(DrrError::WhitespaceIntegrationPath);
        }
        self.validate_bound(lane.max_graph_requests)
    }

    fn validate_bound(&self, bound: u32) -> Result<(), DrrError> {
        if bound == 0 {
            return Err(DrrError::ChunkBoundIsZero);
        }
        if bound > self.config.max_graph_requests_per_chunk {
            return Err(DrrError::ChunkBoundExceedsMaximum);
        }
        Ok(())
    }

    fn ring(&self, class: LaneClass) -> &ClassRing {
        match class {
            LaneClass::Foreground => &self.foreground,
            LaneClass::Reconcile => &self.reconcile,
        }
    }

    fn ring_mut(&mut self, class: LaneClass) -> &mut ClassRing {
        match class {
            LaneClass::Foreground => &mut self.foreground,
            LaneClass::Reconcile => &mut self.reconcile,
        }
    }

    fn remove_from_ring(&mut self, class: LaneClass, path: &str) {
        self.ring_mut(class)
            .paths
            .retain(|candidate| candidate != path);
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::graph::executor::TurnOutcomeV1;

    fn scheduler(quantum: u32, maximum: u32) -> DrrScheduler {
        DrrScheduler::new(DrrConfig::new(quantum, maximum).unwrap())
    }

    fn lane(path: &str, class: LaneClass, cost: u32) -> RunnableLane {
        RunnableLane::new(path, class, cost)
    }

    fn admitted(decision: DrrDecision) -> DrrAdmission {
        let DrrDecision::Admitted(admission) = decision else {
            panic!("expected an admission, got {decision:?}");
        };
        admission
    }

    #[test]
    fn startup_rejects_unpayable_effect_invalid_quantum_and_cap_overflow() {
        assert_eq!(
            DrrConfig::new(8, 1).unwrap_err(),
            DrrError::MaximumBelowSingleEffect
        );
        assert_eq!(
            DrrConfig::new(7, 8).unwrap_err(),
            DrrError::QuantumBelowMaximum
        );
        assert_eq!(
            DrrConfig::new(u32::MAX, u32::MAX).unwrap_err(),
            DrrError::DeficitCapOverflow
        );
    }

    #[test]
    fn unequal_cost_trace_charges_actual_requests_and_preserves_drr_credit() {
        let mut drr = scheduler(8, 8);
        drr.synchronize([
            lane("a", LaneClass::Foreground, 8),
            lane("b", LaneClass::Foreground, 2),
        ])
        .unwrap();

        let a = admitted(drr.admit(LaneClass::Foreground, true).unwrap());
        assert_eq!(a.integration_path(), "a");
        let executor_outcome = TurnOutcomeV1::Progressed {
            completed_effect_count: 4,
            work_exhausted: false,
            requests_used: 8,
        };
        drr.settle(
            a,
            &executor_outcome,
            LaneAfterTurn::Runnable {
                max_graph_requests: 8,
            },
        )
        .unwrap();
        let b = admitted(drr.admit(LaneClass::Foreground, true).unwrap());
        assert_eq!(b.integration_path(), "b");
        drr.settle(
            b,
            &2,
            LaneAfterTurn::Runnable {
                max_graph_requests: 2,
            },
        )
        .unwrap();
        let b_again = admitted(drr.admit(LaneClass::Foreground, true).unwrap());
        assert_eq!(b_again.integration_path(), "b");
        assert_eq!(drr.deficit(LaneClass::Foreground, "b"), Some(6));
    }

    #[test]
    fn token_starvation_does_not_spin_or_accrue_quantum() {
        let mut drr = scheduler(8, 8);
        drr.synchronize([lane("a", LaneClass::Foreground, 8)])
            .unwrap();
        for _ in 0..100 {
            assert_eq!(
                drr.admit(LaneClass::Foreground, false).unwrap(),
                DrrDecision::TokenStarved
            );
        }
        assert_eq!(drr.deficit(LaneClass::Foreground, "a"), Some(0));
        assert_eq!(
            admitted(drr.admit(LaneClass::Foreground, true).unwrap()).max_graph_requests(),
            8
        );
    }

    #[test]
    fn yielded_zero_cost_lane_accrues_but_never_exceeds_two_quanta() {
        let mut drr = scheduler(4, 4);
        drr.synchronize([lane("a", LaneClass::Foreground, 4)])
            .unwrap();
        for expected in [4, 8, 8] {
            let admission = admitted(drr.admit(LaneClass::Foreground, true).unwrap());
            drr.settle(
                admission,
                &0,
                LaneAfterTurn::Yield {
                    max_graph_requests: 4,
                },
            )
            .unwrap();
            assert_eq!(drr.deficit(LaneClass::Foreground, "a"), Some(expected));
        }
    }

    #[test]
    fn simultaneous_arrivals_are_sorted_and_removed_lanes_reset_credit() {
        let mut drr = scheduler(4, 4);
        drr.synchronize([
            lane("z", LaneClass::Foreground, 4),
            lane("a", LaneClass::Foreground, 4),
            lane("m", LaneClass::Foreground, 4),
        ])
        .unwrap();
        let first = admitted(drr.admit(LaneClass::Foreground, true).unwrap());
        assert_eq!(first.integration_path(), "a");
        drr.settle(
            first,
            &0,
            LaneAfterTurn::Yield {
                max_graph_requests: 4,
            },
        )
        .unwrap();
        drr.synchronize([
            lane("z", LaneClass::Foreground, 4),
            lane("m", LaneClass::Foreground, 4),
        ])
        .unwrap();
        assert_eq!(drr.deficit(LaneClass::Foreground, "a"), None);
        drr.synchronize([
            lane("z", LaneClass::Foreground, 4),
            lane("m", LaneClass::Foreground, 4),
            lane("a", LaneClass::Foreground, 4),
        ])
        .unwrap();
        assert_eq!(drr.deficit(LaneClass::Foreground, "a"), Some(0));
    }

    #[test]
    fn continuous_apply_cannot_starve_restore_in_the_foreground_ring() {
        let mut drr = scheduler(4, 4);
        drr.synchronize([
            lane("apply", LaneClass::Foreground, 4),
            lane("restore", LaneClass::Foreground, 4),
        ])
        .unwrap();
        let mut trace = Vec::new();
        for _ in 0..6 {
            let admission = admitted(drr.admit(LaneClass::Foreground, true).unwrap());
            trace.push(admission.integration_path().to_owned());
            drr.settle(
                admission,
                &4,
                LaneAfterTurn::Runnable {
                    max_graph_requests: 4,
                },
            )
            .unwrap();
        }
        assert_eq!(
            trace,
            ["apply", "restore", "apply", "restore", "apply", "restore"]
        );
    }

    #[test]
    fn foreground_arrival_forces_reconcile_to_yield_its_integration_lane() {
        let mut drr = scheduler(4, 4);
        drr.synchronize([
            lane("alice", LaneClass::Reconcile, 4),
            lane("bob", LaneClass::Reconcile, 4),
        ])
        .unwrap();
        let alice = admitted(drr.admit(LaneClass::Reconcile, true).unwrap());
        assert_eq!(alice.integration_path(), "alice");
        drr.synchronize([
            lane("alice", LaneClass::Foreground, 4),
            lane("alice", LaneClass::Reconcile, 4),
            lane("bob", LaneClass::Reconcile, 4),
        ])
        .unwrap();
        drr.settle(
            alice,
            &1,
            LaneAfterTurn::Runnable {
                max_graph_requests: 4,
            },
        )
        .unwrap();
        let bob = admitted(drr.admit(LaneClass::Reconcile, true).unwrap());
        assert_eq!(bob.integration_path(), "bob");
        drr.settle(
            bob,
            &4,
            LaneAfterTurn::Runnable {
                max_graph_requests: 4,
            },
        )
        .unwrap();
        drr.synchronize([
            lane("alice", LaneClass::Foreground, 4),
            lane("alice", LaneClass::Reconcile, 4),
        ])
        .unwrap();
        assert_eq!(
            drr.admit(LaneClass::Reconcile, true).unwrap(),
            DrrDecision::YieldedToForeground
        );
        assert_eq!(
            admitted(drr.admit(LaneClass::Foreground, true).unwrap()).integration_path(),
            "alice"
        );
    }

    #[test]
    fn settlement_refuses_a_charge_above_the_admitted_worst_case() {
        let mut drr = scheduler(4, 4);
        drr.synchronize([lane("a", LaneClass::Foreground, 2)])
            .unwrap();
        let admission = admitted(drr.admit(LaneClass::Foreground, true).unwrap());
        assert_eq!(
            drr.settle(admission, &3, LaneAfterTurn::EmptyOrBlocked)
                .unwrap_err(),
            DrrError::ChargeExceedsAdmission
        );
    }
}
