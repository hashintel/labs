//! Sink accessors: a plain column name, or a tagged transform. Tagged forms
//! count as non-column for hash-path selection (forcing the whole-row
//! fallback exactly as in TS), but hash into the config deterministically and
//! evaluate without closures. `resolve_audited` additionally classifies
//! conversion failures for the DLQ: a conversion FAILS iff the raw input is
//! non-blank and the result is null. boolean and trim never fail; an unmapped
//! measure unit is not a failure (the amount passes through, warn-once).

use serde_json::{Map, Value};

use crate::coerce;
use crate::definition::Accessor;
use crate::value::{js_string, Row};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Audit {
    pub raw: String,
    pub coercion: String,
    pub reason: String,
}

const FALLIBLE_COERCIONS: &[&str] = &["date", "time", "number", "integer", "year"];

pub fn resolve(accessor: &Accessor, row: &Row, unit_maps: &Map<String, Value>) -> Value {
    resolve_audited(accessor, row, unit_maps).0
}

pub fn resolve_audited(
    accessor: &Accessor,
    row: &Row,
    unit_maps: &Map<String, Value>,
) -> (Value, Option<Audit>) {
    match accessor {
        Accessor::Column(column) => (row.get(column).cloned().unwrap_or(Value::Null), None),

        Accessor::Coerce { name, column } => {
            let raw = row.get(column).cloned().unwrap_or(Value::Null);
            let value = coerce::apply(name, &raw);

            if value.is_null() && FALLIBLE_COERCIONS.contains(&name.as_str()) && !blank(&raw) {
                let audit = Audit {
                    raw: js_string(&raw),
                    coercion: format!("coerce:{name}"),
                    reason: format!("coerce:{name} produced nil"),
                };
                (Value::Null, Some(audit))
            } else {
                (value, None)
            }
        }

        Accessor::Measure {
            amount,
            unit,
            map_name,
        } => {
            let raw = row.get(amount).cloned().unwrap_or(Value::Null);
            let unit_map = unit_maps
                .get(map_name)
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let value = coerce::measure(&raw, row.get(unit).unwrap_or(&Value::Null), &unit_map);

            if value.is_null() && !blank(&raw) {
                let audit = Audit {
                    raw: js_string(&raw),
                    coercion: format!("measure:{map_name}"),
                    reason: "measure amount not numeric".to_owned(),
                };
                (Value::Null, Some(audit))
            } else {
                (value, None)
            }
        }
    }
}

fn blank(value: &Value) -> bool {
    match value {
        Value::Null => true,
        other => js_string(other).trim().is_empty(),
    }
}
