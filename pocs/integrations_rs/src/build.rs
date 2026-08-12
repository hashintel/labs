//! Definition (YAML/JSON) to engine structures, ported from the TS/Elixir
//! builders. Accessors become columns or tagged transforms; tagged accessors
//! count as non-column for hash-path selection, exactly like TS function
//! accessors. `build` runs `validate` first and returns one `ConfigError`
//! carrying every issue found (paths included), so an author fixes a config
//! in a single pass; lints (TRY_CAST, unknown keys) warn without failing.

use std::collections::HashMap;

use error_stack::Report;
use serde_json::{Map, Value};

use crate::coerce;
use crate::error::{ConfigError, Issue};
use crate::secret::Secret;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Accessor {
    Column(String),
    Coerce {
        name: String,
        column: String,
    },
    Measure {
        amount: String,
        unit: String,
        map_name: String,
    },
}

impl Accessor {
    pub fn column(&self) -> Option<&str> {
        match self {
            Self::Column(column) => Some(column),
            Self::Coerce { column, .. } => Some(column),
            Self::Measure { amount, .. } => Some(amount),
        }
    }

    pub fn is_column(&self) -> bool {
        matches!(self, Self::Column(_))
    }
}

#[derive(Debug, Clone, Default)]
pub struct ProvenanceFields {
    pub authors: Option<Accessor>,
    pub first_published: Option<Accessor>,
    pub last_updated: Option<Accessor>,
}

#[derive(Debug, Clone)]
pub struct SinkConfig {
    pub entity_type: String,
    pub entity_id: String,
    pub web_id: String,
    pub id_namespace: Option<String>,
    pub properties: Vec<(String, Accessor)>,
    pub property_fields: Vec<(String, String)>,
    pub provenance: Option<Value>,
    pub provenance_fields: ProvenanceFields,
}

#[derive(Debug, Clone)]
pub struct Step {
    pub id: String,
    pub kind: StepKind,
}

#[derive(Debug, Clone)]
pub enum StepKind {
    Sql { sql: String },
    Fn { transform: String },
    Checkpoint { name: String },
    Branch { branches: Vec<Vec<Step>> },
    GraphSink { config: SinkConfig },
}

#[derive(Debug, Clone)]
pub struct SourceDef {
    pub kind: SourceKind,
    pub partial: bool,
    pub archive_on_empty: bool,
    pub provenance: Option<Value>,
    pub asserts: Option<Value>,
}

#[derive(Debug, Clone)]
pub enum SourceKind {
    Sql {
        sql: String,
        primary_key: Vec<String>,
        extensions: Vec<String>,
    },
    Checkpoint {
        name: String,
    },
    External {
        key: Option<String>,
        primary_key: Vec<String>,
    },
    Table {
        primary_key: Vec<String>,
    },
    Rest {
        endpoint: crate::secret::Secret<Value>,
        primary_key: Vec<String>,
    },
}

impl SourceKind {
    pub fn primary_key(&self) -> &[String] {
        match self {
            Self::Sql { primary_key, .. }
            | Self::External { primary_key, .. }
            | Self::Table { primary_key }
            | Self::Rest { primary_key, .. } => primary_key,
            Self::Checkpoint { .. } => &[],
        }
    }
}

#[derive(Debug, Clone)]
pub struct Pipeline {
    pub source: String,
    pub depends_on: Vec<String>,
    pub inputs: Vec<(String, String)>,
    pub steps: Vec<Step>,
}

#[derive(Debug, Clone)]
pub struct EndpointRef {
    pub entity_type: String,
    pub column: String,
}

#[derive(Debug, Clone)]
pub struct LinkEntry {
    pub id: String,
    pub web_id: String,
    pub id_namespace: Option<String>,
    pub source: String,
    pub inputs: Vec<(String, String)>,
    pub steps: Vec<Step>,
    pub from: EndpointRef,
    pub to: EndpointRef,
    pub link_type: String,
    pub properties: Vec<(String, Accessor)>,
    pub property_columns: Vec<String>,
    pub provenance: Option<Value>,
}

#[derive(Debug, Clone)]
pub struct Integration {
    pub connector_id: String,
    pub connector_mode: String,
    /// Carries source credentials (CDC/mongo urls, endpoint auth); redacted
    /// in every Debug rendering by construction.
    pub connector_config: Secret<Value>,
    pub id_namespace: Option<String>,
    pub connector_provenance: Option<Value>,
    pub sources: HashMap<String, SourceDef>,
    pub pipelines: Vec<Pipeline>,
    pub link_pipelines: Vec<LinkEntry>,
    pub unit_maps: Map<String, Value>,
}

