//! Spaces requests to the same host across integrations on this node. Each
//! caller reserves a send time at least its interval after the preceding
//! reservation. It releases the lock before waiting, so requests to other
//! hosts can continue. Old reservations are removed as the host map grows.

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
                // Some monotonic clocks cannot represent a time before boot.
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
