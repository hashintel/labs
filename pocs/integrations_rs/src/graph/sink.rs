//! Batch diff-and-sync against `_state/sync/{connector}/{sink}`. The diff
//! classifies entirely in DuckDB; changed rows stage into a frozen `_upsert`
//! table and stream out in windows (bounded memory, well-defined crash resume
//! via per-window state commits). Deletes archive via keyset pagination.
//! Guards: unique entity ids, mass-archive refusal, hash/config version
//! migration, per-property coverage warnings.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use error_stack::{Report, ResultExt as _};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::build::{Accessor, SinkConfig};
use crate::config::{self, Env};
use crate::dlq;
use crate::error::SourceError;
use crate::progress::{self, Progress};
use crate::store::{lit, qi, Store};
use crate::value::js_string;

use super::hash;
use super::planner::{plan_entity_archive, plan_entity_upsert, EffectSelectionV1, GraphPlanV1};
pub use super::planner::{row_to_entity_op as row_to_graph_op, trimmed};
use super::state_meta::{self, Meta, HASH_VERSION};
use super::{BatchOk, EntityOp, Provenance, SharedClient};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncError {
    pub kind: String,
    pub entity_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncResult {
    pub inserts: i64,
    pub updates: i64,
    pub deletes: i64,
    pub unchanged: i64,
    pub quarantined: i64,
    pub errors: Vec<SyncError>,
    pub aborted: bool,
}

impl SyncResult {
    pub fn merge(mut self, other: Self) -> Self {
        self.inserts += other.inserts;
        self.updates += other.updates;
        self.deletes += other.deletes;
        self.unchanged += other.unchanged;
        self.quarantined += other.quarantined;
        self.errors.extend(other.errors);
        self.aborted = self.aborted || other.aborted;
        self
    }
}

pub struct SinkContext<'a> {
    pub connector_id: &'a str,
    pub client: &'a SharedClient,
    pub provenance: &'a Provenance,
    pub unit_maps: &'a Map<String, Value>,
    pub run_id: &'a str,
    pub source: Option<&'a str>,
    pub partial: bool,
    pub env: &'a Env,
}

pub struct EntityPlanningContext<'a> {
    pub connector_id: &'a str,
    pub provenance: &'a Provenance,
    pub unit_maps: &'a Map<String, Value>,
    pub source: Option<&'a str>,
    pub partial: bool,
    pub effect_selection: EffectSelectionV1,
    pub env: &'a Env,
}

#[derive(Debug, Clone)]
pub struct EntitySinkPlanV1 {
    pub graph: GraphPlanV1,
    pub state_table: String,
    pub inserts: i64,
    pub updates: i64,
    pub deletes: i64,
    pub unchanged: i64,
    pub quarantined: Vec<dlq::Entry>,
    pub errors: Vec<SyncError>,
}

struct PreparedEntityDiff {
    current: String,
    state_table: String,
    diff: String,
    planned_inserts: i64,
    planned_updates: i64,
    planned_deletes: i64,
    unchanged: i64,
}

async fn prepare_entity_diff(
    store: &Store,
    sink_id: &str,
    sink: &SinkConfig,
    input_table: Option<&str>,
    connector_id: &str,
    partial: bool,
    env: &Env,
) -> Result<PreparedEntityDiff, Report<SourceError>> {
    let current = format!("_sync/current/{sink_id}");
    let state_table = format!("_state/sync/{connector_id}/{sink_id}");
    let canonical = build_current(store, sink_id, sink, input_table, &current).await?;
    let has_previous = store
        .schema_of(&state_table)
        .await
        .change_context(SourceError)?
        .is_some();

    if input_table.is_some() {
        migrate_meta(store, sink_id, sink, connector_id, canonical, has_previous)
            .await
            .change_context(SourceError)?;
    }
    if partial && has_previous {
        store
            .exec(&format!(
                "INSERT INTO {current} SELECT * FROM {state} WHERE _entity_id NOT IN (SELECT _entity_id FROM {current})",
                current = qi(&current),
                state = qi(&state_table),
            ))
            .await
            .change_context(SourceError)?;
    }
    if !has_previous {
        store
            .exec(&format!(
                "CREATE TABLE {} AS SELECT * FROM {} WHERE 1=0",
                qi(&state_table),
                qi(&current)
            ))
            .await
            .change_context(SourceError)?;
    }

    let diff = format!("_diff/{connector_id}/{sink_id}");
    store
        .exec(&format!(
            "CREATE OR REPLACE TABLE {diff_q} AS SELECT COALESCE(c._entity_id, p._entity_id) AS _entity_id, CASE WHEN p._entity_id IS NULL THEN 'insert' WHEN c._entity_id IS NULL THEN 'delete' WHEN c._content_hash = p._content_hash THEN 'unchanged' ELSE 'update' END AS _diff_op FROM {current_q} c FULL OUTER JOIN {state_q} p ON c._entity_id = p._entity_id",
            diff_q = qi(&diff),
            current_q = qi(&current),
            state_q = qi(&state_table),
        ))
        .await
        .change_context(SourceError)?;
    let counts = store
        .query(&format!(
            "SELECT _diff_op, COUNT(*)::BIGINT AS n FROM {} GROUP BY _diff_op",
            qi(&diff)
        ))
        .await
        .change_context(SourceError)?;
    let count_of = |op: &str| {
        counts
            .rows
            .iter()
            .find(|row| row.first().and_then(Value::as_str) == Some(op))
            .and_then(|row| row.get(1).and_then(Value::as_i64))
            .unwrap_or(0)
    };
    let planned_inserts = count_of("insert");
    let planned_updates = count_of("update");
    let planned_deletes = count_of("delete");
    let unchanged = count_of("unchanged");
    let state_rows = planned_updates + planned_deletes + unchanged;
    if planned_deletes as f64 > 1000f64.max(state_rows as f64 * 0.5)
        && !config::allow_mass_archive(env)
    {
        let _ = store
            .exec(&format!("DROP TABLE IF EXISTS {}", qi(&current)))
            .await;
        let _ = store
            .exec(&format!("DROP TABLE IF EXISTS {}", qi(&diff)))
            .await;
        return Err(Report::new(SourceError).attach_printable(format!(
            "sink \"{sink_id}\": refusing to archive {planned_deletes} of {state_rows} previously synced rows (truncated source file?). Set HASH_ALLOW_MASS_ARCHIVE=1 if this mass archive is intended."
        )));
    }
    Ok(PreparedEntityDiff {
        current,
        state_table,
        diff,
        planned_inserts,
        planned_updates,
        planned_deletes,
        unchanged,
    })
}

