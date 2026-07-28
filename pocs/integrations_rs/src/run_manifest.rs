//! Durable, run-scoped recovery metadata.
//!
//! A manifest pins every admitted source input before Graph effects begin.
//! Attempts for the same canonical run therefore replay identical bytes even
//! when the live source changes or the local DuckDB workspace disappears.

use std::collections::{BTreeMap, BTreeSet};

use chrono::Utc;
use error_stack::{Report, ResultExt};
use serde::{Deserialize, Serialize};

use crate::blob::{ArtifactStore, BlobNamespace, BlobRef, CasVersion, CasWrite};
use crate::error::StateError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "value", rename_all = "snake_case")]
pub enum RunManifest {
    V1(RunManifestV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunManifestV1 {
    pub run_id: String,
    pub definition_digest: String,
    pub phase: RunPhaseV1,
    #[serde(default)]
    pub inputs: BTreeMap<String, AdmittedInputV1>,
    #[serde(default)]
    pub checkpoints: BTreeMap<String, BlobRef>,
    #[serde(default)]
    pub completed_sources: BTreeSet<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum RunPhaseV1 {
    Sources,
    SourcesCommitted,
    Links,
    LinksCommitted,
    Failed { step: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdmittedInputV1 {
    pub loaded_at: String,
    pub row_count: i64,
    pub object: BlobRef,
}

impl RunManifest {
    pub fn current(&self) -> &RunManifestV1 {
        match self {
            Self::V1(value) => value,
        }
    }
}

#[derive(Debug, Clone)]
pub struct RunManifestRepository {
    blobs: ArtifactStore,
    namespace: BlobNamespace,
    run_id: String,
    definition_digest: String,
}

impl RunManifestRepository {
    pub fn new(
        blobs: ArtifactStore,
        namespace: BlobNamespace,
        run_id: &str,
        definition_digest: &str,
    ) -> Self {
        Self {
            blobs,
            namespace,
            run_id: run_id.to_owned(),
            definition_digest: definition_digest.to_owned(),
        }
    }

    fn key(&self) -> Result<String, Report<StateError>> {
        self.namespace
            .key(&format!("runs/{}/current.json", self.run_id))
            .change_context(StateError)
    }

    pub async fn open_or_create(&self) -> Result<RunManifest, Report<StateError>> {
        if let Some((manifest, _)) = self.load_versioned().await? {
            self.validate(&manifest)?;
            return Ok(manifest);
        }

        let now = Utc::now().to_rfc3339();
        let manifest = RunManifest::V1(RunManifestV1 {
            run_id: self.run_id.clone(),
            definition_digest: self.definition_digest.clone(),
            phase: RunPhaseV1::Sources,
            inputs: BTreeMap::new(),
            checkpoints: BTreeMap::new(),
            completed_sources: BTreeSet::new(),
            created_at: now.clone(),
            updated_at: now,
        });
        match self
            .blobs
            .create_json(&self.key()?, &manifest)
            .await
            .change_context(StateError)?
        {
            CasWrite::Written(_) => Ok(manifest),
            CasWrite::Conflict => {
                let (winner, _) = self.load_versioned().await?.ok_or_else(|| {
                    Report::new(StateError)
                        .attach_printable("run manifest was created concurrently but is missing")
                })?;
                self.validate(&winner)?;
                Ok(winner)
            }
        }
    }

    pub async fn load(&self) -> Result<Option<RunManifest>, Report<StateError>> {
        let value = self.load_versioned().await?.map(|(manifest, _)| manifest);
        if let Some(manifest) = &value {
            self.validate(manifest)?;
        }
        Ok(value)
    }

    pub async fn admitted_input(
        &self,
        source: &str,
    ) -> Result<Option<AdmittedInputV1>, Report<StateError>> {
        Ok(self
            .load()
            .await?
            .and_then(|manifest| manifest.current().inputs.get(source).cloned()))
    }

    pub async fn admit_input(
        &self,
        source: &str,
        input: AdmittedInputV1,
    ) -> Result<(), Report<StateError>> {
        self.update(|manifest| {
            if let Some(existing) = manifest.inputs.get(source) {
                if existing != &input {
                    return Err(format!(
                        "source {source:?} is already admitted with different immutable input"
                    ));
                }
                return Ok(());
            }
            manifest.inputs.insert(source.to_owned(), input);
            Ok(())
        })
        .await
    }

    pub async fn record_checkpoint(
        &self,
        name: &str,
        object: BlobRef,
    ) -> Result<(), Report<StateError>> {
        self.update(|manifest| {
            manifest.checkpoints.insert(name.to_owned(), object);
            Ok(())
        })
        .await
    }

    pub async fn checkpoint(&self, name: &str) -> Result<Option<BlobRef>, Report<StateError>> {
        Ok(self
            .load()
            .await?
            .and_then(|manifest| manifest.current().checkpoints.get(name).cloned()))
    }

    /// Pin an input checkpoint once. A later retry must never substitute a
    /// newer generation merely because the integration-level pointer moved.
    pub async fn pin_checkpoint(
        &self,
        name: &str,
        object: BlobRef,
    ) -> Result<(), Report<StateError>> {
        self.update(|manifest| {
            if let Some(existing) = manifest.checkpoints.get(name) {
                if existing != &object {
                    return Err(format!(
                        "checkpoint {name:?} is already pinned to a different object"
                    ));
                }
                return Ok(());
            }
            manifest.checkpoints.insert(name.to_owned(), object);
            Ok(())
        })
        .await
    }

    pub async fn source_completed(&self, source: &str) -> Result<(), Report<StateError>> {
        self.update(|manifest| {
            manifest.completed_sources.insert(source.to_owned());
            Ok(())
        })
        .await
    }

    pub async fn set_phase(&self, phase: RunPhaseV1) -> Result<(), Report<StateError>> {
        self.update(|manifest| {
            manifest.phase = phase;
            Ok(())
        })
        .await
    }

    async fn update(
        &self,
        mutate: impl FnOnce(&mut RunManifestV1) -> Result<(), String>,
    ) -> Result<(), Report<StateError>> {
        let (mut current, version) = self.load_versioned().await?.ok_or_else(|| {
            Report::new(StateError).attach_printable("run manifest is not initialized")
        })?;
        self.validate(&current)?;
        let RunManifest::V1(value) = &mut current;
        mutate(value).map_err(|message| Report::new(StateError).attach_printable(message))?;
        value.updated_at = Utc::now().to_rfc3339();
        match self
            .blobs
            .compare_and_swap_json(&self.key()?, &version, &current)
            .await
            .change_context(StateError)?
        {
            CasWrite::Written(_) => Ok(()),
            CasWrite::Conflict => Err(Report::new(StateError).attach_printable(format!(
                "run manifest CAS conflict for {}; another writer advanced the run",
                self.run_id
            ))),
        }
    }

    async fn load_versioned(
        &self,
    ) -> Result<Option<(RunManifest, CasVersion)>, Report<StateError>> {
        self.blobs
            .get_json(&self.key()?)
            .await
            .change_context(StateError)
    }

    fn validate(&self, manifest: &RunManifest) -> Result<(), Report<StateError>> {
        let current = manifest.current();
        if current.run_id != self.run_id || current.definition_digest != self.definition_digest {
            return Err(Report::new(StateError).attach_printable(format!(
                "run manifest identity mismatch: expected run {} definition {}, found run {} definition {}",
                self.run_id,
                self.definition_digest,
                current.run_id,
                current.definition_digest
            )));
        }
        Ok(())
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn admitted_input_is_immutable_across_repository_instances() {
        let remote = tempfile::tempdir().unwrap();
        let first_cache = tempfile::tempdir().unwrap();
        let second_cache = tempfile::tempdir().unwrap();
        let namespace = BlobNamespace::new("alice", "sap").unwrap();
        let first = RunManifestRepository::new(
            ArtifactStore::local(remote.path(), first_cache.path()).unwrap(),
            namespace.clone(),
            "run-1",
            "digest-1",
        );
        first.open_or_create().await.unwrap();

        let staged = first.blobs.stage(".parquet").unwrap();
        std::fs::write(&staged, b"exact input").unwrap();
        let object = first
            .blobs
            .publish(&staged, "test/bronze", "application/octet-stream")
            .await
            .unwrap();
        let admitted = AdmittedInputV1 {
            loaded_at: "2026-07-15T00:00:00Z".to_owned(),
            row_count: 1,
            object,
        };
        first
            .admit_input("materials", admitted.clone())
            .await
            .unwrap();

        let second = RunManifestRepository::new(
            ArtifactStore::local(remote.path(), second_cache.path()).unwrap(),
            namespace,
            "run-1",
            "digest-1",
        );
        assert_eq!(
            second.admitted_input("materials").await.unwrap(),
            Some(admitted)
        );
    }
}
