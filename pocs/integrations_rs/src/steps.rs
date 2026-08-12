//! Step execution over the staging store. SQL steps see the previous output
//! as the view `input` plus any named checkpoint inputs; every step output
//! must keep the `_op/_key/_before` envelope. Branch steps fan out against
//! the pre-branch table; the main flow continues unchanged. Side-effect
//! results (graph sinks, checkpoints) are collected and returned in execution
//! order: the caller folds them, no shared mutable state.

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use error_stack::{Report, ResultExt as _};
use serde_json::Value;

use crate::build::{Step, StepKind};
use crate::error::SourceError;
use crate::store::{qi, Store};
use crate::value::Row;

pub type Transform = Arc<dyn Fn(Vec<Row>) -> Vec<Row> + Send + Sync>;
pub type Transforms = HashMap<String, Transform>;

pub struct NamedInput {
    pub alias: String,
    pub table: String,
}

/// A side-effect callback: invoked for graph-sink and checkpoint steps with
/// the current table; its return values are collected. The future is
/// `'static`: callbacks clone what they need (Store is a cheap handle).
pub type SideEffect<'a, T> = dyn FnMut(
        &Step,
        &str,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<T, Report<SourceError>>> + Send>,
    > + Send
    + 'a;

pub struct PipelineOutcome<T> {
    pub final_table: String,
    pub effects: Vec<T>,
}

pub async fn run_pipeline<T>(
    store: &Store,
    source_table: &str,
    steps: &[Step],
    named_inputs: &[NamedInput],
    transforms: &Transforms,
    on_side_effect: &mut SideEffect<'_, T>,
) -> Result<PipelineOutcome<T>, Report<SourceError>> {
    let mut current = source_table.to_owned();
    let mut effects = vec![];

    for step in steps {
        current = run_step(
            store,
            step,
            &current,
            &mut effects,
            named_inputs,
            transforms,
            false,
            on_side_effect,
        )
        .await?;
    }

    Ok(PipelineOutcome {
        final_table: current,
        effects,
    })
}

#[allow(clippy::too_many_arguments)]
async fn run_step<T>(
    store: &Store,
    step: &Step,
    current: &str,
    effects: &mut Vec<T>,
    named_inputs: &[NamedInput],
    transforms: &Transforms,
    in_branch: bool,
    on_side_effect: &mut SideEffect<'_, T>,
) -> Result<String, Report<SourceError>> {
    match &step.kind {
        StepKind::Sql { sql } => {
            let output = format!("_step/{}", step.id);
            execute_sql_step(store, sql, Some(current), &output, named_inputs).await?;
            assert_meta(store, &output, &step.id).await?;
            Ok(output)
        }
        StepKind::Fn { transform } => {
            let output = format!("_step/{}", step.id);
            let function = transforms.get(transform).ok_or_else(|| {
                Report::new(SourceError).attach_printable(format!(
                    "FnStep \"{}\" references transform \"{transform}\" but no resolver was provided",
                    step.id
                ))
            })?;
            exec_transform(store, function, current, &output).await?;
            assert_meta(store, &output, &step.id).await?;
            Ok(output)
        }
        StepKind::Branch { .. } if in_branch => {
            Err(Report::new(SourceError).attach_printable("Nested branches are not supported"))
        }
        StepKind::Branch { branches } => {
            for branch in branches {
                let mut branch_table = current.to_owned();
                for inner in branch {
                    match &inner.kind {
                        StepKind::GraphSink { .. } | StepKind::Checkpoint { .. } => {
                            effects.push(on_side_effect(inner, &branch_table).await?);
                        }
                        _ => {
                            branch_table = Box::pin(run_step(
                                store,
                                inner,
                                &branch_table,
                                effects,
                                named_inputs,
                                transforms,
                                true,
                                on_side_effect,
                            ))
                            .await?;
                        }
                    }
                }
            }
            Ok(current.to_owned())
        }
        StepKind::GraphSink { .. } | StepKind::Checkpoint { .. } => {
            effects.push(on_side_effect(step, current).await?);
            Ok(current.to_owned())
        }
    }
}

pub async fn execute_sql_step(
    store: &Store,
    sql: &str,
    input_table: Option<&str>,
    output_table: &str,
    named_inputs: &[NamedInput],
) -> Result<(), Report<SourceError>> {
    if let Some(input) = input_table {
        store
            .exec(&format!(
                "CREATE OR REPLACE VIEW \"input\" AS SELECT * FROM {}",
                qi(input)
            ))
            .await
            .change_context(SourceError)?;
    }
    for named in named_inputs {
        store
            .exec(&format!(
                "CREATE OR REPLACE VIEW {} AS SELECT * FROM {}",
                qi(&named.alias),
                qi(&named.table)
            ))
            .await
            .change_context(SourceError)?;
    }

    let result = store
        .exec(&format!(
            "CREATE OR REPLACE TABLE {} AS {}",
            qi(output_table),
            sql
        ))
        .await
        .change_context(SourceError)
        .attach_printable("SQL step failed");

    let _ = store.exec("DROP VIEW IF EXISTS \"input\"").await;
    for named in named_inputs {
        let _ = store
            .exec(&format!("DROP VIEW IF EXISTS {}", qi(&named.alias)))
            .await;
    }

    result
}

