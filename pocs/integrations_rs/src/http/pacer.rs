//! Node-wide fetch pacing shared by every endpoint that talks to the same
//! host: `await_slot` reserves the next send slot for the host, at least the
//! caller's interval after the previous one, so back-to-back sources and
//! concurrent integrations cannot stack requests on one API. Reservation is a
//! fast lock; the caller sleeps until its slot, keeping other hosts
//! unblocked. Hosts a node stops talking to are pruned.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Default)]
pub struct FetchPacer {
    slots: Mutex<HashMap<String, Instant>>,
}

impl FetchPacer {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn await_slot(&self, host: &str, interval_ms: u64) {
        if interval_ms == 0 {
            return;
        }

        let slot = {
            let mut slots = self.slots.lock().expect("pacer lock");
            let now = Instant::now();

            if slots.len() > 64 {
                // checked_sub guards a monotonic clock younger than 60s (fresh
                // boot): unwrap would panic while holding the lock and poison
                // the whole pacer. When it can't subtract, keep every slot.
                if let Some(cutoff) = now.checked_sub(Duration::from_secs(60)) {
                    slots.retain(|_, slot| *slot > cutoff);
                }
            }

            let slot = match slots.get(host) {
                Some(last) => (*last + Duration::from_millis(interval_ms)).max(now),
                None => now,
            };
            slots.insert(host.to_owned(), slot);
            slot
        };

        let now = Instant::now();
        if slot > now {
            tokio::time::sleep(slot - now).await;
        }
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

    #[tokio::test]
    async fn spaces_same_host_leaves_other_hosts_unblocked() {
        let pacer = FetchPacer::new();
        let start = Instant::now();
        pacer.await_slot("api.test", 50).await;
        pacer.await_slot("api.test", 50).await;
        pacer.await_slot("api.test", 50).await;
        assert!(start.elapsed().as_millis() >= 100);

        let other = Instant::now();
        pacer.await_slot("other.test", 50).await;
        assert!(other.elapsed().as_millis() < 40);
    }
}
