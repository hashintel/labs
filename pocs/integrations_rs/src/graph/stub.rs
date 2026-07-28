//! Graphless client: logs every op, accepts everything. `has_entity` answers
//! true so adopted state passes the sentinel probe against the stub.

use error_stack::Report;

use crate::error::GraphError;
use crate::value::js_string;

use super::{ArchiveOp, BatchOk, BulkResult, EntityOp, GraphClient, LinkOp};

pub struct StubClient;

fn short(type_url: &str) -> &str {
    type_url.split("/entity-type/").nth(1).unwrap_or(type_url)
}

#[async_trait::async_trait]
impl GraphClient for StubClient {
    fn identity(&self) -> String {
        "stub:graph".to_owned()
    }

    async fn has_entity(&self, _full_entity_id: &str) -> Result<bool, Report<GraphError>> {
        Ok(true)
    }

    async fn archive_entity(&self, op: &ArchiveOp) -> Result<(), Report<GraphError>> {
        tracing::info!(
            "[graph] ARCHIVE {} id={}",
            short(&op.entity_type),
            op.entity_id
        );
        Ok(())
    }

    async fn bulk_upsert_entities(&self, ops: Vec<EntityOp>, on_batch_ok: BatchOk) -> BulkResult {
        let mut ok = vec![];
        for op in &ops {
            tracing::info!(
                "[graph] UPSERT {} id={} ({} props)",
                short(&op.entity_type),
                js_string(&op.entity_id),
                op.properties.len()
            );
            ok.push(js_string(&op.entity_id));
        }
        on_batch_ok(ok.clone()).await;
        BulkResult {
            ok,
            ..BulkResult::default()
        }
    }

    async fn bulk_upsert_links(&self, ops: Vec<LinkOp>, on_batch_ok: BatchOk) -> BulkResult {
        let mut ok = vec![];
        for op in &ops {
            tracing::info!(
                "[graph] LINK {} {} -> {}",
                short(&op.link_type),
                op.source_entity_id,
                op.target_id
            );
            ok.push(op.op_id.clone());
        }
        on_batch_ok(ok.clone()).await;
        BulkResult {
            ok,
            ..BulkResult::default()
        }
    }
}
