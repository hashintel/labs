//! State diffing is only meaningful against the graph it was built from.
//! Before any write: per-sink fingerprint {graph identity, web id, namespace}
//! vs `_state/meta`, plus a sentinel probe (three sampled state ids checked
//! in the live graph; all absent means wiped or reseeded). Mismatch is a
//! hard, non-retryable error; HASH_ALLOW_STATE_MISMATCH=1 drops connector
//! state and cold-starts.

use error_stack::{Report, ResultExt as _};
use serde_json::Value;

use crate::build::Integration;
use crate::config::{self, Env};
use crate::error::{CoherenceError, GraphError};
use crate::store::{lit, qi, Store};

use super::state_meta::{self, Meta};
use super::uuid::{composite_entity_id, deterministic_uuid};
use super::SharedClient;

const PROBE_SAMPLE: usize = 3;

/// The two ways a coherence check can fail, kept distinct because they demand
/// opposite handling: a `Mismatch` is deterministic (wrong state dir, or the
/// graph really was wiped) and must NOT be retried; an `Unreachable` means the
/// graph could not be reached during the sentinel probe and MUST be retried
/// with state intact, never mistaken for "graph wiped". Folding a transport
/// error into `Mismatch` would steer the operator toward the state-dropping
/// remedy over a transient blip.
#[derive(Debug)]
pub enum CheckError {
    Mismatch(Report<CoherenceError>),
    Unreachable(Report<GraphError>),
}

impl From<Report<CoherenceError>> for CheckError {
    fn from(report: Report<CoherenceError>) -> Self {
        Self::Mismatch(report)
    }
}

const REMEDY: &str = "A mismatched target mis-diffs (wrong ops or duplicate entities). Point the state dir at the graph it was written against, use a fresh state dir for a clean full sync, or set HASH_ALLOW_STATE_MISMATCH=1 to drop local state and cold-start (inserts only, no archives).";

struct Scoped {
    scope: &'static str,
    sink_id: String,
    graph_identity: String,
    web_id: String,
    namespace: String,
    state_table: Option<String>,
    entity_type: Option<String>,
}

pub async fn check(
    store: &Store,
    client: &SharedClient,
    integration: &Integration,
    env: &Env,
) -> Result<(), CheckError> {
    let connector_id = &integration.connector_id;
    let graph_identity = client.identity();

    let sync_tables = tables_with_prefix(store, &format!("_state/sync/{connector_id}/"))
        .await
        .change_context(CoherenceError)?;
    let link_tables = tables_with_prefix(store, &format!("_state/links/{connector_id}/"))
        .await
        .change_context(CoherenceError)?;

    let mut scoped: Vec<Scoped> = vec![];
    for sink in crate::engine::batch_sync::collect_sinks(&integration.pipelines) {
        let state = format!("_state/sync/{connector_id}/{}", sink.sink_id);
        scoped.push(Scoped {
            scope: "entity",
            sink_id: sink.sink_id.clone(),
            graph_identity: graph_identity.clone(),
            web_id: sink.config.web_id.clone(),
            namespace: sink
                .config
                .id_namespace
                .clone()
                .unwrap_or_else(|| connector_id.clone()),
            state_table: sync_tables.contains(&state).then_some(state),
            entity_type: Some(sink.config.entity_type.clone()),
        });
    }
    for link in &integration.link_pipelines {
        let state = format!("_state/links/{connector_id}/{}", link.id);
        scoped.push(Scoped {
            scope: "link",
            sink_id: link.id.clone(),
            graph_identity: graph_identity.clone(),
            web_id: link.web_id.clone(),
            namespace: link
                .id_namespace
                .clone()
                .unwrap_or_else(|| connector_id.clone()),
            state_table: link_tables.contains(&state).then_some(state),
            entity_type: None,
        });
    }

    let mut failures = vec![];
    for entry in scoped.iter().filter(|entry| entry.state_table.is_some()) {
        let meta = state_meta::read(store, entry.scope, connector_id, &entry.sink_id)
            .await
            .change_context(CoherenceError)?;
        if let Some(reason) = mismatch_reason(meta.as_ref(), entry) {
            failures.push(format!(
                "{} sink \"{}\": {reason}",
                entry.scope, entry.sink_id
            ));
        }
    }

    if failures.is_empty() {
        if let Some(probe_failure) = sentinel_probe(store, client, &scoped).await? {
            failures.push(probe_failure);
        }
    }

    if !failures.is_empty() {
        if config::allow_state_mismatch(env) {
            tracing::warn!(
                "state/graph coherence OVERRIDDEN (HASH_ALLOW_STATE_MISMATCH=1): dropping state for connector \"{connector_id}\""
            );
            for prefix in [
                format!("_state/sync/{connector_id}/"),
                format!("_state/links/{connector_id}/"),
                format!("_state/links-next/{connector_id}/"),
            ] {
                for table in tables_with_prefix(store, &prefix)
                    .await
                    .change_context(CoherenceError)?
                {
                    store
                        .exec(&format!("DROP TABLE IF EXISTS {}", qi(&table)))
                        .await
                        .change_context(CoherenceError)?;
                }
            }
            store
                .exec(&format!(
                    "DROP TABLE IF EXISTS {}",
                    qi(&format!("_state/pending-links/{connector_id}"))
                ))
                .await
                .change_context(CoherenceError)?;
        } else {
            return Err(CheckError::Mismatch(
                Report::new(CoherenceError).attach_printable(format!(
                    "state/graph coherence check failed:\n  {}\n{REMEDY}",
                    failures.join("\n  ")
                )),
            ));
        }
    }

    for entry in &scoped {
        let existing = state_meta::read(store, entry.scope, connector_id, &entry.sink_id)
            .await
            .change_context(CoherenceError)?
            .unwrap_or_default();

        state_meta::write(
            store,
            entry.scope,
            connector_id,
            &entry.sink_id,
            &Meta {
                hash_version: existing.hash_version,
                config_hash: existing.config_hash,
                graph_identity: Some(entry.graph_identity.clone()),
                web_id: Some(entry.web_id.clone()),
                namespace: Some(entry.namespace.clone()),
            },
        )
        .await
        .change_context(CoherenceError)?;
    }

    Ok(())
}

