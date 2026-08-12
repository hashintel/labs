//! Live, operational-only controls backed by the durable blob store.
//!
//! These values may change while a run is active because they only affect
//! pacing and admission. The run's definition, pinned inputs, retry
//! policy, and checkpoints are immutable. The versioned CAS document is shared by all worker processes.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use error_stack::Report;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::blob::{ArtifactStore, CasWrite};
use crate::config::{self, Env};
use crate::error::BlobError;
use crate::throttle::rate::StaticShareError;

const SETTINGS_KEY: &str = "control/v1/runtime-settings.json";
const MAX_CAS_ATTEMPTS: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "value", rename_all = "snake_case")]
pub enum RuntimeSettings {
    V1(RuntimeSettingsV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeSettingsV1 {
    pub revision: u64,
    /// `None` inherits the worker's environment/default.
    pub max_concurrent_integrations: Option<usize>,
    /// New-engine process-wide Graph scheduling policy, keyed by web ID.
    #[serde(default)]
    pub graph_delivery: BTreeMap<String, GraphDeliverySettingsV1>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphDeliverySettingsV1 {
    /// Fleet-wide Graph HTTP request ceiling. Each configured worker receives
    /// a static share, so independently paced processes cannot exceed it.
    pub requests_per_second: u64,
}

impl GraphDeliverySettingsV1 {
    fn validate(&self) -> Result<(), StaticShareError> {
        if self.requests_per_second == 0 {
            return Err(StaticShareError::NoUsableRunnerRate);
        }
        Ok(())
    }
}

impl Default for RuntimeSettingsV1 {
    fn default() -> Self {
        Self {
            revision: 0,
            max_concurrent_integrations: None,
            graph_delivery: BTreeMap::new(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}

impl RuntimeSettings {
    pub fn current(&self) -> &RuntimeSettingsV1 {
        match self {
            Self::V1(value) => value,
        }
    }
}

#[derive(Clone)]
pub struct RuntimeSettingsStore {
    blobs: ArtifactStore,
}

impl RuntimeSettingsStore {
    pub fn open(env: &Env) -> Result<Self, Report<BlobError>> {
        Ok(Self {
            blobs: ArtifactStore::from_url(
                &config::blob_store_url(env),
                config::blob_cache_dir(env),
            )?,
        })
    }

    pub fn new(blobs: ArtifactStore) -> Self {
        Self { blobs }
    }

    pub async fn load(&self) -> Result<RuntimeSettingsV1, Report<BlobError>> {
        let settings = self
            .blobs
            .get_json::<RuntimeSettings>(SETTINGS_KEY)
            .await?
            .map_or_else(RuntimeSettingsV1::default, |(value, _)| {
                value.current().clone()
            });
        validate(&settings)?;
        Ok(settings)
    }

    pub async fn set_concurrency(
        &self,
        value: Option<usize>,
    ) -> Result<RuntimeSettingsV1, Report<BlobError>> {
        if value == Some(0) {
            return Err(
                Report::new(BlobError).attach_printable("runtime concurrency must be at least one")
            );
        }
        self.update(move |settings| settings.max_concurrent_integrations = value)
            .await
    }

    pub async fn set_graph_delivery(
        &self,
        web_id: &str,
        value: Option<GraphDeliverySettingsV1>,
    ) -> Result<RuntimeSettingsV1, Report<BlobError>> {
        let web_id = validate_web_id(web_id)?;
        if let Some(settings) = &value {
            if let Err(error) = settings.validate() {
                return Err(Report::new(BlobError).attach_printable(error));
            }
        }
        self.update(move |current| match &value {
            Some(value) => {
                current.graph_delivery.insert(web_id.clone(), value.clone());
            }
            None => {
                current.graph_delivery.remove(&web_id);
            }
        })
        .await
    }

    async fn update<F>(&self, mut update: F) -> Result<RuntimeSettingsV1, Report<BlobError>>
    where
        F: FnMut(&mut RuntimeSettingsV1),
    {
        for _ in 0..MAX_CAS_ATTEMPTS {
            let current = self.blobs.get_json::<RuntimeSettings>(SETTINGS_KEY).await?;
            let mut next = current
                .as_ref()
                .map_or_else(RuntimeSettingsV1::default, |(value, _)| {
                    value.current().clone()
                });
            update(&mut next);
            next.revision = next.revision.checked_add(1).ok_or_else(|| {
                Report::new(BlobError).attach_printable("runtime settings revision overflow")
            })?;
            next.updated_at = chrono::Utc::now().to_rfc3339();
            validate(&next)?;
            let document = RuntimeSettings::V1(next.clone());
            let write = match current {
                Some((_, version)) => {
                    self.blobs
                        .compare_and_swap_json(SETTINGS_KEY, &version, &document)
                        .await?
                }
                None => self.blobs.create_json(SETTINGS_KEY, &document).await?,
            };
            if let CasWrite::Written(_) = write {
                return Ok(next);
            }
        }
        Err(Report::new(BlobError).attach_printable(
            "runtime settings remained contended after 16 compare-and-swap attempts",
        ))
    }
}

fn validate(settings: &RuntimeSettingsV1) -> Result<(), Report<BlobError>> {
    if settings.max_concurrent_integrations == Some(0) {
        return Err(Report::new(BlobError)
            .attach_printable("stored runtime concurrency must be at least one"));
    }
    for (web_id, policy) in &settings.graph_delivery {
        validate_web_id(web_id)?;
        if let Err(error) = policy.validate() {
            return Err(Report::new(BlobError)
                .attach_printable(error)
                .attach_printable(format!(
                    "invalid Graph delivery settings for web {web_id:?}"
                )));
        }
    }
    Ok(())
}

fn validate_web_id(value: &str) -> Result<String, Report<BlobError>> {
    let web_id = value.trim();
    if web_id.is_empty() || web_id.contains('/') || web_id.contains("..") {
        return Err(Report::new(BlobError)
            .attach_printable("web ID must be non-empty and must not contain '/' or '..'"));
    }
    Ok(web_id.to_owned())
}

struct CachedSettings {
    value: RuntimeSettingsV1,
    last_attempt: Option<Instant>,
}

/// Small stale-on-error cache. A temporary settings read failure must not stop
/// active work or accidentally remove the last known safety limit.
pub struct RuntimeSettingsCache {
    store: RuntimeSettingsStore,
    state: Mutex<CachedSettings>,
    refresh_interval: Duration,
    read_timeout: Duration,
}

impl RuntimeSettingsCache {
    pub fn open(env: &Env) -> Result<Arc<Self>, Report<BlobError>> {
        Ok(Arc::new(Self::new(
            RuntimeSettingsStore::open(env)?,
            Duration::from_millis(config::runtime_settings_refresh_ms(env)),
            Duration::from_millis(config::control_read_timeout_ms(env)),
        )))
    }

    pub fn new(
        store: RuntimeSettingsStore,
        refresh_interval: Duration,
        read_timeout: Duration,
    ) -> Self {
        Self {
            store,
            state: Mutex::new(CachedSettings {
                value: RuntimeSettingsV1::default(),
                last_attempt: None,
            }),
            refresh_interval,
            read_timeout,
        }
    }

    pub async fn current(&self) -> RuntimeSettingsV1 {
        let mut state = self.state.lock().await;
        if state
            .last_attempt
            .is_some_and(|last| last.elapsed() < self.refresh_interval)
        {
            return state.value.clone();
        }
        state.last_attempt = Some(Instant::now());
        match tokio::time::timeout(self.read_timeout, self.store.load()).await {
            Ok(Ok(value)) => state.value = value,
            Ok(Err(error)) => {
                tracing::warn!(
                    ?error,
                    "runtime settings unavailable; keeping last known values"
                );
            }
            Err(_) => {
                tracing::warn!(
                    timeout_ms = self.read_timeout.as_millis(),
                    "runtime settings read timed out; keeping last known values"
                );
            }
        }
        state.value.clone()
    }

    pub async fn concurrency(&self, fallback: usize) -> usize {
        self.current()
            .await
            .max_concurrent_integrations
            .unwrap_or(fallback)
            .max(1)
            // The startup value also determines each DuckDB store's memory,
            // temp-space and thread share. A live override may safely lower
            // admission, but exceeding that resource envelope requires a
            // restart with a larger MAX_CONCURRENT_INTEGRATIONS.
            .min(fallback.max(1))
    }

    pub async fn graph_delivery(&self, scope: &str) -> (u64, Option<GraphDeliverySettingsV1>) {
        let settings = self.current().await;
        let web_id = scope.strip_prefix("web:").unwrap_or(scope);
        (
            settings.revision,
            settings.graph_delivery.get(web_id).cloned(),
        )
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn cas_updates_preserve_independent_controls() {
        let remote = tempdir().unwrap();
        let cache = tempdir().unwrap();
        let store =
            RuntimeSettingsStore::new(ArtifactStore::local(remote.path(), cache.path()).unwrap());
        store.set_concurrency(Some(7)).await.unwrap();
        store
            .set_graph_delivery(
                "alice",
                Some(GraphDeliverySettingsV1 {
                    requests_per_second: 123,
                }),
            )
            .await
            .unwrap();

        let settings = store.load().await.unwrap();
        assert_eq!(settings.revision, 2);
        assert_eq!(settings.max_concurrent_integrations, Some(7));
        assert_eq!(
            settings.graph_delivery["alice"],
            GraphDeliverySettingsV1 {
                requests_per_second: 123
            }
        );
    }

    #[tokio::test]
    async fn live_concurrency_cannot_exceed_startup_resource_envelope() {
        let store =
            RuntimeSettingsStore::new(ArtifactStore::in_memory(tempdir().unwrap().path()).unwrap());
        store.set_concurrency(Some(99)).await.unwrap();
        let cache = RuntimeSettingsCache::new(store, Duration::ZERO, Duration::from_secs(1));
        assert_eq!(cache.concurrency(4).await, 4);
    }

    #[tokio::test]
    async fn graph_request_rate_is_live_and_can_return_to_the_startup_default() {
        let store =
            RuntimeSettingsStore::new(ArtifactStore::in_memory(tempdir().unwrap().path()).unwrap());
        let valid = GraphDeliverySettingsV1 {
            requests_per_second: 100,
        };
        let accepted = store
            .set_graph_delivery("alice", Some(valid.clone()))
            .await
            .unwrap();
        let cache =
            RuntimeSettingsCache::new(store.clone(), Duration::ZERO, Duration::from_secs(1));
        assert_eq!(
            cache.graph_delivery("web:alice").await,
            (accepted.revision, Some(valid))
        );

        let restored = store.set_graph_delivery("alice", None).await.unwrap();
        assert_eq!(
            cache.graph_delivery("web:alice").await,
            (restored.revision, None)
        );
    }

    #[tokio::test]
    async fn zero_graph_request_rate_fails_without_changing_the_revision() {
        let store =
            RuntimeSettingsStore::new(ArtifactStore::in_memory(tempdir().unwrap().path()).unwrap());
        assert!(store
            .set_graph_delivery(
                "alice",
                Some(GraphDeliverySettingsV1 {
                    requests_per_second: 0,
                }),
            )
            .await
            .is_err());
        assert_eq!(store.load().await.unwrap().revision, 0);
    }

    #[test]
    fn runtime_settings_fail_closed_on_unknown_controls() {
        let document = serde_json::json!({
            "version": "v1",
            "value": {
                "revision": 1,
                "maxConcurrentIntegrations": null,
                "graphDelivery": {},
                "updatedAt": "2026-08-04T00:00:00Z",
                "unknownControl": 500
            }
        });
        assert!(serde_json::from_value::<RuntimeSettings>(document).is_err());
    }
}