const BATCH_SOURCE_KINDS: &[&str] = &["sql", "checkpoint", "external", "table"];
const STEP_KINDS: &[&str] = &["sql", "fn", "checkpoint", "branch", "graph-sink"];

pub fn stream_modes() -> &'static [&'static str] {
    &["webhook", "cdc", "mongo-stream"]
}

pub fn build(yaml: &Value, web_id: &str) -> Result<Integration, Report<ConfigError>> {
    let issues = shape_issues(yaml, web_id);
    if !issues.is_empty() {
        return Err(Report::new(ConfigError::new(issues)));
    }

    let integration = construct(yaml, web_id);
    crate::engine::topology::sort_pipelines(&integration.pipelines)
        .map_err(|message| Report::new(ConfigError::new(vec![Issue::new("pipelines", message)])))?;

    lint_try_cast(yaml);
    lint_unknown_keys(yaml);
    Ok(integration)
}

pub fn validate(yaml: &Value, web_id: &str) -> Vec<Issue> {
    let issues = shape_issues(yaml, web_id);
    if !issues.is_empty() {
        return issues;
    }
    let integration = construct(yaml, web_id);
    match crate::engine::topology::sort_pipelines(&integration.pipelines) {
        Ok(_) => vec![],
        Err(message) => vec![Issue::new("pipelines", message)],
    }
}

fn obj<'a>(value: &'a Value, key: &str) -> Option<&'a Map<String, Value>> {
    value.get(key).and_then(Value::as_object)
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn blank(value: Option<&Value>) -> bool {
    !matches!(value, Some(Value::String(text)) if !text.is_empty())
}

fn invalid_primary_key(value: Option<&Value>) -> bool {
    match value {
        Some(Value::String(column)) => column.is_empty(),
        Some(Value::Array(columns)) => {
            columns.is_empty()
                || columns
                    .iter()
                    .any(|column| !matches!(column, Value::String(name) if !name.is_empty()))
        }
        _ => true,
    }
}

fn shape_issues(yaml: &Value, web_id: &str) -> Vec<Issue> {
    let Some(connector) = yaml.get("connector").filter(|value| value.is_object()) else {
        return vec![Issue::new("connector", "required")];
    };
    let mode = text(connector, "mode").unwrap_or("batch");

    let mut issues = vec![];

    match text(connector, "id") {
        Some("") => issues.push(Issue::new("connector.id", "required")),
        Some(id) if !crate::identity::is_safe_state_component(id) => issues.push(Issue::new(
            "connector.id",
            "must be one safe path component (no '/', '\\', '.' or '..')",
        )),
        Some(_) => {}
        None => issues.push(Issue::new("connector.id", "must be a non-empty string")),
    }

    if connector.get("mode").is_some() && text(connector, "mode").is_none() {
        issues.push(Issue::new("connector.mode", "must be a string"));
    }

    if mode == "rest-api" {
        issues.extend(endpoint_issues(connector));
    } else if mode == "webhook" {
        issues.extend(webhook_issues(connector));
    } else if mode != "batch" && !stream_modes().contains(&mode) {
        issues.push(Issue::new(
            "connector.mode",
            format!("unknown mode \"{mode}\""),
        ));
    }

    let declared = source_names(yaml, connector, mode);
    issues.extend(sources_issues(yaml));
    issues.extend(pipelines_issues(yaml, &declared));
    issues.extend(link_issues(yaml, web_id));
    issues
}

fn webhook_issues(connector: &Value) -> Vec<Issue> {
    let mut issues = Vec::new();
    match text(connector, "provider") {
        Some("github" | "slack" | "linear" | "notion") => {}
        Some(provider) => issues.push(Issue::new(
            "connector.provider",
            format!("unsupported webhook provider \"{provider}\""),
        )),
        None => issues.push(Issue::new(
            "connector.provider",
            "required for mode webhook",
        )),
    }
    match connector.get("subscriptions").and_then(Value::as_array) {
        Some(values)
            if !values.is_empty()
                && values
                    .iter()
                    .all(|value| value.as_str().is_some_and(|name| !name.is_empty())) => {}
        _ => issues.push(Issue::new(
            "connector.subscriptions",
            "must be a non-empty array of event selectors",
        )),
    }
    issues
}

