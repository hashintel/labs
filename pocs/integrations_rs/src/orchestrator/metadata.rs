use std::collections::BTreeMap;

use error_stack::{Report, ResultExt as _};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::config::Env;
use crate::identity;
use crate::yaml::{self, Source};

use super::DurableError;

/// Versioned task parameters stored in the immutable run input artifact.
/// After V1 freezes, incompatible changes add a variant and normalize through
/// [`CurrentTaskPayload`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data")]
#[non_exhaustive]
pub enum TaskPayload {
    #[serde(rename = "v1")]
    V1(TaskPayloadV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskPayloadV1 {
    /// Raw, unresolved user definition. Placeholders travel to the worker and
    /// known credential-shaped fields are rejected when supplied literally.
    pub definition: Value,
    #[serde(default)]
    pub invocation: InvocationV1,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct InvocationV1 {
    #[serde(default)]
    pub links_only: bool,
    #[serde(default)]
    pub replay: BTreeMap<String, Option<String>>,
}

/// Versioned orchestration metadata stored outside the pipeline definition.
/// V1 is the only pre-release shape and already pins both raw and resolved
/// definition semantics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data")]
#[non_exhaustive]
pub enum TaskMetadata {
    #[serde(rename = "v1")]
    V1(TaskMetadataV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskMetadataV1 {
    pub canonical_integration_id: String,
    pub connector_id: String,
    pub web_id: String,
    pub definition_digest: String,
    /// Pins the fully interpolated semantic definition without persisting
    /// resolved credential values.
    pub resolved_definition_digest: String,
    pub submitted_at: String,
    pub runner_revision: String,
    #[serde(default)]
    pub trigger: SubmissionTriggerV1,
    #[serde(default)]
    pub trace_context: Map<String, Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SubmissionTriggerV1 {
    #[default]
    Manual,
    Api {
        #[serde(default)]
        request_id: Option<String>,
    },
    Schedule {
        schedule_id: String,
        slot: String,
    },
    Event {
        source: String,
        event_id: String,
    },
}

/// The representation consumed by engine code. This normalization boundary is
/// where future retained wire variants will upcast into the current domain.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CurrentTaskPayload {
    pub definition: Value,
    pub invocation: InvocationV1,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CurrentTaskMetadata {
    pub canonical_integration_id: String,
    pub connector_id: String,
    pub web_id: String,
    pub definition_digest: String,
    pub submitted_at: String,
    pub runner_revision: String,
    pub trigger: SubmissionTriggerV1,
    pub trace_context: Map<String, Value>,
    pub resolved_definition_digest: String,
}

impl From<TaskPayload> for CurrentTaskPayload {
    fn from(value: TaskPayload) -> Self {
        match value {
            TaskPayload::V1(v1) => Self {
                definition: v1.definition,
                invocation: v1.invocation,
            },
        }
    }
}

impl From<TaskMetadata> for CurrentTaskMetadata {
    fn from(value: TaskMetadata) -> Self {
        match value {
            TaskMetadata::V1(v1) => Self {
                canonical_integration_id: v1.canonical_integration_id,
                connector_id: v1.connector_id,
                web_id: v1.web_id,
                definition_digest: v1.definition_digest,
                submitted_at: v1.submitted_at,
                runner_revision: v1.runner_revision,
                trigger: v1.trigger,
                trace_context: v1.trace_context,
                resolved_definition_digest: v1.resolved_definition_digest,
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreparedTask {
    pub payload: TaskPayload,
    pub metadata: TaskMetadata,
}

/// Validates a definition at submission time, but persists the unresolved
/// form. Canonical identity and all orchestration metadata are supplied by the
/// runner rather than being injected into the pipeline document.
pub fn prepare_task(
    source: &Source,
    invocation: InvocationV1,
    trigger: SubmissionTriggerV1,
    trace_context: Map<String, Value>,
    env: &Env,
) -> Result<PreparedTask, Report<DurableError>> {
    let raw = yaml::raw(source).change_context(DurableError)?;
    reject_inline_secrets(&raw)?;
    reject_unsafe_env_placeholders(&raw, env)?;
    let web_id = env
        .get("HASH_WEB_ID")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            Report::new(DurableError).attach_printable(
                "HASH_WEB_ID is required for durable submission; refusing an ambiguous canonical identity",
            )
        })?;
    let durable_env = env.durable_interpolation_scope();
    let resolved = yaml::resolve_env(&raw, &durable_env).change_context(DurableError)?;
    let integration = crate::build::build(&resolved, web_id).change_context(DurableError)?;
    if crate::connectors::is_stream_mode(&integration.connector_mode) {
        return Err(Report::new(DurableError).attach_printable(format!(
            "connector mode {} is a continuous stream; protocol V1 accepts batch integrations only",
            integration.connector_mode
        )));
    }
    let id = identity::integration_id(&resolved, web_id);
    let resolved_definition_digest = definition_digest(&resolved).change_context(DurableError)?;
    let definition_digest = definition_digest(&raw).change_context(DurableError)?;

    Ok(PreparedTask {
        payload: TaskPayload::V1(TaskPayloadV1 {
            definition: raw,
            invocation,
        }),
        metadata: TaskMetadata::V1(TaskMetadataV1 {
            canonical_integration_id: id.canonical,
            connector_id: id.connector_id,
            web_id: id.web_id,
            definition_digest,
            resolved_definition_digest,
            submitted_at: chrono::Utc::now().to_rfc3339(),
            runner_revision: env!("CARGO_PKG_VERSION").to_owned(),
            trigger,
            trace_context,
        }),
    })
}

pub(crate) fn definition_digest(value: &Value) -> Result<String, serde_json::Error> {
    let canonical = canonical_json(value);
    Ok(hex::encode(Sha256::digest(serde_json::to_vec(&canonical)?)))
}

fn canonical_json(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let sorted: BTreeMap<_, _> = map
                .iter()
                .map(|(key, value)| (key.clone(), canonical_json(value)))
                .collect();
            Value::Object(sorted.into_iter().collect())
        }
        Value::Array(items) => Value::Array(items.iter().map(canonical_json).collect()),
        other => other.clone(),
    }
}

pub(crate) fn reject_inline_secrets(raw: &Value) -> Result<(), Report<DurableError>> {
    let mut paths = Vec::new();
    find_inline_secrets(raw, "definition", None, &mut paths);
    if paths.is_empty() {
        return Ok(());
    }

    Err(Report::new(DurableError).attach_printable(format!(
        "durable submissions cannot persist literal credentials at {}; replace each value with an allowlisted ${{ENV_VAR}} placeholder",
        paths.join(", ")
    )))
}

pub(crate) fn reject_unsafe_env_placeholders(
    raw: &Value,
    env: &Env,
) -> Result<(), Report<DurableError>> {
    let explicitly_allowed = env
        .get("INTEGRATIONS_ENV_ALLOWLIST")
        .map(|value| value.split(',').map(str::trim).collect::<Vec<_>>())
        .unwrap_or_default();
    let required = required_environment_placeholders(raw);
    let rejected = required
        .into_iter()
        .filter(|name| {
            !explicitly_allowed.contains(&name.as_str())
                && !crate::config::implicitly_exposed_integration_env(name)
        })
        .collect::<std::collections::BTreeSet<_>>();
    if rejected.is_empty() {
        return Ok(());
    }
    Err(Report::new(DurableError).attach_printable(format!(
        "durable definition references environment variable(s) {} that are not exposed to integrations; add the intentional public names to INTEGRATIONS_ENV_ALLOWLIST on submitters and workers",
        rejected.into_iter().collect::<Vec<_>>().join(", ")
    )))
}

/// Environment dependencies excluding self-contained `vars:` bindings. A
/// placeholder inside a vars value still depends on the environment because
/// vars defaults are interpolated before they are added to the lookup table.
pub(crate) fn required_environment_placeholders(raw: &Value) -> std::collections::BTreeSet<String> {
    let declared = raw
        .get("vars")
        .and_then(Value::as_object)
        .map(|vars| {
            vars.keys()
                .cloned()
                .collect::<std::collections::BTreeSet<_>>()
        })
        .unwrap_or_default();
    let mut required = std::collections::BTreeSet::new();
    fn walk(
        value: &Value,
        inside_vars: bool,
        declared: &std::collections::BTreeSet<String>,
        required: &mut std::collections::BTreeSet<String>,
    ) {
        match value {
            Value::String(text) => {
                for captures in crate::yaml::placeholder_re().captures_iter(text) {
                    let name = &captures[1];
                    if inside_vars || !declared.contains(name) {
                        required.insert(name.to_owned());
                    }
                }
            }
            Value::Array(values) => {
                for value in values {
                    walk(value, inside_vars, declared, required);
                }
            }
            Value::Object(values) => {
                for (key, value) in values {
                    let child_inside_vars = inside_vars || key == "vars";
                    walk(&Value::String(key.clone()), inside_vars, declared, required);
                    walk(value, child_inside_vars, declared, required);
                }
            }
            Value::Null | Value::Bool(_) | Value::Number(_) => {}
        }
    }
    walk(raw, false, &declared, &mut required);
    required
}

fn find_inline_secrets(
    value: &Value,
    path: &str,
    parent_key: Option<&str>,
    found: &mut Vec<String>,
) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let child_path = format!("{path}.{key}");
                if let Value::String(text) = child {
                    let credential_scope = path == "definition.connector"
                        || path.starts_with("definition.connector.")
                        || path == "definition.vars"
                        || path.starts_with("definition.vars.");
                    let normalized: String = key
                        .chars()
                        .filter(|character| !matches!(character, '_' | '-'))
                        .flat_map(char::to_lowercase)
                        .collect();
                    let key_is_sensitive = matches!(
                        normalized.as_str(),
                        "password"
                            | "passwd"
                            | "token"
                            | "apikey"
                            | "secret"
                            | "clientsecret"
                            | "accesstoken"
                            | "refreshtoken"
                            | "authorization"
                    );
                    let auth_value =
                        credential_scope && key == "value" && parent_key == Some("auth");
                    let credential_url = credential_scope && url_contains_password(text);
                    let credential_field =
                        (credential_scope && key_is_sensitive) || auth_value || credential_url;
                    if !text.is_empty()
                        && credential_field
                        && !credential_is_placeholder(text, auth_value, credential_url)
                    {
                        found.push(child_path.clone());
                    }
                }
                find_inline_secrets(child, &child_path, Some(key), found);
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                find_inline_secrets(child, &format!("{path}[{index}]"), parent_key, found);
            }
        }
        _ => {}
    }
}

fn credential_is_placeholder(text: &str, auth_value: bool, credential_url: bool) -> bool {
    let placeholder = |value: &str| {
        let value = value.trim();
        crate::yaml::placeholder_re()
            .find(value)
            .is_some_and(|found| found.start() == 0 && found.end() == value.len())
    };
    if placeholder(text) {
        return true;
    }
    if auth_value {
        return text
            .split_once(char::is_whitespace)
            .is_some_and(|(scheme, value)| {
                matches!(scheme.to_ascii_lowercase().as_str(), "bearer" | "basic")
                    && placeholder(value)
            });
    }
    if credential_url {
        let Some((_, rest)) = text.split_once("://") else {
            return false;
        };
        let authority = rest.split(['/', '?', '#']).next().unwrap_or(rest);
        return authority
            .split_once('@')
            .and_then(|(userinfo, _)| userinfo.split_once(':'))
            .is_some_and(|(_, password)| placeholder(password));
    }
    false
}

fn url_contains_password(value: &str) -> bool {
    let Some((_, rest)) = value.split_once("://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    authority
        .split_once('@')
        .is_some_and(|(userinfo, _)| userinfo.contains(':'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v1_wire_shape_is_explicit_and_normalizes() {
        let metadata = TaskMetadata::V1(TaskMetadataV1 {
            canonical_integration_id: "web:source".to_owned(),
            connector_id: "source".to_owned(),
            web_id: "web".to_owned(),
            definition_digest: "abc".to_owned(),
            resolved_definition_digest: "def".to_owned(),
            submitted_at: "2026-07-10T12:00:00Z".to_owned(),
            runner_revision: "0.1.0".to_owned(),
            trigger: SubmissionTriggerV1::Manual,
            trace_context: Map::new(),
        });

        let encoded = serde_json::to_value(&metadata).expect("metadata serializes");
        assert_eq!(encoded["version"], "v1");
        assert_eq!(encoded["data"]["canonical_integration_id"], "web:source");

        let decoded: TaskMetadata = serde_json::from_value(encoded).expect("metadata decodes");
        let current = CurrentTaskMetadata::from(decoded);
        assert_eq!(current.canonical_integration_id, "web:source");
    }

    #[test]
    fn v1_optional_audit_fields_have_defaults() {
        let decoded: TaskMetadata = serde_json::from_value(serde_json::json!({
            "version": "v1",
            "data": {
                "canonical_integration_id": "web:source",
                "connector_id": "source",
                "web_id": "web",
                "definition_digest": "abc",
                "resolved_definition_digest": "def",
                "submitted_at": "2026-07-10T12:00:00Z",
                "runner_revision": "0.1.0"
            }
        }))
        .expect("V1 metadata decodes with audit defaults");
        let current = CurrentTaskMetadata::from(decoded);
        assert_eq!(current.trigger, SubmissionTriggerV1::Manual);
        assert!(current.trace_context.is_empty());
    }

    #[test]
    fn definition_digest_survives_json_object_key_reordering() {
        let first = serde_json::json!({
            "connector": { "id": "source", "mode": "batch" },
            "vars": { "B": 2, "A": 1 }
        });
        let second = serde_json::json!({
            "vars": { "A": 1, "B": 2 },
            "connector": { "mode": "batch", "id": "source" }
        });
        assert_eq!(
            definition_digest(&first).expect("first digest"),
            definition_digest(&second).expect("second digest")
        );
    }

    #[test]
    fn unknown_versions_fail_loudly_instead_of_misinterpreting_data() {
        let error = serde_json::from_value::<TaskMetadata>(serde_json::json!({
            "version": "v99",
            "data": {}
        }))
        .expect_err("future metadata must not be misinterpreted");
        assert!(error.to_string().contains("unknown variant"));
    }

    #[test]
    fn durable_payload_rejects_literal_credentials_but_accepts_placeholders() {
        let literal = serde_json::json!({
            "connector": {
                "endpoints": {
                    "items": { "auth": { "type": "bearer", "token": "hunter2" } }
                }
            }
        });
        let error = reject_inline_secrets(&literal).expect_err("literal token must be rejected");
        assert!(format!("{error:?}").contains("definition.connector.endpoints.items.auth.token"));

        let placeholder = serde_json::json!({
            "connector": {
                "url": "postgres://user:${PASSWORD}@database/app",
                "endpoints": {
                    "items": { "auth": { "type": "bearer", "token": "${TOKEN}" } }
                }
            }
        });
        reject_inline_secrets(&placeholder).expect("placeholders are safe to persist");

        let mixed = serde_json::json!({
            "connector": {"auth": {"value": "Bearer sk_live_literal ${TOKEN}"}},
            "vars": {"nested": {"password": "literal"}}
        });
        let error = reject_inline_secrets(&mixed).expect_err("mixed/nested literals must fail");
        let rendered = format!("{error:?}");
        assert!(rendered.contains("definition.connector.auth.value"));
        assert!(rendered.contains("definition.vars.nested.password"));
    }

    #[test]
    fn secret_bearing_environment_placeholders_require_explicit_permission() {
        let raw = serde_json::json!({
            "connector": {"auth": {"value": "Bearer ${SERVICE_TOKEN}"}}
        });
        let env = Env::from_map(std::collections::HashMap::from([(
            "SERVICE_TOKEN".to_owned(),
            "resolved-but-never-persisted".to_owned(),
        )]));
        let error = reject_unsafe_env_placeholders(&raw, &env)
            .expect_err("secret-bearing names fail closed by default");
        assert!(format!("{error:?}").contains("SERVICE_TOKEN"));

        let allowed = Env::from_map(std::collections::HashMap::from([
            (
                "SERVICE_TOKEN".to_owned(),
                "resolved-but-never-persisted".to_owned(),
            ),
            (
                "INTEGRATIONS_ENV_ALLOWLIST".to_owned(),
                "SERVICE_TOKEN".to_owned(),
            ),
        ]));
        reject_unsafe_env_placeholders(&raw, &allowed)
            .expect("operators can explicitly permit an intentional secret placeholder");
    }

    #[test]
    fn durable_submission_requires_explicit_web_identity() {
        let error = prepare_task(
            &Source::Definition(serde_json::json!({})),
            InvocationV1::default(),
            SubmissionTriggerV1::Manual,
            Map::new(),
            &Env::from_map(std::collections::HashMap::new()),
        )
        .expect_err("missing web identity must fail before ambiguous admission");
        assert!(format!("{error:?}").contains("HASH_WEB_ID is required"));
    }

    #[test]
    fn protocol_v1_submission_rejects_streams() {
        let env = Env::from_map(std::collections::HashMap::from([(
            "HASH_WEB_ID".to_owned(),
            "alice".to_owned(),
        )]));
        let definition = serde_json::json!({
            "connector": { "id": "streamer", "mode": "cdc" },
            "sources": {
                "users": { "kind": "table", "primaryKey": "id" }
            },
            "pipelines": {
                "entities": [{
                    "source": "users",
                    "steps": [{
                        "id": "sink-users",
                        "kind": "graph-sink",
                        "config": {
                            "entityType": "https://example.test/types/entity-type/user/v/1",
                            "entityId": "id",
                            "webId": "alice",
                            "properties": {}
                        }
                    }]
                }]
            }
        });
        let error = prepare_task(
            &Source::Definition(definition),
            InvocationV1::default(),
            SubmissionTriggerV1::Manual,
            Map::new(),
            &env,
        )
        .expect_err("clean protocol must reject stream definitions");
        let diagnostic = format!("{error:?}");
        assert!(diagnostic.contains("protocol V1 accepts batch integrations only"));
    }

    #[test]
    fn new_submissions_pin_resolved_semantics_without_storing_resolved_values() {
        let env = Env::from_map(
            [
                ("HASH_WEB_ID".to_owned(), "alice".to_owned()),
                ("SEMANTIC_VALUE".to_owned(), "first".to_owned()),
                (
                    "INTEGRATIONS_ENV_ALLOWLIST".to_owned(),
                    "SEMANTIC_VALUE".to_owned(),
                ),
            ]
            .into_iter()
            .collect(),
        );
        let raw = serde_json::json!({
            "connector": { "id": "semantic-test", "mode": "batch" },
            "vars": { "VALUE": "${SEMANTIC_VALUE}" },
            "sources": {},
            "pipelines": { "entities": [] }
        });
        let prepared = prepare_task(
            &Source::Definition(raw.clone()),
            InvocationV1::default(),
            SubmissionTriggerV1::Manual,
            Map::new(),
            &env,
        )
        .expect("valid durable definition");

        let TaskPayload::V1(payload) = prepared.payload;
        assert_eq!(payload.definition, raw, "receipt keeps unresolved YAML");
        let TaskMetadata::V1(metadata) = prepared.metadata;
        assert_ne!(
            metadata.definition_digest,
            metadata.resolved_definition_digest
        );
    }

    #[test]
    fn durable_local_vars_cannot_be_overridden_by_unexposed_process_values() {
        let env = Env::from_map(std::collections::HashMap::from([
            ("HASH_WEB_ID".to_owned(), "alice".to_owned()),
            (
                "TYPES".to_owned(),
                "https://attacker.invalid/types".to_owned(),
            ),
        ]));
        let raw = serde_json::json!({
            "connector": {"id": "local-vars", "mode": "batch"},
            "vars": {"TYPES": "https://example.test/types"},
            "sources": {},
            "pipelines": {"entities": []},
            "marker": "${TYPES}"
        });
        assert!(required_environment_placeholders(&raw).is_empty());

        let prepared = prepare_task(
            &Source::Definition(raw.clone()),
            InvocationV1::default(),
            SubmissionTriggerV1::Manual,
            Map::new(),
            &env,
        )
        .expect("self-contained vars require no environment permission");
        let TaskMetadata::V1(metadata) = prepared.metadata;
        let resolved = yaml::resolve_env(&raw, &env.durable_interpolation_scope())
            .expect("self-contained vars resolve");
        assert_eq!(resolved["marker"], "https://example.test/types");
        assert_eq!(
            metadata.resolved_definition_digest,
            definition_digest(&resolved).expect("resolved definition hashes")
        );
    }
}
