//! Declarative post-hydrate invariants on the materialized source table,
//! semantics identical to the TS/Elixir engines. A failure errors with a
//! diagnostic; per-source isolation turns that into a source-level error
//! without touching other sources.

use error_stack::{Report, ResultExt as _};
use serde_json::Value;

use crate::error::SourceError;
use crate::store::{qi, Store};

const OFFENDER_SAMPLE: usize = 5;

pub async fn run(
    store: &Store,
    source_table: &str,
    source: &str,
    asserts: &Value,
    row_count: i64,
) -> Result<(), Report<SourceError>> {
    let mut failures = row_count_failures(asserts.get("rowCount"), row_count);

    if row_count > 0 {
        failures.extend(
            not_null_failures(store, source_table, asserts.get("notNull"), row_count).await?,
        );
        failures.extend(unique_failures(store, source_table, asserts.get("unique")).await?);
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(Report::new(SourceError).attach_printable(format!(
            "source \"{source}\" failed asserts:\n  {}",
            failures.join("\n  ")
        )))
    }
}

fn row_count_failures(spec: Option<&Value>, row_count: i64) -> Vec<String> {
    let Some(spec) = spec else { return vec![] };
    let mut failures = vec![];

    if let Some(min) = spec.get("min").and_then(Value::as_i64) {
        if row_count < min {
            failures.push(format!("rowCount: {row_count} < min {min}"));
        }
    }
    if let Some(max) = spec.get("max").and_then(Value::as_i64) {
        if row_count > max {
            failures.push(format!("rowCount: {row_count} > max {max}"));
        }
    }
    failures
}

async fn not_null_failures(
    store: &Store,
    table: &str,
    columns: Option<&Value>,
    row_count: i64,
) -> Result<Vec<String>, Report<SourceError>> {
    let mut failures = vec![];

    for column in columns
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(Value::as_str)
    {
        let result = store
            .query(&format!(
                "SELECT COUNT(*) FILTER (WHERE {col} IS NULL OR TRIM({col}::VARCHAR) = '')::BIGINT AS n FROM {table}",
                col = qi(column),
                table = qi(table),
            ))
            .await
            .change_context(SourceError)?;

        let nulls = result.single_i64();
        if nulls > 0 {
            failures.push(format!(
                "notNull({column}): {nulls} of {row_count} rows null or blank"
            ));
        }
    }

    Ok(failures)
}

async fn unique_failures(
    store: &Store,
    table: &str,
    keys: Option<&Value>,
) -> Result<Vec<String>, Report<SourceError>> {
    let mut failures = vec![];

    for key in keys
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        let columns: Vec<&str> = match key {
            Value::String(column) => vec![column.as_str()],
            Value::Array(list) => list.iter().filter_map(Value::as_str).collect(),
            _ => continue,
        };
        let column_list = columns
            .iter()
            .map(|column| qi(column))
            .collect::<Vec<_>>()
            .join(", ");

        let result = store
            .query(&format!(
                "SELECT {column_list}, COUNT(*)::BIGINT AS n FROM {} GROUP BY {column_list} HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT {OFFENDER_SAMPLE}",
                qi(table),
            ))
            .await
            .change_context(SourceError)?;

        if !result.rows.is_empty() {
            let offenders = result
                .rows
                .iter()
                .map(|row| {
                    let (key_values, count) = row.split_at(columns.len());
                    let rendered = key_values
                        .iter()
                        .map(crate::value::js_string)
                        .collect::<Vec<_>>()
                        .join("::");
                    format!(
                        "{rendered} ({} rows)",
                        count.first().and_then(Value::as_i64).unwrap_or(0)
                    )
                })
                .collect::<Vec<_>>()
                .join(", ");

            failures.push(format!(
                "unique({}): duplicated keys, e.g. {offenders}",
                columns.join(", ")
            ));
        }
    }

    Ok(failures)
}
