//! Durable medallion artifacts referenced through small CAS indexes.
//!
//! Bronze history and named (silver) checkpoints are immutable Parquet
//! objects. Readers never list hashes: a tenant/integration-scoped index is
//! the discoverable source of truth.

use chrono::Utc;
use error_stack::{Report, ResultExt};
use serde::{Deserialize, Serialize};

use crate::blob::{ArtifactStore, BlobNamespace, BlobRef, CasVersion, CasWrite};
use crate::error::SourceError;
use crate::store::{lit, qi, Store};

const BRONZE_KEEP: usize = 3;

#[derive(Debug, Clone)]
pub struct ArtifactRepository {
    blobs: ArtifactStore,
    namespace: BlobNamespace,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "value", rename_all = "snake_case")]
enum CheckpointHead {
    V1(CheckpointHeadV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckpointHeadV1 {
    object: BlobRef,
    committed_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "value", rename_all = "snake_case")]
enum BronzeIndex {
    V1(BronzeIndexV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BronzeIndexV1 {
    snapshots: Vec<BronzeSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BronzeSnapshot {
    loaded_at: String,
    object: BlobRef,
}

impl ArtifactRepository {
    pub fn new(blobs: ArtifactStore, namespace: BlobNamespace) -> Self {
        Self { blobs, namespace }
    }

    pub fn staging_root(&self) -> &std::path::Path {
        self.blobs.staging_root()
    }

    pub fn materialized_root(&self) -> std::path::PathBuf {
        self.blobs.materialized_root()
    }

    pub async fn materialize(
        &self,
        object: &BlobRef,
    ) -> Result<std::path::PathBuf, Report<SourceError>> {
        self.blobs
            .materialize(object)
            .await
            .change_context(SourceError)
    }

    pub async fn write_checkpoint(
        &self,
        store: &Store,
        name: &str,
        table: &str,
    ) -> Result<BlobRef, Report<SourceError>> {
        let staged = self.blobs.stage(".parquet").change_context(SourceError)?;
        store
            .exec(&format!(
                "COPY (SELECT * FROM {}) TO {} (FORMAT PARQUET)",
                qi(table),
                lit(&staged.display().to_string())
            ))
            .await
            .change_context(SourceError)?;
        let logical = self
            .namespace
            .key(&format!("artifacts/silver/{name}"))
            .change_context(SourceError)?;
        let object = self
            .blobs
            .publish(&staged, &logical, "application/vnd.apache.parquet")
            .await
            .change_context(SourceError)?;
        let _ = tokio::fs::remove_file(staged).await;

        let pointer = self
            .namespace
            .key(&format!("checkpoints/{name}/current.json"))
            .change_context(SourceError)?;
        let value = CheckpointHead::V1(CheckpointHeadV1 {
            object: object.clone(),
            committed_at: Utc::now().to_rfc3339(),
        });
        self.cas_replace(&pointer, &value).await?;
        Ok(object)
    }

    pub async fn read_checkpoint(
        &self,
        name: &str,
    ) -> Result<Option<std::path::PathBuf>, Report<SourceError>> {
        Ok(self.resolve_checkpoint(name).await?.map(|(_, path)| path))
    }

    /// Resolve the current checkpoint generation together with its immutable
    /// object identity. Durable runs persist that identity in their manifest
    /// and materialize it directly on replay instead of following this mutable
    /// pointer again.
    pub async fn resolve_checkpoint(
        &self,
        name: &str,
    ) -> Result<Option<(BlobRef, std::path::PathBuf)>, Report<SourceError>> {
        let pointer = self
            .namespace
            .key(&format!("checkpoints/{name}/current.json"))
            .change_context(SourceError)?;
        let Some((head, _)) = self
            .blobs
            .get_json::<CheckpointHead>(&pointer)
            .await
            .change_context(SourceError)?
        else {
            return Ok(None);
        };
        let object = match head {
            CheckpointHead::V1(value) => value.object,
        };
        let path = self
            .blobs
            .materialize(&object)
            .await
            .change_context(SourceError)?;
        Ok(Some((object, path)))
    }

    pub async fn write_bronze(
        &self,
        store: &Store,
        source: &str,
        table: &str,
        loaded_at: &str,
    ) -> Result<BlobRef, Report<SourceError>> {
        let staged = self.blobs.stage(".parquet").change_context(SourceError)?;
        store
            .exec(&format!(
                "COPY (SELECT * FROM {}) TO {} (FORMAT PARQUET)",
                qi(table),
                lit(&staged.display().to_string())
            ))
            .await
            .change_context(SourceError)?;
        let logical = self
            .namespace
            .key(&format!("artifacts/bronze/{source}"))
            .change_context(SourceError)?;
        let object = self
            .blobs
            .publish(&staged, &logical, "application/vnd.apache.parquet")
            .await
            .change_context(SourceError)?;
        let _ = tokio::fs::remove_file(staged).await;

        let index_key = self
            .namespace
            .key(&format!("bronze/{source}/index.json"))
            .change_context(SourceError)?;
        let current = self
            .blobs
            .get_json::<BronzeIndex>(&index_key)
            .await
            .change_context(SourceError)?;
        let mut snapshots = match &current {
            Some((BronzeIndex::V1(value), _)) => value.snapshots.clone(),
            None => vec![],
        };
        snapshots.retain(|snapshot| snapshot.loaded_at != loaded_at);
        snapshots.push(BronzeSnapshot {
            loaded_at: loaded_at.to_owned(),
            object: object.clone(),
        });
        snapshots.sort_by(|left, right| left.loaded_at.cmp(&right.loaded_at));
        if snapshots.len() > BRONZE_KEEP {
            snapshots.drain(..snapshots.len() - BRONZE_KEEP);
        }
        let value = BronzeIndex::V1(BronzeIndexV1 { snapshots });
        self.cas_write(&index_key, current.map(|(_, version)| version), &value)
            .await?;
        Ok(object)
    }

    pub async fn read_bronze(
        &self,
        source: &str,
        prefix: Option<&str>,
    ) -> Result<Option<(String, std::path::PathBuf)>, Report<SourceError>> {
        Ok(self
            .resolve_bronze(source, prefix)
            .await?
            .map(|(loaded_at, _, path)| (loaded_at, path)))
    }

    pub async fn resolve_bronze(
        &self,
        source: &str,
        prefix: Option<&str>,
    ) -> Result<Option<(String, BlobRef, std::path::PathBuf)>, Report<SourceError>> {
        let index_key = self
            .namespace
            .key(&format!("bronze/{source}/index.json"))
            .change_context(SourceError)?;
        let Some((BronzeIndex::V1(index), _)) = self
            .blobs
            .get_json::<BronzeIndex>(&index_key)
            .await
            .change_context(SourceError)?
        else {
            return Ok(None);
        };
        let snapshot = match prefix {
            None => index.snapshots.last(),
            Some(prefix) => index
                .snapshots
                .iter()
                .find(|snapshot| snapshot.loaded_at.starts_with(prefix)),
        };
        let Some(snapshot) = snapshot else {
            return Ok(None);
        };
        let path = self
            .blobs
            .materialize(&snapshot.object)
            .await
            .change_context(SourceError)?;
        Ok(Some((
            snapshot.loaded_at.clone(),
            snapshot.object.clone(),
            path,
        )))
    }

    async fn cas_replace<T: Serialize + serde::de::DeserializeOwned + Sync>(
        &self,
        key: &str,
        value: &T,
    ) -> Result<(), Report<SourceError>> {
        let current = self
            .blobs
            .get_json::<T>(key)
            .await
            .change_context(SourceError)?;
        self.cas_write(key, current.map(|(_, version)| version), value)
            .await
    }

    async fn cas_write<T: Serialize + Sync>(
        &self,
        key: &str,
        current: Option<CasVersion>,
        value: &T,
    ) -> Result<(), Report<SourceError>> {
        let write = match current {
            None => self
                .blobs
                .create_json(key, value)
                .await
                .change_context(SourceError)?,
            Some(version) => self
                .blobs
                .compare_and_swap_json(key, &version, value)
                .await
                .change_context(SourceError)?,
        };
        match write {
            CasWrite::Written(_) => Ok(()),
            CasWrite::Conflict => Err(Report::new(SourceError).attach_printable(format!(
                "artifact index CAS conflict at {key}; another writer committed first"
            ))),
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use crate::store::StoreOptions;

    #[tokio::test]
    async fn checkpoints_and_bronze_restore_without_the_original_working_directory() {
        let remote = tempfile::tempdir().unwrap();
        let local = tempfile::tempdir().unwrap();
        let blobs = ArtifactStore::local(remote.path(), local.path().join("cache")).unwrap();
        let repository =
            ArtifactRepository::new(blobs, BlobNamespace::new("alice", "supply-chain").unwrap());
        let store = Store::open(StoreOptions {
            path: Some(local.path().join("store.duckdb")),
            allowed_directories: Some(vec![
                repository.staging_root().to_owned(),
                repository.materialized_root(),
            ]),
            ..StoreOptions::default()
        })
        .unwrap();
        store
            .exec("CREATE TABLE source AS SELECT 1 AS id, 'part' AS value")
            .await
            .unwrap();
        repository
            .write_checkpoint(&store, "parts", "source")
            .await
            .unwrap();
        repository
            .write_bronze(&store, "parts", "source", "2026-07-15T12:00:00Z")
            .await
            .unwrap();

        let checkpoint = repository.read_checkpoint("parts").await.unwrap().unwrap();
        assert!(checkpoint.is_file());
        let count = store
            .query(&format!(
                "SELECT COUNT(*)::BIGINT FROM read_parquet({})",
                lit(&checkpoint.display().to_string())
            ))
            .await
            .unwrap()
            .single_i64();
        assert_eq!(count, 1);
        let (loaded_at, path) = repository
            .read_bronze("parts", Some("2026-07-15"))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded_at, "2026-07-15T12:00:00Z");
        assert!(path.is_file());
    }
}
