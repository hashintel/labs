//! Counting semaphore capping concurrently active integrations on this node.
//! Per-integration serialization is structural (one DuckDB file); this is the
//! cross-integration resource budget. Slots are RAII guards: release happens
//! on drop, so a dying holder cannot leak a slot, and a dropped waiter
//! stops polling.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use tokio::sync::Notify;

pub struct RunSlots {
    inner: Mutex<Inner>,
    notify: Notify,
}

struct Inner {
    max: usize,
    held: HashSet<String>,
}

pub struct SlotGuard {
    slots: Arc<RunSlots>,
    key: String,
}

impl core::fmt::Debug for SlotGuard {
    fn fmt(&self, fmt: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(fmt, "SlotGuard({})", self.key)
    }
}

impl Drop for SlotGuard {
    fn drop(&mut self) {
        let mut inner = self.slots.inner.lock().expect("slots lock");
        inner.held.remove(&self.key);
        drop(inner);
        self.slots.notify.notify_waiters();
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum TryAcquire {
    Busy,
    AlreadyHeld,
}

impl RunSlots {
    pub fn new(max: usize) -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(Inner {
                max: max.max(1),
                held: HashSet::new(),
            }),
            notify: Notify::new(),
        })
    }

    /// Non-blocking: for callers that reject instead of waiting.
    pub fn try_acquire(self: &Arc<Self>, key: &str) -> Result<SlotGuard, TryAcquire> {
        let mut inner = self.inner.lock().expect("slots lock");
        if inner.held.contains(key) {
            return Err(TryAcquire::AlreadyHeld);
        }
        if inner.held.len() >= inner.max {
            return Err(TryAcquire::Busy);
        }
        inner.held.insert(key.to_owned());
        Ok(SlotGuard {
            slots: Arc::clone(self),
            key: key.to_owned(),
        })
    }

    /// Blocking acquire; `AlreadyHeld` resolves immediately (matching the
    /// immediate-path behavior: the key's answer is already determined).
    pub async fn acquire(self: &Arc<Self>, key: &str) -> Result<SlotGuard, TryAcquire> {
        loop {
            let waiter = self.notify.notified();
            match self.try_acquire(key) {
                Ok(guard) => return Ok(guard),
                Err(TryAcquire::AlreadyHeld) => return Err(TryAcquire::AlreadyHeld),
                Err(TryAcquire::Busy) => waiter.await,
            }
        }
    }

    pub fn active(&self) -> Vec<String> {
        let inner = self.inner.lock().expect("slots lock");
        let mut keys: Vec<String> = inner.held.iter().cloned().collect();
        keys.sort();
        keys
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
    use std::time::Duration;

    #[tokio::test]
    async fn grants_up_to_max_queues_the_rest_releases_on_drop() {
        let slots = RunSlots::new(1);
        let guard = slots.try_acquire("a").unwrap();

        assert_eq!(slots.try_acquire("b").unwrap_err(), TryAcquire::Busy);
        assert_eq!(slots.try_acquire("a").unwrap_err(), TryAcquire::AlreadyHeld);

        let waiter = {
            let slots = Arc::clone(&slots);
            tokio::spawn(async move {
                let _guard = slots.acquire("b").await.unwrap();
                slots.active()
            })
        };

        tokio::time::sleep(Duration::from_millis(30)).await;
        assert!(!waiter.is_finished());

        drop(guard);
        assert_eq!(waiter.await.unwrap(), vec!["b".to_owned()]);
    }

    #[tokio::test]
    async fn dropped_waiter_never_holds_a_slot() {
        let slots = RunSlots::new(1);
        let _guard = slots.try_acquire("a").unwrap();

        let waiter = {
            let slots = Arc::clone(&slots);
            tokio::spawn(async move {
                let _guard = slots.acquire("dead").await;
                unreachable!("aborted before grant");
            })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        waiter.abort();
        let _ = waiter.await;

        drop(_guard);
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(slots.active().is_empty());
    }
}