fn endpoint_issues(connector: &Value) -> Vec<Issue> {
    match obj(connector, "endpoints").filter(|endpoints| !endpoints.is_empty()) {
        None => vec![Issue::new(
            "connector.endpoints",
            "required for mode rest-api",
        )],
        Some(endpoints) => endpoints
            .iter()
            .flat_map(|(name, endpoint)| {
                let path = format!("connector.endpoints.{name}");
                let mut issues = vec![];
                if blank(endpoint.get("url")) {
                    issues.push(Issue::new(format!("{path}.url"), "required"));
                }
                if invalid_primary_key(endpoint.get("primaryKey")) {
                    issues.push(Issue::new(format!("{path}.primaryKey"), "required"));
                }
                issues
            })
            .collect(),
    }
}

fn source_names(yaml: &Value, connector: &Value, mode: &str) -> Vec<String> {
    let mut names: Vec<String> = obj(yaml, "sources")
        .map(|sources| sources.keys().cloned().collect())
        .unwrap_or_default();
    if mode == "rest-api" {
        if let Some(endpoints) = obj(connector, "endpoints") {
            names.extend(endpoints.keys().cloned());
        }
    }
    names
}

fn sources_issues(yaml: &Value) -> Vec<Issue> {
    let Some(sources) = obj(yaml, "sources") else {
        return vec![];
    };

    sources
        .iter()
        .flat_map(|(name, source)| {
            let path = format!("sources.{name}");
            let mut issues = vec![];

            match text(source, "kind") {
                Some("sql") => {
                    if blank(source.get("sql")) {
                        issues.push(Issue::new(format!("{path}.sql"), "required"));
                    }
                    if invalid_primary_key(source.get("primaryKey")) {
                        issues.push(Issue::new(format!("{path}.primaryKey"), "required"));
                    }
                }
                Some("checkpoint") => {
                    if blank(source.get("name")) {
                        issues.push(Issue::new(format!("{path}.name"), "required"));
                    }
                }
                Some("table") => {
                    if invalid_primary_key(source.get("primaryKey")) {
                        issues.push(Issue::new(format!("{path}.primaryKey"), "required"));
                    }
                }
                Some("external") => {}
                other => issues.push(Issue::new(
                    format!("{path}.kind"),
                    format!(
                        "unknown kind {other:?}; expected one of {}",
                        BATCH_SOURCE_KINDS.join(", ")
                    ),
                )),
            }

            let denied: Vec<&str> = source
                .get("extensions")
                .and_then(Value::as_array)
                .map(|extensions| {
                    extensions
                        .iter()
                        .filter_map(Value::as_str)
                        .filter(|ext| !crate::config::duckdb_extension_allowlist().contains(ext))
                        .collect()
                })
                .unwrap_or_default();
            if !denied.is_empty() {
                issues.push(Issue::new(
                    format!("{path}.extensions"),
                    format!("not allowlisted: {}", denied.join(", ")),
                ));
            }

            issues
        })
        .collect()
}

fn pipelines_issues(yaml: &Value, declared: &[String]) -> Vec<Issue> {
    let unit_maps = obj(yaml, "unitMaps").cloned().unwrap_or_default();

    let Some(pipelines) = yaml
        .get("pipelines")
        .and_then(|pipelines| pipelines.get("entities"))
        .and_then(Value::as_array)
    else {
        return vec![Issue::new("pipelines.entities", "required")];
    };

    pipelines
        .iter()
        .enumerate()
        .flat_map(|(index, pipeline)| {
            let path = format!("pipelines.entities[{index}]");
            let mut issues = vec![];

            match text(pipeline, "source") {
                None | Some("") => issues.push(Issue::new(format!("{path}.source"), "required")),
                Some(source) if !declared.contains(&source.to_owned()) => issues.push(Issue::new(
                    format!("{path}.source"),
                    format!("references undeclared source \"{source}\""),
                )),
                Some(_) => {}
            }

            let steps = pipeline.get("steps").and_then(Value::as_array);
            issues.extend(steps_issues(
                steps.map(Vec::as_slice).unwrap_or(&[]),
                &format!("{path}.steps"),
                &unit_maps,
                false,
            ));
            issues
        })
        .collect()
}

