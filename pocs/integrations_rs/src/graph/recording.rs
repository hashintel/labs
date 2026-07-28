//! Test double: records every op in order; behavior configurable per test
//! (fail specific ids, deny sentinel probes). Lives in the library so
//! integration tests and embedders can drive the engine hermetically.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use error_stack::Report;

use crate::error::GraphError;
use crate::value::js_string;

use super::{ArchiveOp, BatchOk, BulkResult, EntityOp, GraphClient, LinkOp, OpFailure};

#[derive(Debug, Clone)]
pub enum RecordedOp {
    Upsert(EntityOp),
    Archive(ArchiveOp),
    Link(LinkOp),
}

#[derive(Default)]
pub struct RecordingClient {
    ops: Mutex<Vec<RecordedOp>>,
    pub identity: Option<String>,
    pub has_entity: bool,
    /// Entity ids (JS-rendered) whose upserts fail.
    pub fail_ids: Vec<String>,
    fail_archives_remaining: AtomicUsize,
    fail_upsert_batches_remaining: AtomicUsize,
}

impl RecordingClient {
    pub fn new() -> Self {
        Self {
            has_entity: true,
            ..Self::default()
        }
    }

    pub fn ops(&self) -> Vec<RecordedOp> {
        self.ops.lock().expect("recording lock").clone()
    }

    pub fn upserts(&self) -> Vec<EntityOp> {
        self.ops()
            .into_iter()
            .filter_map(|op| match op {
                RecordedOp::Upsert(op) => Some(op),
                _ => None,
            })
            .collect()
    }

    pub fn links(&self) -> Vec<LinkOp> {
        self.ops()
            .into_iter()
            .filter_map(|op| match op {
                RecordedOp::Link(op) => Some(op),
                _ => None,
            })
            .collect()
    }

    pub fn archives(&self) -> Vec<ArchiveOp> {
        self.ops()
            .into_iter()
            .filter_map(|op| match op {
                RecordedOp::Archive(op) => Some(op),
                _ => None,
            })
            .collect()
    }

    pub fn fail_next_archives(&self, count: usize) {
        self.fail_archives_remaining.store(count, Ordering::Relaxed);
    }

    pub fn fail_next_upsert_batches(&self, count: usize) {
        self.fail_upsert_batches_remaining
            .store(count, Ordering::Relaxed);
    }

    fn record(&self, op: RecordedOp) {
        self.ops.lock().expect("recording lock").push(op);
    }
}

#[async_trait::async_trait]
impl GraphClient for RecordingClient {
    fn identity(&self) -> String {
        self.identity
            .clone()
            .unwrap_or_else(|| "recording:graph".to_owned())
    }

    async fn has_entity(&self, _full_entity_id: &str) -> Result<bool, Report<GraphError>> {
        Ok(self.has_entity)
    }

    async fn archive_entity(&self, op: &ArchiveOp) -> Result<(), Report<GraphError>> {
        if self
            .fail_archives_remaining
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |remaining| {
                remaining.checked_sub(1)
            })
            .is_ok()
        {
            return Err(
                Report::new(GraphError).attach_printable("recording: configured archive failure")
            );
        }
        self.record(RecordedOp::Archive(op.clone()));
        Ok(())
    }

    async fn bulk_upsert_entities(&self, ops: Vec<EntityOp>, on_batch_ok: BatchOk) -> BulkResult {
        if self
            .fail_upsert_batches_remaining
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |remaining| {
                remaining.checked_sub(1)
            })
            .is_ok()
        {
            return BulkResult {
                failed: ops
                    .into_iter()
                    .map(|op| OpFailure {
                        id: js_string(&op.entity_id),
                        message: "recording: configured batch transport failure".to_owned(),
                    })
                    .collect(),
                aborted: true,
                ..BulkResult::default()
            };
        }
        let mut result = BulkResult::default();
        for op in ops {
            let id = js_string(&op.entity_id);
            if self.fail_ids.contains(&id) {
                result.failed.push(OpFailure {
                    id,
                    message: "recording: configured failure".to_owned(),
                });
            } else {
                self.record(RecordedOp::Upsert(op));
                result.ok.push(id);
            }
        }
        on_batch_ok(result.ok.clone()).await;
        result
    }

    async fn bulk_upsert_links(&self, ops: Vec<LinkOp>, on_batch_ok: BatchOk) -> BulkResult {
        let mut result = BulkResult::default();
        for op in ops {
            let id = op.op_id.clone();
            self.record(RecordedOp::Link(op));
            result.ok.push(id);
        }
        on_batch_ok(result.ok.clone()).await;
        result
    }
}
