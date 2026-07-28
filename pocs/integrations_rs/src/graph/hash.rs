//! Content-hash SQL, byte-identical to the TS/Elixir engines'
//! (golden-tested against the strings it generates): md5 over a struct of
//! exactly the sink-mapped columns. VARCHAR columns mirror the sink's
//! trim/blank-to-null normalization. Any function accessor (coerce, measure)
//! forces the whole-row fallback, and that CHOICE is part of adopted state.

use std::collections::HashMap;

use serde_json::json;
use sha2::{Digest, Sha256};

use crate::build::{Accessor, LinkEntry, SinkConfig};
use crate::store::qi;

pub fn struct_hash_expr(
    columns: &[String],
    column_types: &HashMap<String, String>,
    mut on_missing: impl FnMut(&str),
) -> String {
    if columns.is_empty() {
        return "md5('')".to_owned();
    }

    let fields = columns
        .iter()
        .enumerate()
        .map(|(index, column)| match column_types.get(column) {
            None => {
                on_missing(column);
                format!("p{index} := NULL")
            }
            Some(sql_type) if sql_type == "VARCHAR" => {
                format!("p{index} := NULLIF(TRIM({}), '')", qi(column))
            }
            Some(_) => format!("p{index} := {}", qi(column)),
        })
        .collect::<Vec<_>>()
        .join(", ");

    format!("md5(struct_pack({fields})::VARCHAR)")
}

/// Hash over exactly the columns the sink maps (sorted-by-URL property
/// columns plus provenance-field columns; entityId excluded as the join key).
/// `None` when any accessor is a function: the caller falls back to the
/// whole-row hash.
pub fn canonical_hash_expr(
    config: &SinkConfig,
    column_types: &HashMap<String, String>,
    on_missing: impl FnMut(&str),
) -> Option<String> {
    let mut sorted: Vec<_> = config.properties.iter().collect();
    sorted.sort_by(|(a, _), (b, _)| a.cmp(b));

    let mut accessors: Vec<&Accessor> = sorted.into_iter().map(|(_, accessor)| accessor).collect();
    for field in [
        &config.provenance_fields.authors,
        &config.provenance_fields.first_published,
        &config.provenance_fields.last_updated,
    ]
    .into_iter()
    .flatten()
    {
        accessors.push(field);
    }

    let columns: Option<Vec<String>> = accessors
        .iter()
        .map(|accessor| match accessor {
            Accessor::Column(column) => Some(column.clone()),
            _ => None,
        })
        .collect();

    columns.map(|columns| struct_hash_expr(&columns, column_types, on_missing))
}

/// Whole-row fallback: every non-envelope column, DuckDB row rendering.
pub fn whole_row_hash_sql(entity_id_col: &str, input_table: &str) -> String {
    format!(
        "SELECT {}::VARCHAR AS _entity_id, md5(data::VARCHAR) AS _content_hash FROM (SELECT * EXCLUDE (\"_op\", \"_key\", \"_before\") FROM {}) data",
        qi(entity_id_col),
        qi(input_table),
    )
}

fn accessor_repr(accessor: Option<&Accessor>) -> serde_json::Value {
    match accessor {
        None => serde_json::Value::Null,
        Some(Accessor::Column(column)) => json!(column),
        // Golden fixtures preserve a TypeScript function's exact `toString()`
        // body after `fn:`. Keeping that representation lets a sibling engine
        // adopt function-backed state without an artificial config change.
        Some(Accessor::Coerce { name, column }) if name == "fn" => json!(format!("fn:{column}")),
        Some(Accessor::Coerce { name, column }) => json!(format!("coerce:{name}:{column}")),
        Some(Accessor::Measure {
            amount,
            unit,
            map_name,
        }) => json!(format!("measure:{map_name}:{amount}:{unit}")),
    }
}

/// Portable hash of the operation-shaping config. Column accessors and exact
/// imported `fn:` representations are byte-pinned against the TypeScript
/// engine so cross-engine adoption is not mistaken for a config change.
pub fn sink_config_hash(config: &SinkConfig, connector_id: &str) -> String {
    let mut properties: Vec<_> = config
        .properties
        .iter()
        .map(|(url, accessor)| json!([url, accessor_repr(Some(accessor))]))
        .collect();
    properties.sort_by_key(std::string::ToString::to_string);

    let mut property_fields: Vec<_> = config
        .property_fields
        .iter()
        .map(|(url, column)| json!([url, column]))
        .collect();
    property_fields.sort_by_key(std::string::ToString::to_string);

    let payload = json!({
        "entityType": config.entity_type,
        "entityId": config.entity_id,
        "namespace": config.id_namespace.as_deref().unwrap_or(connector_id),
        "properties": properties,
        "propertyFields": property_fields,
        "provenanceFields": {
            "authors": accessor_repr(config.provenance_fields.authors.as_ref()),
            "firstPublished": accessor_repr(config.provenance_fields.first_published.as_ref()),
            "lastUpdated": accessor_repr(config.provenance_fields.last_updated.as_ref()),
        },
        "provenance": config.provenance,
    });

    hex::encode(Sha256::digest(payload.to_string()))
}

pub fn link_config_hash(entry: &LinkEntry, namespace: &str) -> String {
    let mut properties: Vec<_> = entry
        .properties
        .iter()
        .map(|(url, accessor)| json!([url, accessor_repr(Some(accessor))]))
        .collect();
    properties.sort_by_key(std::string::ToString::to_string);

    let mut property_columns = entry.property_columns.clone();
    property_columns.sort();

    let payload = json!({
        "linkType": entry.link_type,
        "namespace": namespace,
        "from": {"entityType": entry.from.entity_type, "column": entry.from.column},
        "to": {"entityType": entry.to.entity_type, "column": entry.to.column},
        "properties": properties,
        "propertyColumns": property_columns,
    });

    hex::encode(Sha256::digest(payload.to_string()))
}