pub async fn diff_and_sync(
    store: &Store,
    sink_id: &str,
    sink: &SinkConfig,
    input_table: Option<&str>,
    ctx: &SinkContext<'_>,
) -> Result<SyncResult, Report<SourceError>> {
    let t0 = std::time::Instant::now();
    let connector_id = ctx.connector_id;
    let PreparedEntityDiff {
        current,
        state_table,
        diff,
        planned_inserts,
        planned_updates,
        planned_deletes,
        unchanged,
    } = prepare_entity_diff(
        store,
        sink_id,
        sink,
        input_table,
        connector_id,
        ctx.partial,
        ctx.env,
    )
    .await?;

    let namespace = sink
        .id_namespace
        .clone()
        .unwrap_or_else(|| connector_id.to_owned());

    let (upsert_errors, aborted, quarantined) = match input_table {
        Some(input_table) if planned_inserts + planned_updates > 0 => {
            stream_upserts(
                store,
                sink_id,
                sink,
                input_table,
                &diff,
                &current,
                &state_table,
                &namespace,
                planned_inserts + planned_updates,
                ctx,
            )
            .await?
        }
        _ => (vec![], false, 0),
    };

    let delete_errors = if planned_deletes > 0 {
        archive_deletes(
            store,
            sink_id,
            sink,
            &diff,
            &state_table,
            &namespace,
            ctx,
            planned_deletes,
        )
        .await?
    } else {
        vec![]
    };

    // Diff counts are candidates. Report only rows whose acknowledged slice
    // reached durable local state; failed or circuit-broken operations must
    // not be presented as successful Graph writes.
    let (inserts, updates) = acknowledged_upserts(store, &diff, &current, &state_table).await?;
    let deletes = planned_deletes - delete_errors.len() as i64;

    let _ = store
        .exec(&format!("DROP TABLE IF EXISTS {}", qi(&current)))
        .await;
    let _ = store
        .exec(&format!("DROP TABLE IF EXISTS {}", qi(&diff)))
        .await;

    let mut errors = upsert_errors;
    errors.extend(delete_errors);
    let elapsed = t0.elapsed().as_millis() as i64;
    let ops = inserts + updates + deletes;
    let planned = planned_inserts + planned_updates + planned_deletes;
    let delivery_note = if ops == planned {
        String::new()
    } else {
        format!(
            ", planned {planned_inserts} inserts, {planned_updates} updates, {planned_deletes} deletes"
        )
    };

    tracing::info!(
        "sync {sink_id}: {inserts} inserts, {updates} updates, {deletes} deletes, {unchanged} unchanged{delivery_note}{}{} in {}{}",
        if quarantined > 0 { format!(", {quarantined} quarantined") } else { String::new() },
        if errors.is_empty() { String::new() } else { format!(", {} FAILED", errors.len()) },
        progress::duration(elapsed),
        progress::rate_suffix(ops, elapsed),
    );

    Ok(SyncResult {
        inserts,
        updates,
        deletes,
        unchanged,
        quarantined,
        errors,
        aborted,
    })
}

