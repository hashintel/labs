//! Cell values and JS rendering parity. Rows are string-keyed maps of
//! `serde_json::Value`; a value carrying a HASH data-type id travels in the
//! `$typedValue` tagged shape (the TS replacer/reviver wire format), which is
//! also its JSON-staging representation, so there is exactly one encoding.

use serde_json::{json, Value};

pub type Row = serde_json::Map<String, Value>;

pub fn typed_value(value: Value, data_type_id: &str) -> Value {
    json!({"$typedValue": true, "value": value, "dataTypeId": data_type_id})
}

/// `(inner value, data type id)` when tagged; identity otherwise.
pub fn unwrap_typed(value: &Value) -> (Value, Option<String>) {
    match value {
        Value::Object(map) if map.get("$typedValue") == Some(&Value::Bool(true)) => (
            map.get("value").cloned().unwrap_or(Value::Null),
            map.get("dataTypeId")
                .and_then(Value::as_str)
                .map(str::to_owned),
        ),
        other => (other.clone(), None),
    }
}

/// JS `String()` rendering for the id position: integral floats drop the
/// `.0`, null renders as "null". This byte sequence feeds deterministic
/// UUIDs and must never drift.
pub fn js_string(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => "null".to_owned(),
        Value::Bool(true) => "true".to_owned(),
        Value::Bool(false) => "false".to_owned(),
        Value::Number(number) => {
            if let Some(int) = number.as_i64() {
                int.to_string()
            } else if let Some(float) = number.as_f64() {
                js_float_string(float)
            } else {
                number.to_string()
            }
        }
        other => other.to_string(),
    }
}

/// JS `String(1.0)` is "1", not "1.0"; non-integral floats use the shortest
/// roundtrip rendering (Rust's default matches JS for the doubles pipelines
/// see).
pub fn js_float_string(float: f64) -> String {
    if float.fract() == 0.0 && float.is_finite() && float.abs() < 1e15 {
        format!("{}", float as i64)
    } else {
        format!("{float}")
    }
}

/// JS `Number(s)` for the string shapes pipelines see: optional sign, decimal
/// or float, scientific notation. Integral strings become integers (JSON
/// renders identically to JS); NaN cases are `None`.
pub fn js_number(text: &str) -> Option<Value> {
    let trimmed = text.trim();
    if let Ok(int) = trimmed.parse::<i64>() {
        return Some(json!(int));
    }
    let float: f64 = trimmed.parse().ok()?;
    float.is_finite().then(|| json!(float))
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
mod tests {
    use super::*;

    #[test]
    fn js_string_parity() {
        assert_eq!(js_string(&json!("x")), "x");
        assert_eq!(js_string(&json!(7)), "7");
        assert_eq!(js_string(&json!(1.0)), "1");
        assert_eq!(js_string(&json!(1.5)), "1.5");
        assert_eq!(js_string(&Value::Null), "null");
        assert_eq!(js_string(&json!(true)), "true");
    }

    #[test]
    fn typed_values_round_trip() {
        let tagged = typed_value(json!(1.5), "https://x/dt/kg/v/1");
        let (value, data_type) = unwrap_typed(&tagged);
        assert_eq!(value, json!(1.5));
        assert_eq!(data_type.as_deref(), Some("https://x/dt/kg/v/1"));

        let (plain, none) = unwrap_typed(&json!("v"));
        assert_eq!(plain, json!("v"));
        assert!(none.is_none());
    }
}
