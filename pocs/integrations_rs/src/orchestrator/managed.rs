//! Durable managed-integration definitions and shared webhook acceptance.
//!
//! The HTTP adapter owns authentication and provider response shapes. This
//! module owns exact-CAS definition evolution, routing, verification and the
//! durability boundary: an event is accepted only after both its immutable
//! payload and every enabled tenant receipt exist in object storage.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest as _, Sha256};
use uuid::Uuid;

use crate::blob::{ArtifactStore, BlobRef, CasVersion, CasWrite};
use crate::secret::Secret;

pub const DEFAULT_MAX_BODY_BYTES: usize = 25 * 1024 * 1024;
pub const DEFAULT_MAX_PENDING_EVENTS: u64 = 100_000;
pub const DEFAULT_MAX_PENDING_BYTES: u64 = 10 * 1024 * 1024 * 1024;
pub const DEFAULT_REPLAY_WINDOW_SECONDS: i64 = 5 * 60;
const MAX_RECORD_BYTES: usize = 16 * 1024 * 1024;
const MANAGED_RECORD_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredRecord<T> {
    version: u32,
    data: T,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebhookProvider {
    Github,
    Slack,
    Linear,
    Notion,
}

impl WebhookProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Github => "github",
            Self::Slack => "slack",
            Self::Linear => "linear",
            Self::Notion => "notion",
        }
    }
}

