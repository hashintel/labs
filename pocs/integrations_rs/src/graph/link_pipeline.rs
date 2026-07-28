//! Link diffing and two-phase staging. Current links (from checkpoint
//! inputs, optionally shaped by sql steps) diff against
//! `_state/links/{connector}/{id}`; upserts and stale-link archives stage
//! into `_state/pending-links/{connector}` and a `links-next` table; `flush`
//! sends pending ops and `commit_link_state` finalizes only what actually
//! flushed, so a crash mid-flush retries the remainder next sync. Pending
//! payloads are JSON with the TS field names (camelCase, `$typedValue` tag),
//! so state written by any engine flushes under any other.

use error_stack::{Report, ResultExt as _};
use serde_json::{json, Map, Value};

use crate::build::LinkEntry;
use crate::config::{self, Env};
use crate::dlq;
use crate::durable_artifacts::ArtifactRepository;
use crate::error::SourceError;
use crate::progress::{self, Progress};
use crate::run_manifest::RunManifestRepository;
use crate::steps;
use crate::store::{lit, qi, Store};

use super::coherence::tables_with_prefix;
use super::hash;
use super::planner::{
    plan_link_archive, plan_link_upsert, row_to_link_op, EffectSelectionV1, GraphPlanV1,
};
use super::sink::{column_types_of, SyncError, SyncResult};
use super::state_meta::{self, Meta, HASH_VERSION};
use super::{BatchOk, LinkOp, Provenance, SharedClient};

pub struct LinkContext<'a> {
    pub connector_id: &'a str,
    pub artifacts: &'a ArtifactRepository,
    pub provenance: &'a Provenance,
    pub unit_maps: &'a Map<String, Value>,
    pub run_id: &'a str,
    pub env: &'a Env,
    pub run_manifest: Option<&'a RunManifestRepository>,
}

pub struct LinkPlanningContext<'a> {
    pub connector_id: &'a str,
    pub provenance: &'a Provenance,
    pub unit_maps: &'a Map<String, Value>,
    pub effect_selection: EffectSelectionV1,
}

#[derive(Debug, Clone)]
pub struct LinkPipelinePlanV1 {
    pub graph: GraphPlanV1,
    pub state_table: String,
    pub upserts: i64,
    pub archives: i64,
    pub unchanged: i64,
    pub quarantined: Vec<dlq::Entry>,
}

struct PreparedLinkDiff {
    current: String,
    diff: String,
    state_table: String,
    changed: i64,
    unchanged: i64,
}