fn steps_issues(
    steps: &[Value],
    path: &str,
    unit_maps: &Map<String, Value>,
    in_branch: bool,
) -> Vec<Issue> {
    steps
        .iter()
        .enumerate()
        .flat_map(|(index, step)| {
            let step_path = format!("{path}[{index}]");
            let mut issues = vec![];

            let require = |issues: &mut Vec<Issue>, key: &str| {
                if blank(step.get(key)) {
                    issues.push(Issue::new(format!("{step_path}.{key}"), "required"));
                }
            };

            match text(step, "kind") {
                Some("sql") => {
                    require(&mut issues, "id");
                    require(&mut issues, "sql");
                }
                Some("fn") => {
                    require(&mut issues, "id");
                    require(&mut issues, "transform");
                }
                Some("checkpoint") => {
                    require(&mut issues, "id");
                    require(&mut issues, "name");
                }
                Some("branch") if in_branch => {
                    issues.push(Issue::new(
                        step_path.clone(),
                        "nested branches are not supported",
                    ));
                }
                Some("branch") => {
                    if let Some(branches) = step.get("branches").and_then(Value::as_array) {
                        for (branch_index, branch) in branches.iter().enumerate() {
                            let branch_steps = branch.as_array().map(Vec::as_slice).unwrap_or(&[]);
                            issues.extend(steps_issues(
                                branch_steps,
                                &format!("{step_path}.branches[{branch_index}]"),
                                unit_maps,
                                true,
                            ));
                        }
                    }
                }
                Some("graph-sink") => {
                    issues.extend(sink_issues(
                        step.get("config"),
                        &format!("{step_path}.config"),
                        unit_maps,
                    ));
                }
                other => issues.push(Issue::new(
                    format!("{step_path}.kind"),
                    format!(
                        "unknown kind {other:?}; expected one of {}",
                        STEP_KINDS.join(", ")
                    ),
                )),
            }

            issues
        })
        .collect()
}

fn sink_issues(config: Option<&Value>, path: &str, unit_maps: &Map<String, Value>) -> Vec<Issue> {
    let Some(config) = config.filter(|value| value.is_object()) else {
        return vec![Issue::new(path, "required")];
    };

    let mut issues = vec![];

    match config.get("entityId") {
        Some(Value::Array(_)) => issues.push(Issue::new(
            format!("{path}.entityId"),
            "array entityId is stream-only in the TS engine and unsupported in batch; compose it in SQL",
        )),
        Some(Value::String(id)) if !id.is_empty() => {}
        _ => issues.push(Issue::new(format!("{path}.entityId"), "required")),
    }

    for key in ["entityType", "webId"] {
        if blank(config.get(key)) {
            issues.push(Issue::new(format!("{path}.{key}"), "required"));
        }
    }

    issues.extend(accessor_issues(
        obj(config, "properties"),
        &format!("{path}.properties"),
        unit_maps,
    ));
    issues.extend(accessor_issues(
        obj(config, "provenanceFields"),
        &format!("{path}.provenanceFields"),
        unit_maps,
    ));
    issues
}

fn accessor_issues(
    accessors: Option<&Map<String, Value>>,
    path: &str,
    unit_maps: &Map<String, Value>,
) -> Vec<Issue> {
    let Some(accessors) = accessors else {
        return vec![];
    };

    accessors
        .iter()
        .filter_map(|(key, accessor)| {
            let issue = |message: String| Some(Issue::new(format!("{path}.{key}"), message));

            // A bare string is a column; otherwise it must be exactly one of
            // the two tagged shapes. Anything else (a typo'd tag, a partial
            // object) would silently become an empty-column accessor at build,
            // so flag it here.
            if accessor.is_string() {
                return None;
            }
            let Some(object) = accessor.as_object() else {
                return issue("accessor must be a column string or a {column,coerce}/{amount,unit,measure} object".to_owned());
            };

            if object.contains_key("coerce") {
                let name = object.get("coerce").and_then(Value::as_str);
                if object.get("column").and_then(Value::as_str).is_none() || name.is_none() {
                    return issue("coerce accessor requires string \"column\" and \"coerce\"".to_owned());
                }
                let name = name.expect("checked");
                if !coerce::known(name) {
                    return issue(format!(
                        "unknown coercion \"{name}\"; available: {}",
                        coerce::REGISTRY.join(", ")
                    ));
                }
                return None;
            }

            if object.contains_key("measure") {
                let map_name = object.get("measure").and_then(Value::as_str);
                if object.get("amount").and_then(Value::as_str).is_none()
                    || object.get("unit").and_then(Value::as_str).is_none()
                    || map_name.is_none()
                {
                    return issue("measure accessor requires string \"amount\", \"unit\", and \"measure\"".to_owned());
                }
                let map_name = map_name.expect("checked");
                if !unit_maps.contains_key(map_name) {
                    return issue(format!("unknown unit map \"{map_name}\""));
                }
                return None;
            }

            issue("accessor object must contain \"coerce\" (with \"column\") or \"measure\" (with \"amount\"/\"unit\")".to_owned())
        })
        .collect()
}