fn mismatch_reason(meta: Option<&Meta>, entry: &Scoped) -> Option<String> {
    const NO_FINGERPRINT: &str =
        "state exists but no fingerprint is recorded (state predates the coherence check, or meta was lost)";

    let Some(meta) = meta else {
        return Some(NO_FINGERPRINT.to_owned());
    };
    let (Some(graph), Some(web), Some(namespace)) =
        (&meta.graph_identity, &meta.web_id, &meta.namespace)
    else {
        return Some(NO_FINGERPRINT.to_owned());
    };

    let diffs: Vec<String> = [
        (graph, &entry.graph_identity, "graph"),
        (web, &entry.web_id, "web"),
        (namespace, &entry.namespace, "namespace"),
    ]
    .into_iter()
    .filter(|(stored, now, _)| stored != now)
    .map(|(stored, now, label)| format!("{label} \"{stored}\" vs \"{now}\""))
    .collect();

    (!diffs.is_empty()).then(|| format!("stored vs current: {}", diffs.join(", ")))
}

// One legitimately purged entity must not trip the check; a wiped graph
// trips it always.
async fn sentinel_probe(
    store: &Store,
    client: &SharedClient,
    scoped: &[Scoped],
) -> Result<Option<String>, CheckError> {
    let mut best: Option<(&Scoped, i64)> = None;
    for entry in scoped {
        let (Some(state_table), Some(_)) = (&entry.state_table, &entry.entity_type) else {
            continue;
        };
        let count = store
            .query(&format!(
                "SELECT COUNT(*)::BIGINT AS n FROM {}",
                qi(state_table)
            ))
            .await
            .change_context(CoherenceError)?
            .single_i64();
        if best.map(|(_, n)| count > n).unwrap_or(true) {
            best = Some((entry, count));
        }
    }

    let Some((entry, count)) = best else {
        return Ok(None);
    };
    if count == 0 {
        return Ok(None);
    }
    let state_table = entry.state_table.as_ref().expect("filtered");
    let entity_type = entry.entity_type.as_ref().expect("filtered");

    let sample = store
        .query(&format!(
            "SELECT _entity_id FROM {} ORDER BY _entity_id LIMIT {PROBE_SAMPLE}",
            qi(state_table)
        ))
        .await
        .change_context(CoherenceError)?;

    let ids: Vec<&str> = sample
        .rows
        .iter()
        .filter_map(|row| row.first().and_then(Value::as_str))
        .collect();

    let mut found = 0;
    for id in &ids {
        let composite = composite_entity_id(
            &entry.web_id,
            &deterministic_uuid(
                &entry.namespace,
                entity_type,
                &Value::String((*id).to_owned()),
            ),
        );
        // A transport error here is NOT "entity absent": propagate it as
        // Unreachable so the run retries with state intact, rather than
        // reading a graph outage as "wiped" and steering toward the
        // state-dropping remedy.
        if client
            .has_entity(&composite)
            .await
            .map_err(CheckError::Unreachable)?
        {
            found += 1;
        }
    }

    if found == 0 {
        Ok(Some(format!(
            "sentinel probe: none of {} sampled entities from \"{state_table}\" exist in the target graph (graph wiped or reseeded since this state was written?)",
            ids.len()
        )))
    } else {
        Ok(None)
    }
}

pub async fn tables_with_prefix(
    store: &Store,
    prefix: &str,
) -> Result<Vec<String>, Report<crate::error::StoreError>> {
    let result = store
        .query(&format!(
            "SELECT table_name FROM information_schema.tables WHERE starts_with(table_name, {})",
            lit(prefix)
        ))
        .await?;

    Ok(result
        .rows
        .iter()
        .filter_map(|row| row.first().and_then(Value::as_str))
        .map(str::to_owned)
        .collect())
}
