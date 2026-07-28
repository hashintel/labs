//! Wraps a read expression with the snapshot envelope (`_op`/`_key`/`_before`)
//! into a staging table. The `_key` rendering (`CAST(to_json({...}) AS
//! VARCHAR)`) is computed by DuckDB itself and is byte-identical to the
//! TS/Elixir engines': it is part of the adopted-state contract
//! (golden-pinned).

use error_stack::{Report, ResultExt as _};

use crate::error::SourceError;
use crate::store::{lit, qi, Store};

pub const META_COLUMNS: [&str; 3] = ["_op", "_key", "_before"];

pub fn key_expr(primary_key: &[String]) -> String {
    let entries = primary_key
        .iter()
        .map(|column| format!("{}: {}", lit(column), qi(column)))
        .collect::<Vec<_>>()
        .join(", ");
    format!("CAST(to_json({{{entries}}}) AS VARCHAR)")
}

pub struct Materialized {
    pub row_count: i64,
}

pub async fn materialize(
    store: &Store,
    source: &str,
    staging_table: &str,
    read_expr: &str,
    primary_key: &[String],
) -> Result<Materialized, Report<SourceError>> {
    let described = store
        .query(&format!("DESCRIBE ({read_expr})"))
        .await
        .change_context(SourceError)?;

    let columns: Vec<String> = described
        .rows
        .iter()
        .filter_map(|row| row.first().and_then(serde_json::Value::as_str))
        .map(str::to_owned)
        .collect();

    let collisions: Vec<_> = columns
        .iter()
        .filter(|column| META_COLUMNS.contains(&column.as_str()))
        .cloned()
        .collect();
    if !collisions.is_empty() {
        return Err(Report::new(SourceError).attach_printable(format!(
            "Source \"{source}\" has reserved column names [{}]. Rename them at the source, or via a read expression that aliases them.",
            collisions.join(", ")
        )));
    }

    let missing: Vec<_> = primary_key
        .iter()
        .filter(|column| !columns.contains(column))
        .cloned()
        .collect();
    if !missing.is_empty() {
        return Err(Report::new(SourceError).attach_printable(format!(
            "Source \"{source}\" primaryKey references missing columns [{}]. Available: [{}]",
            missing.join(", "),
            columns.join(", ")
        )));
    }

    let data_columns = columns
        .iter()
        .map(|column| qi(column))
        .collect::<Vec<_>>()
        .join(", ");

    store
        .exec(&format!(
            "CREATE OR REPLACE TABLE {} AS SELECT 'snapshot' AS \"_op\", {} AS \"_key\", CAST(NULL AS JSON) AS \"_before\", {} FROM ({}) _src",
            qi(staging_table),
            key_expr(primary_key),
            data_columns,
            read_expr,
        ))
        .await
        .change_context(SourceError)?;

    let count = store
        .query(&format!(
            "SELECT COUNT(*)::BIGINT AS n FROM {}",
            qi(staging_table)
        ))
        .await
        .change_context(SourceError)?;

    Ok(Materialized {
        row_count: count.single_i64(),
    })
}
