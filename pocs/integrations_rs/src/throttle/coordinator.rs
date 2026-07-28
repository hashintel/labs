//! Process-wide asynchronous ownership of the fair Graph scheduler.
//!
//! One coordinator serializes lane synchronization, turn admission,
//! per-request token consumption, and settlement for every shard a worker
//! owns. The `FairGraphScheduler` itself is pure over caller-supplied
//! monotonic nanoseconds; this wrapper owns the single async mutex, the
//! monotonic origin, and the token waits, so no lock is ever held across an
//! await.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Instant;

use super::drr::{LaneAfterTurn, LaneClass, RunnableLane};
use super::rate::{
    FairAdmission, FairDecision, FairGraphScheduler, FairScheduleError, StaticShareConfig,
    TokenDecision,
};

pub(crate) struct GraphTokenCoordinator {
    scheduler: tokio::sync::Mutex<FairGraphScheduler>,
    origin: Instant,
}

impl GraphTokenCoordinator {
    pub(crate) fn new(config: StaticShareConfig) -> Self {
        Self {
            scheduler: tokio::sync::Mutex::new(FairGraphScheduler::new(config)),
            origin: Instant::now(),
        }
    }

    pub(crate) fn with_telemetry(self, telemetry: crate::progress::OperationalTelemetry) -> Self {
        Self {
            scheduler: tokio::sync::Mutex::new(
                self.scheduler.into_inner().with_telemetry(telemetry),
            ),
            origin: self.origin,
        }
    }

    fn now_nanos(&self) -> u64 {
        u64::try_from(self.origin.elapsed().as_nanos()).unwrap_or(u64::MAX)
    }

    /// Declares the complete runnable lane set across every owned shard.
    /// Call only while no admission is outstanding, so a changed chunk bound
    /// can never race an in-flight lane.
    pub(crate) async fn synchronize(
        &self,
        lanes: Vec<RunnableLane>,
    ) -> Result<(), FairScheduleError> {
        self.scheduler.lock().await.synchronize(lanes)
    }

    /// Applies a validated runtime rate revision while preserving token debt.
    /// The runner calls this only between delivery passes, when no admission
    /// is outstanding.
    pub(crate) async fn reconfigure(
        &self,
        config: StaticShareConfig,
    ) -> Result<(), FairScheduleError> {
        let now = self.now_nanos();
        self.scheduler.lock().await.reconfigure(config, now)
    }

    /// One non-waiting admission attempt for the class. An admitted turn has
    /// already consumed exactly one parent+class token, prepaying its first
    /// Graph request.
    pub(crate) async fn admit(&self, class: LaneClass) -> Result<FairDecision, FairScheduleError> {
        let now = self.now_nanos();
        self.scheduler.lock().await.admit(class, now)
    }

    /// Waits until one parent+class token pair is consumed, sleeping outside
    /// the scheduler lock between attempts. Returns `false` once `deadline`
    /// passes without a grant.
    pub(crate) async fn acquire_request_token(
        &self,
        class: LaneClass,
        deadline: Option<tokio::time::Instant>,
    ) -> Result<bool, FairScheduleError> {
        loop {
            let due = {
                let now = self.now_nanos();
                let decision = self.scheduler.lock().await.take_request_token(class, now)?;
                match decision {
                    TokenDecision::Granted => return Ok(true),
                    TokenDecision::WaitUntil(due) => due,
                }
            };
            let wait = std::time::Duration::from_nanos(due.saturating_sub(self.now_nanos()));
            let token_ready = tokio::time::Instant::now() + wait;
            if let Some(deadline) = deadline {
                if token_ready >= deadline {
                    return Ok(false);
                }
            }
            tokio::time::sleep_until(token_ready).await;
        }
    }

    /// Settles an admitted turn with the executor's authoritative request
    /// charge and the lane's real terminal state. Every admission must reach
    /// this exactly once, on success and on every error exit.
    pub(crate) async fn settle(
        &self,
        admission: FairAdmission,
        requests_used: u32,
        after: LaneAfterTurn,
    ) -> Result<(), FairScheduleError> {
        self.scheduler
            .lock()
            .await
            .settle(admission, &requests_used, after)
    }
}

/// Per-turn request pacing derived from one admission. The admission prepaid
/// the turn's first Graph request; every later request in the same turn
/// consumes one parent+class token as it starts.
pub(crate) struct TurnTokens {
    coordinator: Arc<GraphTokenCoordinator>,
    class: LaneClass,
    prepaid_remaining: AtomicU32,
}

impl TurnTokens {
    pub(crate) fn new(
        coordinator: Arc<GraphTokenCoordinator>,
        class: LaneClass,
        prepaid_graph_requests: u32,
    ) -> Self {
        Self {
            coordinator,
            class,
            prepaid_remaining: AtomicU32::new(prepaid_graph_requests),
        }
    }

