//! Conversion quarantine: current-state ledger of bronze-to-silver conversion
//! failures, kept in the state store next to `_state/*`. Rows carry the raw
//! value as evidence and the `_key` envelope to locate the row in bronze.
//! Self-healing: callers clear by resolved entity id for every re-evaluated
//! row, then record fresh failures.

use error_stack::Report;
use serde_json::Value;

use crate::error::StoreError;
use crate::store::{lit, qi, Store};

const CHUNK: usize = 500;

pub fn table(connector_id: &str) -> String {
    format!("_dlq/{connector_id}")
}

#[derive(Debug, Clone)]
pub struct Entry {
    pub source: Option<String>,
    pub kind: String,
    pub sink_id: String,
    pub property_url: Option<String>,
    pub coercion: Option<String>,
    pub entity_id: String,
    pub entity_key: Option<String>,
    pub raw_value: Option<String>,
    pub reason: String,
}

pub async fn ensure_table(store: &Store, connector_id: &str) -> Result<(), Report<StoreError>> {
    store
        .exec(&format!(
            "CREATE TABLE IF NOT EXISTS {} (occurred_at TIMESTAMP, run_id VARCHAR, source VARCHAR, kind VARCHAR, sink_id VARCHAR, property_url VARCHAR, coercion VARCHAR, entity_id VARCHAR, entity_key VARCHAR, raw_value VARCHAR, reason VARCHAR)",
            qi(&table(connector_id))
        ))
        .await
}

pub async fn record(
    store: &Store,
    connector_id: &str,
    run_id: &str,
    entries: &[Entry],
) -> Result<(), Report<StoreError>> {
    if entries.is_empty() {
        return Ok(());
    }
    ensure_table(store, connector_id).await?;
    let quoted = qi(&table(connector_id));

    for chunk in entries.chunks(CHUNK) {
        let placeholders = (0..chunk.len())
            .map(|index| {
                let base = index * 10;
                let cells = (1..=10)
                    .map(|offset| format!("${}", base + offset))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("(now(), {cells})")
            })
            .collect::<Vec<_>>()
            .join(", ");

        let params: Vec<Value> = chunk
            .iter()
            .flat_map(|entry| {
                vec![
                    Value::from(run_id),
                    opt(&entry.source),
                    Value::from(entry.kind.clone()),
                    Value::from(entry.sink_id.clone()),
                    opt(&entry.property_url),
                    opt(&entry.coercion),
                    Value::from(entry.entity_id.clone()),
                    opt(&entry.entity_key),
                    opt(&entry.raw_value),
                    Value::from(entry.reason.clone()),
                ]
            })
            .collect();

        store
            .exec_params(
                &format!("INSERT INTO {quoted} VALUES {placeholders}"),
                params,
            )
            .await?;
    }

    Ok(())
}

fn opt(value: &Option<String>) -> Value {
    value.clone().map(Value::from).unwrap_or(Value::Null)
}

pub async fn clear(
    store: &Store,
    connector_id: &str,
    kind: &str,
    sink_id: &str,
    entity_ids: &[String],
) -> Result<(), Report<StoreError>> {
    if entity_ids.is_empty() {
        return Ok(());
    }
    ensure_table(store, connector_id).await?;
    let quoted = qi(&table(connector_id));

    for chunk in entity_ids.chunks(CHUNK) {
        let list = chunk.iter().map(|id| lit(id)).collect::<Vec<_>>().join(",");
        store
            .exec(&format!(
                "DELETE FROM {quoted} WHERE kind = {} AND sink_id = {} AND entity_id IN ({list})",
                lit(kind),
                lit(sink_id)
            ))
            .await?;
    }

    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SummaryRow {
    pub source: String,
    pub kind: String,
    pub sink_id: String,
    pub property_url: String,
    pub coercion: String,
    pub count: i64,
}

pub async fn summary(
    store: &Store,
    connector_id: &str,
    source: Option<&str>,
) -> Result<Vec<SummaryRow>, Report<StoreError>> {
    ensure_table(store, connector_id).await?;
    let filter = source
        .map(|name| format!(" WHERE source = {}", lit(name)))
        .unwrap_or_default();

    let result = store
        .query(&format!(
            "SELECT COALESCE(source, ''), kind, sink_id, COALESCE(property_url, ''), COALESCE(coercion, ''), COUNT(*)::BIGINT FROM {}{filter} GROUP BY source, kind, sink_id, property_url, coercion ORDER BY kind, sink_id, property_url",
            qi(&table(connector_id))
        ))
        .await?;

    Ok(result
        .rows
        .iter()
        .map(|row| SummaryRow {
            source: text(row.first()),
            kind: text(row.get(1)),
            sink_id: text(row.get(2)),
            property_url: text(row.get(3)),
            coercion: text(row.get(4)),
            count: row.get(5).and_then(Value::as_i64).unwrap_or(0),
        })
        .collect())
}

fn text(value: Option<&Value>) -> String {
    value.and_then(Value::as_str).unwrap_or_default().to_owned()
}
