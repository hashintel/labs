//! Append-path materialize for stream events: builds/evolves the staging
//! table and inserts one row per event with the envelope rendered host-side.
//! `_key` is JSON in PRIMARY-KEY DECLARED ORDER (TS `JSON.stringify(ev.key)`
//! parity), `_before` is the JSON'd before-image, cells render like the TS
//! event path (JS `String()` scalars, JSON columns for structured values).
//! This is the documented event-path adoption caveat: these bytes are
//! host-rendered, unlike the snapshot path.

use error_stack::{Report, ResultExt as _};
use serde_json::Value;

use crate::connectors::{EventOp, StreamEvent};
use crate::error::SourceError;
use crate::store::{lit, qi, Store};
use crate::value::{js_string, Row};

const ENVELOPE: [(&str, &str); 3] = [("_op", "VARCHAR"), ("_key", "VARCHAR"), ("_before", "JSON")];

pub async fn materialize(
    store: &Store,
    table: &str,
    events: &[StreamEvent],
    primary_key: &[String],
) -> Result<(), Report<SourceError>> {
    let events: Vec<&StreamEvent> = events.iter().filter(|event| event.row.is_some()).collect();
    if events.is_empty() {
        return Ok(());
    }

    let mut data_cols: Vec<String> = vec![];
    for event in &events {
        for key in event.row.as_ref().expect("filtered").keys() {
            if !data_cols.contains(key) {
                data_cols.push(key.clone());
            }
        }
    }

    ensure_table(store, table, &data_cols, &events).await?;

    let values = events
        .iter()
        .map(|event| {
            let row = event.row.as_ref().expect("filtered");
            let mut cells = vec![
                lit(op_name(&event.op)),
                lit(&key_json(&event.key, primary_key)),
                encode_cell(event.before.as_ref().map(row_json).as_ref()),
            ];
            for column in &data_cols {
                cells.push(encode_cell(row.get(column)));
            }
            format!("({})", cells.join(", "))
        })
        .collect::<Vec<_>>()
        .join(", ");

    let mut columns: Vec<&str> = vec!["_op", "_key", "_before"];
    columns.extend(data_cols.iter().map(String::as_str));
    let column_list = columns
        .iter()
        .map(|column| qi(column))
        .collect::<Vec<_>>()
        .join(", ");

    store
        .exec(&format!(
            "INSERT INTO {} ({column_list}) VALUES {values}",
            qi(table)
        ))
        .await
        .change_context(SourceError)
}

fn op_name(op: &EventOp) -> &'static str {
    match op {
        EventOp::Insert => "insert",
        EventOp::Update => "update",
        EventOp::Delete => "delete",
    }
}

/// JSON object over the primary-key columns in declared order (map key order
/// is not stable).
pub fn key_json(key: &Row, primary_key: &[String]) -> String {
    let entries = primary_key
        .iter()
        .map(|column| {
            format!(
                "{}:{}",
                Value::String(column.clone()),
                key.get(column).cloned().unwrap_or(Value::Null)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("{{{entries}}}")
}

async fn ensure_table(
    store: &Store,
    table: &str,
    data_cols: &[String],
    events: &[&StreamEvent],
) -> Result<(), Report<SourceError>> {
    match store.schema_of(table).await.change_context(SourceError)? {
        Some(existing) => {
            for column in data_cols.iter().filter(|column| !existing.contains(column)) {
                store
                    .exec(&format!(
                        "ALTER TABLE {} ADD COLUMN {} {}",
                        qi(table),
                        qi(column),
                        column_type(events, column)
                    ))
                    .await
                    .change_context(SourceError)?;
            }
        }
        None => {
            let mut defs: Vec<String> = ENVELOPE
                .iter()
                .map(|(column, sql_type)| format!("{} {sql_type}", qi(column)))
                .collect();
            for column in data_cols {
                defs.push(format!("{} {}", qi(column), column_type(events, column)));
            }
            store
                .exec(&format!("CREATE TABLE {} ({})", qi(table), defs.join(", ")))
                .await
                .change_context(SourceError)?;
        }
    }
    Ok(())
}

fn column_type(events: &[&StreamEvent], column: &str) -> &'static str {
    let structured = events.iter().any(|event| {
        event
            .row
            .as_ref()
            .and_then(|row| row.get(column))
            .map(|value| value.is_object() || value.is_array())
            .unwrap_or(false)
    });
    if structured {
        "JSON"
    } else {
        "VARCHAR"
    }
}

fn row_json(row: &Row) -> Value {
    Value::Object(row.clone())
}

fn encode_cell(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => "NULL".to_owned(),
        Some(structured @ (Value::Object(_) | Value::Array(_))) => lit(&structured.to_string()),
        Some(scalar) => lit(&js_string(scalar)),
    }
}