pub async fn assert_meta(
    store: &Store,
    table: &str,
    step_id: &str,
) -> Result<(), Report<SourceError>> {
    let columns = store
        .schema_of(table)
        .await
        .change_context(SourceError)?
        .unwrap_or_default();

    let absent: Vec<&str> = ["_op", "_key", "_before"]
        .into_iter()
        .filter(|meta| !columns.iter().any(|column| column == meta))
        .collect();

    if absent.is_empty() {
        Ok(())
    } else {
        Err(Report::new(SourceError).attach_printable(format!(
            "Step \"{step_id}\" output is missing {}. SELECT _op, _key, _before (may be NULL) from input.",
            absent.join(", ")
        )))
    }
}

const INSERT_CHUNK: usize = 500;

async fn exec_transform(
    store: &Store,
    transform: &Transform,
    input_table: &str,
    output_table: &str,
) -> Result<(), Report<SourceError>> {
    let result = store
        .query(&format!(
            "SELECT * FROM {} ORDER BY \"_key\" NULLS LAST",
            qi(input_table)
        ))
        .await
        .change_context(SourceError)?;

    // Transforms see the full rowset (they may aggregate across rows, TS
    // parity), so this materializes in memory and warns when the rowset
    // is large.
    if result.rows.len() as u64 > crate::config::sync_window(&crate::config::Env::process()) {
        tracing::warn!(
            "fn step materializes {} rows in memory; prefer a sql step for tables this size",
            result.rows.len()
        );
    }

    let out_rows = transform(result.row_maps());

    if out_rows.is_empty() {
        // Clone input shape so downstream sees columns.
        store
            .exec(&format!(
                "CREATE OR REPLACE TABLE {} AS SELECT * FROM {} LIMIT 0",
                qi(output_table),
                qi(input_table)
            ))
            .await
            .change_context(SourceError)?;
        return Ok(());
    }

    write_rows(store, output_table, &out_rows).await
}

async fn write_rows(store: &Store, table: &str, rows: &[Row]) -> Result<(), Report<SourceError>> {
    // A transform may add a field after the first row or emit null first.
    // Infer from the full output and sort names so replay cannot change the
    // DuckDB shape merely because an unordered row happened to arrive first.
    let columns: Vec<String> = rows
        .iter()
        .flat_map(|row| row.keys().cloned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    let column_defs = columns
        .iter()
        .map(|column| {
            if column == "_before" {
                "\"_before\" JSON".to_owned()
            } else {
                format!(
                    "{} {}",
                    qi(column),
                    sql_type(rows.iter().filter_map(|row| row.get(column)))
                )
            }
        })
        .collect::<Vec<_>>()
        .join(", ");

    store
        .exec(&format!(
            "CREATE OR REPLACE TABLE {} ({column_defs})",
            qi(table)
        ))
        .await
        .change_context(SourceError)?;

    for chunk in rows.chunks(INSERT_CHUNK) {
        let placeholders = (0..chunk.len())
            .map(|row_index| {
                let base = row_index * columns.len();
                let cells = (1..=columns.len())
                    .map(|offset| format!("${}", base + offset))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("({cells})")
            })
            .collect::<Vec<_>>()
            .join(", ");

        let params: Vec<Value> = chunk
            .iter()
            .flat_map(|row| {
                columns
                    .iter()
                    .map(|column| encode_param(row.get(column)))
                    .collect::<Vec<_>>()
            })
            .collect();

        store
            .exec_params(
                &format!("INSERT INTO {} VALUES {placeholders}", qi(table)),
                params,
            )
            .await
            .change_context(SourceError)?;
    }

    Ok(())
}

fn sql_type<'a>(values: impl Iterator<Item = &'a Value>) -> &'static str {
    let mut number = false;
    let mut boolean = false;
    let mut json = false;
    let mut string = false;
    for value in values {
        match value {
            Value::Null => {}
            Value::Number(_) => number = true,
            Value::Bool(_) => boolean = true,
            Value::Object(_) | Value::Array(_) => json = true,
            Value::String(_) => string = true,
        }
    }
    match (number, boolean, json, string) {
        (true, false, false, false) => "DOUBLE",
        (false, true, false, false) => "BOOLEAN",
        (false, false, true, false) => "JSON",
        _ => "VARCHAR",
    }
}

fn encode_param(value: Option<&Value>) -> Value {
    match value {
        None | Some(Value::Null) => Value::Null,
        Some(object @ (Value::Object(_) | Value::Array(_))) => Value::String(object.to_string()),
        Some(other) => other.clone(),
    }
}