async fn prepare_link_diff(
    store: &Store,
    entry: &LinkEntry,
    data_table: &str,
    connector_id: &str,
    namespace: &str,
) -> Result<PreparedLinkDiff, Report<SourceError>> {
    let current = format!("_link_current/{}", entry.id);
    let diff = format!("_link_diff/{}", entry.id);
    let state_table = format!("_state/links/{connector_id}/{}", entry.id);
    let mut prop_columns = entry.property_columns.clone();
    prop_columns.sort();
    prop_columns.dedup();
    let column_types = column_types_of(store, data_table)
        .await
        .change_context(SourceError)?;
    let hash_expr = hash::struct_hash_expr(&prop_columns, &column_types, |column| {
        tracing::warn!(
            "link pipeline \"{}\": property column \"{column}\" not in output; hashed as NULL",
            entry.id
        );
    });
    let prop_select: String = prop_columns
        .iter()
        .map(|column| format!(", {}", qi(column)))
        .collect();
    store
        .exec(&format!(
            "CREATE OR REPLACE TABLE {current_q} AS SELECT *, {hash_expr} AS _content_hash FROM (SELECT CAST({from_q} AS VARCHAR) AS _source_id, CAST({to_q} AS VARCHAR) AS _target_id{prop_select} FROM {data_q} WHERE {from_q} IS NOT NULL AND {to_q} IS NOT NULL)",
            current_q = qi(&current),
            from_q = qi(&entry.from.column),
            to_q = qi(&entry.to.column),
            data_q = qi(data_table),
        ))
        .await
        .change_context(SourceError)?;
    assert_unique_pairs(store, &current, &entry.id).await?;
    let has_previous = match store
        .schema_of(&state_table)
        .await
        .change_context(SourceError)?
    {
        Some(_) => true,
        None => {
            store
                .exec(&format!(
                    "CREATE TABLE {} (_source_id VARCHAR, _target_id VARCHAR, _content_hash VARCHAR)",
                    qi(&state_table)
                ))
                .await
                .change_context(SourceError)?;
            false
        }
    };
    migrate_meta(store, entry, connector_id, namespace, has_previous)
        .await
        .change_context(SourceError)?;
    store
        .exec(&format!(
            "CREATE OR REPLACE TABLE {diff_q} AS SELECT COALESCE(c._source_id, p._source_id) AS _source_id, COALESCE(c._target_id, p._target_id) AS _target_id, CASE WHEN p._source_id IS NULL THEN 'insert' WHEN c._source_id IS NULL THEN 'delete' WHEN c._content_hash = p._content_hash THEN 'unchanged' ELSE 'update' END AS _diff_op FROM {current_q} c FULL OUTER JOIN {state_q} p ON c._source_id = p._source_id AND c._target_id = p._target_id",
            diff_q = qi(&diff),
            current_q = qi(&current),
            state_q = qi(&state_table),
        ))
        .await
        .change_context(SourceError)?;
    let counts = store
        .query(&format!(
            "SELECT _diff_op, COUNT(*)::BIGINT FROM {} GROUP BY _diff_op",
            qi(&diff)
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
    Ok(PreparedLinkDiff {
        current,
        diff,
        state_table,
        changed: count("insert") + count("update"),
        unchanged: count("unchanged"),
    })
}

pub async fn process(
    store: &Store,
    entry: &LinkEntry,
    ctx: &LinkContext<'_>,
) -> Result<SyncResult, Report<SourceError>> {
    let t0 = std::time::Instant::now();
    let connector_id = ctx.connector_id;
    let namespace = entry
        .id_namespace
        .clone()
        .unwrap_or_else(|| connector_id.to_owned());
    let next_state = format!("_state/links-next/{connector_id}/{}", entry.id);

    let data_table = load_inputs(store, entry, ctx.artifacts, ctx.run_manifest).await?;
    let PreparedLinkDiff {
        current,
        diff,
        state_table: _,
        changed: _,
        unchanged,
    } = prepare_link_diff(store, entry, &data_table, connector_id, &namespace).await?;

    let (upserts, archives, quarantined) =
        stage_ops(store, entry, &namespace, &current, &diff, ctx).await?;

    stage_next_state(store, entry, &namespace, &current, &diff, &next_state).await?;

    for table in [&current, &diff] {
        let _ = store
            .exec(&format!("DROP TABLE IF EXISTS {}", qi(table)))
            .await;
    }

    tracing::info!(
        "link pipeline \"{}\": {upserts} upserts, {archives} archives, {unchanged} unchanged staged in {}",
        entry.id,
        progress::duration(t0.elapsed().as_millis() as i64)
    );

    // Delivery counts surface at flush; unchanged and quarantine are
    // process-time facts and must still reach the durable run result.
    Ok(SyncResult {
        unchanged,
        quarantined,
        ..SyncResult::default()
    })
}

/// Plans one complete link pipeline from an already materialized data table.
/// The candidate workspace is advanced to G, but no pending ledger or Graph
/// client is involved. The caller publishes the resulting desired projection
/// and effects before proposing `WorkPlanned`.
pub async fn plan_link_table(
    store: &Store,
    entry: &LinkEntry,
    data_table: &str,
    ctx: &LinkPlanningContext<'_>,
) -> Result<LinkPipelinePlanV1, Report<SourceError>> {
    let namespace = entry
        .id_namespace
        .clone()
        .unwrap_or_else(|| ctx.connector_id.to_owned());
    let PreparedLinkDiff {
        current,
        diff,
        state_table,
        changed,
        unchanged,
    } = prepare_link_diff(store, entry, data_table, ctx.connector_id, &namespace).await?;
    let rows = store
        .query(&format!(
            "SELECT c.*, d._diff_op AS \"__diff_op\" FROM {current_q} c JOIN {diff_q} d ON c._source_id = d._source_id AND c._target_id = d._target_id ORDER BY c._source_id, c._target_id",
            current_q = qi(&current),
            diff_q = qi(&diff),
        ))
        .await
        .change_context(SourceError)?;
    let mut graph = GraphPlanV1::default();
    let mut quarantined = Vec::new();
    for row in rows.row_maps() {
        let (op, audits) = row_to_link_op(&row, entry, &namespace, ctx.provenance, ctx.unit_maps);
        let pair_id = format!("{}::{}", op.source_entity_id, op.target_id);
        for (property_url, audit) in audits {
            quarantined.push(dlq::Entry {
                source: None,
                kind: "link".to_owned(),
                sink_id: entry.id.clone(),
                property_url: Some(property_url),
                coercion: Some(audit.coercion),
                entity_id: pair_id.clone(),
                entity_key: Some(pair_id.clone()),
                raw_value: Some(audit.raw),
                reason: audit.reason,
            });
        }
        let changed = ctx.effect_selection == EffectSelectionV1::ForceAll
            || row.get("__diff_op").and_then(Value::as_str) != Some("unchanged");
        graph.add(plan_link_upsert(&op).change_context(SourceError)?, changed);
    }

    let deleted = store
        .query(&format!(
            "SELECT _source_id, _target_id FROM {} WHERE _diff_op = 'delete' ORDER BY _source_id, _target_id",
            qi(&diff)
        ))
        .await
        .change_context(SourceError)?;
    let archives = deleted.rows.len() as i64;
    for row in deleted.rows {
        let source_id = row.first().and_then(Value::as_str).unwrap_or("");
        let target_id = row.get(1).and_then(Value::as_str).unwrap_or("");
        let entity_id = format!(
            "{}::{source_id}::{}::{target_id}",
            entry.from.entity_type, entry.to.entity_type
        );
        graph.add(
            plan_link_archive(&super::ArchiveOp {
                namespace: namespace.clone(),
                entity_type: entry.link_type.clone(),
                entity_id,
                provenance: ctx.provenance.clone(),
                web_id: entry.web_id.clone(),
            })
            .change_context(SourceError)?,
            true,
        );
    }
    store
        .exec(&format!(
            "CREATE OR REPLACE TABLE {state_q} AS SELECT _source_id, _target_id, _content_hash FROM {current_q}",
            state_q = qi(&state_table),
            current_q = qi(&current),
        ))
        .await
        .change_context(SourceError)?;
    for table in [&current, &diff] {
        let _ = store
            .exec(&format!("DROP TABLE IF EXISTS {}", qi(table)))
            .await;
    }
    Ok(LinkPipelinePlanV1 {
        graph: graph.finish().change_context(SourceError)?,
        state_table,
        upserts: changed,
        archives,
        unchanged,
        quarantined,
    })
}

async fn load_inputs(
    store: &Store,
    entry: &LinkEntry,
    artifacts: &ArtifactRepository,
    run_manifest: Option<&RunManifestRepository>,
) -> Result<String, Report<SourceError>> {
    let inputs: Vec<(String, String)> = if !entry.source.is_empty() {
        vec![("input".to_owned(), entry.source.clone())]
    } else if !entry.inputs.is_empty() {
        entry.inputs.clone()
    } else {
        return Err(Report::new(SourceError).attach_printable(format!(
            "link pipeline \"{}\" requires source or inputs",
            entry.id
        )));
    };

    let mut named = vec![];
    for (alias, checkpoint) in &inputs {
        let table = format!("_link_src/{}/{alias}", entry.id);
        let Some(path) =
            crate::engine::batch_sync::load_run_checkpoint(artifacts, run_manifest, checkpoint)
                .await?
        else {
            return Err(Report::new(SourceError)
                .attach_printable(format!("durable checkpoint {checkpoint} not found")));
        };
        let uri = path.display().to_string();
        store
            .exec(&format!(
                "CREATE OR REPLACE TABLE {} AS SELECT * FROM read_parquet({})",
                qi(&table),
                lit(&uri)
            ))
            .await
            .change_context(SourceError)?;
        named.push(steps::NamedInput {
            alias: alias.clone(),
            table,
        });
    }

    if entry.steps.is_empty() {
        return if named.len() == 1 {
            Ok(named.remove(0).table)
        } else {
            Err(Report::new(SourceError).attach_printable(format!(
                "link pipeline \"{}\" with multiple inputs requires at least one sql step",
                entry.id
            )))
        };
    }

    let mut previous: Option<String> = None;
    for step in &entry.steps {
        let crate::build::StepKind::Sql { sql } = &step.kind else {
            continue;
        };
        let out = format!("_link_step/{}", step.id);
        steps::execute_sql_step(store, sql, previous.as_deref(), &out, &named).await?;
        previous = Some(out);
    }
    Ok(previous.expect("nonempty steps"))
}

async fn assert_unique_pairs(
    store: &Store,
    current: &str,
    id: &str,
) -> Result<(), Report<SourceError>> {
    let result = store
        .query(&format!(
            "SELECT _source_id, _target_id, COUNT(*)::BIGINT AS n FROM {} GROUP BY _source_id, _target_id HAVING COUNT(*) > 1 LIMIT 5",
            qi(current)
        ))
        .await
        .change_context(SourceError)?;

    if result.rows.is_empty() {
        return Ok(());
    }
    let bad = result
        .rows
        .iter()
        .map(|row| {
            format!(
                "{}::{} ({} rows)",
                row.first().and_then(Value::as_str).unwrap_or(""),
                row.get(1).and_then(Value::as_str).unwrap_or(""),
                row.get(2).and_then(Value::as_i64).unwrap_or(0)
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    Err(Report::new(SourceError).attach_printable(format!(
        "link pipeline \"{id}\" produced duplicate source-target pairs: {bad}"
    )))
}

async fn migrate_meta(
    store: &Store,
    entry: &LinkEntry,
    connector_id: &str,
    namespace: &str,
    has_previous: bool,
) -> Result<(), Report<crate::error::StoreError>> {
    let config_hash = hash::link_config_hash(entry, namespace);
    let meta = state_meta::read(store, "link", connector_id, &entry.id).await?;

    let stale = meta
        .as_ref()
        .map(|meta| {
            meta.hash_version != Some(HASH_VERSION)
                || meta.config_hash.as_deref() != Some(&config_hash)
        })
        .unwrap_or(true);

    if stale {
        if has_previous {
            tracing::info!(
                "link pipeline \"{}\": content-hash algorithm or config changed; pairs re-upsert once",
                entry.id
            );

            // Pending payloads encode the old link type, endpoints and
            // properties. Keeping them after a config change can replay an
            // invalid operation forever alongside the rebuilt operation for
            // the same logical pair. Invalidate only this sink's ledger; the
            // current state below deterministically stages its replacement.
            let pending = format!("_state/pending-links/{connector_id}");
            store
                .exec(&format!(
                    "CREATE TABLE IF NOT EXISTS {} (op_id VARCHAR, sink_id VARCHAR, operation VARCHAR, payload VARCHAR)",
                    qi(&pending)
                ))
                .await?;
            store
                .exec(&format!(
                    "DELETE FROM {} WHERE sink_id = {}",
                    qi(&pending),
                    lit(&entry.id)
                ))
                .await?;

            // Pair content hashes do not themselves contain the config hash.
            // Invalidate the previous hashes before the diff so unchanged
            // pairs really are re-upserted once under the new operation shape.
            let state_table = format!("_state/links/{connector_id}/{}", entry.id);
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
            "link",
            connector_id,
            &entry.id,
            &Meta {
                hash_version: Some(HASH_VERSION),
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

async fn stage_ops(
    store: &Store,
    entry: &LinkEntry,
    namespace: &str,
    current: &str,
    diff: &str,
    ctx: &LinkContext<'_>,
) -> Result<(i64, i64, i64), Report<SourceError>> {
    let window = config::sync_window(ctx.env) as i64;
    let pending = ensure_pending_table(store, ctx.connector_id).await?;

    let changed = store
        .query(&format!(
            "SELECT COUNT(*)::BIGINT FROM {} WHERE _diff_op IN ('insert', 'update')",
            qi(diff)
        ))
        .await
        .change_context(SourceError)?
        .single_i64();

    let mut quarantined = 0i64;

    if changed > 0 {
        let upsert_table = format!("_link_upsert/{}", entry.id);
        let progress = Progress::start(format!("stage \"{}\"", entry.id), Some(changed));

        store
            .exec(&format!(
                "CREATE OR REPLACE TABLE {upsert_q} AS SELECT c.*, row_number() OVER (ORDER BY c._source_id, c._target_id) - 1 AS \"__rn\" FROM {current_q} c JOIN {diff_q} d ON c._source_id = d._source_id AND c._target_id = d._target_id WHERE d._diff_op IN ('insert', 'update')",
                upsert_q = qi(&upsert_table),
                current_q = qi(current),
                diff_q = qi(diff),
            ))
            .await
            .change_context(SourceError)?;

        let mut offset = 0i64;
        while offset < changed {
            let result = store
                .query(&format!(
                    "SELECT * EXCLUDE (\"__rn\") FROM {} WHERE \"__rn\" >= {offset} AND \"__rn\" < {}",
                    qi(&upsert_table),
                    offset + window
                ))
                .await
                .change_context(SourceError)?;

            let mut ops = vec![];
            let mut audit_entries = vec![];

            for row in result.row_maps() {
                let (op, audits) =
                    row_to_link_op(&row, entry, namespace, ctx.provenance, ctx.unit_maps);
                let pair_id = format!("{}::{}", op.source_entity_id, op.target_id);
                for (url, audit) in audits {
                    audit_entries.push(dlq::Entry {
                        source: None,
                        kind: "link".to_owned(),
                        sink_id: entry.id.clone(),
                        property_url: Some(url),
                        coercion: Some(audit.coercion),
                        entity_id: pair_id.clone(),
                        entity_key: Some(pair_id.clone()),
                        raw_value: Some(audit.raw),
                        reason: audit.reason,
                    });
                }
                ops.push(op);
            }

            // Quarantine before staging: same crash-ordering rationale as
            // the sink.
            let pair_ids: Vec<String> = ops
                .iter()
                .map(|op| format!("{}::{}", op.source_entity_id, op.target_id))
                .collect();
            dlq::clear(store, ctx.connector_id, "link", &entry.id, &pair_ids)
                .await
                .change_context(SourceError)?;
            dlq::record(store, ctx.connector_id, ctx.run_id, &audit_entries)
                .await
                .change_context(SourceError)?;

            let count = ops.len() as i64;
            let rows: Vec<(String, String, String)> = ops
                .iter()
                .map(|op| (op.op_id.clone(), "upsert".to_owned(), encode_link_op(op)))
                .collect();
            insert_pending(store, &pending, &entry.id, &rows).await?;

            progress.tick(count);
            quarantined += audit_entries.len() as i64;
            offset += window;
        }

        let _ = store
            .exec(&format!("DROP TABLE IF EXISTS {}", qi(&upsert_table)))
            .await;
    }

    let delete_rows = store
        .query(&format!(
            "SELECT _source_id, _target_id FROM {} WHERE _diff_op = 'delete' ORDER BY _source_id, _target_id",
            qi(diff)
        ))
        .await
        .change_context(SourceError)?;

    let mut archive_ops = vec![];
    let mut removed_pairs = vec![];
    for row in &delete_rows.rows {
        let source_id = row.first().and_then(Value::as_str).unwrap_or("");
        let target_id = row.get(1).and_then(Value::as_str).unwrap_or("");
        removed_pairs.push(format!("{source_id}::{target_id}"));

        let entity_id = format!(
            "{}::{source_id}::{}::{target_id}",
            entry.from.entity_type, entry.to.entity_type
        );
        let op_id = format!(
            "archive::{namespace}::{}::{}::{entity_id}",
            entry.web_id, entry.link_type
        );
        let payload = json!({
            "kind": "archive",
            "namespace": namespace,
            "entityType": entry.link_type,
            "entityId": entity_id,
            "provenance": ctx.provenance.source_json(),
            "webId": entry.web_id,
        });
        archive_ops.push((op_id, "archive".to_owned(), payload.to_string()));
    }

    // Removed pairs also leave the quarantine.
    dlq::clear(store, ctx.connector_id, "link", &entry.id, &removed_pairs)
        .await
        .change_context(SourceError)?;
    insert_pending(store, &pending, &entry.id, &archive_ops).await?;

    Ok((changed, archive_ops.len() as i64, quarantined))
}

async fn stage_next_state(
    store: &Store,
    entry: &LinkEntry,
    namespace: &str,
    current: &str,
    diff: &str,
    next_state: &str,
) -> Result<(), Report<SourceError>> {
    store
        .exec(&format!(
            "CREATE OR REPLACE TABLE {next_q} AS SELECT c._source_id, c._target_id, c._content_hash, d._diff_op AS _op_kind, CONCAT_WS('::', 'upsert', {ns}, {web}, {link}, c._source_id, c._target_id) AS _op_id FROM {current_q} c JOIN {diff_q} d ON c._source_id = d._source_id AND c._target_id = d._target_id WHERE d._diff_op != 'delete'",
            next_q = qi(next_state),
            ns = lit(namespace),
            web = lit(&entry.web_id),
            link = lit(&entry.link_type),
            current_q = qi(current),
            diff_q = qi(diff),
        ))
        .await
        .change_context(SourceError)
}

pub async fn flush(
    store: &Store,
    connector_id: &str,
    client: &SharedClient,
    label: Option<&str>,
) -> Result<SyncResult, Report<SourceError>> {
    let pending = ensure_pending_table(store, connector_id).await?;
    let filter = label
        .map(|label| format!(" WHERE sink_id = {}", lit(label)))
        .unwrap_or_default();

    let rows = store
        .query(&format!(
            "SELECT op_id, sink_id, operation, payload FROM {}{filter} ORDER BY operation, op_id",
            qi(&pending)
        ))
        .await
        .change_context(SourceError)?;

    let flush_label = label
        .map(|label| format!("flush \"{label}\""))
        .unwrap_or_else(|| "flush links".to_owned());
    // Shared with the async bulk callbacks so large link flushes report
    // acknowledged Graph writes while they are moving, rather than appearing
    // idle between the staging and final summary logs.
    let progress = std::sync::Arc::new(Progress::start(
        flush_label.clone(),
        Some(rows.rows.len() as i64),
    ));

    let (archives, upserts): (Vec<_>, Vec<_>) = rows
        .rows
        .iter()
        .partition(|row| row.get(2).and_then(Value::as_str) == Some("archive"));

    let mut errors: Vec<SyncError> = vec![];
    let mut archive_ok = 0i64;

    for row in &archives {
        let op_id = row.first().and_then(Value::as_str).unwrap_or("");
        let payload: Value = row
            .get(3)
            .and_then(Value::as_str)
            .and_then(|text| serde_json::from_str(text).ok())
            .unwrap_or(Value::Null);

        let op = super::ArchiveOp {
            namespace: payload
                .get("namespace")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
            entity_type: payload
                .get("entityType")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
            entity_id: payload
                .get("entityId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
            // Restore the provenance staged into the payload rather than
            // sending an empty default (which would drop loadedAt/location and
            // fail server-side provenance validation, re-queuing forever).
            provenance: provenance_from_wire(payload.get("provenance")),
            web_id: payload
                .get("webId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
        };

        match client.archive_entity(&op).await {
            Ok(()) => {
                delete_pending(store, &pending, &[op_id.to_owned()]).await?;
                archive_ok += 1;
            }
            Err(err) => errors.push(SyncError {
                kind: "link-archive".to_owned(),
                entity_id: op.entity_id,
                message: format!("{err:?}"),
            }),
        }
        progress.tick(1);
    }

    let link_ops: Vec<LinkOp> = upserts
        .iter()
        .filter_map(|row| row.get(3).and_then(Value::as_str).map(decode_link_op))
        .collect();

    let result = if link_ops.is_empty() {
        super::BulkResult::default()
    } else {
        let delete_store = store.clone();
        let delete_table = pending.clone();
        let ack_progress = std::sync::Arc::clone(&progress);
        let on_batch_ok: BatchOk = std::sync::Arc::new(move |ids: Vec<String>| {
            let store = delete_store.clone();
            let pending = delete_table.clone();
            let progress = std::sync::Arc::clone(&ack_progress);
            Box::pin(async move {
                let acknowledged = ids.len() as i64;
                // A failed pending-delete leaves the flushed op in the pending
                // table, so it re-sends next flush (idempotent link upsert) and
                // commit_link_state withholds its state row until then. Log it
                // rather than swallow it silently.
                if let Err(err) = delete_pending(&store, &pending, &ids).await {
                    tracing::error!("link flush: pending-delete failed, ops will re-send: {err:?}");
                }
                progress.tick(acknowledged);
            })
        });
        client.bulk_upsert_links(link_ops, on_batch_ok).await
    };

    for failure in &result.failed {
        errors.push(SyncError {
            kind: "link-upsert".to_owned(),
            entity_id: failure.id.clone(),
            message: failure.message.clone(),
        });
    }

    for next_state in tables_with_prefix(store, &format!("_state/links-next/{connector_id}/"))
        .await
        .change_context(SourceError)?
    {
        commit_link_state(store, &next_state, &pending).await?;
    }

    let ok_count = result.ok.len() as i64 + archive_ok;
    let aborted = result.aborted || (!errors.is_empty() && ok_count == 0);

    if !rows.rows.is_empty() {
        let elapsed = progress.elapsed_ms();
        tracing::info!(
            "{flush_label}: {} upserts, {archive_ok} archives{} in {}{}",
            result.ok.len(),
            if errors.is_empty() {
                String::new()
            } else {
                format!(", {} FAILED", errors.len())
            },
            progress::duration(elapsed),
            progress::rate_suffix(ok_count, elapsed),
        );
    }

    Ok(SyncResult {
        inserts: result.ok.len() as i64,
        deletes: archive_ok,
        errors,
        aborted,
        ..SyncResult::default()
    })
}

// Finalize `_state/links` from the staged next state: keep upserts whose op
// left pending (they flushed) and archives that did NOT leave pending (still
// exist, retry recorded); then drop the staging table.
async fn commit_link_state(
    store: &Store,
    next_state: &str,
    pending: &str,
) -> Result<(), Report<SourceError>> {
    let state_table = next_state.replace("_state/links-next/", "_state/links/");

    if store
        .schema_of(next_state)
        .await
        .change_context(SourceError)?
        .is_none()
    {
        return Ok(());
    }

    store
        .exec(&format!(
            "CREATE OR REPLACE TABLE {state_q} AS SELECT n._source_id, n._target_id, n._content_hash FROM {next_q} n WHERE (n._op_kind = 'unchanged') OR (n._op_kind IN ('insert', 'update') AND n._op_id NOT IN (SELECT op_id FROM {pending_q}))",
            state_q = qi(&state_table),
            next_q = qi(next_state),
            pending_q = qi(pending),
        ))
        .await
        .change_context(SourceError)?;

    store
        .exec(&format!("DROP TABLE IF EXISTS {}", qi(next_state)))
        .await
        .change_context(SourceError)
}

pub fn link_op_id(
    namespace: &str,
    web_id: &str,
    link_type: &str,
    source_id: &str,
    target_id: &str,
) -> String {
    ["upsert", namespace, web_id, link_type, source_id, target_id].join("::")
}

async fn ensure_pending_table(
    store: &Store,
    connector_id: &str,
) -> Result<String, Report<SourceError>> {
    let table = format!("_state/pending-links/{connector_id}");
    store
        .exec(&format!(
            "CREATE TABLE IF NOT EXISTS {} (op_id VARCHAR, sink_id VARCHAR, operation VARCHAR, payload VARCHAR)",
            qi(&table)
        ))
        .await
        .change_context(SourceError)?;
    Ok(table)
}

async fn insert_pending(
    store: &Store,
    pending: &str,
    sink_id: &str,
    rows: &[(String, String, String)],
) -> Result<(), Report<SourceError>> {
    for chunk in rows.chunks(500) {
        if chunk.is_empty() {
            continue;
        }
        let ids = chunk
            .iter()
            .map(|(op_id, _, _)| lit(op_id))
            .collect::<Vec<_>>()
            .join(",");
        store
            .exec(&format!(
                "DELETE FROM {} WHERE op_id IN ({ids})",
                qi(pending)
            ))
            .await
            .change_context(SourceError)?;

        let placeholders = (0..chunk.len())
            .map(|index| {
                let base = index * 4;
                format!(
                    "(${}, ${}, ${}, ${})",
                    base + 1,
                    base + 2,
                    base + 3,
                    base + 4
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        let params: Vec<Value> = chunk
            .iter()
            .flat_map(|(op_id, operation, payload)| {
                vec![
                    Value::from(op_id.clone()),
                    Value::from(sink_id),
                    Value::from(operation.clone()),
                    Value::from(payload.clone()),
                ]
            })
            .collect();

        store
            .exec_params(
                &format!("INSERT INTO {} VALUES {placeholders}", qi(pending)),
                params,
            )
            .await
            .change_context(SourceError)?;
    }
    Ok(())
}

async fn delete_pending(
    store: &Store,
    pending: &str,
    ids: &[String],
) -> Result<(), Report<SourceError>> {
    for chunk in ids.chunks(500) {
        if chunk.is_empty() {
            continue;
        }
        let list = chunk.iter().map(|id| lit(id)).collect::<Vec<_>>().join(",");
        store
            .exec(&format!(
                "DELETE FROM {} WHERE op_id IN ({list})",
                qi(pending)
            ))
            .await
            .change_context(SourceError)?;
    }
    Ok(())
}

// TS pending-payload wire shape: camelCase fields, TypedValues as
// `$typedValue` tags (which is already this engine's native value shape).
pub fn encode_link_op(op: &LinkOp) -> String {
    let properties = op
        .properties
        .as_ref()
        .map(|properties| properties.iter().cloned().collect::<Map<String, Value>>());

    json!({
        "opId": op.op_id,
        "namespace": op.namespace,
        "webId": op.web_id,
        "sourceEntityType": op.source_entity_type,
        "sourceEntityId": op.source_entity_id,
        "linkType": op.link_type,
        "targetEntityType": op.target_entity_type,
        "targetId": op.target_id,
        "properties": properties,
        "provenance": provenance_wire(&op.provenance),
    })
    .to_string()
}

pub fn decode_link_op(payload: &str) -> LinkOp {
    let value: Value = serde_json::from_str(payload).unwrap_or(Value::Null);
    let text = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned()
    };

    LinkOp {
        op_id: text("opId"),
        namespace: text("namespace"),
        web_id: text("webId"),
        source_entity_type: text("sourceEntityType"),
        source_entity_id: text("sourceEntityId"),
        link_type: text("linkType"),
        target_entity_type: text("targetEntityType"),
        target_id: text("targetId"),
        properties: value
            .get("properties")
            .and_then(Value::as_object)
            .map(|properties| {
                properties
                    .iter()
                    .map(|(url, value)| (url.clone(), value.clone()))
                    .collect()
            }),
        provenance: provenance_from_wire(value.get("provenance")),
    }
}

fn provenance_wire(prov: &Provenance) -> Value {
    let mut map = Map::new();
    map.insert("type".to_owned(), json!("integration"));
    if let Some(authors) = &prov.authors {
        map.insert("authors".to_owned(), json!(authors));
    }
    if !prov.location_name.is_empty() {
        map.insert("location".to_owned(), json!({"name": prov.location_name}));
    }
    if let Some(first_published) = &prov.first_published {
        map.insert("firstPublished".to_owned(), json!(first_published));
    }
    if let Some(last_updated) = &prov.last_updated {
        map.insert("lastUpdated".to_owned(), json!(last_updated));
    }
    if !prov.loaded_at.is_empty() {
        map.insert("loadedAt".to_owned(), json!(prov.loaded_at));
    }
    Value::Object(map)
}

fn provenance_from_wire(value: Option<&Value>) -> Provenance {
    let Some(value) = value else {
        return Provenance::default();
    };
    Provenance {
        loaded_at: value
            .get("loadedAt")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        location_name: value
            .pointer("/location/name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        authors: value
            .get("authors")
            .and_then(Value::as_array)
            .map(|authors| {
                authors
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            }),
        first_published: value
            .get("firstPublished")
            .and_then(Value::as_str)
            .map(str::to_owned),
        last_updated: value
            .get("lastUpdated")
            .and_then(Value::as_str)
            .map(str::to_owned),
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::blob::{ArtifactStore, BlobNamespace};
    use crate::build::{Accessor, EndpointRef};
    use crate::graph::client::{archive_params, link_entity_ids};
    use crate::graph::effects::GraphOperationV1;
    use crate::graph::planner::{GraphDeliveryPayload, GraphDeliveryRequestV1};
    use crate::graph::recording::RecordingClient;
    use crate::orchestrator::registry::DurableRecord;
    use crate::store::StoreOptions;
    use tempfile::TempDir;

    fn entry() -> LinkEntry {
        LinkEntry {
            id: "relations".to_owned(),
            web_id: "00000000-0000-4000-8000-000000000001".to_owned(),
            id_namespace: Some("connector".to_owned()),
            source: "checkpoint".to_owned(),
            inputs: vec![],
            steps: vec![],
            from: EndpointRef {
                entity_type: "https://example.com/types/entity-type/item/v/1".to_owned(),
                column: "source_id".to_owned(),
            },
            to: EndpointRef {
                entity_type: "https://example.com/types/entity-type/item/v/1".to_owned(),
                column: "target_id".to_owned(),
            },
            link_type: "https://example.com/types/entity-type/related/v/1".to_owned(),
            properties: vec![(
                "https://example.com/types/property-type/label/v/1".to_owned(),
                Accessor::Column("label".to_owned()),
            )],
            property_columns: vec!["label".to_owned()],
            provenance: None,
        }
    }

    fn provenance() -> Provenance {
        Provenance {
            loaded_at: "2026-07-22T10:00:00Z".to_owned(),
            location_name: "fixture".to_owned(),
            ..Provenance::default()
        }
    }

    async fn parity_store(entry: &LinkEntry) -> Store {
        let store = Store::open(StoreOptions::default()).expect("store");
        store
            .exec("CREATE TABLE links (source_id VARCHAR, target_id VARCHAR, label VARCHAR); INSERT INTO links VALUES ('A', 'B', 'old'), ('B', 'C', 'same'), ('C', 'D', 'removed')")
            .await
            .expect("initial links");
        let prepared = prepare_link_diff(&store, entry, "links", "connector", "connector")
            .await
            .expect("seed diff");
        store
            .exec(&format!(
                "CREATE OR REPLACE TABLE {} AS SELECT _source_id, _target_id, _content_hash FROM {}",
                qi(&prepared.state_table),
                qi(&prepared.current)
            ))
            .await
            .expect("seed state");
        for table in [prepared.current, prepared.diff] {
            store
                .exec(&format!("DROP TABLE {}", qi(&table)))
                .await
                .expect("drop seed table");
        }
        store
            .exec("DELETE FROM links; INSERT INTO links VALUES ('A', 'B', 'changed'), ('B', 'C', 'same'), ('D', 'E', 'new')")
            .await
            .expect("candidate links");
        store
    }

    fn artifacts() -> (TempDir, TempDir, ArtifactRepository) {
        let remote = TempDir::new().expect("remote");
        let cache = TempDir::new().expect("cache");
        let blobs = ArtifactStore::local(remote.path(), cache.path()).expect("blob store");
        let namespace = BlobNamespace::new("web", "connector").expect("namespace");
        let artifacts = ArtifactRepository::new(blobs, namespace);
        (remote, cache, artifacts)
    }

    #[tokio::test]
    async fn extracted_link_plan_matches_reference_effects_and_state_bytes() {
        let entry = entry();
        let reference_store = parity_store(&entry).await;
        let planned_store = parity_store(&entry).await;
        let provenance = provenance();
        let unit_maps = Map::new();
        let env = Env::default();
        let (_remote, _cache, artifacts) = artifacts();
        let reference_prepared =
            prepare_link_diff(&reference_store, &entry, "links", "connector", "connector")
                .await
                .expect("reference prepare");
        let reference_ctx = LinkContext {
            connector_id: "connector",
            artifacts: &artifacts,
            provenance: &provenance,
            unit_maps: &unit_maps,
            run_id: "reference",
            env: &env,
            run_manifest: None,
        };
        stage_ops(
            &reference_store,
            &entry,
            "connector",
            &reference_prepared.current,
            &reference_prepared.diff,
            &reference_ctx,
        )
        .await
        .expect("stage reference operations");
        let next_state = "_state/links-next/connector/relations";
        stage_next_state(
            &reference_store,
            &entry,
            "connector",
            &reference_prepared.current,
            &reference_prepared.diff,
            next_state,
        )
        .await
        .expect("stage reference state");
        let recording = Arc::new(RecordingClient::new());
        let client: SharedClient = recording.clone();
        let flushed = flush(&reference_store, "connector", &client, Some("relations"))
            .await
            .expect("reference flush");

        let planned = plan_link_table(
            &planned_store,
            &entry,
            "links",
            &LinkPlanningContext {
                connector_id: "connector",
                provenance: &provenance,
                unit_maps: &unit_maps,
                effect_selection: EffectSelectionV1::ChangesOnly,
            },
        )
        .await
        .expect("link plan");
        assert_eq!((flushed.inserts, flushed.deletes), (2, 1));
        assert_eq!(
            (planned.upserts, planned.archives, planned.unchanged),
            (2, 1, 1)
        );

        let mut reference_effects = Vec::new();
        for op in recording.links() {
            let identity = link_entity_ids(&op).full_link_id;
            reference_effects.push((GraphOperationV1::UpsertLink, identity.clone()));
            let expected = plan_link_upsert(&op).expect("reference link payload");
            let actual = planned
                .graph
                .desired
                .iter()
                .find(|object| object.graph_identity == identity)
                .expect("planned live link");
            assert_eq!(
                actual.disposition.payload(),
                expected.desired.disposition.payload()
            );
        }
        for op in recording.archives() {
            let identity = archive_params(&op)["entityId"]
                .as_str()
                .expect("archive identity")
                .to_owned();
            reference_effects.push((GraphOperationV1::ArchiveLink, identity.clone()));
            let desired = planned
                .graph
                .desired
                .iter()
                .find(|object| object.graph_identity == identity)
                .expect("planned archived link");
            let payload = GraphDeliveryPayload::decode(desired.disposition.payload())
                .expect("delivery payload")
                .into_current()
                .expect("current delivery");
            let GraphDeliveryRequestV1::Archive { archive } = payload.request else {
                panic!("archive delivery")
            };
            assert_eq!(archive, archive_params(&op));
        }
        reference_effects.sort_by(|left, right| {
            (left.0.order(), left.1.as_str()).cmp(&(right.0.order(), right.1.as_str()))
        });
        assert_eq!(
            planned
                .graph
                .effects
                .iter()
                .map(|effect| (effect.operation, effect.graph_identity.clone()))
                .collect::<Vec<_>>(),
            reference_effects
        );
        let reference_state = reference_store
            .query("SELECT * FROM \"_state/links/connector/relations\" ORDER BY _source_id, _target_id")
            .await
            .expect("reference state");
        let planned_state = planned_store
            .query("SELECT * FROM \"_state/links/connector/relations\" ORDER BY _source_id, _target_id")
            .await
            .expect("planned state");
        assert_eq!(
            serde_json::to_vec(&reference_state.rows).expect("reference state bytes"),
            serde_json::to_vec(&planned_state.rows).expect("planned state bytes")
        );

        let forced = plan_link_table(
            &planned_store,
            &entry,
            "links",
            &LinkPlanningContext {
                connector_id: "connector",
                provenance: &provenance,
                unit_maps: &unit_maps,
                effect_selection: EffectSelectionV1::ForceAll,
            },
        )
        .await
        .expect("force link plan");
        assert_eq!(forced.unchanged, 3);
        assert_eq!(forced.graph.effects.len(), 3);
        assert!(forced
            .graph
            .effects
            .iter()
            .all(|effect| effect.operation == GraphOperationV1::UpsertLink));
    }
}