fn link_issues(yaml: &Value, web_id: &str) -> Vec<Issue> {
    let unit_maps = obj(yaml, "unitMaps").cloned().unwrap_or_default();
    let links = yaml
        .get("pipelines")
        .and_then(|pipelines| pipelines.get("links"))
        .and_then(Value::as_array);

    links
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .enumerate()
        .flat_map(|(index, link)| {
            let path = format!("pipelines.links[{index}]");
            let mut issues = vec![];

            for key in ["id", "linkType"] {
                if blank(link.get(key)) {
                    issues.push(Issue::new(format!("{path}.{key}"), "required"));
                }
            }
            let source = text(link, "source").filter(|source| !source.is_empty());
            let inputs = obj(link, "inputs");
            let has_inputs = inputs.is_some_and(|inputs| !inputs.is_empty());
            match (source.is_some(), has_inputs) {
                (true, true) => issues.push(Issue::new(
                    format!("{path}.inputs"),
                    "cannot be combined with source",
                )),
                (false, false) => issues.push(Issue::new(
                    format!("{path}.source"),
                    "source or inputs is required",
                )),
                _ => {}
            }
            if let Some(inputs) = inputs {
                for (alias, checkpoint) in inputs {
                    if alias == "input" {
                        issues.push(Issue::new(
                            format!("{path}.inputs.input"),
                            "alias is reserved",
                        ));
                    }
                    if blank(Some(checkpoint)) {
                        issues.push(Issue::new(
                            format!("{path}.inputs.{alias}"),
                            "checkpoint name is required",
                        ));
                    }
                }
            }
            for end in ["from", "to"] {
                for key in ["entityType", "column"] {
                    if blank(link.get(end).and_then(|value| value.get(key))) {
                        issues.push(Issue::new(format!("{path}.{end}.{key}"), "required"));
                    }
                }
            }
            if web_id.is_empty() {
                issues.push(Issue::new(
                    format!("{path}.webId"),
                    "no web id (set HASH_WEB_ID; the link schema has no webId)",
                ));
            }
            issues.extend(accessor_issues(
                obj(link, "properties"),
                &format!("{path}.properties"),
                &unit_maps,
            ));
            issues
        })
        .collect()
}

