//! Write budget toward the graph, scoped per web and weighted in operations,
//! not HTTP requests. This is the TypeScript runner's token-bucket contract:
//! 2x-rate burst capacity, refill to now, deduct/reserve the full charge, then
//! sleep once when the resulting balance is negative. Reservation prevents
//! concurrent waiters racing to reacquire the same future capacity.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub(crate) mod coordinator;
pub(crate) mod drr;
pub(crate) mod rate;

pub(crate) use drr::{GraphRequestCharge, GraphRequestsUsed};

#[async_trait::async_trait]
pub trait RateLimiter: Send + Sync {
    async fn acquire(&self, scope: &str, ops: u64, rate: Option<u64>) -> Result<(), String>;
}

#[derive(Default)]
pub struct Throttle {
    buckets: Mutex<HashMap<String, Bucket>>,
}

struct Bucket {
    tokens: f64,
    last: Instant,
}

impl Throttle {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn acquire_local(&self, scope: &str, ops: u64, rate: Option<u64>) {
        let Some(rate) = rate.filter(|rate| *rate > 0) else {
            return;
        };

        let capacity = rate.saturating_mul(2);
        let balance = {
            let now = Instant::now();
            let mut buckets = self.buckets.lock().expect("throttle lock");
            let bucket = buckets.entry(scope.to_owned()).or_insert(Bucket {
                tokens: capacity as f64,
                last: now,
            });
            bucket.tokens = now
                .duration_since(bucket.last)
                .as_secs_f64()
                .mul_add(rate as f64, bucket.tokens)
                .min(capacity as f64)
                - ops as f64;
            bucket.last = now;
            bucket.tokens
        };

        if balance < 0.0 {
            let wait_ms = ((-balance / rate as f64) * 1000.0).ceil() as u64;
            tracing::debug!(scope, wait_ms, ops, "local throttle reserved wait");
            tokio::time::sleep(Duration::from_millis(wait_ms)).await;
        }
    }
}

#[async_trait::async_trait]
impl RateLimiter for Throttle {
    async fn acquire(&self, scope: &str, ops: u64, rate: Option<u64>) -> Result<(), String> {
        self.acquire_local(scope, ops, rate).await;
        Ok(())
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::Instant;

    #[tokio::test]
    async fn no_rate_means_off() {
        let throttle = Throttle::new();
        let start = Instant::now();
        for _ in 0..100 {
            throttle.acquire_local("web", 1000, None).await;
        }
        assert!(start.elapsed().as_millis() < 100);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn holds_the_cap_under_concurrency() {
        // A fresh 50/s bucket may burst 100 ops. The remaining 100 ops are
        // reserved into the future, so 200 concurrent ops take about 2s.
        let throttle = Arc::new(Throttle::new());
        let start = Instant::now();

        let tasks: Vec<_> = (0..20)
            .map(|_| {
                let throttle = Arc::clone(&throttle);
                tokio::spawn(async move { throttle.acquire_local("web", 10, Some(50)).await })
            })
            .collect();
        for task in tasks {
            task.await.expect("acquire task");
        }

        assert!(
            start.elapsed().as_millis() >= 1900,
            "over-admitting: {}ms",
            start.elapsed().as_millis()
        );
    }

    #[tokio::test]
    async fn oversized_op_waits_a_window_then_releases() {
        // At 1000/s with 2000 burst capacity, a 2500-op request reserves 500
        // future tokens and waits about half a second.
        let throttle = Throttle::new();
        let start = Instant::now();
        throttle.acquire_local("web", 2500, Some(1000)).await;
        let elapsed = start.elapsed().as_millis();
        assert!(
            (400..=700).contains(&elapsed),
            "oversized op should wait ~half a second, took {elapsed}ms"
        );
    }

    #[tokio::test]
    async fn scopes_are_independent_lanes() {
        let throttle = Throttle::new();
        throttle.acquire_local("web-a", 50, Some(50)).await;
        let start = Instant::now();
        throttle.acquire_local("web-b", 10, Some(50)).await;
        assert!(start.elapsed().as_millis() < 100);
    }
}