/// Plans a complete entity-sink candidate in a candidate workspace. It never
/// receives a Graph client and performs no external delivery. The workspace
/// may be mutated because its snapshot is the candidate G; the journal-owned
/// applied state A remains a separate immutable artifact until work completes.
pub async fn plan_entity_sink(
    store: &Store,
    sink_id: &str,
    sink: &SinkConfig,
    input_table: Option<&str>,
    ctx: &EntityPlanningContext<'_>,
) -> Result<EntitySinkPlanV1, Report<SourceError>> {
    let PreparedEntityDiff {
        current,
        state_table,
        diff,
        planned_inserts,
        planned_updates,
        planned_deletes,
        unchanged,
    } = prepare_entity_diff(
        store,
        sink_id,
        sink,
        input_table,
        ctx.connector_id,
        ctx.partial,
        ctx.env,
    )
    .await?;
    let namespace = sink
        .id_namespace
        .clone()
        .unwrap_or_else(|| ctx.connector_id.to_owned());
    let mut graph = GraphPlanV1::default();
    let mut quarantined = Vec::new();
    let mut errors = Vec::new();
    let mut invalid_state_ids = Vec::new();

    if let Some(input_table) = input_table {
        let rows = store
            .query(&format!(
                "SELECT i.*, c._entity_id AS \"__state_entity_id\", d._diff_op AS \"__diff_op\" FROM {input_q} i JOIN {current_q} c ON CAST(i.{id_q} AS VARCHAR) = c._entity_id JOIN {diff_q} d ON d._entity_id = c._entity_id ORDER BY c._entity_id",
                input_q = qi(input_table),
                current_q = qi(&current),
                diff_q = qi(&diff),
                id_q = qi(&sink.entity_id),
            ))
            .await
            .change_context(SourceError)?;
        for row in rows.row_maps() {
            let state_id = row
                .get("__state_entity_id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            match row_to_graph_op(&row, sink, &namespace, ctx.provenance, ctx.unit_maps) {
                Ok((op, audits)) => {
                    for (property_url, audit) in audits {
                        quarantined.push(dlq::Entry {
                            source: ctx.source.map(str::to_owned),
                            kind: "sink".to_owned(),
                            sink_id: sink_id.to_owned(),
                            property_url: Some(property_url),
                            coercion: Some(audit.coercion),
                            entity_id: js_string(&op.entity_id),
                            entity_key: row.get("_key").map(js_string),
                            raw_value: Some(audit.raw),
                            reason: audit.reason,
                        });
                    }
                    let changed = ctx.effect_selection == EffectSelectionV1::ForceAll
                        || row.get("__diff_op").and_then(Value::as_str) != Some("unchanged");
                    graph.add(
                        plan_entity_upsert(&op).change_context(SourceError)?,
                        changed,
                    );
                }
                Err(message) => {
                    invalid_state_ids.push(state_id);
                    let entity_id = row.get(&sink.entity_id).map(js_string).unwrap_or_default();
                    quarantined.push(dlq::Entry {
                        source: ctx.source.map(str::to_owned),
                        kind: "sink".to_owned(),
                        sink_id: sink_id.to_owned(),
                        property_url: None,
                        coercion: None,
                        entity_id: entity_id.clone(),
                        entity_key: row.get("_key").map(js_string),
                        raw_value: Some(Value::Object(row.clone()).to_string()),
                        reason: message.clone(),
                    });
                    errors.push(SyncError {
                        kind: "row-build".to_owned(),
                        entity_id,
                        message,
                    });
                }
            }
        }
    }

    let deleted = store
        .query(&format!(
            "SELECT _entity_id FROM {} WHERE _diff_op = 'delete' ORDER BY _entity_id",
            qi(&diff)
        ))
        .await
        .change_context(SourceError)?;
    for row in deleted.rows {
        let entity_id = row.first().and_then(Value::as_str).unwrap_or("").to_owned();
        graph.add(
            plan_entity_archive(&super::ArchiveOp {
                namespace: namespace.clone(),
                entity_type: sink.entity_type.clone(),
                entity_id,
                provenance: ctx.provenance.clone(),
                web_id: sink.web_id.clone(),
            })
            .change_context(SourceError)?,
            true,
        );
    }

    if !invalid_state_ids.is_empty() {
        let ids = invalid_state_ids
            .iter()
            .map(|id| lit(id))
            .collect::<Vec<_>>()
            .join(",");
        store
            .exec(&format!(
                "DELETE FROM {} WHERE _entity_id IN ({ids})",
                qi(&current)
            ))
            .await
            .change_context(SourceError)?;
    }
    store
        .exec(&format!(
            "CREATE OR REPLACE TABLE {} AS SELECT * FROM {}",
            qi(&state_table),
            qi(&current)
        ))
        .await
        .change_context(SourceError)?;
    let _ = store
        .exec(&format!("DROP TABLE IF EXISTS {}", qi(&current)))
        .await;
    let _ = store
        .exec(&format!("DROP TABLE IF EXISTS {}", qi(&diff)))
        .await;

    Ok(EntitySinkPlanV1 {
        graph: graph.finish().change_context(SourceError)?,
        state_table,
        inserts: planned_inserts,
        updates: planned_updates,
        deletes: planned_deletes,
        unchanged,
        quarantined,
        errors,
    })
}

async fn acknowledged_upserts(
    store: &Store,
    diff: &str,
    current: &str,
    state_table: &str,
) -> Result<(i64, i64), Report<SourceError>> {
    let counts = store
        .query(&format!(
            "SELECT d._diff_op, COUNT(*)::BIGINT FROM {diff_q} d JOIN {current_q} c USING (_entity_id) JOIN {state_q} s USING (_entity_id) WHERE d._diff_op IN ('insert', 'update') AND c._content_hash IS NOT DISTINCT FROM s._content_hash GROUP BY d._diff_op",
            diff_q = qi(diff),
            current_q = qi(current),
            state_q = qi(state_table),
        ))
        .await
        .change_context(SourceError)?;
    let count = |operation: &str| {
        counts
            .rows
            .iter()
            .find(|row| row.first().and_then(Value::as_str) == Some(operation))
            .and_then(|row| row.get(1).and_then(Value::as_i64))
            .unwrap_or(0)
    };
    Ok((count("insert"), count("update")))
}

async fn build_current(
    store: &Store,
    sink_id: &str,
    sink: &SinkConfig,
    input_table: Option<&str>,
    current: &str,
) -> Result<bool, Report<SourceError>> {
    let Some(input_table) = input_table else {
        store
            .exec(&format!(
                "CREATE OR REPLACE TABLE {} (_entity_id VARCHAR, _content_hash VARCHAR)",
                qi(current)
            ))
            .await
            .change_context(SourceError)?;
        return Ok(false);
    };

    let column_types = column_types_of(store, input_table)
        .await
        .change_context(SourceError)?;
    report_coverage(store, sink_id, sink, input_table, &column_types).await?;

    let hash_expr = hash::canonical_hash_expr(sink, &column_types, |column| {
        tracing::warn!("content hash: column \"{column}\" not in pipeline output; hashed as NULL");
    });

    let select = match &hash_expr {
        None => hash::whole_row_hash_sql(&sink.entity_id, input_table),
        Some(expr) => format!(
            "SELECT {}::VARCHAR AS _entity_id, {expr} AS _content_hash FROM {}",
            qi(&sink.entity_id),
            qi(input_table)
        ),
    };

    store
        .exec(&format!(
            "CREATE OR REPLACE TABLE {} AS {select}",
            qi(current)
        ))
        .await
        .change_context(SourceError)?;

    assert_unique_entity_ids(store, current, sink_id, &sink.entity_id).await?;
    Ok(hash_expr.is_some())
}

