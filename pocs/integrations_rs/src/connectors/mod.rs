//! Connector registry. `batch` and `rest-api` are engine-native modes
//! (hydration runs inside the batch sync); stream modes resolve to
//! `StreamConnector` implementations. The pgoutput decoder is ported and
//! golden-testable; the live CDC replication connection and the mongo change
//! stream are deferred (documented), so the built-in stream modes are
//! recognized for validation and run through injected connectors (fixtures,
//! custom implementations) until then.

pub mod cdc;
pub mod rest_api;

use std::sync::Arc;

use error_stack::Report;
use futures::future::BoxFuture;
use serde_json::Value;

use crate::error::SourceError;

pub fn stream_modes() -> &'static [&'static str] {
    crate::build::stream_modes()
}

pub fn is_stream_mode(mode: &str) -> bool {
    stream_modes().contains(&mode)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EventOp {
    Insert,
    Update,
    Delete,
}

#[derive(Debug, Clone)]
pub struct StreamEvent {
    pub op: EventOp,
    pub key: crate::value::Row,
    pub row: Option<crate::value::Row>,
    pub before: Option<crate::value::Row>,
}

#[derive(Debug, Clone)]
pub struct StreamBatch {
    pub events: Vec<StreamEvent>,
    /// Resume position AFTER these events (LSN, resume token); persisted once
    /// the batch is fully processed.
    pub cursor: Option<Value>,
}

/// The callback is synchronous in effect: the connector must not deliver the
/// next batch until the returned future resolves. `Ok` acknowledges the
/// source cursor; `Err` is a negative acknowledgement and the connector must
/// redeliver the same batch. This is the durability/back-pressure boundary.
pub type OnBatch = Arc<dyn Fn(StreamBatch) -> BoxFuture<'static, Result<(), String>> + Send + Sync>;

#[async_trait::async_trait]
pub trait StreamConnector: Send + Sync {
    async fn subscribe(
        &self,
        source: &str,
        cursor: Option<Value>,
        on_batch: OnBatch,
    ) -> Result<(), Report<SourceError>>;

    async fn unsubscribe(&self, source: &str);
}

pub type SharedStreamConnector = Arc<dyn StreamConnector>;