fn construct(yaml: &Value, web_id: &str) -> Integration {
    let connector = yaml.get("connector").expect("validated").clone();
    let connector_id = text(&connector, "id").expect("validated").to_owned();
    let mode = text(&connector, "mode").unwrap_or("batch").to_owned();
    let unit_maps = obj(yaml, "unitMaps").cloned().unwrap_or_default();
    let id_namespace = text(&connector, "idNamespace").map(str::to_owned);

    let sources = if mode == "rest-api" {
        build_rest_sources(&connector)
    } else {
        build_sources(yaml)
    };

    let pipelines = yaml
        .get("pipelines")
        .and_then(|pipelines| pipelines.get("entities"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .map(|pipeline| build_pipeline(pipeline, &connector, &unit_maps))
        .collect();

    let link_pipelines = yaml
        .get("pipelines")
        .and_then(|pipelines| pipelines.get("links"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .map(|link| build_link(link, &connector, &unit_maps, web_id))
        .collect();

    Integration {
        connector_provenance: connector.get("provenance").cloned(),
        connector_config: Secret::new(connector),
        connector_id,
        connector_mode: mode,
        id_namespace,
        sources,
        pipelines,
        link_pipelines,
        unit_maps,
    }
}

fn primary_key_of(value: &Value) -> Vec<String> {
    match value.get("primaryKey") {
        Some(Value::String(column)) => vec![column.clone()],
        Some(Value::Array(columns)) => columns
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        _ => vec![],
    }
}

fn common_flags(source: &Value) -> (bool, bool) {
    (
        source
            .get("partial")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        source
            .get("archiveOnEmpty")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    )
}

fn build_sources(yaml: &Value) -> HashMap<String, SourceDef> {
    obj(yaml, "sources")
        .map(|sources| {
            sources
                .iter()
                .map(|(name, source)| {
                    let kind = match text(source, "kind") {
                        Some("sql") => SourceKind::Sql {
                            sql: text(source, "sql").expect("validated").to_owned(),
                            primary_key: primary_key_of(source),
                            extensions: source
                                .get("extensions")
                                .and_then(Value::as_array)
                                .map(|extensions| {
                                    extensions
                                        .iter()
                                        .filter_map(Value::as_str)
                                        .map(str::to_owned)
                                        .collect()
                                })
                                .unwrap_or_default(),
                        },
                        Some("checkpoint") => SourceKind::Checkpoint {
                            name: text(source, "name").expect("validated").to_owned(),
                        },
                        Some("external") => SourceKind::External {
                            key: text(source, "key").map(str::to_owned),
                            primary_key: primary_key_of(source),
                        },
                        _ => SourceKind::Table {
                            primary_key: primary_key_of(source),
                        },
                    };
                    let (partial, archive_on_empty) = common_flags(source);

                    (
                        name.clone(),
                        SourceDef {
                            kind,
                            partial,
                            archive_on_empty,
                            provenance: source.get("provenance").cloned(),
                            asserts: source.get("asserts").cloned(),
                        },
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

/// rest-api connectors declare endpoints instead of duckdb sources: each
/// endpoint becomes a `Rest` source, with connector-level
/// auth/rateLimitMs/pageSize as endpoint defaults.
fn build_rest_sources(connector: &Value) -> HashMap<String, SourceDef> {
    let Some(endpoints) = obj(connector, "endpoints") else {
        return HashMap::new();
    };

    endpoints
        .iter()
        .map(|(name, endpoint)| {
            let mut merged = Map::new();
            for key in ["auth", "rateLimitMs", "pageSize"] {
                if let Some(value) = connector.get(key) {
                    merged.insert(key.to_owned(), value.clone());
                }
            }
            if let Some(endpoint) = endpoint.as_object() {
                for (key, value) in endpoint {
                    merged.insert(key.clone(), value.clone());
                }
            }
            let (partial, archive_on_empty) = common_flags(endpoint);

            (
                name.clone(),
                SourceDef {
                    kind: SourceKind::Rest {
                        primary_key: primary_key_of(endpoint),
                        endpoint: crate::secret::Secret::new(Value::Object(merged)),
                    },
                    partial,
                    archive_on_empty,
                    provenance: endpoint.get("provenance").cloned(),
                    asserts: endpoint.get("asserts").cloned(),
                },
            )
        })
        .collect()
}

fn build_pipeline(pipeline: &Value, connector: &Value, unit_maps: &Map<String, Value>) -> Pipeline {
    Pipeline {
        source: text(pipeline, "source").unwrap_or_default().to_owned(),
        depends_on: pipeline
            .get("dependsOn")
            .and_then(Value::as_array)
            .map(|names| {
                names
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
        inputs: obj(pipeline, "inputs")
            .map(|inputs| {
                inputs
                    .iter()
                    .filter_map(|(alias, checkpoint)| {
                        checkpoint
                            .as_str()
                            .map(|name| (alias.clone(), name.to_owned()))
                    })
                    .collect()
            })
            .unwrap_or_default(),
        steps: pipeline
            .get("steps")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[])
            .iter()
            .map(|step| build_step(step, connector, unit_maps))
            .collect(),
    }
}

fn build_step(step: &Value, connector: &Value, unit_maps: &Map<String, Value>) -> Step {
    let id = text(step, "id").unwrap_or_default().to_owned();
    let kind = match text(step, "kind") {
        Some("sql") => StepKind::Sql {
            sql: text(step, "sql").unwrap_or_default().to_owned(),
        },
        Some("fn") => StepKind::Fn {
            transform: text(step, "transform").unwrap_or_default().to_owned(),
        },
        Some("checkpoint") => StepKind::Checkpoint {
            name: text(step, "name").unwrap_or_default().to_owned(),
        },
        Some("branch") => StepKind::Branch {
            branches: step
                .get("branches")
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or(&[])
                .iter()
                .map(|branch| {
                    branch
                        .as_array()
                        .map(Vec::as_slice)
                        .unwrap_or(&[])
                        .iter()
                        .map(|inner| build_step(inner, connector, unit_maps))
                        .collect()
                })
                .collect(),
        },
        _ => StepKind::GraphSink {
            config: build_sink_config(step.get("config").expect("validated"), connector, unit_maps),
        },
    };
    Step { id, kind }
}

fn build_accessor(value: &Value) -> Accessor {
    if let Some(column) = value.as_str() {
        return Accessor::Column(column.to_owned());
    }
    if let (Some(column), Some(name)) = (
        value.get("column").and_then(Value::as_str),
        value.get("coerce").and_then(Value::as_str),
    ) {
        return Accessor::Coerce {
            name: name.to_owned(),
            column: column.to_owned(),
        };
    }
    if let (Some(amount), Some(unit), Some(map_name)) = (
        value.get("amount").and_then(Value::as_str),
        value.get("unit").and_then(Value::as_str),
        value.get("measure").and_then(Value::as_str),
    ) {
        return Accessor::Measure {
            amount: amount.to_owned(),
            unit: unit.to_owned(),
            map_name: map_name.to_owned(),
        };
    }
    Accessor::Column(String::new())
}

fn build_sink_config(
    config: &Value,
    connector: &Value,
    _unit_maps: &Map<String, Value>,
) -> SinkConfig {
    let properties: Vec<(String, Accessor)> = obj(config, "properties")
        .map(|properties| {
            properties
                .iter()
                .map(|(url, accessor)| (url.clone(), build_accessor(accessor)))
                .collect()
        })
        .unwrap_or_default();

    let property_fields = properties
        .iter()
        .filter_map(|(url, accessor)| {
            accessor
                .column()
                .map(|column| (url.clone(), column.to_owned()))
        })
        .collect();

    let fields = obj(config, "provenanceFields");
    let field = |name: &str| {
        fields
            .and_then(|fields| fields.get(name))
            .filter(|value| !value.is_null())
            .map(build_accessor)
    };

    SinkConfig {
        entity_type: text(config, "entityType").unwrap_or_default().to_owned(),
        entity_id: text(config, "entityId").unwrap_or_default().to_owned(),
        web_id: text(config, "webId").unwrap_or_default().to_owned(),
        id_namespace: text(connector, "idNamespace").map(str::to_owned),
        properties,
        property_fields,
        provenance: config.get("provenance").cloned(),
        provenance_fields: ProvenanceFields {
            authors: field("authors"),
            first_published: field("firstPublished"),
            last_updated: field("lastUpdated"),
        },
    }
}

fn build_link(
    link: &Value,
    connector: &Value,
    _unit_maps: &Map<String, Value>,
    web_id: &str,
) -> LinkEntry {
    let properties: Vec<(String, Accessor)> = obj(link, "properties")
        .map(|properties| {
            properties
                .iter()
                .map(|(url, accessor)| (url.clone(), build_accessor(accessor)))
                .collect()
        })
        .unwrap_or_default();

    let mut property_columns: Vec<String> = properties
        .iter()
        .filter_map(|(_, accessor)| accessor.column().map(str::to_owned))
        .collect();
    property_columns.dedup();

    let endpoint = |name: &str| EndpointRef {
        entity_type: link
            .get(name)
            .and_then(|end| end.get("entityType"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        column: link
            .get(name)
            .and_then(|end| end.get("column"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
    };

    LinkEntry {
        id: text(link, "id").unwrap_or_default().to_owned(),
        web_id: web_id.to_owned(),
        id_namespace: text(connector, "idNamespace").map(str::to_owned),
        source: text(link, "source").unwrap_or_default().to_owned(),
        inputs: obj(link, "inputs")
            .map(|inputs| {
                inputs
                    .iter()
                    .filter_map(|(alias, checkpoint)| {
                        checkpoint
                            .as_str()
                            .map(|name| (alias.clone(), name.to_owned()))
                    })
                    .collect()
            })
            .unwrap_or_default(),
        steps: link
            .get("steps")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[])
            .iter()
            .map(|step| Step {
                id: text(step, "id").unwrap_or_default().to_owned(),
                kind: StepKind::Sql {
                    sql: text(step, "sql").unwrap_or_default().to_owned(),
                },
            })
            .collect(),
        from: endpoint("from"),
        to: endpoint("to"),
        link_type: text(link, "linkType").unwrap_or_default().to_owned(),
        properties,
        property_columns,
        provenance: link.get("provenance").cloned(),
    }
}

// TRY_CAST nulls silently on conversion failure and bypasses the conversion
// quarantine; warn at build time so the known limitation is visible at the
// offending location.
fn lint_try_cast(yaml: &Value) {
    let mut sites: Vec<(String, &str)> = vec![];

    if let Some(sources) = obj(yaml, "sources") {
        for (name, source) in sources {
            if let Some(sql) = text(source, "sql") {
                sites.push((format!("source {name}"), sql));
            }
        }
    }
    for (label, list) in [("step", "entities"), ("link", "links")] {
        if let Some(pipelines) = yaml
            .get("pipelines")
            .and_then(|pipelines| pipelines.get(list))
            .and_then(Value::as_array)
        {
            for pipeline in pipelines {
                if let Some(steps) = pipeline.get("steps").and_then(Value::as_array) {
                    for step in steps {
                        if let Some(sql) = text(step, "sql") {
                            sites.push((
                                format!("{label} \"{}\"", text(step, "id").unwrap_or("")),
                                sql,
                            ));
                        }
                    }
                }
            }
        }
    }

    for (site, sql) in sites {
        if sql.to_uppercase().contains("TRY_CAST") {
            tracing::warn!(
                "{site}: TRY_CAST nulls silently on conversion failure and bypasses the conversion quarantine; prefer an explicit cast or a coerce accessor"
            );
        }
    }
}

const KNOWN_TOP: &[&str] = &["connector", "vars", "sources", "pipelines", "unitMaps"];
const KNOWN_SOURCE: &[&str] = &[
    "kind",
    "sql",
    "primaryKey",
    "name",
    "key",
    "extensions",
    "partial",
    "archiveOnEmpty",
    "provenance",
    "asserts",
];
const KNOWN_PIPELINE: &[&str] = &["source", "dependsOn", "inputs", "steps"];
const KNOWN_STEP: &[&str] = &[
    "kind",
    "id",
    "sql",
    "transform",
    "name",
    "branches",
    "config",
    "dependsOn",
];
const KNOWN_SINK: &[&str] = &[
    "entityType",
    "entityId",
    "webId",
    "properties",
    "provenanceFields",
    "provenance",
];
const KNOWN_LINK: &[&str] = &[
    "id",
    "source",
    "inputs",
    "steps",
    "from",
    "to",
    "linkType",
    "properties",
    "provenance",
];

// A typo'd optional key is silently ignored by construction; warn instead of
// erroring so newer-schema definitions still run.
fn lint_unknown_keys(yaml: &Value) {
    let warn = |path: &str, map: Option<&Map<String, Value>>, known: &[&str]| {
        let Some(map) = map else { return };
        let unknown: Vec<&str> = map
            .keys()
            .map(String::as_str)
            .filter(|key| !known.contains(key))
            .collect();
        if !unknown.is_empty() {
            tracing::warn!(
                "{path}: unknown key(s) ignored (typo?): {}",
                unknown.join(", ")
            );
        }
    };

    warn("(top level)", yaml.as_object(), KNOWN_TOP);

    if let Some(sources) = obj(yaml, "sources") {
        for (name, source) in sources {
            warn(&format!("sources.{name}"), source.as_object(), KNOWN_SOURCE);
        }
    }

    if let Some(pipelines) = yaml
        .get("pipelines")
        .and_then(|pipelines| pipelines.get("entities"))
        .and_then(Value::as_array)
    {
        for (index, pipeline) in pipelines.iter().enumerate() {
            let path = format!("pipelines.entities[{index}]");
            warn(&path, pipeline.as_object(), KNOWN_PIPELINE);
            lint_step_keys(pipeline.get("steps"), &format!("{path}.steps"), &warn);
        }
    }

    if let Some(links) = yaml
        .get("pipelines")
        .and_then(|pipelines| pipelines.get("links"))
        .and_then(Value::as_array)
    {
        for (index, link) in links.iter().enumerate() {
            warn(
                &format!("pipelines.links[{index}]"),
                link.as_object(),
                KNOWN_LINK,
            );
        }
    }
}

fn lint_step_keys(
    steps: Option<&Value>,
    path: &str,
    warn: &impl Fn(&str, Option<&Map<String, Value>>, &[&str]),
) {
    let Some(steps) = steps.and_then(Value::as_array) else {
        return;
    };
    for (index, step) in steps.iter().enumerate() {
        let step_path = format!("{path}[{index}]");
        warn(&step_path, step.as_object(), KNOWN_STEP);
        if let Some(config) = step.get("config") {
            warn(
                &format!("{step_path}.config"),
                config.as_object(),
                KNOWN_SINK,
            );
        }
        if let Some(branches) = step.get("branches").and_then(Value::as_array) {
            for (branch_index, branch) in branches.iter().enumerate() {
                lint_step_keys(
                    Some(branch),
                    &format!("{step_path}.branches[{branch_index}]"),
                    warn,
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn link(overrides: Value) -> Value {
        let mut value = json!({
            "id": "joined",
            "inputs": {"src": "sap/source", "target": "sap/target"},
            "from": {"entityType": "https://example.com/source/v/1", "column": "source_id"},
            "to": {"entityType": "https://example.com/target/v/1", "column": "target_id"},
            "linkType": "https://example.com/link/v/1"
        });
        value
            .as_object_mut()
            .expect("test link is an object")
            .extend(
                overrides
                    .as_object()
                    .expect("test overrides are an object")
                    .clone(),
            );
        value
    }

    #[test]
    fn link_pipeline_accepts_named_inputs_without_source() {
        let yaml = json!({"pipelines": {"links": [link(json!({}))]}});
        assert!(link_issues(&yaml, "web").is_empty());
    }

    #[test]
    fn link_pipeline_requires_exactly_one_input_form() {
        let both = json!({"pipelines": {"links": [link(json!({"source": "sap/source"}))]}});
        assert!(link_issues(&both, "web")
            .iter()
            .any(|issue| issue.message == "cannot be combined with source"));

        let neither = json!({"pipelines": {"links": [link(json!({"inputs": {}}))]}});
        assert!(link_issues(&neither, "web")
            .iter()
            .any(|issue| issue.message == "source or inputs is required"));
    }
}