async fn migrate_meta(
    store: &Store,
    sink_id: &str,
    sink: &SinkConfig,
    connector_id: &str,
    canonical: bool,
    has_previous: bool,
) -> Result<(), Report<crate::error::StoreError>> {
    let hash_version = if canonical { HASH_VERSION } else { 1 };
    let config_hash = hash::sink_config_hash(sink, connector_id);
    let meta = state_meta::read(store, "entity", connector_id, sink_id).await?;

    let stale = meta
        .as_ref()
        .map(|meta| {
            meta.hash_version != Some(hash_version)
                || meta.config_hash.as_deref() != Some(&config_hash)
        })
        .unwrap_or(true);

    if stale {
        if has_previous {
            tracing::info!(
                "sink \"{sink_id}\": content-hash algorithm or config changed (v{} -> v{hash_version}); rows with old-style hashes re-upsert once",
                meta.as_ref().and_then(|meta| meta.hash_version).map(|version| version.to_string()).unwrap_or_else(|| "?".to_owned()),
            );

            // The config hash is not part of each row's content hash. Invalidate
            // the previous hashes before diffing so every current row is
            // retried and only acknowledged slices restore canonical hashes.
            let state_table = format!("_state/sync/{connector_id}/{sink_id}");
            store
                .exec(&format!(
                    "UPDATE {} SET _content_hash = NULL",
                    qi(&state_table)
                ))
                .await?;
        }
        let existing = meta.unwrap_or_default();
        state_meta::write(
            store,
            "entity",
            connector_id,
            sink_id,
            &Meta {
                hash_version: Some(hash_version),
                config_hash: Some(config_hash),
                graph_identity: existing.graph_identity,
                web_id: existing.web_id,
                namespace: existing.namespace,
            },
        )
        .await?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn stream_upserts(
    store: &Store,
    sink_id: &str,
    sink: &SinkConfig,
    input_table: &str,
    diff: &str,
    current: &str,
    state_table: &str,
    namespace: &str,
    changed_total: i64,
    ctx: &SinkContext<'_>,
) -> Result<(Vec<SyncError>, bool, i64), Report<SourceError>> {
    let upsert_table = format!("_upsert/{sink_id}");

    store
        .exec(&format!(
            "CREATE OR REPLACE TABLE {upsert_q} AS SELECT i.*, d._entity_id AS \"__state_entity_id\", row_number() OVER (ORDER BY d._entity_id) - 1 AS \"__rn\" FROM {input_q} i JOIN {diff_q} d ON CAST(i.{id_q} AS VARCHAR) = d._entity_id WHERE d._diff_op IN ('insert', 'update')",
            upsert_q = qi(&upsert_table),
            input_q = qi(input_table),
            diff_q = qi(diff),
            id_q = qi(&sink.entity_id),
        ))
        .await
        .change_context(SourceError)?;

    // Per-slice state commit: acked ids replace their state rows, so a crash
    // resumes from committed work. A commit failure is recorded (not
    // swallowed): the graph write already landed, so we do not abort, but the
    // resume anchor did not advance and that must appear in the result so the
    // run is marked failed and the operator sees a non-converging sync.
    let commit_failed = Arc::new(AtomicBool::new(false));
    let commit_store = store.clone();
    let commit_state = state_table.to_owned();
    let commit_current = current.to_owned();
    let commit_flag = Arc::clone(&commit_failed);
    let commit_slice: BatchOk = Arc::new(move |ids: Vec<String>| {
        let store = commit_store.clone();
        let state_table = commit_state.clone();
        let current = commit_current.clone();
        let flag = Arc::clone(&commit_flag);
        Box::pin(async move {
            if ids.is_empty() {
                return;
            }
            let list = ids.iter().map(|id| lit(id)).collect::<Vec<_>>().join(",");
            let deleted = store
                .exec(&format!(
                    "DELETE FROM {} WHERE _entity_id IN ({list})",
                    qi(&state_table)
                ))
                .await;
            let inserted = store
                .exec(&format!(
                    "INSERT INTO {} SELECT * FROM {} WHERE _entity_id IN ({list})",
                    qi(&state_table),
                    qi(&current)
                ))
                .await;
            if let Err(err) = deleted.and(inserted) {
                tracing::error!("state commit failed for sink \"{state_table}\": {err:?}");
                flag.store(true, Ordering::Relaxed);
            }
        })
    });

    let (mut errors, aborted, quarantined) = upsert_staged(
        store,
        &upsert_table,
        sink,
        namespace,
        changed_total,
        ctx,
        UpsertLabels {
            sink_id,
            progress_label: &format!("sync {sink_id}"),
        },
        commit_slice,
    )
    .await?;

    if commit_failed.load(Ordering::Relaxed) {
        errors.push(SyncError {
            kind: "state-commit".to_owned(),
            entity_id: sink_id.to_owned(),
            message: "state commit failed after graph write; sync did not converge".to_owned(),
        });
    }
    let outcome = (errors, aborted, quarantined);

    let _ = store
        .exec(&format!("DROP TABLE IF EXISTS {}", qi(&upsert_table)))
        .await;

    Ok(outcome)
}

pub struct UpsertLabels<'a> {
    pub sink_id: &'a str,
    pub progress_label: &'a str,
}

/// Windowed op-build + quarantine + bulk upsert over a staged `__rn` table.
/// The batch diff path commits state per acked slice; the stream path (no
/// diff state, events are the deltas) passes a no-op commit.
#[allow(clippy::too_many_arguments)]
pub async fn upsert_staged(
    store: &Store,
    upsert_table: &str,
    sink: &SinkConfig,
    namespace: &str,
    changed_total: i64,
    ctx: &SinkContext<'_>,
    labels: UpsertLabels<'_>,
    commit_slice: BatchOk,
) -> Result<(Vec<SyncError>, bool, i64), Report<SourceError>> {
    let window = config::sync_window(ctx.env) as i64;
    let progress = Progress::start(labels.progress_label, Some(changed_total));

    let mut errors: Vec<SyncError> = vec![];
    let mut aborted = false;
    let mut quarantined = 0i64;
    let mut offset = 0i64;

    while offset < changed_total && !aborted {
        let result = store
            .query(&format!(
                "SELECT * EXCLUDE (\"__rn\") FROM {} WHERE \"__rn\" >= {offset} AND \"__rn\" < {}",
                qi(upsert_table),
                offset + window
            ))
            .await
            .change_context(SourceError)?;

        let row_maps = result.row_maps();
        let mut ops: Vec<EntityOp> = vec![];
        let mut audit_entries: Vec<dlq::Entry> = vec![];
        let mut state_ids = HashMap::new();

        for row in &row_maps {
            match row_to_graph_op(row, sink, namespace, ctx.provenance, ctx.unit_maps) {
                Ok((op, audits)) => {
                    if let Some(state_id) = row.get("__state_entity_id").and_then(Value::as_str) {
                        state_ids.insert(js_string(&op.entity_id), state_id.to_owned());
                    }
                    for (property_url, audit) in audits {
                        audit_entries.push(dlq::Entry {
                            source: ctx.source.map(str::to_owned),
                            kind: "sink".to_owned(),
                            sink_id: labels.sink_id.to_owned(),
                            property_url: Some(property_url),
                            coercion: Some(audit.coercion),
                            entity_id: js_string(&op.entity_id),
                            entity_key: row.get("_key").map(js_string),
                            raw_value: Some(audit.raw),
                            reason: audit.reason,
                        });
                    }
                    ops.push(op);
                }
                Err(message) => {
                    let id = row.get(&sink.entity_id).map(js_string).unwrap_or_default();
                    audit_entries.push(dlq::Entry {
                        source: ctx.source.map(str::to_owned),
                        kind: "sink".to_owned(),
                        sink_id: labels.sink_id.to_owned(),
                        property_url: None,
                        coercion: None,
                        entity_id: id.clone(),
                        entity_key: row.get("_key").map(js_string),
                        raw_value: Some(Value::Object(row.clone()).to_string()),
                        reason: message.clone(),
                    });
                    errors.push(SyncError {
                        kind: "row-build".to_owned(),
                        entity_id: id,
                        message,
                    });
                }
            }
        }

        // Quarantine before sending: state commits inside the client call, so
        // a crash after commit but before recording would freeze rows as
        // unchanged with a stale DLQ. Clear-then-record-then-send is
        // idempotent under any crash.
        let cleared: Vec<String> = ops.iter().map(|op| js_string(&op.entity_id)).collect();
        dlq::clear(store, ctx.connector_id, "sink", labels.sink_id, &cleared)
            .await
            .change_context(SourceError)?;
        dlq::record(store, ctx.connector_id, ctx.run_id, &audit_entries)
            .await
            .change_context(SourceError)?;

        // Graph acknowledgements use JavaScript ID rendering (`1.0` -> `1`),
        // while DuckDB's canonical state key may be `1.0`. Translate through
        // the diff row captured above so successful numeric IDs advance state.
        let acknowledged = commit_slice.clone();
        let state_ids = Arc::new(state_ids);
        let commit_state_ids: BatchOk = Arc::new(move |ids: Vec<String>| {
            let acknowledged = acknowledged.clone();
            let state_ids = Arc::clone(&state_ids);
            Box::pin(async move {
                let ids = ids
                    .into_iter()
                    .map(|id| state_ids.get(&id).cloned().unwrap_or(id))
                    .collect();
                acknowledged(ids).await;
            })
        });
        let result = ctx.client.bulk_upsert_entities(ops, commit_state_ids).await;

        let window_aborted = result.aborted || (!result.failed.is_empty() && result.ok.is_empty());
        for failure in result.failed {
            errors.push(SyncError {
                kind: "upsert".to_owned(),
                entity_id: failure.id,
                message: failure.message,
            });
        }

        progress.tick(row_maps.len() as i64);
        quarantined += audit_entries.len() as i64;
        aborted = window_aborted;
        offset += window;
    }

    Ok((errors, aborted, quarantined))
}

#[allow(clippy::too_many_arguments)]
async fn archive_deletes(
    store: &Store,
    sink_id: &str,
    sink: &SinkConfig,
    diff: &str,
    state_table: &str,
    namespace: &str,
    ctx: &SinkContext<'_>,
    total: i64,
) -> Result<Vec<SyncError>, Report<SourceError>> {
    let window = config::sync_window(ctx.env) as i64;
    let progress = Progress::start(format!("archive {sink_id}"), Some(total));
    let mut errors = vec![];
    let mut cursor = String::new();

    loop {
        let result = store
            .query(&format!(
                "SELECT _entity_id FROM {} WHERE _diff_op = 'delete' AND _entity_id > {} ORDER BY _entity_id LIMIT {window}",
                qi(diff),
                lit(&cursor)
            ))
            .await
            .change_context(SourceError)?;

        let ids: Vec<String> = result
            .rows
            .iter()
            .filter_map(|row| row.first().and_then(Value::as_str))
            .map(str::to_owned)
            .collect();
        if ids.is_empty() {
            break;
        }
        cursor = ids.last().expect("nonempty").clone();

        for entity_id in ids {
            let op = super::ArchiveOp {
                namespace: namespace.to_owned(),
                entity_type: sink.entity_type.clone(),
                entity_id: entity_id.clone(),
                provenance: ctx.provenance.clone(),
                web_id: sink.web_id.clone(),
            };

            match ctx.client.archive_entity(&op).await {
                Ok(()) => {
                    store
                        .exec(&format!(
                            "DELETE FROM {} WHERE _entity_id = {}",
                            qi(state_table),
                            lit(&entity_id)
                        ))
                        .await
                        .change_context(SourceError)?;
                    dlq::clear(
                        store,
                        ctx.connector_id,
                        "sink",
                        sink_id,
                        std::slice::from_ref(&entity_id),
                    )
                    .await
                    .change_context(SourceError)?;
                }
                Err(err) => errors.push(SyncError {
                    kind: "archive".to_owned(),
                    entity_id,
                    message: format!("{err:?}"),
                }),
            }
            progress.tick(1);
        }
    }

    Ok(errors)
}

async fn assert_unique_entity_ids(
    store: &Store,
    current: &str,
    sink_id: &str,
    entity_id_col: &str,
) -> Result<(), Report<SourceError>> {
    let result = store
        .query(&format!(
            "SELECT _entity_id, COUNT(*)::BIGINT AS n FROM {} GROUP BY _entity_id HAVING COUNT(*) > 1 LIMIT 5",
            qi(current)
        ))
        .await
        .change_context(SourceError)?;

    if result.rows.is_empty() {
        return Ok(());
    }

    let dupes = result
        .rows
        .iter()
        .map(|row| {
            format!(
                "{} ({} rows)",
                row.first().map(js_string).unwrap_or_default(),
                row.get(1).and_then(Value::as_i64).unwrap_or(0)
            )
        })
        .collect::<Vec<_>>()
        .join(", ");

    Err(Report::new(SourceError).attach_printable(format!(
        "sink \"{sink_id}\": duplicate entity ids in pipeline output: {dupes}. Deduplicate upstream, e.g. SELECT DISTINCT ON ({entity_id_col})."
    )))
}

async fn report_coverage(
    store: &Store,
    sink_id: &str,
    sink: &SinkConfig,
    input_table: &str,
    column_types: &HashMap<String, String>,
) -> Result<(), Report<SourceError>> {
    let mapped: Vec<&str> = sink
        .properties
        .iter()
        .filter_map(|(_, accessor)| match accessor {
            Accessor::Column(column) => Some(column.as_str()),
            _ => None,
        })
        .filter(|column| column_types.contains_key(*column))
        .collect();

    if mapped.is_empty() {
        return Ok(());
    }

    let aggregates = mapped
        .iter()
        .enumerate()
        .map(|(index, column)| {
            format!(
                "COUNT(NULLIF(TRIM({}::VARCHAR), '')) AS {}",
                qi(column),
                qi(&format!("c{index}"))
            )
        })
        .collect::<Vec<_>>()
        .join(", ");

    let result = store
        .query(&format!(
            "SELECT COUNT(*)::BIGINT AS _total, {aggregates} FROM {}",
            qi(input_table)
        ))
        .await
        .change_context(SourceError)?;

    let Some(row) = result.rows.first() else {
        return Ok(());
    };
    let total = row.first().and_then(Value::as_i64).unwrap_or(0);
    if total == 0 {
        return Ok(());
    }

    let empty: Vec<&str> = mapped
        .iter()
        .enumerate()
        .filter(|(index, _)| row.get(index + 1).and_then(Value::as_i64) == Some(0))
        .map(|(_, column)| *column)
        .collect();

    if !empty.is_empty() {
        tracing::warn!(
            "sink \"{sink_id}\": mapped column(s) with NO values in {total} rows: {} (property will never populate)",
            empty.join(", ")
        );
    }
    Ok(())
}

pub async fn column_types_of(
    store: &Store,
    table: &str,
) -> Result<HashMap<String, String>, Report<crate::error::StoreError>> {
    let result = store.query(&format!("DESCRIBE {}", qi(table))).await?;
    Ok(result
        .rows
        .iter()
        .filter_map(|row| {
            let name = row.first().and_then(Value::as_str)?;
            let sql_type = row.get(1).and_then(Value::as_str)?;
            Some((name.to_owned(), sql_type.to_owned()))
        })
        .collect())
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::build::ProvenanceFields;
    use crate::graph::client::{archive_params, entity_graph_id};
    use crate::graph::effects::GraphOperationV1;
    use crate::graph::planner::{GraphDeliveryPayload, GraphDeliveryRequestV1};
    use crate::graph::recording::RecordingClient;
    use crate::orchestrator::registry::DurableRecord;
    use crate::store::StoreOptions;

    async fn parity_store(sink: &SinkConfig) -> Store {
        let store = Store::open(StoreOptions::default()).expect("store");
        store
            .exec("CREATE TABLE input (id VARCHAR, name VARCHAR); INSERT INTO input VALUES ('A', 'old'), ('B', 'same'), ('C', 'removed')")
            .await
            .expect("initial input");
        build_current(&store, "items", sink, Some("input"), "seed-current")
            .await
            .expect("seed current");
        store
            .exec("CREATE TABLE \"_state/sync/connector/items\" AS SELECT * FROM \"seed-current\"")
            .await
            .expect("seed state");
        store
            .exec("DROP TABLE \"seed-current\"; DELETE FROM input; INSERT INTO input VALUES ('A', 'changed'), ('B', 'same'), ('D', 'new')")
            .await
            .expect("candidate input");
        state_meta::write(
            &store,
            "entity",
            "connector",
            "items",
            &Meta {
                hash_version: Some(HASH_VERSION),
                config_hash: Some(hash::sink_config_hash(sink, "connector")),
                ..Meta::default()
            },
        )
        .await
        .expect("seed metadata");
        store
    }

    #[tokio::test]
    async fn acknowledged_counts_exclude_uncommitted_candidates() {
        let store = Store::open(StoreOptions::default()).expect("store");
        store
            .exec("CREATE TABLE diff (_entity_id VARCHAR, _diff_op VARCHAR)")
            .await
            .unwrap();
        store
            .exec("INSERT INTO diff VALUES ('new-ok', 'insert'), ('new-failed', 'insert'), ('changed', 'update')")
            .await
            .unwrap();
        store
            .exec("CREATE TABLE current (_entity_id VARCHAR, _content_hash VARCHAR)")
            .await
            .unwrap();
        store
            .exec("INSERT INTO current VALUES ('new-ok', 'a'), ('new-failed', 'b'), ('changed', 'new')")
            .await
            .unwrap();
        store
            .exec("CREATE TABLE state (_entity_id VARCHAR, _content_hash VARCHAR)")
            .await
            .unwrap();
        store
            .exec("INSERT INTO state VALUES ('new-ok', 'a'), ('changed', 'old')")
            .await
            .unwrap();

        assert_eq!(
            acknowledged_upserts(&store, "diff", "current", "state")
                .await
                .unwrap(),
            (1, 0)
        );
        store
            .exec("UPDATE state SET _content_hash = 'new' WHERE _entity_id = 'changed'")
            .await
            .unwrap();
        assert_eq!(
            acknowledged_upserts(&store, "diff", "current", "state")
                .await
                .unwrap(),
            (1, 1)
        );
    }

    #[tokio::test]
    async fn stale_sink_config_invalidates_previous_row_hashes() {
        let store = Store::open(StoreOptions::default()).expect("store");
        store
            .exec("CREATE TABLE \"_state/sync/sap/materials\" (_entity_id VARCHAR, _content_hash VARCHAR)")
            .await
            .unwrap();
        store
            .exec("INSERT INTO \"_state/sync/sap/materials\" VALUES ('1', 'old-hash')")
            .await
            .unwrap();
        let sink = SinkConfig {
            entity_type: "type".to_owned(),
            entity_id: "id".to_owned(),
            web_id: "web".to_owned(),
            id_namespace: None,
            properties: vec![],
            property_fields: vec![],
            provenance: None,
            provenance_fields: ProvenanceFields::default(),
        };

        migrate_meta(&store, "materials", &sink, "sap", true, true)
            .await
            .unwrap();

        assert!(store
            .query("SELECT _content_hash FROM \"_state/sync/sap/materials\"")
            .await
            .unwrap()
            .single()
            .is_some_and(Value::is_null));
    }

    #[tokio::test]
    async fn numeric_graph_ids_advance_the_duckdb_resume_anchor() {
        let store = Store::open(StoreOptions::default()).expect("store");
        store
            .exec("CREATE TABLE input (id DOUBLE, name VARCHAR); INSERT INTO input VALUES (1.0, 'one')")
            .await
            .unwrap();
        let sink = SinkConfig {
            entity_type: "type".to_owned(),
            entity_id: "id".to_owned(),
            web_id: "web".to_owned(),
            id_namespace: None,
            properties: vec![("name".to_owned(), Accessor::Column("name".to_owned()))],
            property_fields: vec![],
            provenance: None,
            provenance_fields: ProvenanceFields::default(),
        };
        let client = Arc::new(RecordingClient::new());
        let client_trait: SharedClient = client.clone();
        let provenance = Provenance::default();
        let unit_maps = Map::new();
        let env = Env::default();
        let context = SinkContext {
            connector_id: "numeric",
            client: &client_trait,
            provenance: &provenance,
            unit_maps: &unit_maps,
            run_id: "run-1",
            source: Some("numbers"),
            partial: false,
            env: &env,
        };

        let first = diff_and_sync(&store, "numbers", &sink, Some("input"), &context)
            .await
            .unwrap();
        assert_eq!(first.inserts, 1);
        assert_eq!(
            store
                .query("SELECT COUNT(*)::BIGINT FROM \"_state/sync/numeric/numbers\" WHERE _entity_id = '1.0' AND _content_hash IS NOT NULL")
                .await
                .unwrap()
                .single_i64(),
            1,
            "the Graph acknowledgement '1' must commit DuckDB state key '1.0'"
        );

        let second = diff_and_sync(&store, "numbers", &sink, Some("input"), &context)
            .await
            .unwrap();
        assert_eq!(second.unchanged, 1);
        assert_eq!(
            client.upserts().len(),
            1,
            "rerun must not resend numeric ID"
        );
    }

    #[tokio::test]
    async fn extracted_plan_matches_reference_effects_and_resulting_state_bytes() {
        let sink = SinkConfig {
            entity_type: "https://example.com/types/entity-type/item/v/1".to_owned(),
            entity_id: "id".to_owned(),
            web_id: "00000000-0000-4000-8000-000000000001".to_owned(),
            id_namespace: Some("connector".to_owned()),
            properties: vec![(
                "https://example.com/types/property-type/name/v/1".to_owned(),
                Accessor::Column("name".to_owned()),
            )],
            property_fields: vec![],
            provenance: None,
            provenance_fields: ProvenanceFields::default(),
        };
        let reference_store = parity_store(&sink).await;
        let planned_store = parity_store(&sink).await;
        let provenance = Provenance {
            loaded_at: "2026-07-22T10:00:00Z".to_owned(),
            location_name: "fixture".to_owned(),
            ..Provenance::default()
        };
        let unit_maps = Map::new();
        let env = Env::default();
        let recording = Arc::new(RecordingClient::new());
        let client: SharedClient = recording.clone();
        let reference = diff_and_sync(
            &reference_store,
            "items",
            &sink,
            Some("input"),
            &SinkContext {
                connector_id: "connector",
                client: &client,
                provenance: &provenance,
                unit_maps: &unit_maps,
                run_id: "reference",
                source: Some("source"),
                partial: false,
                env: &env,
            },
        )
        .await
        .expect("reference sync");
        let planned = plan_entity_sink(
            &planned_store,
            "items",
            &sink,
            Some("input"),
            &EntityPlanningContext {
                connector_id: "connector",
                provenance: &provenance,
                unit_maps: &unit_maps,
                source: Some("source"),
                partial: false,
                effect_selection: EffectSelectionV1::ChangesOnly,
                env: &env,
            },
        )
        .await
        .expect("plan");
        assert_eq!(
            (
                reference.inserts,
                reference.updates,
                reference.deletes,
                reference.unchanged
            ),
            (1, 1, 1, 1)
        );
        assert_eq!(
            (
                planned.inserts,
                planned.updates,
                planned.deletes,
                planned.unchanged
            ),
            (1, 1, 1, 1)
        );

        let planned_effects = planned
            .graph
            .effects
            .iter()
            .map(|effect| (effect.operation, effect.graph_identity.clone()))
            .collect::<Vec<_>>();
        let mut reference_effects = Vec::new();
        for op in recording.upserts() {
            reference_effects.push((GraphOperationV1::UpsertEntity, entity_graph_id(&op)));
            let expected = plan_entity_upsert(&op).expect("reference upsert payload");
            let actual = planned
                .graph
                .desired
                .iter()
                .find(|object| object.graph_identity == expected.desired.graph_identity)
                .expect("planned live object");
            assert_eq!(
                actual.disposition.payload(),
                expected.desired.disposition.payload()
            );
        }
        for op in recording.archives() {
            let graph_identity = archive_params(&op)["entityId"]
                .as_str()
                .expect("archive identity")
                .to_owned();
            reference_effects.push((GraphOperationV1::ArchiveEntity, graph_identity.clone()));
            let desired = planned
                .graph
                .desired
                .iter()
                .find(|object| object.graph_identity == graph_identity)
                .expect("planned archive object");
            let payload = GraphDeliveryPayload::decode(desired.disposition.payload())
                .expect("archive delivery")
                .into_current()
                .expect("current archive delivery");
            let GraphDeliveryRequestV1::Archive { archive } = payload.request else {
                panic!("archive delivery kind")
            };
            assert_eq!(archive, archive_params(&op));
        }
        reference_effects.sort_by(|left, right| {
            (left.0.order(), left.1.as_str()).cmp(&(right.0.order(), right.1.as_str()))
        });
        assert_eq!(planned_effects, reference_effects);

        let reference_state = reference_store
            .query("SELECT * FROM \"_state/sync/connector/items\" ORDER BY _entity_id")
            .await
            .expect("reference state");
        let planned_state = planned_store
            .query("SELECT * FROM \"_state/sync/connector/items\" ORDER BY _entity_id")
            .await
            .expect("planned state");
        assert_eq!(
            serde_json::to_vec(&reference_state.rows).expect("reference state bytes"),
            serde_json::to_vec(&planned_state.rows).expect("planned state bytes")
        );

        let forced = plan_entity_sink(
            &planned_store,
            "items",
            &sink,
            Some("input"),
            &EntityPlanningContext {
                connector_id: "connector",
                provenance: &provenance,
                unit_maps: &unit_maps,
                source: Some("source"),
                partial: false,
                effect_selection: EffectSelectionV1::ForceAll,
                env: &env,
            },
        )
        .await
        .expect("force plan");
        assert_eq!(forced.unchanged, 3);
        assert_eq!(forced.graph.effects.len(), 3);
        assert!(forced
            .graph
            .effects
            .iter()
            .all(|effect| effect.operation == GraphOperationV1::UpsertEntity));
    }

    #[tokio::test]
    async fn sibling_engine_golden_state_is_adopted_without_reupserts_or_byte_drift() {
        let fixture: Value =
            serde_json::from_slice(include_bytes!("../../tests/golden/fallback-hash.json"))
                .expect("fallback fixture");
        let store = Store::open(StoreOptions::default()).expect("store");
        store
            .exec(fixture["ddl"].as_str().expect("fixture DDL"))
            .await
            .expect("fixture table");
        for insert in fixture["inserts"].as_array().expect("fixture inserts") {
            store
                .exec(insert.as_str().expect("insert SQL"))
                .await
                .expect("fixture insert");
        }
        let sink = SinkConfig {
            entity_type: "https://x/@t/types/entity-type/material/v/1".to_owned(),
            entity_id: "MATNR".to_owned(),
            web_id: "00000000-0000-4000-8000-000000000001".to_owned(),
            id_namespace: Some("connector".to_owned()),
            properties: vec![
                (
                    "https://x/@t/types/property-type/name/v/1".to_owned(),
                    Accessor::Column("MAKTX".to_owned()),
                ),
                (
                    "https://x/@t/types/property-type/weight/v/1".to_owned(),
                    Accessor::Column("BRGEW".to_owned()),
                ),
                (
                    "https://x/@t/types/property-type/created/v/1".to_owned(),
                    Accessor::Column("ERSDA".to_owned()),
                ),
            ],
            property_fields: vec![],
            provenance: None,
            provenance_fields: ProvenanceFields::default(),
        };
        let state_table = "_state/sync/connector/materials";
        store
            .exec(&format!(
                "CREATE TABLE {} (_entity_id VARCHAR, _content_hash VARCHAR)",
                qi(state_table)
            ))
            .await
            .expect("adopted state table");
        for row in fixture["canonicalRows"].as_array().expect("canonical rows") {
            store
                .exec(&format!(
                    "INSERT INTO {} VALUES ({}, {})",
                    qi(state_table),
                    lit(row["_entity_id"].as_str().expect("entity id")),
                    lit(row["_content_hash"].as_str().expect("content hash"))
                ))
                .await
                .expect("adopted state row");
        }
        state_meta::write(
            &store,
            "entity",
            "connector",
            "materials",
            &Meta {
                hash_version: Some(HASH_VERSION),
                config_hash: Some(hash::sink_config_hash(&sink, "connector")),
                ..Meta::default()
            },
        )
        .await
        .expect("adopted metadata");
        let before = store
            .query(&format!(
                "SELECT * FROM {} ORDER BY _entity_id",
                qi(state_table)
            ))
            .await
            .expect("state before");
        let provenance = Provenance {
            loaded_at: "2026-07-22T10:00:00Z".to_owned(),
            location_name: "fixture".to_owned(),
            ..Provenance::default()
        };
        let unit_maps = Map::new();
        let env = Env::default();
        let plan = plan_entity_sink(
            &store,
            "materials",
            &sink,
            Some("fallback_fixture"),
            &EntityPlanningContext {
                connector_id: "connector",
                provenance: &provenance,
                unit_maps: &unit_maps,
                source: Some("fixture"),
                partial: false,
                effect_selection: EffectSelectionV1::InitializeFromExistingState,
                env: &env,
            },
        )
        .await
        .expect("adopt state");
        assert!(plan.graph.effects.is_empty(), "adoption must not re-upsert");
        let finalized = crate::graph::planner::finalize_projection_plan(
            &[],
            plan.graph.clone(),
            EffectSelectionV1::InitializeFromExistingState,
            crate::graph::planner::ProjectionCoverageV1::Complete,
        )
        .expect("finalize adopted state");
        assert!(
            finalized.effects.is_empty(),
            "adoption must remain effect-free at the integration boundary"
        );
        assert_eq!(plan.unchanged, before.rows.len() as i64);
        let after = store
            .query(&format!(
                "SELECT * FROM {} ORDER BY _entity_id",
                qi(state_table)
            ))
            .await
            .expect("state after");
        assert_eq!(
            serde_json::to_vec(&before.rows).expect("before bytes"),
            serde_json::to_vec(&after.rows).expect("after bytes")
        );
    }
}