    /// Admits the next Graph request of this turn, waiting for a token when
    /// the prepaid budget is exhausted. Returns `false` when the deadline
    /// passes first; the executor then yields the turn at its durable cursor.
    pub(crate) async fn acquire(&self, deadline: Option<tokio::time::Instant>) -> bool {
        let prepaid = self
            .prepaid_remaining
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |remaining| {
                remaining.checked_sub(1)
            })
            .is_ok();
        if prepaid {
            return true;
        }
        match self
            .coordinator
            .acquire_request_token(self.class, deadline)
            .await
        {
            Ok(granted) => granted,
            Err(error) => {
                tracing::error!(error = ?error, "per-request token acquisition failed; yielding turn");
                false
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn coordinator(rate: u64) -> Arc<GraphTokenCoordinator> {
        let config = StaticShareConfig::new(1, rate, 1, 1_000, 4, 4, 1, 1).expect("config");
        Arc::new(GraphTokenCoordinator::new(config))
    }

    fn lane(path: &str, class: LaneClass) -> RunnableLane {
        RunnableLane::new(path.to_owned(), class, 4)
    }

    #[tokio::test]
    async fn admission_prepays_exactly_the_first_request() {
        let coordinator = coordinator(1_000_000);
        coordinator
            .synchronize(vec![lane("aa", LaneClass::Foreground)])
            .await
            .expect("synchronize");
        let FairDecision::Admitted(admission) = coordinator
            .admit(LaneClass::Foreground)
            .await
            .expect("admission attempt")
        else {
            panic!("one runnable foreground lane admits")
        };
        let tokens = TurnTokens::new(
            Arc::clone(&coordinator),
            admission.class(),
            admission.prepaid_graph_requests(),
        );
        // First request is prepaid; the second consumes a live token.
        assert!(tokens.acquire(None).await);
        assert!(tokens.acquire(None).await);
        coordinator
            .settle(admission, 2, LaneAfterTurn::EmptyOrBlocked)
            .await
            .expect("settlement");
    }

    #[tokio::test]
    async fn starved_request_token_respects_the_deadline() {
        // One request per second: the admission consumes the only live token.
        let coordinator = coordinator(1);
        coordinator
            .synchronize(vec![lane("aa", LaneClass::Foreground)])
            .await
            .expect("synchronize");
        let FairDecision::Admitted(admission) = coordinator
            .admit(LaneClass::Foreground)
            .await
            .expect("admission attempt")
        else {
            panic!("one runnable foreground lane admits")
        };
        let tokens = TurnTokens::new(
            Arc::clone(&coordinator),
            admission.class(),
            admission.prepaid_graph_requests(),
        );
        assert!(tokens.acquire(None).await);
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(20);
        assert!(!tokens.acquire(Some(deadline)).await);
        coordinator
            .settle(
                admission,
                1,
                LaneAfterTurn::Yield {
                    max_graph_requests: 4,
                },
            )
            .await
            .expect("settlement");
    }

    #[tokio::test]
    async fn concurrent_requests_are_serialized_through_one_rate_ceiling() {
        let coordinator = coordinator(20);
        coordinator
            .synchronize(vec![lane("aa", LaneClass::Foreground)])
            .await
            .expect("synchronize");
        let FairDecision::Admitted(admission) = coordinator
            .admit(LaneClass::Foreground)
            .await
            .expect("admission attempt")
        else {
            panic!("one runnable foreground lane admits")
        };
        let tokens = Arc::new(TurnTokens::new(
            Arc::clone(&coordinator),
            admission.class(),
            admission.prepaid_graph_requests(),
        ));
        let started = Instant::now();
        let mut requests = Vec::new();
        for _ in 0..4 {
            let tokens = Arc::clone(&tokens);
            requests.push(tokio::spawn(async move { tokens.acquire(None).await }));
        }
        for request in requests {
            assert!(request.await.expect("request task"));
        }
        assert!(
            started.elapsed() >= std::time::Duration::from_millis(150),
            "concurrent callers must wait for the shared token cadence"
        );
        coordinator
            .settle(admission, 4, LaneAfterTurn::EmptyOrBlocked)
            .await
            .expect("settlement");
    }

    #[tokio::test]
    async fn foreground_is_tried_before_reconcile_and_reconcile_yields() {
        let coordinator = coordinator(1_000_000);
        coordinator
            .synchronize(vec![
                lane("aa", LaneClass::Foreground),
                lane("aa", LaneClass::Reconcile),
            ])
            .await
            .expect("synchronize");
        // The same integration has runnable foreground work, so its Reconcile
        // lane yields instead of admitting.
        let decision = coordinator
            .admit(LaneClass::Reconcile)
            .await
            .expect("reconcile admission attempt");
        assert!(matches!(decision, FairDecision::YieldedToForeground));
        let FairDecision::Admitted(admission) = coordinator
            .admit(LaneClass::Foreground)
            .await
            .expect("foreground admission attempt")
        else {
            panic!("foreground lane admits")
        };
        coordinator
            .settle(admission, 0, LaneAfterTurn::EmptyOrBlocked)
            .await
            .expect("settlement");
    }
}
