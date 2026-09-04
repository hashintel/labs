//! Defines connector interfaces. Batch and REST API sources run in the batch
//! engine. Stream modes use injected `StreamConnector` implementations. This
//! module also decodes PostgreSQL `pgoutput` messages.

pub mod cdc;
pub mod postgres;
pub mod rest_api;

use std::sync::Arc;

use error_stack::Report;
use futures::future::BoxFuture;
use serde_json::Value;

use crate::error::SourceError;

pub fn stream_modes() -> &'static [&'static str] {
    crate::definition::stream_modes()
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
    /// Position after these events, such as an LSN or resume token. The engine
    /// persists it after processing the batch.
    pub cursor: Option<Value>,
}

/// The connector waits for the returned future before delivering the next
/// batch. `Ok` acknowledges the source cursor. `Err` requires redelivery of
/// the same batch.
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