impl std::str::FromStr for WebhookProvider {
    type Err = ManagedError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "github" => Ok(Self::Github),
            "slack" => Ok(Self::Slack),
            "linear" => Ok(Self::Linear),
            "notion" => Ok(Self::Notion),
            _ => Err(ManagedError::Invalid(format!(
                "unsupported webhook provider {value:?}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedDesiredState {
    Enabled,
    Disabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedObservedState {
    Inactive,
    Active,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdentityContract {
    pub components: BTreeSet<String>,
}

impl IdentityContract {
    pub fn from_definition(definition: &Value) -> Self {
        let mut components = BTreeSet::new();
        let connector = definition.get("connector").unwrap_or(&Value::Null);
        capture(
            &mut components,
            "connector.idNamespace",
            connector.get("idNamespace"),
        );
        if let Some(sources) = definition.get("sources").and_then(Value::as_object) {
            for (name, source) in sources {
                capture(
                    &mut components,
                    &format!("source.{name}.primaryKey"),
                    source.get("primaryKey"),
                );
            }
        }
        if let Some(entities) = definition
            .pointer("/pipelines/entities")
            .and_then(Value::as_array)
        {
            for pipeline in entities {
                if let Some(steps) = pipeline.get("steps").and_then(Value::as_array) {
                    collect_sink_identity(
                        &mut components,
                        &format!(
                            "entity.source.{}",
                            pipeline
                                .get("source")
                                .and_then(Value::as_str)
                                .unwrap_or("unknown")
                        ),
                        steps,
                    );
                }
            }
        }
        if let Some(links) = definition
            .pointer("/pipelines/links")
            .and_then(Value::as_array)
        {
            for link in links {
                let id = link.get("id").and_then(Value::as_str).unwrap_or("unknown");
                for key in ["idNamespace", "linkType", "from", "to"] {
                    capture(&mut components, &format!("link.{id}.{key}"), link.get(key));
                }
            }
        }
        Self { components }
    }

    pub fn ensure_compatible_with(&self, next: &Self) -> Result<(), ManagedError> {
        let removed: Vec<_> = self
            .components
            .difference(&next.components)
            .cloned()
            .collect();
        if removed.is_empty() {
            Ok(())
        } else {
            Err(ManagedError::IdentityBreaking { removed })
        }
    }
}

fn collect_sink_identity(out: &mut BTreeSet<String>, prefix: &str, steps: &[Value]) {
    for step in steps {
        if step.get("kind").and_then(Value::as_str) == Some("graph-sink") {
            let id = step.get("id").and_then(Value::as_str).unwrap_or("unknown");
            let step_prefix = format!("{prefix}.sink.{id}");
            let config = step.get("config").unwrap_or(step);
            for key in ["entityType", "entityId", "idNamespace"] {
                capture(out, &format!("{step_prefix}.{key}"), config.get(key));
            }
        }
        if let Some(branches) = step.get("branches").and_then(Value::as_array) {
            for nested in branches.iter().filter_map(Value::as_array) {
                collect_sink_identity(out, prefix, nested);
            }
        }
    }
}

fn capture(out: &mut BTreeSet<String>, path: &str, value: Option<&Value>) {
    if let Some(value) = value {
        out.insert(format!("{path}={}", canonical_json(value)));
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedDefinition {
    pub web_id: String,
    pub connector_id: String,
    pub revision: String,
    pub definition: Value,
    pub provider: WebhookProvider,
    pub owner_actor: String,
    pub desired_state: ManagedDesiredState,
    pub observed_state: ManagedObservedState,
    pub identity_contract: IdentityContract,
    pub replaces_connector_id: Option<String>,
    pub pending_events: u64,
    pub pending_bytes: u64,
    pub processed_events: u64,
    pub duplicate_events: u64,
    pub dlq_events: u64,
    pub last_accepted_at: Option<String>,
    pub checkpoint: Option<BlobRef>,
    pub failure: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretRef {
    pub entity_uuid: Uuid,
}

impl<'de> Deserialize<'de> for SecretRef {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Current {
            entity_uuid: Uuid,
        }

        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Legacy {
            backend: String,
            path: String,
        }

        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Representation {
            Current(Current),
            Legacy(Legacy),
        }

        match Representation::deserialize(deserializer)? {
            Representation::Current(Current { entity_uuid }) => Ok(Self { entity_uuid }),
            Representation::Legacy(Legacy { backend, path }) => {
                if backend != "hash-graph-vault" {
                    return Err(serde::de::Error::custom(
                        "legacy secret reference backend must be hash-graph-vault",
                    ));
                }
                let mut parts = path.split('~');
                let web_id = parts.next().unwrap_or_default();
                let entity_uuid = parts.next().unwrap_or_default();
                if parts.next().is_some() || Uuid::parse_str(web_id).is_err() {
                    return Err(serde::de::Error::custom(
                        "legacy secret reference path must be a HASH entity ID",
                    ));
                }
                let entity_uuid = Uuid::parse_str(entity_uuid).map_err(|_error| {
                    serde::de::Error::custom(
                        "legacy secret reference path must be a HASH entity ID",
                    )
                })?;
                Ok(Self { entity_uuid })
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderBinding {
    pub binding_id: String,
    pub provider: WebhookProvider,
    pub external_id: String,
    pub web_id: String,
    pub connector_id: String,
    pub secret_ref: SecretRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoutingTarget {
    pub binding_id: String,
    pub provider: WebhookProvider,
    pub web_id: String,
    pub connector_id: String,
    pub secret_ref: SecretRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RoutingIndex {
    version: u32,
    provider: WebhookProvider,
    external_identity_hash: String,
    targets: Vec<RoutingTarget>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebhookReceipt {
    pub provider: WebhookProvider,
    pub delivery_id: String,
    pub payload_digest: String,
    pub payload: BlobRef,
    pub web_id: String,
    pub connector_id: String,
    pub definition_revision: String,
    pub owner_actor: String,
    pub accepted_at: String,
    pub headers: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IngressDisposition {
    Accepted { targets: usize },
    Duplicate { targets: usize },
    Challenge(String),
}

/// Stable provider-specific rows exposed to webhook pipeline source tables.
/// `payload` retains the complete original object so newly added provider
/// fields survive an older engine version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "provider", rename_all = "snake_case")]
pub enum ProviderEventRow {
    Github {
        delivery: String,
        event: String,
        action: Option<String>,
        installation: Value,
        repository: Option<Value>,
        sender: Option<Value>,
        payload: Value,
    },
    Slack {
        event_id: String,
        event_type: String,
        event_time: Option<i64>,
        team: String,
        app: Option<String>,
        event: Value,
        payload: Value,
    },
    Linear {
        delivery: String,
        action: Option<String>,
        event_type: String,
        event_time: Option<i64>,
        organization: String,
        data: Value,
        previous_values: Option<Value>,
        payload: Value,
    },
    Notion {
        event_id: String,
        event_type: String,
        event_time: Option<String>,
        workspace: Option<String>,
        subscription: Option<Value>,
        entity: Option<Value>,
        payload: Value,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptedEvent {
    pub receipt_key: String,
    pub receipt: WebhookReceipt,
    pub row: ProviderEventRow,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StreamMicroBatch {
    pub run_id: String,
    pub web_id: String,
    pub connector_id: String,
    pub definition_revision: String,
    pub events: Vec<AcceptedEvent>,
}

impl StreamMicroBatch {
    /// One scheduler turn contains at most 100 accepted events. Callers close
    /// a smaller batch after the 250 ms collection deadline.
    pub fn from_events(mut events: Vec<AcceptedEvent>) -> Result<Self, ManagedError> {
        if events.is_empty() || events.len() > 100 {
            return Err(ManagedError::Invalid(
                "a stream microbatch must contain between 1 and 100 events".to_owned(),
            ));
        }
        events.sort_by(|left, right| {
            (
                &left.receipt.accepted_at,
                &left.receipt.delivery_id,
                &left.receipt_key,
            )
                .cmp(&(
                    &right.receipt.accepted_at,
                    &right.receipt.delivery_id,
                    &right.receipt_key,
                ))
        });
        let first = &events[0].receipt;
        if events.iter().any(|event| {
            event.receipt.web_id != first.web_id
                || event.receipt.connector_id != first.connector_id
                || event.receipt.definition_revision != first.definition_revision
        }) {
            return Err(ManagedError::Invalid(
                "a stream microbatch cannot cross integration or definition revisions".to_owned(),
            ));
        }
        let identity = canonical_json(&Value::Array(
            events
                .iter()
                .map(|event| {
                    serde_json::json!({
                        "delivery": event.receipt.delivery_id,
                        "digest": event.receipt.payload_digest,
                        "revision": event.receipt.definition_revision,
                    })
                })
                .collect(),
        ));
        let run_id = uuid::Uuid::new_v5(
            &uuid::Uuid::NAMESPACE_URL,
            format!(
                "hash:managed-microbatch:v1:{}:{}:{identity}",
                first.web_id, first.connector_id
            )
            .as_bytes(),
        )
        .to_string();
        Ok(Self {
            run_id,
            web_id: first.web_id.clone(),
            connector_id: first.connector_id.clone(),
            definition_revision: first.definition_revision.clone(),
            events,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ManagedError {
    Invalid(String),
    NotFound,
    Conflict { current_revision: Option<String> },
    IdentityBreaking { removed: Vec<String> },
    Signature,
    Replay,
    DeliveryCollision,
    Disabled,
    BacklogFull,
    SecretUnavailable,
    Storage(String),
}

impl fmt::Display for ManagedError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(message) | Self::Storage(message) => formatter.write_str(message),
            Self::NotFound => formatter.write_str("managed integration was not found"),
            Self::Conflict { .. } => formatter.write_str("managed integration revision conflict"),
            Self::IdentityBreaking { removed } => write!(
                formatter,
                "definition changes identity-bearing components: {}",
                removed.join(", ")
            ),
            Self::Signature => formatter.write_str("webhook signature is invalid"),
            Self::Replay => formatter.write_str("webhook timestamp is outside the replay window"),
            Self::DeliveryCollision => {
                formatter.write_str("delivery identifier was reused with different payload bytes")
            }
            Self::Disabled => formatter.write_str("managed integration is disabled"),
            Self::BacklogFull => formatter.write_str("managed integration backlog limit reached"),
            Self::SecretUnavailable => formatter.write_str("webhook secret is unavailable"),
        }
    }
}

impl std::error::Error for ManagedError {}

#[async_trait]
pub trait SecretStore: Send + Sync {
    async fn read(
        &self,
        web_id: &str,
        reference: &SecretRef,
    ) -> Result<Secret<Vec<u8>>, ManagedError>;
    async fn write_once(
        &self,
        web_id: &str,
        reference: &SecretRef,
        value: Secret<Vec<u8>>,
    ) -> Result<(), ManagedError>;
}

#[derive(Default)]
pub struct InMemorySecretStore {
    values: RwLock<HashMap<SecretRefKey, Secret<Vec<u8>>>>,
}

type SecretRefKey = (String, Uuid);

#[async_trait]
impl SecretStore for InMemorySecretStore {
    async fn read(
        &self,
        web_id: &str,
        reference: &SecretRef,
    ) -> Result<Secret<Vec<u8>>, ManagedError> {
        self.values
            .read()
            .map_err(|_poisoned| ManagedError::SecretUnavailable)?
            .get(&(web_id.to_owned(), reference.entity_uuid))
            .cloned()
            .ok_or(ManagedError::SecretUnavailable)
    }

    async fn write_once(
        &self,
        web_id: &str,
        reference: &SecretRef,
        value: Secret<Vec<u8>>,
    ) -> Result<(), ManagedError> {
        let mut values = self
            .values
            .write()
            .map_err(|_poisoned| ManagedError::SecretUnavailable)?;
        let key = (web_id.to_owned(), reference.entity_uuid);
        if values.contains_key(&key) {
            return Err(ManagedError::Conflict {
                current_revision: None,
            });
        }
        values.insert(key, value);
        Ok(())
    }
}

pub struct UnavailableVaultSecretStore;

#[async_trait]
impl SecretStore for UnavailableVaultSecretStore {
    async fn read(
        &self,
        _web_id: &str,
        _reference: &SecretRef,
    ) -> Result<Secret<Vec<u8>>, ManagedError> {
        Err(ManagedError::SecretUnavailable)
    }

    async fn write_once(
        &self,
        _web_id: &str,
        _reference: &SecretRef,
        _value: Secret<Vec<u8>>,
    ) -> Result<(), ManagedError> {
        Err(ManagedError::SecretUnavailable)
    }
}

#[derive(Clone)]
pub struct ManagedStore {
    blobs: ArtifactStore,
    secrets: Arc<dyn SecretStore>,
    max_pending_events: u64,
    max_pending_bytes: u64,
}

impl ManagedStore {
    pub fn new(blobs: ArtifactStore, secrets: Arc<dyn SecretStore>) -> Self {
        Self {
            blobs,
            secrets,
            max_pending_events: DEFAULT_MAX_PENDING_EVENTS,
            max_pending_bytes: DEFAULT_MAX_PENDING_BYTES,
        }
    }

    pub fn with_backlog_limits(mut self, events: u64, bytes: u64) -> Self {
        self.max_pending_events = events;
        self.max_pending_bytes = bytes;
        self
    }

    pub async fn put_definition(
        &self,
        web_id: &str,
        connector_id: &str,
        actor: &str,
        definition: Value,
        expected_revision: Option<&str>,
        replaces_connector_id: Option<String>,
    ) -> Result<ManagedDefinition, ManagedError> {
        validate_component(web_id, "web id")?;
        validate_component(connector_id, "connector id")?;
        if actor.trim().is_empty() {
            return Err(ManagedError::Invalid("owner actor is required".to_owned()));
        }
        let route_connector = definition
            .pointer("/connector/id")
            .and_then(Value::as_str)
            .ok_or_else(|| ManagedError::Invalid("connector.id is required".to_owned()))?;
        if route_connector != connector_id {
            return Err(ManagedError::Invalid(
                "route connector does not match connector.id".to_owned(),
            ));
        }
        if definition
            .pointer("/connector/mode")
            .and_then(Value::as_str)
            != Some("webhook")
        {
            return Err(ManagedError::Invalid(
                "managed definition requires connector.mode webhook".to_owned(),
            ));
        }
        let provider: WebhookProvider = definition
            .pointer("/connector/provider")
            .and_then(Value::as_str)
            .ok_or_else(|| ManagedError::Invalid("connector.provider is required".to_owned()))?
            .parse()?;
        let integration = crate::definition::parse(&definition, web_id)
            .map_err(|error| ManagedError::Invalid(error.current_context().to_string()))?;
        if integration.connector_mode != "webhook" {
            return Err(ManagedError::Invalid(
                "definition is not a webhook".to_owned(),
            ));
        }
        let key = definition_key(web_id, connector_id);
        let observed = self.read_definition_at(&key).await?;
        match (&observed, expected_revision) {
            (None, None) => {}
            (None, Some(_)) => {
                return Err(ManagedError::Conflict {
                    current_revision: None,
                });
            }
            (Some((current, _)), Some(expected)) if current.revision == expected => {}
            (Some((current, _)), _) => {
                return Err(ManagedError::Conflict {
                    current_revision: Some(current.revision.clone()),
                });
            }
        }
        let contract = IdentityContract::from_definition(&definition);
        if let Some((current, _)) = &observed {
            current
                .identity_contract
                .ensure_compatible_with(&contract)?;
        }
        let revision = digest_value(&definition);
        let mut record = observed.as_ref().map_or_else(
            || ManagedDefinition {
                web_id: web_id.to_owned(),
                connector_id: connector_id.to_owned(),
                revision: revision.clone(),
                definition: definition.clone(),
                provider,
                owner_actor: actor.to_owned(),
                desired_state: ManagedDesiredState::Disabled,
                observed_state: ManagedObservedState::Inactive,
                identity_contract: contract.clone(),
                replaces_connector_id: replaces_connector_id.clone(),
                pending_events: 0,
                pending_bytes: 0,
                processed_events: 0,
                duplicate_events: 0,
                dlq_events: 0,
                last_accepted_at: None,
                checkpoint: None,
                failure: None,
            },
            |(current, _)| current.clone(),
        );
        record.revision = revision;
        record.definition = definition;
        record.provider = provider;
        record.owner_actor = actor.to_owned();
        record.identity_contract = contract;
        record.replaces_connector_id = replaces_connector_id;
        let bytes = encode_record(&record)?;
        let write = match observed {
            None => self.blobs.create_cas_document(&key, bytes).await,
            Some((_current, version)) => {
                self.blobs
                    .compare_and_swap_cas_document(&key, &version, bytes)
                    .await
            }
        }
        .map_err(storage)?;
        match write {
            CasWrite::Written(_) => Ok(record),
            CasWrite::Conflict => Err(ManagedError::Conflict {
                current_revision: self
                    .get_definition(web_id, connector_id)
                    .await
                    .ok()
                    .map(|v| v.revision),
            }),
        }
    }

    pub async fn get_definition(
        &self,
        web_id: &str,
        connector_id: &str,
    ) -> Result<ManagedDefinition, ManagedError> {
        self.read_definition_at(&definition_key(web_id, connector_id))
            .await?
            .map(|(record, _)| record)
            .ok_or(ManagedError::NotFound)
    }

    pub async fn set_desired_state(
        &self,
        web_id: &str,
        connector_id: &str,
        desired: ManagedDesiredState,
        expected_revision: &str,
    ) -> Result<ManagedDefinition, ManagedError> {
        let key = definition_key(web_id, connector_id);
        let (mut record, version) = self
            .read_definition_at(&key)
            .await?
            .ok_or(ManagedError::NotFound)?;
        if record.revision != expected_revision {
            return Err(ManagedError::Conflict {
                current_revision: Some(record.revision),
            });
        }
        record.desired_state = desired;
        record.observed_state = match desired {
            ManagedDesiredState::Enabled => ManagedObservedState::Active,
            ManagedDesiredState::Disabled => ManagedObservedState::Inactive,
        };
        match self
            .blobs
            .compare_and_swap_cas_document(&key, &version, encode_record(&record)?)
            .await
            .map_err(storage)?
        {
            CasWrite::Written(_) => Ok(record),
            CasWrite::Conflict => Err(ManagedError::Conflict {
                current_revision: self
                    .get_definition(web_id, connector_id)
                    .await
                    .ok()
                    .map(|v| v.revision),
            }),
        }
    }

    pub async fn bind(
        &self,
        binding: ProviderBinding,
        secret: Option<Secret<Vec<u8>>>,
    ) -> Result<(), ManagedError> {
        validate_component(&binding.binding_id, "binding id")?;
        let definition = self
            .get_definition(&binding.web_id, &binding.connector_id)
            .await?;
        if definition.provider != binding.provider {
            return Err(ManagedError::Invalid(
                "binding provider does not match definition".to_owned(),
            ));
        }
        if let Some(secret) = secret {
            self.secrets
                .write_once(&binding.web_id, &binding.secret_ref, secret)
                .await?;
        } else {
            self.secrets
                .read(&binding.web_id, &binding.secret_ref)
                .await?;
        }
        let key = binding_key(&binding.web_id, &binding.connector_id, &binding.binding_id);
        match self
            .blobs
            .create_cas_document(&key, encode_record(&binding)?)
            .await
            .map_err(storage)?
        {
            CasWrite::Written(_) => {}
            CasWrite::Conflict => {
                let existing: ProviderBinding = self.read_json(&key).await?.ok_or_else(|| {
                    ManagedError::Storage("binding disappeared after conflict".to_owned())
                })?;
                if existing != binding {
                    return Err(ManagedError::Conflict {
                        current_revision: None,
                    });
                }
            }
        }
        let locator = RoutingTarget {
            binding_id: binding.binding_id.clone(),
            provider: binding.provider,
            web_id: binding.web_id.clone(),
            connector_id: binding.connector_id.clone(),
            secret_ref: binding.secret_ref.clone(),
        };
        let locator_key = binding_locator_key(&binding.binding_id);
        match self
            .blobs
            .create_cas_document(&locator_key, encode_record(&locator)?)
            .await
            .map_err(storage)?
        {
            CasWrite::Written(_) => {}
            CasWrite::Conflict => {
                let existing: RoutingTarget =
                    self.read_json(&locator_key).await?.ok_or_else(|| {
                        ManagedError::Storage("binding locator disappeared".to_owned())
                    })?;
                if existing != locator {
                    return Err(ManagedError::Conflict {
                        current_revision: None,
                    });
                }
            }
        }
        self.add_route(&binding).await
    }

    pub async fn accept(
        &self,
        provider: WebhookProvider,
        binding_id: Option<&str>,
        headers: &BTreeMap<String, String>,
        body: &[u8],
        now_unix_seconds: i64,
    ) -> Result<IngressDisposition, ManagedError> {
        if body.len() > DEFAULT_MAX_BODY_BYTES {
            return Err(ManagedError::Invalid(
                "webhook body exceeds 25 MiB".to_owned(),
            ));
        }
        let envelope = parse_envelope(provider, headers, body, now_unix_seconds)?;
        let targets = if provider == WebhookProvider::Notion {
            let binding_id = binding_id.ok_or_else(|| {
                ManagedError::Invalid("Notion webhook requires a binding id".to_owned())
            })?;
            vec![self.find_binding(binding_id).await?]
        } else {
            self.routes(provider, &envelope.external_id).await?
        };
        if targets.is_empty() {
            return Err(ManagedError::NotFound);
        }
        if targets.iter().any(|target| target.provider != provider) {
            return Err(ManagedError::NotFound);
        }
        // Notion's initial verification request is unsigned and its binding-id
        // route supplies the otherwise absent routing identity.
        if provider == WebhookProvider::Notion {
            if let Some(challenge) = envelope.challenge {
                let target = targets.first().expect("non-empty targets checked above");
                match self
                    .secrets
                    .write_once(
                        &target.web_id,
                        &target.secret_ref,
                        Secret::new(challenge.as_bytes().to_vec()),
                    )
                    .await
                {
                    Ok(()) => {}
                    Err(ManagedError::Conflict { .. }) => {
                        let existing = self
                            .secrets
                            .read(&target.web_id, &target.secret_ref)
                            .await?;
                        if existing.expose() != challenge.as_bytes() {
                            return Err(ManagedError::DeliveryCollision);
                        }
                    }
                    Err(error) => return Err(error),
                }
                return Ok(IngressDisposition::Challenge(challenge));
            }
        }
        let mut enabled = Vec::new();
        for target in targets {
            let definition = self
                .get_definition(&target.web_id, &target.connector_id)
                .await?;
            if provider == WebhookProvider::Slack && envelope.challenge.is_some() {
                let secret = self
                    .secrets
                    .read(&target.web_id, &target.secret_ref)
                    .await?;
                verify(provider, headers, body, secret.expose(), now_unix_seconds)?;
                enabled.push((target, definition));
                continue;
            }
            if definition.desired_state != ManagedDesiredState::Enabled {
                continue;
            }
            if definition.pending_events >= self.max_pending_events
                || definition.pending_bytes.saturating_add(body.len() as u64)
                    > self.max_pending_bytes
            {
                return Err(ManagedError::BacklogFull);
            }
            let secret = self
                .secrets
                .read(&target.web_id, &target.secret_ref)
                .await?;
            verify(provider, headers, body, secret.expose(), now_unix_seconds)?;
            enabled.push((target, definition));
        }
        if enabled.is_empty() {
            return Err(ManagedError::Disabled);
        }
        // Slack URL verification is still signature and replay checked above.
        if let Some(challenge) = envelope.challenge {
            return Ok(IngressDisposition::Challenge(challenge));
        }
        let digest = hex::encode(Sha256::digest(body));
        let payload = self.publish_payload(provider, body).await?;
        let safe_headers = allowlisted_headers(provider, headers);
        let mut duplicates = 0;
        for (target, definition) in &enabled {
            let receipt = WebhookReceipt {
                provider,
                delivery_id: envelope.delivery_id.clone(),
                payload_digest: digest.clone(),
                payload: payload.clone(),
                web_id: target.web_id.clone(),
                connector_id: target.connector_id.clone(),
                definition_revision: definition.revision.clone(),
                owner_actor: definition.owner_actor.clone(),
                accepted_at: now_rfc3339(now_unix_seconds),
                headers: safe_headers.clone(),
            };
            let key = receipt_key(
                &target.web_id,
                &target.connector_id,
                provider,
                &envelope.delivery_id,
            );
            match self
                .blobs
                .create_cas_document(&key, encode_record(&receipt)?)
                .await
                .map_err(storage)?
            {
                CasWrite::Written(_) => {
                    self.bump_acceptance(definition, body.len() as u64, false, now_unix_seconds)
                        .await?;
                }
                CasWrite::Conflict => {
                    let existing: WebhookReceipt = self
                        .read_json(&key)
                        .await?
                        .ok_or_else(|| ManagedError::Storage("receipt disappeared".to_owned()))?;
                    if existing.payload_digest != digest {
                        return Err(ManagedError::DeliveryCollision);
                    }
                    duplicates += 1;
                    self.bump_acceptance(definition, 0, true, now_unix_seconds)
                        .await?;
                }
            }
        }
        if duplicates == enabled.len() {
            Ok(IngressDisposition::Duplicate {
                targets: enabled.len(),
            })
        } else {
            Ok(IngressDisposition::Accepted {
                targets: enabled.len(),
            })
        }
    }

    /// Read accepted events for a shard owner. Receipts are the authoritative
    /// queue; mutable definition counters are status accelerators only.
    pub async fn pending_events(
        &self,
        web_id: &str,
        connector_id: &str,
    ) -> Result<Vec<AcceptedEvent>, ManagedError> {
        validate_component(web_id, "web id")?;
        validate_component(connector_id, "connector id")?;
        let prefix = format!("managed/receipts/{web_id}/{connector_id}");
        let mut events = Vec::new();
        for object in self.blobs.list(&prefix).await.map_err(storage)? {
            let Some(receipt) = self.read_json::<WebhookReceipt>(&object.key).await? else {
                continue;
            };
            let path = self
                .blobs
                .materialize(&receipt.payload)
                .await
                .map_err(storage)?;
            let bytes = tokio::fs::read(path)
                .await
                .map_err(|error| ManagedError::Storage(error.to_string()))?;
            let row = provider_row(&receipt, &bytes)?;
            events.push(AcceptedEvent {
                receipt_key: object.key,
                receipt,
                row,
            });
        }
        events.sort_by(|left, right| {
            (
                &left.receipt.accepted_at,
                &left.receipt.delivery_id,
                &left.receipt_key,
            )
                .cmp(&(
                    &right.receipt.accepted_at,
                    &right.receipt.delivery_id,
                    &right.receipt_key,
                ))
        });
        Ok(events)
    }

    async fn publish_payload(
        &self,
        provider: WebhookProvider,
        body: &[u8],
    ) -> Result<BlobRef, ManagedError> {
        let staged = self.blobs.stage(".json").map_err(storage)?;
        let result = async {
            let mut file = tokio::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&staged)
                .await
                .map_err(|error| ManagedError::Storage(error.to_string()))?;
            use tokio::io::AsyncWriteExt as _;
            file.write_all(body)
                .await
                .map_err(|error| ManagedError::Storage(error.to_string()))?;
            file.sync_all()
                .await
                .map_err(|error| ManagedError::Storage(error.to_string()))?;
            drop(file);
            self.blobs
                .publish(
                    &staged,
                    &format!("managed/webhook-payloads/{}", provider.as_str()),
                    "application/json",
                )
                .await
                .map_err(storage)
        }
        .await;
        let _ = tokio::fs::remove_file(staged).await;
        result
    }

    async fn bump_acceptance(
        &self,
        original: &ManagedDefinition,
        bytes: u64,
        duplicate: bool,
        now: i64,
    ) -> Result<(), ManagedError> {
        let key = definition_key(&original.web_id, &original.connector_id);
        for _ in 0..16 {
            let (mut current, version) = self
                .read_definition_at(&key)
                .await?
                .ok_or(ManagedError::NotFound)?;
            if duplicate {
                current.duplicate_events = current.duplicate_events.saturating_add(1);
            } else {
                current.pending_events = current.pending_events.saturating_add(1);
                current.pending_bytes = current.pending_bytes.saturating_add(bytes);
                current.last_accepted_at = Some(now_rfc3339(now));
            }
            if matches!(
                self.blobs
                    .compare_and_swap_cas_document(&key, &version, encode_record(&current)?)
                    .await
                    .map_err(storage)?,
                CasWrite::Written(_)
            ) {
                return Ok(());
            }
        }
        Err(ManagedError::Storage(
            "definition counters remained unstable".to_owned(),
        ))
    }

    async fn add_route(&self, binding: &ProviderBinding) -> Result<(), ManagedError> {
        let key = route_key(binding.provider, &binding.external_id);
        let target = RoutingTarget {
            binding_id: binding.binding_id.clone(),
            provider: binding.provider,
            web_id: binding.web_id.clone(),
            connector_id: binding.connector_id.clone(),
            secret_ref: binding.secret_ref.clone(),
        };
        for _ in 0..16 {
            let observed = self.blobs.get_cas_document(&key).await.map_err(storage)?;
            let (mut index, version) = match observed {
                None => (
                    RoutingIndex {
                        version: 1,
                        provider: binding.provider,
                        external_identity_hash: identity_hash(
                            binding.provider,
                            &binding.external_id,
                        ),
                        targets: Vec::new(),
                    },
                    None,
                ),
                Some((bytes, version)) => (decode_record(&bytes)?, Some(version)),
            };
            if !index.targets.contains(&target) {
                index.targets.push(target.clone());
                index.targets.sort_by(|left, right| {
                    (&left.web_id, &left.connector_id, &left.binding_id).cmp(&(
                        &right.web_id,
                        &right.connector_id,
                        &right.binding_id,
                    ))
                });
            }
            let write = match version {
                None => {
                    self.blobs
                        .create_cas_document(&key, encode_record(&index)?)
                        .await
                }
                Some(version) => {
                    self.blobs
                        .compare_and_swap_cas_document(&key, &version, encode_record(&index)?)
                        .await
                }
            }
            .map_err(storage)?;
            if matches!(write, CasWrite::Written(_)) {
                return Ok(());
            }
        }
        Err(ManagedError::Storage(
            "routing index remained unstable".to_owned(),
        ))
    }

    async fn routes(
        &self,
        provider: WebhookProvider,
        external_id: &str,
    ) -> Result<Vec<RoutingTarget>, ManagedError> {
        Ok(self
            .read_json::<RoutingIndex>(&route_key(provider, external_id))
            .await?
            .map_or_else(Vec::new, |index| index.targets))
    }

    async fn find_binding(&self, binding_id: &str) -> Result<RoutingTarget, ManagedError> {
        validate_component(binding_id, "binding id")?;
        self.read_json(&binding_locator_key(binding_id))
            .await?
            .ok_or(ManagedError::NotFound)
    }

    async fn read_definition_at(
        &self,
        key: &str,
    ) -> Result<Option<(ManagedDefinition, CasVersion)>, ManagedError> {
        let Some((bytes, version)) = self
            .blobs
            .get_cas_document_bounded(key, MAX_RECORD_BYTES)
            .await
            .map_err(storage)?
            .into_present()?
        else {
            return Ok(None);
        };
        let record = decode_record(&bytes)?;
        Ok(Some((record, version)))
    }

    async fn read_json<T: serde::de::DeserializeOwned>(
        &self,
        key: &str,
    ) -> Result<Option<T>, ManagedError> {
        let Some((bytes, _version)) = self.blobs.get_cas_document(key).await.map_err(storage)?
        else {
            return Ok(None);
        };
        decode_record(&bytes).map(Some)
    }
}

// Keep the bounded blob observation private to `blob`; map it through the
// ordinary unbounded read, whose object-store implementation is itself
// bounded by the definition ceiling checked after retrieval.
trait PresentCas {
    fn into_present(self) -> Result<Option<(bytes::Bytes, CasVersion)>, ManagedError>;
}

impl PresentCas for crate::blob::BoundedCasDocument {
    fn into_present(self) -> Result<Option<(bytes::Bytes, CasVersion)>, ManagedError> {
        match self {
            Self::Missing => Ok(None),
            Self::Present(bytes, version) => Ok(Some((bytes, version))),
            Self::TooLarge {
                actual_bytes,
                max_bytes,
            } => Err(ManagedError::Storage(format!(
                "managed record is {actual_bytes} bytes; maximum is {max_bytes}"
            ))),
        }
    }
}

#[derive(Debug)]
struct ParsedEnvelope {
    delivery_id: String,
    external_id: String,
    challenge: Option<String>,
}

fn parse_envelope(
    provider: WebhookProvider,
    headers: &BTreeMap<String, String>,
    body: &[u8],
    now: i64,
) -> Result<ParsedEnvelope, ManagedError> {
    let payload: Value = serde_json::from_slice(body)
        .map_err(|error| ManagedError::Invalid(format!("malformed webhook JSON: {error}")))?;
    match provider {
        WebhookProvider::Github => Ok(ParsedEnvelope {
            delivery_id: header(headers, "x-github-delivery")?.to_owned(),
            external_id: json_id(payload.pointer("/installation/id"))?,
            challenge: None,
        }),
        WebhookProvider::Slack => {
            check_timestamp(header(headers, "x-slack-request-timestamp")?, now)?;
            if payload.get("type").and_then(Value::as_str) == Some("url_verification") {
                return Ok(ParsedEnvelope {
                    delivery_id: payload
                        .get("token")
                        .and_then(Value::as_str)
                        .unwrap_or("slack-challenge")
                        .to_owned(),
                    external_id: payload
                        .get("team_id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                    challenge: payload
                        .get("challenge")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                });
            }
            Ok(ParsedEnvelope {
                delivery_id: required_json_text(&payload, "/event_id")?,
                external_id: required_json_text(&payload, "/team_id")?,
                challenge: None,
            })
        }
        WebhookProvider::Linear => {
            if let Some(timestamp) = payload.get("webhookTimestamp").and_then(Value::as_i64) {
                let seconds = if timestamp > 10_000_000_000 {
                    timestamp / 1000
                } else {
                    timestamp
                };
                if (now - seconds).abs() > DEFAULT_REPLAY_WINDOW_SECONDS {
                    return Err(ManagedError::Replay);
                }
            }
            Ok(ParsedEnvelope {
                delivery_id: headers
                    .get("linear-delivery")
                    .cloned()
                    .or_else(|| {
                        payload
                            .get("webhookId")
                            .and_then(Value::as_str)
                            .map(str::to_owned)
                    })
                    .ok_or_else(|| {
                        ManagedError::Invalid("Linear delivery id is required".to_owned())
                    })?,
                external_id: payload
                    .get("organizationId")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .or_else(|| {
                        payload
                            .pointer("/organization/id")
                            .and_then(Value::as_str)
                            .map(str::to_owned)
                    })
                    .ok_or_else(|| {
                        ManagedError::Invalid("Linear organization is required".to_owned())
                    })?,
                challenge: None,
            })
        }
        WebhookProvider::Notion => Ok(ParsedEnvelope {
            delivery_id: payload
                .get("id")
                .and_then(Value::as_str)
                .or_else(|| headers.get("x-notion-delivery").map(String::as_str))
                .unwrap_or("notion-verification")
                .to_owned(),
            external_id: String::new(),
            challenge: payload
                .get("verification_token")
                .and_then(Value::as_str)
                .map(str::to_owned),
        }),
    }
}

pub fn provider_row(
    receipt: &WebhookReceipt,
    body: &[u8],
) -> Result<ProviderEventRow, ManagedError> {
    let payload: Value = serde_json::from_slice(body)
        .map_err(|error| ManagedError::Invalid(format!("malformed webhook JSON: {error}")))?;
    let row = match receipt.provider {
        WebhookProvider::Github => ProviderEventRow::Github {
            delivery: receipt.delivery_id.clone(),
            event: receipt
                .headers
                .get("x-github-event")
                .cloned()
                .unwrap_or_default(),
            action: payload
                .get("action")
                .and_then(Value::as_str)
                .map(str::to_owned),
            installation: payload.get("installation").cloned().unwrap_or(Value::Null),
            repository: payload.get("repository").cloned(),
            sender: payload.get("sender").cloned(),
            payload,
        },
        WebhookProvider::Slack => {
            let event = payload.get("event").cloned().unwrap_or(Value::Null);
            ProviderEventRow::Slack {
                event_id: receipt.delivery_id.clone(),
                event_type: event
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                event_time: payload.get("event_time").and_then(Value::as_i64),
                team: payload
                    .get("team_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                app: payload
                    .get("api_app_id")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                event,
                payload,
            }
        }
        WebhookProvider::Linear => ProviderEventRow::Linear {
            delivery: receipt.delivery_id.clone(),
            action: payload
                .get("action")
                .and_then(Value::as_str)
                .map(str::to_owned),
            event_type: payload
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            event_time: payload.get("webhookTimestamp").and_then(Value::as_i64),
            organization: payload
                .get("organizationId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            data: payload.get("data").cloned().unwrap_or(Value::Null),
            previous_values: payload.get("updatedFrom").cloned(),
            payload,
        },
        WebhookProvider::Notion => ProviderEventRow::Notion {
            event_id: receipt.delivery_id.clone(),
            event_type: payload
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            event_time: payload
                .get("timestamp")
                .and_then(Value::as_str)
                .map(str::to_owned),
            workspace: payload
                .pointer("/workspace/id")
                .and_then(Value::as_str)
                .map(str::to_owned),
            subscription: payload.get("subscription").cloned(),
            entity: payload.get("entity").cloned(),
            payload,
        },
    };
    Ok(row)
}

fn verify(
    provider: WebhookProvider,
    headers: &BTreeMap<String, String>,
    body: &[u8],
    secret: &[u8],
    now: i64,
) -> Result<(), ManagedError> {
    let (signature, signed): (&str, Vec<u8>) = match provider {
        WebhookProvider::Github => (
            header(headers, "x-hub-signature-256")?
                .strip_prefix("sha256=")
                .ok_or(ManagedError::Signature)?,
            body.to_vec(),
        ),
        WebhookProvider::Slack => {
            let timestamp = header(headers, "x-slack-request-timestamp")?;
            check_timestamp(timestamp, now)?;
            let mut signed = format!("v0:{timestamp}:").into_bytes();
            signed.extend_from_slice(body);
            (
                header(headers, "x-slack-signature")?
                    .strip_prefix("v0=")
                    .ok_or(ManagedError::Signature)?,
                signed,
            )
        }
        WebhookProvider::Linear => (header(headers, "linear-signature")?, body.to_vec()),
        WebhookProvider::Notion => {
            let value = header(headers, "x-notion-signature")?;
            (
                value.strip_prefix("sha256=").unwrap_or(value),
                body.to_vec(),
            )
        }
    };
    let decoded = hex::decode(signature).map_err(|_invalid_hex| ManagedError::Signature)?;
    let expected = hmac_sha256(secret, &signed);
    if constant_time_eq(&decoded, &expected) {
        Ok(())
    } else {
        Err(ManagedError::Signature)
    }
}

pub(crate) fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut normalized = [0_u8; BLOCK];
    if key.len() > BLOCK {
        normalized[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        normalized[..key.len()].copy_from_slice(key);
    }
    let mut inner_pad = [0x36_u8; BLOCK];
    let mut outer_pad = [0x5c_u8; BLOCK];
    for index in 0..BLOCK {
        inner_pad[index] ^= normalized[index];
        outer_pad[index] ^= normalized[index];
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner);
    outer.finalize().into()
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn check_timestamp(timestamp: &str, now: i64) -> Result<(), ManagedError> {
    let timestamp = timestamp.parse::<i64>().map_err(|_invalid_integer| {
        ManagedError::Invalid("webhook timestamp is invalid".to_owned())
    })?;
    if (now - timestamp).abs() > DEFAULT_REPLAY_WINDOW_SECONDS {
        Err(ManagedError::Replay)
    } else {
        Ok(())
    }
}

fn allowlisted_headers(
    provider: WebhookProvider,
    headers: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let allowed: &[&str] = match provider {
        WebhookProvider::Github => &["x-github-delivery", "x-github-event"],
        WebhookProvider::Slack => &["x-slack-request-timestamp"],
        WebhookProvider::Linear => &["linear-delivery"],
        WebhookProvider::Notion => &["x-notion-delivery"],
    };
    allowed
        .iter()
        .filter_map(|name| {
            headers
                .get(*name)
                .map(|value| ((*name).to_owned(), value.clone()))
        })
        .collect()
}

fn header<'a>(headers: &'a BTreeMap<String, String>, name: &str) -> Result<&'a str, ManagedError> {
    headers
        .get(name)
        .map(String::as_str)
        .ok_or_else(|| ManagedError::Invalid(format!("{name} header is required")))
}

fn required_json_text(value: &Value, pointer: &str) -> Result<String, ManagedError> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| ManagedError::Invalid(format!("{pointer} is required")))
}

fn json_id(value: Option<&Value>) -> Result<String, ManagedError> {
    match value {
        Some(Value::String(value)) => Ok(value.clone()),
        Some(Value::Number(value)) => Ok(value.to_string()),
        _ => Err(ManagedError::Invalid(
            "provider routing identity is required".to_owned(),
        )),
    }
}

fn validate_component(value: &str, label: &str) -> Result<(), ManagedError> {
    if crate::identity::is_safe_state_component(value) {
        Ok(())
    } else {
        Err(ManagedError::Invalid(format!(
            "{label} must be one safe path component"
        )))
    }
}

fn definition_key(web: &str, connector: &str) -> String {
    format!("managed/definitions/{web}/{connector}.json")
}

fn binding_key(web: &str, connector: &str, binding: &str) -> String {
    format!("managed/bindings/{web}/{connector}/{binding}.json")
}

fn binding_locator_key(binding: &str) -> String {
    format!("managed/binding-locators/{binding}.json")
}

fn route_key(provider: WebhookProvider, external_id: &str) -> String {
    format!(
        "managed/routing/{}/{}.json",
        provider.as_str(),
        identity_hash(provider, external_id)
    )
}

fn receipt_key(web: &str, connector: &str, provider: WebhookProvider, delivery: &str) -> String {
    format!(
        "managed/receipts/{web}/{connector}/{}/{}.json",
        provider.as_str(),
        hex::encode(Sha256::digest(delivery.as_bytes()))
    )
}

fn identity_hash(provider: WebhookProvider, external_id: &str) -> String {
    hex::encode(Sha256::digest(
        format!("{}:{external_id}", provider.as_str()).as_bytes(),
    ))
}

fn digest_value(value: &Value) -> String {
    hex::encode(Sha256::digest(canonical_json(value).as_bytes()))
}

fn canonical_json(value: &Value) -> String {
    fn sorted(value: &Value) -> Value {
        match value {
            Value::Object(map) => {
                let entries: BTreeMap<_, _> = map.iter().collect();
                Value::Object(
                    entries
                        .into_iter()
                        .map(|(key, value)| (key.clone(), sorted(value)))
                        .collect::<Map<_, _>>(),
                )
            }
            Value::Array(values) => Value::Array(values.iter().map(sorted).collect()),
            other => other.clone(),
        }
    }
    serde_json::to_string(&sorted(value)).expect("JSON values always serialize")
}

fn encode_record<T: Serialize>(value: &T) -> Result<Vec<u8>, ManagedError> {
    serde_json::to_vec(&StoredRecord {
        version: MANAGED_RECORD_VERSION,
        data: value,
    })
    .map_err(|error| ManagedError::Storage(format!("encode managed record: {error}")))
}

fn decode_record<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T, ManagedError> {
    let record: StoredRecord<T> = serde_json::from_slice(bytes)
        .map_err(|error| ManagedError::Storage(format!("decode managed record: {error}")))?;
    if record.version != MANAGED_RECORD_VERSION {
        return Err(ManagedError::Storage(format!(
            "unsupported managed record version {}",
            record.version
        )));
    }
    Ok(record.data)
}

fn storage(error: impl fmt::Debug) -> ManagedError {
    ManagedError::Storage(format!("managed object storage failed: {error:?}"))
}

fn now_rfc3339(seconds: i64) -> String {
    chrono::DateTime::from_timestamp(seconds, 0)
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339()
}

pub fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    const SECRET_UUID: &str = "22222222-2222-4222-8222-222222222222";

    #[test]
    fn secret_reference_serializes_as_an_entity_uuid() {
        let reference = SecretRef {
            entity_uuid: Uuid::parse_str(SECRET_UUID).expect("fixture secret UUID should be valid"),
        };

        let value =
            serde_json::to_value(reference).expect("secret reference should serialize as JSON");

        assert_eq!(
            value,
            json!({ "entityUuid": SECRET_UUID }),
            "secret reference should serialize only its entity UUID"
        );
    }

    #[test]
    fn legacy_hash_graph_vault_reference_keeps_its_entity_uuid() {
        let reference: SecretRef = serde_json::from_value(json!({
            "backend": "hash-graph-vault",
            "path": format!("11111111-1111-4111-8111-111111111111~{SECRET_UUID}")
        }))
        .expect("legacy HASH Graph Vault reference should deserialize");

        assert_eq!(
            reference.entity_uuid.to_string(),
            SECRET_UUID,
            "legacy HASH Graph Vault reference should keep its entity UUID"
        );
    }

    #[test]
    fn rejects_a_legacy_memory_reference() {
        let result = serde_json::from_value::<SecretRef>(json!({
            "backend": "memory",
            "path": "github/7"
        }));

        assert!(
            result.is_err(),
            "legacy memory reference should fail deserialization"
        );
    }

    fn definition(entity_type: &str) -> Value {
        json!({
            "connector": {
                "id": "events",
                "mode": "webhook",
                "provider": "github",
                "subscriptions": ["issues"]
            },
            "sources": {"events": {"kind": "table", "primaryKey": "delivery"}},
            "pipelines": {"entities": [{
                "source": "events",
                "steps": [{
                    "id": "sink", "kind": "graph-sink", "config": {
                        "entityType": entity_type, "entityId": "payload.id",
                        "webId": "web", "properties": {}
                    }
                }]
            }]}
        })
    }

    fn store() -> (ManagedStore, Arc<InMemorySecretStore>) {
        let cache = tempdir().expect("cache").keep();
        let blobs = ArtifactStore::in_memory(cache).expect("blob store");
        let secrets = Arc::new(InMemorySecretStore::default());
        (ManagedStore::new(blobs, secrets.clone()), secrets)
    }

    #[tokio::test]
    async fn exact_cas_and_identity_contract_are_enforced() {
        let (store, _) = store();
        let first = store
            .put_definition(
                "web",
                "events",
                "actor",
                definition("issue/v/1"),
                None,
                None,
            )
            .await
            .expect("create");
        assert!(matches!(
            store
                .put_definition(
                    "web",
                    "events",
                    "actor",
                    definition("issue/v/1"),
                    None,
                    None
                )
                .await,
            Err(ManagedError::Conflict { .. })
        ));
        assert!(matches!(
            store
                .put_definition(
                    "web",
                    "events",
                    "actor",
                    definition("issue/v/2"),
                    Some(&first.revision),
                    None
                )
                .await,
            Err(ManagedError::IdentityBreaking { .. })
        ));
    }

    #[tokio::test]
    async fn github_acceptance_is_durable_deduplicated_and_replay_stable() {
        let (store, secrets) = store();
        let created = store
            .put_definition(
                "web",
                "events",
                "actor",
                definition("issue/v/1"),
                None,
                None,
            )
            .await
            .expect("create");
        store
            .set_desired_state(
                "web",
                "events",
                ManagedDesiredState::Enabled,
                &created.revision,
            )
            .await
            .expect("enable");
        let secret_ref = SecretRef {
            entity_uuid: Uuid::new_v4(),
        };
        store
            .bind(
                ProviderBinding {
                    binding_id: "binding-7".to_owned(),
                    provider: WebhookProvider::Github,
                    external_id: "7".to_owned(),
                    web_id: "web".to_owned(),
                    connector_id: "events".to_owned(),
                    secret_ref: secret_ref.clone(),
                },
                Some(Secret::new(b"secret".to_vec())),
            )
            .await
            .expect("bind");
        assert!(
            secrets.read("web", &secret_ref).await.is_ok(),
            "secret reference should resolve in its binding web"
        );
        assert!(
            secrets.read("other-web", &secret_ref).await.is_err(),
            "in-memory secret store should isolate values by web"
        );
        let body = br#"{"installation":{"id":7},"action":"opened","future":{"kept":true}}"#;
        let headers = BTreeMap::from([
            ("x-github-delivery".to_owned(), "delivery-1".to_owned()),
            ("x-github-event".to_owned(), "issues".to_owned()),
            (
                "x-hub-signature-256".to_owned(),
                format!("sha256={}", hex::encode(hmac_sha256(b"secret", body))),
            ),
        ]);
        assert_eq!(
            store
                .accept(WebhookProvider::Github, None, &headers, body, 100)
                .await
                .expect("accept"),
            IngressDisposition::Accepted { targets: 1 }
        );
        assert_eq!(
            store
                .accept(WebhookProvider::Github, None, &headers, body, 100)
                .await
                .expect("deduplicate"),
            IngressDisposition::Duplicate { targets: 1 }
        );
        let events = store.pending_events("web", "events").await.expect("events");
        assert_eq!(events.len(), 1);
        assert!(matches!(
            &events[0].row,
            ProviderEventRow::Github { payload, .. }
                if payload.pointer("/future/kept") == Some(&Value::Bool(true))
        ));
        let first_batch = StreamMicroBatch::from_events(events.clone()).expect("batch");
        let replayed_batch = StreamMicroBatch::from_events(events).expect("replayed batch");
        assert_eq!(first_batch.run_id, replayed_batch.run_id);
    }

    #[test]
    fn github_and_slack_signatures_cover_exact_raw_bytes() {
        let body = br#"{"installation":{"id":7}}"#;
        let signature = hmac_sha256(b"secret", body);
        let mut headers = BTreeMap::from([
            ("x-github-delivery".to_owned(), "delivery-1".to_owned()),
            (
                "x-hub-signature-256".to_owned(),
                format!("sha256={}", hex::encode(signature)),
            ),
        ]);
        verify(WebhookProvider::Github, &headers, body, b"secret", 100).expect("signature");
        headers.insert("x-hub-signature-256".to_owned(), "sha256=00".to_owned());
        assert_eq!(
            verify(WebhookProvider::Github, &headers, body, b"secret", 100),
            Err(ManagedError::Signature)
        );
    }
}
