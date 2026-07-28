//! Integration definitions: loading, and `${KEY}` interpolation. Precedence
//! matches the TS runner: the `vars:` block supplies defaults, a same-named
//! env var overrides each, and `vars` values are themselves interpolated
//! against the environment. Interpolation applies to every string value AND
//! every map key, and sees only the allowlisted environment
//! (`config::interpolation_env`): definitions are user-authorable, and
//! unrestricted `${}` would exfiltrate node secrets. A placeholder with no
//! binding fails with the TS message shape.

use std::collections::HashMap;
use std::path::Path;

use error_stack::{Report, ResultExt as _};
use serde_json::Value;

use crate::config::{self, Env};
use crate::error::ConfigError;

/// An integration definition from any of its shapes: an already-decoded map
/// (definitions arrive over requests), inline YAML content, or a path to a
/// file (dev/CLI convenience; a string is a path iff a regular file exists
/// there). Returns the resolved definition; [`raw`] returns it UNRESOLVED,
/// which is what gets persisted or enqueued: placeholders remain unresolved.
/// Literal values remain literal, so persistence boundaries must validate
/// their own secret policy.
pub fn load(source: &Source, env: &Env) -> Result<Value, Report<ConfigError>> {
    let raw = raw(source)?;
    resolve_env(&raw, env)
}

#[derive(Debug, Clone)]
pub enum Source {
    Definition(Value),
    Text(String),
}

impl Source {
    /// CLI/dev entry: a string that names an existing file is a path,
    /// anything else is inline YAML content.
    pub fn from_arg(arg: &str) -> Self {
        Self::Text(arg.to_owned())
    }
}

impl From<Value> for Source {
    fn from(definition: Value) -> Self {
        Self::Definition(definition)
    }
}

pub fn raw(source: &Source) -> Result<Value, Report<ConfigError>> {
    match source {
        Source::Definition(value) if value.is_object() => Ok(value.clone()),
        Source::Definition(_) => Err(Report::new(ConfigError::bare(
            "integration definition must be a mapping",
        ))),
        Source::Text(text) => {
            let (content, label) = if Path::new(text).is_file() {
                let content = std::fs::read_to_string(text)
                    .change_context(ConfigError::bare("cannot read integration definition"))
                    .attach_printable(format!("path: {text}"))?;
                (content, text.as_str())
            } else {
                (text.clone(), "definition")
            };

            match serde_yaml::from_str::<Value>(&content) {
                Ok(yaml) if yaml.is_object() => Ok(yaml),
                Ok(_) => Err(Report::new(ConfigError::bare(
                    "integration definition must be a YAML mapping (got a scalar; missing file?)",
                ))),
                Err(err) => Err(Report::new(err)
                    .change_context(ConfigError::bare("cannot parse integration definition"))
                    .attach_printable(format!("source: {label}"))),
            }
        }
    }
}

pub fn resolve_env(yaml: &Value, env: &Env) -> Result<Value, Report<ConfigError>> {
    let visible = config::interpolation_env(env);

    let mut lookup: HashMap<String, String> = HashMap::new();
    if let Some(declared) = yaml.get("vars").and_then(Value::as_object) {
        for (name, value) in declared {
            if let Some(text) = value.as_str() {
                lookup.insert(name.clone(), interpolate(text, &visible)?);
            }
        }
    }
    lookup.extend(visible);

    walk(yaml, &lookup)
}

pub fn interpolate(
    text: &str,
    lookup: &HashMap<String, String>,
) -> Result<String, Report<ConfigError>> {
    let re = placeholder_re();
    let mut out = String::with_capacity(text.len());
    let mut last = 0;

    for captures in re.captures_iter(text) {
        let whole = captures.get(0).expect("capture 0 always present");
        let key = &captures[1];
        out.push_str(&text[last..whole.start()]);

        match lookup.get(key) {
            Some(value) => out.push_str(value),
            // Message shape is TS parity; the exception type is the
            // user-fault surface.
            None => {
                return Err(Report::new(ConfigError::bare(format!(
                    "Missing env var: {key}"
                ))));
            }
        }

        last = whole.end();
    }

    out.push_str(&text[last..]);
    Ok(out)
}

pub fn placeholder_re() -> &'static regex::Regex {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"\$\{([^}]+)\}").expect("static regex"))
}

fn walk(value: &Value, lookup: &HashMap<String, String>) -> Result<Value, Report<ConfigError>> {
    match value {
        Value::String(text) => Ok(Value::String(interpolate(text, lookup)?)),
        Value::Array(items) => Ok(Value::Array(
            items
                .iter()
                .map(|item| walk(item, lookup))
                .collect::<Result<_, _>>()?,
        )),
        Value::Object(map) => {
            let mut out = serde_json::Map::with_capacity(map.len());
            for (key, item) in map {
                out.insert(interpolate(key, lookup)?, walk(item, lookup)?);
            }
            Ok(Value::Object(out))
        }
        other => Ok(other.clone()),
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
    use serde_json::json;

    fn env(pairs: &[(&str, &str)]) -> Env {
        Env::from_map(
            pairs
                .iter()
                .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
                .collect(),
        )
    }

    #[test]
    fn env_overrides_vars_and_vars_interpolate_against_env() {
        let yaml = json!({
            "vars": {"SITE": "SITE-A", "BASE": "${ROOT}/data"},
            "sql": "WHERE plant = '${SITE}' AND path = '${BASE}'"
        });

        let resolved = resolve_env(&yaml, &env(&[("ROOT", "/srv"), ("SITE", "OVERRIDE")])).unwrap();
        assert_eq!(
            resolved["sql"],
            json!("WHERE plant = 'OVERRIDE' AND path = '/srv/data'")
        );
    }

    #[test]
    fn interpolates_map_keys_too() {
        let yaml = json!({"properties": {"${BASE}/property-type/name/v/1": "NAME"}});
        let resolved = resolve_env(&yaml, &env(&[("BASE", "https://x")])).unwrap();
        assert!(resolved["properties"]
            .as_object()
            .unwrap()
            .contains_key("https://x/property-type/name/v/1"));
    }

    #[test]
    fn missing_env_var_fails_with_the_ts_message_shape() {
        let err = resolve_env(&json!({"a": "${NOPE}"}), &env(&[])).unwrap_err();
        assert_eq!(err.current_context().to_string(), "Missing env var: NOPE");
    }

    #[test]
    fn allowlist_scopes_interpolation() {
        let scoped = env(&[
            ("SECRET", "hunter2"),
            ("SITE", "A"),
            ("INTEGRATIONS_ENV_ALLOWLIST", "SITE"),
        ]);

        let resolved = resolve_env(&json!({"a": "${SITE}"}), &scoped).unwrap();
        assert_eq!(resolved["a"], json!("A"));

        let err = resolve_env(&json!({"a": "${SECRET}"}), &scoped).unwrap_err();
        assert_eq!(err.current_context().to_string(), "Missing env var: SECRET");
    }

    #[test]
    fn inline_yaml_and_non_maps_are_distinguished() {
        let inline = Source::Text("connector:\n  id: c\n".to_owned());
        assert_eq!(raw(&inline).unwrap()["connector"]["id"], json!("c"));

        let scalar = Source::Text("nonexistent.yaml".to_owned());
        let err = raw(&scalar).unwrap_err();
        assert!(err
            .current_context()
            .to_string()
            .contains("must be a YAML mapping"));
    }
}
