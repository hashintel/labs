//! Graph ops, the client trait, and its implementations. A client is a
//! `dyn GraphClient`: the HTTP client for real graphs, the stub for graphless
//! runs, the recording client for tests.

pub mod accessor;
pub mod apply;
pub mod artifacts;
pub mod client;
pub mod coherence;
pub mod effects;
pub mod executor;
pub mod hash;
pub mod link_pipeline;
pub mod planner;
pub mod reconcile;
pub mod recording;
pub mod restore;
pub mod sink;
pub mod state_meta;
pub mod stub;
pub mod uuid;

use std::collections::BTreeMap;
use std::sync::Arc;

use error_stack::Report;
use futures::future::BoxFuture;
use serde_json::{json, Map, Value};

use crate::error::GraphError;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Provenance {
    pub loaded_at: String,
    pub location_name: String,
    pub authors: Option<Vec<String>>,
    pub first_published: Option<String>,
    pub last_updated: Option<String>,
}

impl Provenance {
    /// The per-property `sources` entry (camelCase wire shape).
    pub fn source_json(&self) -> Value {
        let mut source = Map::new();
        source.insert("type".to_owned(), json!("integration"));
        if let Some(authors) = &self.authors {
            source.insert("authors".to_owned(), json!(authors));
        }
        source.insert("location".to_owned(), json!({"name": self.location_name}));
        if let Some(first_published) = &self.first_published {
            source.insert("firstPublished".to_owned(), json!(first_published));
        }
        if let Some(last_updated) = &self.last_updated {
            source.insert("lastUpdated".to_owned(), json!(last_updated));
        }
        source.insert("loadedAt".to_owned(), json!(self.loaded_at));
        Value::Object(source)
    }

    /// The op-level provenance envelope.
    pub fn op_json(&self) -> Value {
        json!({
            "actorType": "machine",
            "origin": {"type": "api"},
            "sources": [self.source_json()],
        })
    }
}

#[derive(Debug, Clone)]
pub struct EntityOp {
    pub namespace: String,
    pub entity_type: String,
    pub entity_id: Value,
    /// Property URL -> value (possibly `$typedValue`-tagged); nulls filtered
    /// at the client.
    pub properties: Vec<(String, Value)>,
    /// Property URL -> per-property provenance `sources` payload.
    pub property_provenance: BTreeMap<String, Value>,
    pub provenance: Provenance,
    pub web_id: String,
}

#[derive(Debug, Clone)]
pub struct ArchiveOp {
    pub namespace: String,
    pub entity_type: String,
    pub entity_id: String,
    pub provenance: Provenance,
    pub web_id: String,
}

#[derive(Debug, Clone)]
pub struct LinkOp {
    pub op_id: String,
    pub namespace: String,
    pub web_id: String,
    pub source_entity_type: String,
    pub source_entity_id: String,
    pub link_type: String,
    pub target_entity_type: String,
    pub target_id: String,
    pub properties: Option<Vec<(String, Value)>>,
    pub provenance: Provenance,
}

#[derive(Debug, Clone)]
pub struct OpFailure {
    /// Entity id (JS-rendered) or link op id.
    pub id: String,
    pub message: String,
}

#[derive(Debug, Clone, Default)]
pub struct BulkResult {
    pub ok: Vec<String>,
    pub failed: Vec<OpFailure>,
    pub aborted: bool,
}

/// Called with each acknowledged slice of ids; the batch path commits diff
/// state here so a crash resumes from acked work.
pub type BatchOk = Arc<dyn Fn(Vec<String>) -> BoxFuture<'static, ()> + Send + Sync>;

pub fn noop_batch_ok() -> BatchOk {
    Arc::new(|_ids| Box::pin(async {}))
}

#[async_trait::async_trait]
pub trait GraphClient: Send + Sync {
    /// Stable identity of the target graph (the coherence fingerprint).
    fn identity(&self) -> String;

    async fn has_entity(&self, full_entity_id: &str) -> Result<bool, Report<GraphError>>;

    async fn archive_entity(&self, op: &ArchiveOp) -> Result<(), Report<GraphError>>;

    async fn bulk_upsert_entities(&self, ops: Vec<EntityOp>, on_batch_ok: BatchOk) -> BulkResult;

    async fn bulk_upsert_links(&self, ops: Vec<LinkOp>, on_batch_ok: BatchOk) -> BulkResult;
}

pub type SharedClient = Arc<dyn GraphClient>;
