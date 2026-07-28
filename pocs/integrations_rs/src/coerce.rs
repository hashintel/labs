//! Value coercions for definition accessors, semantics identical to the
//! TS/Elixir registries. These compile to function accessors, which forces
//! the sink onto the whole-row hash path exactly as in TS; that choice is
//! part of adopted state and must not be "improved" into column expressions.

use std::sync::OnceLock;

use regex::Regex;
use serde_json::{json, Value};

use crate::value::{js_number, js_string, typed_value};

pub const REGISTRY: &[&str] = &[
    "date", "time", "boolean", "number", "integer", "year", "trim",
];

pub fn known(name: &str) -> bool {
    REGISTRY.contains(&name)
}

pub fn apply(name: &str, value: &Value) -> Value {
    match name {
        "date" => coerce_date(value).map_or(Value::Null, Value::String),
        "time" => coerce_time(value).map_or(Value::Null, Value::String),
        "boolean" => json!(coerce_boolean(value)),
        "number" => coerce_number(value).unwrap_or(Value::Null),
        "integer" => match coerce_number(value) {
            Some(Value::Number(number)) => number
                .as_i64()
                .or_else(|| number.as_f64().map(|float| float.trunc() as i64))
                .map_or(Value::Null, |int| json!(int)),
            _ => Value::Null,
        },
        "year" => {
            let text = to_str(value);
            let trimmed = text.trim();
            if trimmed.is_empty() {
                Value::Null
            } else {
                js_number(trimmed).unwrap_or(Value::Null)
            }
        }
        "trim" => match value {
            Value::String(text) => Value::String(text.trim().to_owned()),
            other => other.clone(),
        },
        other => panic!(
            "Unknown coercion \"{other}\". Available: {}",
            REGISTRY.join(", ")
        ),
    }
}

fn re(pattern: &'static str, cell: &'static OnceLock<Regex>) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("static regex"))
}

macro_rules! static_re {
    ($name:ident, $pattern:literal) => {
        fn $name() -> &'static Regex {
            static CELL: OnceLock<Regex> = OnceLock::new();
            re($pattern, &CELL)
        }
    };
}

static_re!(re_iso_date, r"^\d{4}-\d{2}-\d{2}");
static_re!(re_dmy, r"^(\d{2})[./](\d{2})[./](\d{4})$");
static_re!(re_mdy, r"^(\d{2})/(\d{2})/(\d{4})$");
static_re!(re_packed8, r"^\d{8}$");
static_re!(re_yyyy_mm_dd, r"^\d{4}-\d{2}-\d{2}$");
static_re!(re_packed6, r"^\d{6}$");
static_re!(re_hms, r"^\d{2}:\d{2}:\d{2}$");
static_re!(re_hms_frac, r"^\d{2}:\d{2}:\d{2}\.\d+$");
static_re!(re_tz_suffix, r"[Zz+\-]");

pub fn coerce_date(value: &Value) -> Option<String> {
    let text = to_str(value);
    let s = text.trim();

    let result = if s.is_empty() {
        None
    } else if re_iso_date().is_match(s) {
        Some(s[..10].to_owned())
    } else if let Some(captures) = re_dmy().captures(s) {
        from_parts(&captures[1], &captures[2], &captures[3], |d, m, y| {
            format!("{y}-{m}-{d}")
        })
    } else if let Some(captures) = re_mdy().captures(s) {
        from_parts(&captures[1], &captures[2], &captures[3], |m, d, y| {
            format!("{y}-{m}-{d}")
        })
    } else if s == "00000000" {
        None
    } else if re_packed8().is_match(s) {
        Some(format!("{}-{}-{}", &s[..4], &s[4..6], &s[6..8]))
    } else {
        None
    };

    result.filter(|date| re_yyyy_mm_dd().is_match(date))
}

fn from_parts(
    a: &str,
    b: &str,
    year: &str,
    build: impl Fn(&str, &str, &str) -> String,
) -> Option<String> {
    if a == "00" || b == "00" || year == "0000" {
        None
    } else {
        Some(build(a, b, year))
    }
}

pub fn coerce_time(value: &Value) -> Option<String> {
    let text = to_str(value);
    let s = text.trim();

    if s.is_empty() || s == "000000" {
        return None;
    }

    let t = if re_packed6().is_match(s) {
        format!("{}:{}:{}", &s[..2], &s[2..4], &s[4..6])
    } else {
        s.to_owned()
    };

    if re_hms().is_match(&t) {
        Some(format!("{t}+00:00"))
    } else if re_hms_frac().is_match(&t) && !re_tz_suffix().is_match(last6(&t)) {
        Some(format!("{t}+00:00"))
    } else {
        Some(t)
    }
}

fn last6(text: &str) -> &str {
    let len = text.len();
    if len >= 6 {
        &text[len - 6..]
    } else {
        text
    }
}

pub fn coerce_number(value: &Value) -> Option<Value> {
    if value.is_number() {
        return Some(value.clone());
    }

    let text = to_str(value);
    let s = text.trim();

    if s.is_empty() {
        None
    } else if s.contains(',') && comma_after_last_dot(s) {
        // EU format only when the comma sits after the last dot (1.234,56)
        js_number(&s.replace('.', "").replace(',', "."))
    } else {
        js_number(s)
    }
}

fn comma_after_last_dot(text: &str) -> bool {
    let comma = text.find(',').expect("caller checked contains comma") as isize;
    let last_dot = text.rfind('.').map_or(-1, |index| index as isize);
    comma > last_dot
}

pub fn coerce_boolean(value: &Value) -> bool {
    if let Value::Bool(flag) = value {
        return *flag;
    }
    let text = to_str(value);
    matches!(
        text.trim().to_uppercase().as_str(),
        "X" | "TRUE" | "1" | "YES" | "Y"
    )
}

/// The measure accessor: amount coerced as number, unit code looked up in the
/// unit map (`"*"` fallback), result tagged with the data-type id.
pub fn measure(
    row_amount: &Value,
    row_unit: &Value,
    unit_map: &serde_json::Map<String, Value>,
) -> Value {
    let Some(amount) = coerce_number(row_amount) else {
        return Value::Null;
    };

    let unit_text = to_str(row_unit);
    let code = unit_text.trim();

    if !unit_map.contains_key(code) {
        warn_once(code);
    }

    match unit_map
        .get(code)
        .or_else(|| unit_map.get("*"))
        .and_then(Value::as_str)
    {
        None => amount,
        Some(data_type_id) => typed_value(amount, data_type_id),
    }
}

fn to_str(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        other => js_string(other),
    }
}

fn warn_once(code: &str) {
    use std::collections::HashSet;
    use std::sync::Mutex;

    static WARNED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    let warned = WARNED.get_or_init(|| Mutex::new(HashSet::new()));
    if warned
        .lock()
        .expect("measure warn lock")
        .insert(code.to_owned())
    {
        tracing::warn!("[measure] unmapped unit code \"{code}\" -> falling back");
    }
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
    fn date_shapes() {
        assert_eq!(
            coerce_date(&json!("2024-01-15")).as_deref(),
            Some("2024-01-15")
        );
        assert_eq!(
            coerce_date(&json!("2024-01-15T10:00:00Z")).as_deref(),
            Some("2024-01-15")
        );
        assert_eq!(
            coerce_date(&json!("15.01.2024")).as_deref(),
            Some("2024-01-15")
        );
        assert_eq!(
            coerce_date(&json!("15/01/2024")).as_deref(),
            Some("2024-01-15")
        );
        // DMY-first even for slashes is TS byte parity: month 15, shape-only
        // final check.
        assert_eq!(
            coerce_date(&json!("01/15/2024")).as_deref(),
            Some("2024-15-01")
        );
        assert_eq!(
            coerce_date(&json!("20240115")).as_deref(),
            Some("2024-01-15")
        );
        assert_eq!(coerce_date(&json!("00000000")), None);
        assert_eq!(coerce_date(&json!("00.01.2024")), None);
        assert_eq!(coerce_date(&json!("15.01.0000")), None);
        assert_eq!(coerce_date(&json!("")), None);
        assert_eq!(coerce_date(&json!("garbage")), None);
        assert_eq!(
            coerce_date(&json!("  2024-01-15  ")).as_deref(),
            Some("2024-01-15")
        );
    }

    #[test]
    fn time_shapes() {
        assert_eq!(
            coerce_time(&json!("101530")).as_deref(),
            Some("10:15:30+00:00")
        );
        assert_eq!(
            coerce_time(&json!("10:15:30")).as_deref(),
            Some("10:15:30+00:00")
        );
        assert_eq!(
            coerce_time(&json!("10:15:30.5")).as_deref(),
            Some("10:15:30.5+00:00")
        );
        assert_eq!(
            coerce_time(&json!("10:15:30+02:00")).as_deref(),
            Some("10:15:30+02:00")
        );
        assert_eq!(coerce_time(&json!("000000")), None);
        assert_eq!(coerce_time(&json!("")), None);
    }

    #[test]
    fn number_shapes_including_eu() {
        assert_eq!(coerce_number(&json!("1,5")), Some(json!(1.5)));
        assert_eq!(coerce_number(&json!("1.234,56")), Some(json!(1234.56)));
        assert_eq!(
            coerce_number(&json!("1.234.567,89")),
            Some(json!(1_234_567.89))
        );
        // US thousands separators are NOT handled: comma before the last dot
        // means not-EU, and JS Number("1,234.56") is NaN (TS parity).
        assert_eq!(coerce_number(&json!("1,234.56")), None);
        assert_eq!(coerce_number(&json!("42")), Some(json!(42)));
        assert_eq!(coerce_number(&json!("-1.5e3")), Some(json!(-1500.0)));
        assert_eq!(coerce_number(&json!(2)), Some(json!(2)));
        assert_eq!(coerce_number(&json!("")), None);
        assert_eq!(coerce_number(&json!("x")), None);
    }

    #[test]
    fn boolean_and_integer_and_year() {
        for truthy in ["X", "true", "1", "YES", "y"] {
            assert!(coerce_boolean(&json!(truthy)), "{truthy}");
        }
        assert!(!coerce_boolean(&json!("0")));
        assert!(coerce_boolean(&json!(true)));

        assert_eq!(apply("integer", &json!("2.9")), json!(2));
        assert_eq!(apply("year", &json!("2024")), json!(2024));
        assert_eq!(apply("trim", &json!("  x ")), json!("x"));
    }

    #[test]
    fn measure_tags_with_data_type() {
        let map = serde_json::from_value(
            json!({"KG": "https://x/dt/kg/v/1", "*": "https://x/dt/unit/v/1"}),
        )
        .unwrap();
        let tagged = measure(&json!("1,5"), &json!("KG"), &map);
        assert_eq!(tagged["value"], json!(1.5));
        assert_eq!(tagged["dataTypeId"], json!("https://x/dt/kg/v/1"));

        let fallback = measure(&json!("2"), &json!("ZZ"), &map);
        assert_eq!(fallback["dataTypeId"], json!("https://x/dt/unit/v/1"));
    }
}
