//! Durable, provider-neutral blob storage.
//!
//! Large artifacts are immutable and content-addressed. Small mutable
//! documents use object-store conditional writes, which is the only CAS
//! primitive the orchestration layer needs. DuckDB never receives provider
//! credentials: callers materialize immutable blobs into a read-only local
//! cache and create outputs in the separate staging directory.

use std::collections::{BTreeMap, VecDeque};
use std::fmt;
use std::fs::File;
use std::io::{Read, Seek, Write};
use std::path::{Path as FsPath, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use error_stack::{Report, ResultExt};
use fs4::fs_std::FileExt as _;
use futures::stream::BoxStream;
use futures::StreamExt;
use object_store::aws::{AmazonS3Builder, Checksum};
use object_store::buffered::BufWriter;
use object_store::local::LocalFileSystem;
use object_store::memory::InMemory;
use object_store::path::Path as ObjectPath;
use object_store::{
    GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta, ObjectStore, PutMode,
    PutMultipartOptions, PutOptions, PutPayload, PutResult, UpdateVersion, UploadPart,
};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

use crate::error::BlobError;
use crate::progress::{ObjectStoreOperation, OperationalTelemetry};

const UPLOAD_CHUNK_SIZE: usize = 8 * 1024 * 1024;
const VERIFIED_MATERIALIZATION_CACHE_ENTRIES: usize = 8;
const VERIFIED_MATERIALIZATION_CACHE_MAX_BYTES: u64 = 1024 * 1024 * 1024;

/// Instruments the provider-neutral storage boundary. This counts calls the
/// engine makes through `object_store`, including individual multipart parts,
/// without issuing any observation-only request.
#[derive(Debug)]
struct ObservedObjectStore {
    inner: Arc<dyn ObjectStore>,
    telemetry: OperationalTelemetry,
}

impl fmt::Display for ObservedObjectStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "observed({})", self.inner)
    }
}

#[async_trait::async_trait]
impl ObjectStore for ObservedObjectStore {
    async fn put_opts(
        &self,
        location: &ObjectPath,
        payload: PutPayload,
        options: PutOptions,
    ) -> object_store::Result<PutResult> {
        let bytes = u64::try_from(payload.content_length()).unwrap_or(u64::MAX);
        let started = std::time::Instant::now();
        let result = self.inner.put_opts(location, payload, options).await;
        self.telemetry.record_object_store_operation(
            ObjectStoreOperation::Put,
            bytes,
            started.elapsed(),
            result.is_ok(),
        );
        result
    }

    async fn put_multipart_opts(
        &self,
        location: &ObjectPath,
        options: PutMultipartOptions,
    ) -> object_store::Result<Box<dyn MultipartUpload>> {
        let started = std::time::Instant::now();
        let result = self.inner.put_multipart_opts(location, options).await;
        if result.is_err() {
            self.telemetry.record_object_store_operation(
                ObjectStoreOperation::Put,
                0,
                started.elapsed(),
                false,
            );
        }
        result.map(|inner| {
            Box::new(ObservedMultipartUpload {
                inner,
                telemetry: self.telemetry.clone(),
            }) as Box<dyn MultipartUpload>
        })
    }

    async fn get_opts(
        &self,
        location: &ObjectPath,
        options: GetOptions,
    ) -> object_store::Result<GetResult> {
        let is_head = options.head;
        let started = std::time::Instant::now();
        let result = self.inner.get_opts(location, options).await;
        let bytes = result
            .as_ref()
            .map_or(0, |value| value.range.end.saturating_sub(value.range.start));
        self.telemetry.record_object_store_operation(
            if is_head {
                ObjectStoreOperation::Head
            } else {
                ObjectStoreOperation::Get
            },
            if is_head { 0 } else { bytes },
            started.elapsed(),
            result.is_ok(),
        );
        result
    }

    async fn delete(&self, location: &ObjectPath) -> object_store::Result<()> {
        let started = std::time::Instant::now();
        let result = self.inner.delete(location).await;
        self.telemetry.record_object_store_operation(
            ObjectStoreOperation::Delete,
            0,
            started.elapsed(),
            result.is_ok(),
        );
        result
    }

    fn list(
        &self,
        prefix: Option<&ObjectPath>,
    ) -> BoxStream<'static, object_store::Result<ObjectMeta>> {
        // Provider pagination is intentionally opaque at this boundary. One
        // counter value is one engine LIST scan, while returned object bytes
        // are not charged as payload bytes.
        self.telemetry.record_object_store_operation(
            ObjectStoreOperation::List,
            0,
            Duration::ZERO,
            true,
        );
        self.inner.list(prefix)
    }

    async fn list_with_delimiter(
        &self,
        prefix: Option<&ObjectPath>,
    ) -> object_store::Result<ListResult> {
        let started = std::time::Instant::now();
        let result = self.inner.list_with_delimiter(prefix).await;
        self.telemetry.record_object_store_operation(
            ObjectStoreOperation::List,
            0,
            started.elapsed(),
            result.is_ok(),
        );
        result
    }

    async fn copy(&self, from: &ObjectPath, to: &ObjectPath) -> object_store::Result<()> {
        let started = std::time::Instant::now();
        let result = self.inner.copy(from, to).await;
        self.telemetry.record_object_store_operation(
            ObjectStoreOperation::Copy,
            0,
            started.elapsed(),
            result.is_ok(),
        );
        result
    }

    async fn copy_if_not_exists(
        &self,
        from: &ObjectPath,
        to: &ObjectPath,
    ) -> object_store::Result<()> {
        let started = std::time::Instant::now();
        let result = self.inner.copy_if_not_exists(from, to).await;
        self.telemetry.record_object_store_operation(
            ObjectStoreOperation::Copy,
            0,
            started.elapsed(),
            result.is_ok(),
        );
        result
    }
}

#[derive(Debug)]
struct ObservedMultipartUpload {
    inner: Box<dyn MultipartUpload>,
    telemetry: OperationalTelemetry,
}

#[async_trait::async_trait]
impl MultipartUpload for ObservedMultipartUpload {
    fn put_part(&mut self, data: PutPayload) -> UploadPart {
        let bytes = u64::try_from(data.content_length()).unwrap_or(u64::MAX);
        let part = self.inner.put_part(data);
        let telemetry = self.telemetry.clone();
        Box::pin(async move {
            let started = std::time::Instant::now();
            let result = part.await;
            telemetry.record_multipart_part(bytes, started.elapsed(), result.is_ok());
            result
        })
    }

    async fn complete(&mut self) -> object_store::Result<PutResult> {
        let started = std::time::Instant::now();
        let result = self.inner.complete().await;
        self.telemetry
            .record_multipart_complete(started.elapsed(), result.is_ok());
        result
    }

    async fn abort(&mut self) -> object_store::Result<()> {
        let started = std::time::Instant::now();
        let result = self.inner.abort().await;
        self.telemetry
            .record_multipart_abort(started.elapsed(), result.is_ok());
        result
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "value", rename_all = "snake_case")]
pub enum BlobRef {
    V1(BlobRefV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlobRefV1 {
    /// Object key relative to the configured bucket/root.
    pub key: String,
    pub sha256: String,
    pub size: u64,
    pub media_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub e_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_version: Option<String>,
}

impl BlobRef {
    pub fn current(&self) -> &BlobRefV1 {
        match self {
            Self::V1(value) => value,
        }
    }
}

/// The artifacts required to reproduce or resume a run. New representations
/// are added as enum variants; readers retain explicit backwards-compatibility
/// code instead of guessing from optional fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "value", rename_all = "snake_case")]
pub enum ArtifactSet {
    V1(ArtifactSetV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSetV1 {
    #[serde(default)]
    pub bronze: Vec<BlobRef>,
    #[serde(default)]
    pub checkpoints: BTreeMap<String, BlobRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<StateSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "value", rename_all = "snake_case")]
pub enum StateSnapshot {
    V1(StateSnapshotV1),
}

impl StateSnapshot {
    pub fn current(&self) -> &StateSnapshotV1 {
        match self {
            Self::V1(value) => value,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateSnapshotV1 {
    pub generation: u64,
    pub duckdb: BlobRef,
    #[serde(default)]
    pub accepted_batches: Vec<BlobRef>,
    pub created_at: String,
}

/// A store-version token. Both fields must be retained because providers use
/// different combinations for conditional writes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "value", rename_all = "snake_case")]
pub enum CasVersion {
    V1(CasVersionV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CasVersionV1 {
    pub e_tag: Option<String>,
    pub provider_version: Option<String>,
}

impl CasVersion {
    fn update_version(&self) -> UpdateVersion {
        match self {
            Self::V1(value) => UpdateVersion {
                e_tag: value.e_tag.clone(),
                version: value.provider_version.clone(),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CasWrite {
    Written(CasVersion),
    Conflict,
}

pub(crate) enum BoundedCasDocument {
    Missing,
    Present(Bytes, CasVersion),
    TooLarge { actual_bytes: u64, max_bytes: usize },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListedObject {
    pub key: String,
    pub size: u64,
    pub e_tag: Option<String>,
    pub provider_version: Option<String>,
    pub last_modified: String,
}

/// Verified cache object whose process lock remains held for the lifetime of
/// the guard. Workspace restoration keeps this guard until copying is done,
/// so an LRU pass cannot unlink bytes midway through materialization.
pub struct MaterializedBlob {
    path: PathBuf,
    _lock: File,
}

#[derive(Default)]
struct VerifiedMaterializationCache {
    entries: VecDeque<(BlobRef, Arc<MaterializedBlob>)>,
    bytes: u64,
}

struct CacheReservation {
    path: PathBuf,
    file: File,
}

impl Drop for CacheReservation {
    fn drop(&mut self) {
        let _ = fs4::fs_std::FileExt::unlock(&self.file);
        let _ = std::fs::remove_file(&self.path);
    }
}

impl MaterializedBlob {
    pub fn path(&self) -> &FsPath {
        &self.path
    }
}

/// Stable tenant/integration namespace. Run identifiers and content hashes
/// live below this root; they never replace web identity as the tenancy key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlobNamespace {
    root: String,
}

impl BlobNamespace {
    pub fn new(web_id: &str, integration_id: &str) -> Result<Self, Report<BlobError>> {
        validate_segment("web id", web_id)?;
        validate_segment("integration id", integration_id)?;
        Ok(Self {
            root: format!("tenants/{web_id}/integrations/{integration_id}"),
        })
    }

    pub fn v1(
        tenant: &crate::orchestrator::ids::TenantNamespace,
        integration: &crate::orchestrator::routing::IntegrationPath,
    ) -> Self {
        Self {
            root: crate::kernel::keyspace::Keyspace::for_tenant(tenant)
                .integration_root(integration),
        }
    }

    pub fn root(&self) -> String {
        self.root.clone()
    }

    pub fn key(&self, relative: &str) -> Result<String, Report<BlobError>> {
        validate_relative_key(relative)?;
        Ok(format!("{}/{}", self.root(), relative))
    }
}

#[derive(Clone)]
pub struct ArtifactStore {
    store: Arc<dyn ObjectStore>,
    telemetry: OperationalTelemetry,
    prefix: String,
    /// Filesystem backend root, used to emulate conditional update because
    /// object_store's LocalFileSystem intentionally returns NotImplemented.
    local_root: Option<PathBuf>,
    cache_root: PathBuf,
    staging_root: PathBuf,
    staging_owner: Arc<crate::local_disk::OwnedDirectory>,
    local_limits: Option<crate::local_disk::LocalDiskLimits>,
    verified_materializations: Arc<Mutex<VerifiedMaterializationCache>>,
}

impl std::fmt::Debug for ArtifactStore {
    fn fmt(&self, fmt: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        fmt.debug_struct("ArtifactStore")
            .field("store", &self.store.to_string())
            .field("telemetry", &self.telemetry)
            .field("prefix", &self.prefix)
            .field("local_root", &self.local_root)
            .field("cache_root", &self.cache_root)
            .field("staging_root", &self.staging_root)
            .field("staging_owner", &self.staging_owner.path())
            .field("local_limits", &self.local_limits)
            .finish_non_exhaustive()
    }
}

impl ArtifactStore {
    pub fn new(
        store: Arc<dyn ObjectStore>,
        prefix: &str,
        cache_root: impl Into<PathBuf>,
    ) -> Result<Self, Report<BlobError>> {
        Self::new_with_telemetry(store, prefix, cache_root, OperationalTelemetry::default())
    }

    pub fn new_with_telemetry(
        store: Arc<dyn ObjectStore>,
        prefix: &str,
        cache_root: impl Into<PathBuf>,
        telemetry: OperationalTelemetry,
    ) -> Result<Self, Report<BlobError>> {
        let prefix = prefix.trim_matches('/');
        if !prefix.is_empty() {
            validate_relative_key(prefix)?;
        }
        let cache_root = cache_root.into();
        let staging_parent = cache_root.join("staging");
        let staging_root = staging_parent.join(format!("process-{}", Uuid::new_v4()));
        std::fs::create_dir_all(cache_root.join("objects"))
            .change_context(BlobError)
            .attach_printable("create blob cache")?;
        let staging_owner = Arc::new(
            crate::local_disk::OwnedDirectory::claim(&staging_root)
                .change_context(BlobError)
                .attach_printable("claim process-local blob staging directory")?,
        );
        Ok(Self {
            store: Arc::new(ObservedObjectStore {
                inner: store,
                telemetry: telemetry.clone(),
            }),
            telemetry,
            prefix: prefix.to_owned(),
            local_root: None,
            cache_root,
            staging_root,
            staging_owner,
            local_limits: None,
            verified_materializations: Arc::new(
                Mutex::new(VerifiedMaterializationCache::default()),
            ),
        })
    }

    pub fn telemetry(&self) -> OperationalTelemetry {
        self.telemetry.clone()
    }

    /// Measures local disposable storage only. Callers choose the reporting
    /// cadence; this never consults Graph or the remote object store.
    pub fn local_disk_signals(
        &self,
        duckdb_bytes: u64,
        workspace_available_bytes: u64,
    ) -> Result<crate::progress::DiskSignalsV1, Report<BlobError>> {
        let cache_bytes = crate::local_disk::tree_size(&self.cache_root.join("objects"))
            .change_context(BlobError)?;
        let staging_bytes = crate::local_disk::tree_size(&self.cache_root.join("staging"))
            .change_context(BlobError)?;
        Ok(crate::progress::DiskSignalsV1 {
            duckdb_bytes,
            cache_bytes,
            staging_bytes,
            workspace_available_bytes,
            free_reserve_bytes: self.local_limits.map_or(0, |limits| limits.min_free_bytes),
        })
    }

    /// Enables bounded cache/staging behavior and performs process-safe
    /// startup cleanup. Active process stages remain locked and are skipped.
    pub fn with_local_disk_limits(
        mut self,
        limits: crate::local_disk::LocalDiskLimits,
    ) -> Result<Self, Report<BlobError>> {
        let staging_parent = self.cache_root.join("staging");
        crate::local_disk::scavenge_staging(
            &staging_parent,
            limits.max_staging_age,
            limits.max_staging_bytes,
        )
        .change_context(BlobError)
        .attach_printable("scavenge abandoned blob stages")?;
        self.local_limits = Some(limits);
        Ok(self)
    }

    pub fn local(
        remote_root: impl AsRef<FsPath>,
        cache_root: impl Into<PathBuf>,
    ) -> Result<Self, Report<BlobError>> {
        std::fs::create_dir_all(remote_root.as_ref())
            .change_context(BlobError)
            .attach_printable("create local blob root")?;
        let root = std::fs::canonicalize(remote_root.as_ref())
            .change_context(BlobError)
            .attach_printable("canonicalize local blob root")?;
        let store = LocalFileSystem::new_with_prefix(&root)
            .change_context(BlobError)
            .attach_printable("open local blob root")?;
        let mut result = Self::new(Arc::new(store), "", cache_root)?;
        result.local_root = Some(root);
        Ok(result)
    }

    pub fn in_memory(cache_root: impl Into<PathBuf>) -> Result<Self, Report<BlobError>> {
        Self::new(Arc::new(InMemory::new()), "", cache_root)
    }

    pub fn from_url(url: &str, cache_root: impl Into<PathBuf>) -> Result<Self, Report<BlobError>> {
        if let Some(path) = url.strip_prefix("file://") {
            if path.is_empty() {
                return Err(Report::new(BlobError)
                    .attach_printable("file blob URL requires a filesystem path"));
            }
            Self::local(path, cache_root)
        } else if url.starts_with("s3://") {
            Self::s3_from_env(url, cache_root)
        } else {
            Err(Report::new(BlobError).attach_printable(format!(
                "unsupported blob URL scheme in {url:?}; expected file:// or s3://"
            )))
        }
    }

    /// Builds an S3-compatible backend from the normal AWS environment.
    /// `url` is `s3://bucket` or `s3://bucket/prefix`; custom endpoints and
    /// credentials remain standard `AWS_*` settings understood by object_store.
    pub fn s3_from_env(
        url: &str,
        cache_root: impl Into<PathBuf>,
    ) -> Result<Self, Report<BlobError>> {
        let (bucket, prefix) = parse_s3_url(url)?;
        let store = AmazonS3Builder::from_env()
            .with_bucket_name(bucket)
            // Ask the provider to validate and retain an object-level SHA-256
            // checksum in addition to SigV4 transport signing and our own
            // content-address verification. This strengthens the acceptance
            // boundary without replacing the authoritative read-back checks.
            .with_checksum_algorithm(Checksum::SHA256)
            .build()
            .change_context(BlobError)
            .attach_printable("build S3 blob backend")?;
        Self::new(Arc::new(store), prefix, cache_root)
    }

    pub fn staging_root(&self) -> &FsPath {
        &self.staging_root
    }

    /// Read-only materialization root to add to DuckDB's precise filesystem
    /// allowlist. It never contains credentials or writable staged outputs.
    pub fn materialized_root(&self) -> PathBuf {
        self.cache_root.join("objects")
    }

    /// Lists control/discovery objects. Artifact readers never use LIST to
    /// choose a version, but the durable worker uses it to discover immutable
    /// admission heads written by independent integration-server processes.
    pub async fn list(&self, prefix: &str) -> Result<Vec<ListedObject>, Report<BlobError>> {
        validate_relative_key(prefix)?;
        let location = self.location(prefix)?;
        let mut stream = self.store.list(Some(&location));
        let mut objects = Vec::new();
        while let Some(item) = stream.next().await {
            let meta = item.map_err(|error| store_report("list objects", error))?;
            let key = self.relative_location(&meta.location)?;
            // The local CAS emulation stages `.{name}.cas-{uuid}` temporaries
            // beside their destination before an atomic rename. S3 never
            // exposes a partial PUT as a key, so the emulation must not
            // either: a concurrent lister observing a staged temporary would
            // misread a fresh prefix as foreign. The filter applies to the
            // local backend only, and `validate_relative_key` rejects
            // dot-leading segments, so a committed object can never be hidden
            // by it: foreign dotfile keys on a real provider stay visible to
            // foreign-prefix refusal.
            if self.local_root.is_some() && is_local_cas_staging(&key) {
                continue;
            }
            objects.push(ListedObject {
                key,
                size: meta.size,
                e_tag: meta.e_tag,
                provider_version: meta.version,
                last_modified: meta.last_modified.to_rfc3339(),
            });
        }
        Ok(objects)
    }

    /// Checks that an immutable reference resolves to an object with the
    /// expected content-addressed key and size. This is intentionally a HEAD
    /// check; callers requiring byte-level integrity use [`Self::materialize`].
    pub async fn inspect(&self, reference: &BlobRef) -> Result<ListedObject, Report<BlobError>> {
        let value = reference.current();
        validate_blob_reference(value)?;
        let location = self.location(&value.key)?;
        let meta = self
            .store
            .head(&location)
            .await
            .map_err(|error| store_report("inspect referenced blob", error))?;
        if meta.size != value.size {
            return Err(Report::new(BlobError).attach_printable(format!(
                "referenced blob {} has size {}, expected {}",
                value.key, meta.size, value.size
            )));
        }
        Ok(ListedObject {
            key: self.relative_location(&meta.location)?,
            size: meta.size,
            e_tag: meta.e_tag,
            provider_version: meta.version,
            last_modified: meta.last_modified.to_rfc3339(),
        })
    }

    /// Streams an authoritative object through SHA-256 verification without
    /// retaining it in the local cache. Production integrity scans must not
    /// grow disposable disk in proportion to the entire live object set.
    pub async fn verify_content(&self, reference: &BlobRef) -> Result<(), Report<BlobError>> {
        let value = reference.current();
        validate_blob_reference(value)?;
        let result = self
            .store
            .get(&self.location(&value.key)?)
            .await
            .map_err(|error| store_report("fetch blob for integrity verification", error))?;
        let mut stream = result.into_stream();
        let mut hasher = Sha256::new();
        let mut size = 0_u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| store_report("stream blob verification", error))?;
            hasher.update(&chunk);
            size = size.checked_add(chunk.len() as u64).ok_or_else(|| {
                Report::new(BlobError).attach_printable("verified blob size overflowed u64")
            })?;
        }
        let hash = hex::encode(hasher.finalize());
        if size != value.size || hash != value.sha256 {
            return Err(Report::new(BlobError).attach_printable(format!(
                "blob integrity mismatch for {}: expected {} bytes/{}, got {} bytes/{}",
                value.key, value.size, value.sha256, size, hash
            )));
        }
        Ok(())
    }

    /// Deletes a known small control object. Immutable artifacts are removed
    /// only by the separate reachability-aware GC; this primitive exists for
    /// unique diagnostic probes and explicit maintenance workflows.
    pub async fn delete_control(&self, key: &str) -> Result<(), Report<BlobError>> {
        let components = key.split('/').collect::<Vec<_>>();
        let is_diagnostics_control = components.first() == Some(&"control");
        let is_tenant_control = components.len() >= 4
            && components.first() == Some(&"tenants")
            && components.get(2) == Some(&"control");
        if !is_diagnostics_control && !is_tenant_control {
            return Err(Report::new(BlobError).attach_printable(format!(
                "refusing to delete non-control object {key:?} through control deletion"
            )));
        }
        let location = self.location(key)?;
        match self.store.delete(&location).await {
            Ok(()) | Err(object_store::Error::NotFound { .. }) => Ok(()),
            Err(error) => Err(store_report("delete control object", error)),
        }
    }

    /// Returns a unique writable output path. This path is never used as the
    /// immutable download cache, preventing hard-link/write-through corruption.
    pub fn stage(&self, suffix: &str) -> Result<PathBuf, Report<BlobError>> {
        validate_suffix(suffix)?;
        let path = self
            .staging_root
            .join(format!("{}{}", Uuid::new_v4(), suffix));
        Ok(path)
    }

    /// Publishes a completed local file to an immutable content-addressed key.
    /// The source is fsynced before hashing; upload completion is atomic from a
    /// reader's perspective, including multipart S3 uploads.
    pub async fn publish(
        &self,
        source: &FsPath,
        logical_prefix: &str,
        media_type: &str,
    ) -> Result<BlobRef, Report<BlobError>> {
        validate_relative_key(logical_prefix)?;
        self.enforce_staging_bounds()?;
        let source = source.to_owned();
        let hash_source = source.clone();
        let (sha256, size) = tokio::task::spawn_blocking(move || hash_and_sync(&hash_source))
            .await
            .change_context(BlobError)
            .attach_printable("join artifact hashing task")??;

        let extension = source_extension(source_path_name(source.as_path())?)?;
        let relative_key = format!(
            "{}/sha256/{}/{}{}",
            logical_prefix.trim_end_matches('/'),
            &sha256[..2],
            sha256,
            extension
        );
        let location = self.location(&relative_key)?;

        // Small immutable artifacts fit in one bounded request. Creating them
        // conditionally both saves the speculative HEAD on the overwhelmingly
        // common new-object path and strengthens immutability: a concurrent or
        // pre-existing object can never be overwritten. Existing content still
        // takes the authoritative HEAD + full-byte verification path below.
        if size <= UPLOAD_CHUNK_SIZE as u64 {
            let bytes = tokio::fs::read(source_path_name(source.as_path())?)
                .await
                .change_context(BlobError)
                .attach_printable("read bounded staged artifact")?;
            let read_size = bytes.len() as u64;
            let read_hash = hex::encode(Sha256::digest(&bytes));
            if read_size != size || read_hash != sha256 {
                return Err(Report::new(BlobError).attach_printable(format!(
                    "staged artifact changed before upload: expected {size} bytes/{sha256}, read {read_size} bytes/{read_hash}"
                )));
            }
            let options = PutOptions {
                mode: PutMode::Create,
                ..PutOptions::default()
            };
            match self
                .store
                .put_opts(&location, Bytes::from(bytes).into(), options)
                .await
            {
                Ok(_result) => {
                    if let Some(root) = &self.local_root {
                        let root = root.clone();
                        let relative = location.to_string();
                        tokio::task::spawn_blocking(move || {
                            sync_local_published_object(&root, &relative)
                        })
                        .await
                        .change_context(BlobError)
                        .attach_printable("join local artifact durability task")??;
                    }
                    let meta = self
                        .store
                        .head(&location)
                        .await
                        .map_err(|error| store_report("verify uploaded artifact", error))?;
                    if meta.size != size {
                        return Err(Report::new(BlobError).attach_printable(format!(
                            "uploaded object {} has size {}, expected {size}",
                            meta.location, meta.size
                        )));
                    }
                    let reference = blob_ref(relative_key, sha256, size, media_type, &meta);
                    self.seed_cache_best_effort(&reference, &source).await;
                    return Ok(reference);
                }
                Err(
                    object_store::Error::AlreadyExists { .. }
                    | object_store::Error::Precondition { .. },
                ) => {}
                // A backend without conditional puts retains the prior safe
                // HEAD/upload/HEAD implementation below.
                Err(
                    object_store::Error::NotSupported { .. } | object_store::Error::NotImplemented,
                ) => {}
                Err(error) => return Err(store_report("create immutable content object", error)),
            }
        }

        match self.store.head(&location).await {
            Ok(meta) if meta.size == size => {
                let reference = blob_ref(relative_key, sha256, size, media_type, &meta);
                self.verify_content(&reference).await.attach_printable(
                    "existing content-addressed object failed byte verification",
                )?;
                self.seed_cache_best_effort(&reference, &source).await;
                return Ok(reference);
            }
            Ok(meta) => {
                return Err(Report::new(BlobError).attach_printable(format!(
                    "content-addressed object {} has size {}, expected {size}",
                    meta.location, meta.size
                )));
            }
            Err(object_store::Error::NotFound { .. }) => {}
            Err(error) => return Err(store_report("inspect content object", error)),
        }

        let mut input = tokio::fs::File::open(source_path_name(source.as_path())?)
            .await
            .change_context(BlobError)
            .attach_printable("open staged artifact")?;
        let mut output =
            BufWriter::with_capacity(Arc::clone(&self.store), location.clone(), UPLOAD_CHUNK_SIZE);
        let mut buffer = vec![0_u8; UPLOAD_CHUNK_SIZE];
        let mut upload_hasher = Sha256::new();
        let mut uploaded_size = 0_u64;
        loop {
            let read = input
                .read(&mut buffer)
                .await
                .change_context(BlobError)
                .attach_printable("read staged artifact")?;
            if read == 0 {
                break;
            }
            upload_hasher.update(&buffer[..read]);
            uploaded_size = uploaded_size.checked_add(read as u64).ok_or_else(|| {
                Report::new(BlobError).attach_printable("uploaded artifact size overflowed u64")
            })?;
            if let Err(error) = output.put(Bytes::copy_from_slice(&buffer[..read])).await {
                let _ = output.abort().await;
                return Err(store_report("upload artifact", error));
            }
        }
        let uploaded_hash = hex::encode(upload_hasher.finalize());
        if uploaded_size != size || uploaded_hash != sha256 {
            let _ = output.abort().await;
            return Err(Report::new(BlobError).attach_printable(format!(
                "staged artifact changed during upload: expected {size} bytes/{sha256}, read {uploaded_size} bytes/{uploaded_hash}"
            )));
        }
        output
            .shutdown()
            .await
            .change_context(BlobError)
            .attach_printable("complete artifact upload")?;

        if let Some(root) = &self.local_root {
            let root = root.clone();
            let relative = location.to_string();
            tokio::task::spawn_blocking(move || sync_local_published_object(&root, &relative))
                .await
                .change_context(BlobError)
                .attach_printable("join local artifact durability task")??;
        }

        let meta = self
            .store
            .head(&location)
            .await
            .map_err(|error| store_report("verify uploaded artifact", error))?;
        if meta.size != size {
            return Err(Report::new(BlobError).attach_printable(format!(
                "uploaded object {} has size {}, expected {size}",
                meta.location, meta.size
            )));
        }
        let reference = blob_ref(relative_key, sha256, size, media_type, &meta);
        // The staged file is already fsynced and was hashed both before and
        // during upload. Retain those exact bytes in the disposable cache so
        // the execution phase does not immediately download its own output.
        // S3 remains authoritative; a cache-admission failure is therefore
        // deliberately non-fatal and materialization will fetch it normally.
        self.seed_cache_best_effort(&reference, &source).await;
        Ok(reference)
    }

    /// Publishes one registered, bounded durable record through the same
    /// staged-file path as large artifacts, then verifies the published bytes.
    /// Keeping this typed prevents arbitrary application JSON from entering a
    /// canonical V1 immutable-artifact prefix.
    pub(crate) async fn publish_record<T: crate::orchestrator::registry::DurableRecord + Sync>(
        &self,
        record: &T,
        maximum_bytes: usize,
        logical_prefix: &str,
        media_type: &str,
    ) -> Result<BlobRef, Report<BlobError>> {
        crate::orchestrator::registry::require_registered::<T>()
            .change_context(BlobError)
            .attach_printable("publish only a registered durable record")?;
        let bytes = record
            .encode()
            .change_context(BlobError)
            .attach_printable("encode immutable durable record")?;
        if bytes.len() > maximum_bytes {
            return Err(Report::new(BlobError).attach_printable(format!(
                "encoded durable record is {} bytes; maximum is {maximum_bytes}",
                bytes.len()
            )));
        }

        let staged = self.stage(".json")?;
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staged)
            .await
            .change_context(BlobError)
            .attach_printable("create staged durable record")?;
        file.write_all(&bytes)
            .await
            .change_context(BlobError)
            .attach_printable("write staged durable record")?;
        file.sync_all()
            .await
            .change_context(BlobError)
            .attach_printable("fsync staged durable record")?;
        drop(file);

        let published = self.publish(&staged, logical_prefix, media_type).await;
        let cleanup = tokio::fs::remove_file(&staged)
            .await
            .change_context(BlobError)
            .attach_printable("remove staged durable record");
        let reference = published?;
        cleanup?;
        // Durable records retain the stronger authoritative read-back check.
        // The write-through cache is only an execution accelerator and must
        // never substitute for verifying the bytes accepted by the provider.
        self.verify_content(&reference)
            .await
            .attach_printable("verify published durable-record bytes")?;
        Ok(reference)
    }

    async fn seed_cache_best_effort(&self, reference: &BlobRef, source: &FsPath) {
        if let Err(error) = self.seed_cache(reference, source).await {
            tracing::debug!(
                error = ?error,
                key = %reference.current().key,
                "published artifact was not admitted to the local cache"
            );
        }
    }

    async fn seed_cache(
        &self,
        reference: &BlobRef,
        source: &FsPath,
    ) -> Result<(), Report<BlobError>> {
        let value = reference.current();
        validate_blob_reference(value)?;
        let destination = self.cached_path(reference)?;

        // A verified materialization deliberately holds this object's lock
        // for the guard's lifetime. Republishing identical content must not
        // wait for that guard (the small process cache may retain it for an
        // arbitrarily long time). A lock-free valid hit needs no mutation;
        // eviction racing this check is harmless because S3 remains the
        // authority and a later materialization can fetch it again.
        if destination.is_file() {
            let path = destination.clone();
            let expected_hash = value.sha256.clone();
            let expected_size = value.size;
            let valid = tokio::task::spawn_blocking(move || {
                verify_file(&path, &expected_hash, expected_size)
            })
            .await
            .change_context(BlobError)
            .attach_printable("join existing published-cache verification task")??;
            if valid {
                return Ok(());
            }
        }

        let Some(mut object_lock) = self.try_lock_cache_object(&value.sha256).await? else {
            // Cache population is optional. Never delay a successfully
            // published artifact behind a reader holding the cache object.
            return Ok(());
        };

        if destination.is_file() {
            let path = destination.clone();
            let expected_hash = value.sha256.clone();
            let expected_size = value.size;
            let valid = tokio::task::spawn_blocking(move || {
                verify_file(&path, &expected_hash, expected_size)
            })
            .await
            .change_context(BlobError)
            .attach_printable("join published-cache verification task")??;
            if valid {
                touch_cache_lock(&mut object_lock)?;
                return Ok(());
            }
            tokio::fs::remove_file(&destination)
                .await
                .change_context(BlobError)
                .attach_printable("remove corrupt published-cache object")?;
        }

        let _cache_reservation = self.ensure_cache_capacity(value.size, Some(&destination))?;
        if let Some(parent) = destination.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .change_context(BlobError)
                .attach_printable("create published-cache shard")?;
        }
        let temporary = destination.with_extension(format!(
            "{}part-{}",
            destination
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or(""),
            Uuid::new_v4()
        ));
        let copied = async {
            tokio::fs::copy(source, &temporary)
                .await
                .change_context(BlobError)
                .attach_printable("copy published artifact into cache")?;
            let temporary_file = tokio::fs::OpenOptions::new()
                .read(true)
                .open(&temporary)
                .await
                .change_context(BlobError)
                .attach_printable("open published-cache temporary file")?;
            temporary_file
                .sync_all()
                .await
                .change_context(BlobError)
                .attach_printable("fsync published-cache object")?;
            drop(temporary_file);

            let path = temporary.clone();
            let expected_hash = value.sha256.clone();
            let expected_size = value.size;
            tokio::task::spawn_blocking(move || verify_file(&path, &expected_hash, expected_size))
                .await
                .change_context(BlobError)
                .attach_printable("join copied published-cache verification task")?
        }
        .await;
        let valid = match copied {
            Ok(valid) => valid,
            Err(error) => {
                let _ = tokio::fs::remove_file(&temporary).await;
                return Err(error);
            }
        };
        if !valid {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(Report::new(BlobError)
                .attach_printable("published artifact changed while copying into cache"));
        }
        if let Err(error) = tokio::fs::rename(&temporary, &destination).await {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(Report::new(error)
                .change_context(BlobError)
                .attach_printable("commit published-cache object"));
        }
        if let Err(error) = set_read_only(&destination) {
            let _ = tokio::fs::remove_file(&destination).await;
            return Err(error);
        }
        touch_cache_lock(&mut object_lock)?;
        Ok(())
    }

    /// Convenience for bounded control-plane and test artifacts that already
    /// exist in memory. Bytes still pass through the ordinary staged-file,
    /// fsync, content-addressed upload, and read-back verification path.
    #[cfg(test)]
    pub(crate) async fn publish_bytes(
        &self,
        bytes: &[u8],
        suffix: &str,
        logical_prefix: &str,
        media_type: &str,
    ) -> Result<BlobRef, Report<BlobError>> {
        let staged = self.stage(suffix)?;
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staged)
            .await
            .change_context(BlobError)
            .attach_printable("create staged byte artifact")?;
        file.write_all(bytes)
            .await
            .change_context(BlobError)
            .attach_printable("write staged byte artifact")?;
        file.sync_all()
            .await
            .change_context(BlobError)
            .attach_printable("fsync staged byte artifact")?;
        drop(file);
        let result = self.publish(&staged, logical_prefix, media_type).await;
        let _ = tokio::fs::remove_file(staged).await;
        result
    }

    /// Materializes and verifies a blob into the immutable local read cache.
    /// Corrupt cache entries are discarded and fetched again.
    pub async fn materialize(&self, reference: &BlobRef) -> Result<PathBuf, Report<BlobError>> {
        Ok(self.materialize_guarded(reference).await?.path)
    }

    /// Materializes a blob while retaining its eviction lock. Use this when
    /// copying or linking the cache object into a workspace.
    pub async fn materialize_guarded(
        &self,
        reference: &BlobRef,
    ) -> Result<MaterializedBlob, Report<BlobError>> {
        let value = reference.current();
        validate_blob_reference(value)?;
        let destination = self.cached_path(reference)?;
        let mut object_lock = self.lock_cache_object(&value.sha256).await?;

        if destination.is_file() {
            let path = destination.clone();
            let expected_hash = value.sha256.clone();
            let expected_size = value.size;
            let valid = tokio::task::spawn_blocking(move || {
                verify_file(&path, &expected_hash, expected_size)
            })
            .await
            .change_context(BlobError)
            .attach_printable("join cache verification task")??;
            if valid {
                touch_cache_lock(&mut object_lock)?;
                return Ok(MaterializedBlob {
                    path: destination,
                    _lock: object_lock,
                });
            }
            tokio::fs::remove_file(&destination)
                .await
                .change_context(BlobError)
                .attach_printable("remove corrupt cache object")?;
        }

        let _cache_reservation = self.ensure_cache_capacity(value.size, Some(&destination))?;

        if let Some(parent) = destination.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .change_context(BlobError)
                .attach_printable("create cache shard")?;
        }
        let temporary = destination.with_extension(format!(
            "{}part-{}",
            destination
                .extension()
                .and_then(|v| v.to_str())
                .unwrap_or(""),
            Uuid::new_v4()
        ));
        let mut output = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .await
            .change_context(BlobError)
            .attach_printable("create cache temporary file")?;
        let location = self.location(&value.key)?;
        let result = self
            .store
            .get(&location)
            .await
            .map_err(|error| store_report("fetch blob", error))?;
        let mut stream = result.into_stream();
        let mut hasher = Sha256::new();
        let mut downloaded = 0_u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| store_report("stream blob", error))?;
            output
                .write_all(&chunk)
                .await
                .change_context(BlobError)
                .attach_printable("write cache object")?;
            hasher.update(&chunk);
            downloaded += chunk.len() as u64;
        }
        output
            .sync_all()
            .await
            .change_context(BlobError)
            .attach_printable("fsync cache object")?;
        drop(output);
        let actual_hash = hex::encode(hasher.finalize());
        if downloaded != value.size || actual_hash != value.sha256 {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(Report::new(BlobError).attach_printable(format!(
                "blob integrity mismatch for {}: expected {} bytes/{}, got {} bytes/{}",
                value.key, value.size, value.sha256, downloaded, actual_hash
            )));
        }
        tokio::fs::rename(&temporary, &destination)
            .await
            .change_context(BlobError)
            .attach_printable("commit cache object")?;
        set_read_only(&destination)?;
        touch_cache_lock(&mut object_lock)?;
        Ok(MaterializedBlob {
            path: destination,
            _lock: object_lock,
        })
    }

    /// Reuses a process-local, fully verified immutable materialization.
    ///
    /// This is intended for large content-addressed packs whose selected
    /// slices are independently verified by the caller. Retaining the guard
    /// prevents local cache eviction while a cached entry is live.
    pub async fn materialize_guarded_cached(
        &self,
        reference: &BlobRef,
    ) -> Result<Arc<MaterializedBlob>, Report<BlobError>> {
        if let Some(materialized) = self.cached_materialization(reference)? {
            return Ok(materialized);
        }

        let materialized = Arc::new(self.materialize_guarded(reference).await?);
        let byte_limit = self
            .local_limits
            .map_or(VERIFIED_MATERIALIZATION_CACHE_MAX_BYTES, |limits| {
                VERIFIED_MATERIALIZATION_CACHE_MAX_BYTES.min(limits.max_cache_bytes / 2)
            });
        let size = reference.current().size;
        if size > byte_limit {
            return Ok(materialized);
        }

        let mut cache = self.verified_materializations.lock().map_err(|_poisoned| {
            Report::new(BlobError).attach_printable("lock verified blob cache")
        })?;
        if let Some(index) = cache
            .entries
            .iter()
            .position(|(cached, _materialized)| cached == reference)
        {
            let (cached, existing) = cache.entries.remove(index).ok_or_else(|| {
                Report::new(BlobError).attach_printable("verified blob cache changed while locked")
            })?;
            cache.entries.push_back((cached, Arc::clone(&existing)));
            return Ok(existing);
        }
        while cache.entries.len() >= VERIFIED_MATERIALIZATION_CACHE_ENTRIES
            || cache.bytes.saturating_add(size) > byte_limit
        {
            let Some((evicted, _materialized)) = cache.entries.pop_front() else {
                break;
            };
            cache.bytes = cache.bytes.saturating_sub(evicted.current().size);
        }
        cache.bytes = cache.bytes.saturating_add(size);
        cache
            .entries
            .push_back((reference.clone(), Arc::clone(&materialized)));
        Ok(materialized)
    }

    fn cached_materialization(
        &self,
        reference: &BlobRef,
    ) -> Result<Option<Arc<MaterializedBlob>>, Report<BlobError>> {
        let mut cache = self.verified_materializations.lock().map_err(|_poisoned| {
            Report::new(BlobError).attach_printable("lock verified blob cache")
        })?;
        let Some(index) = cache
            .entries
            .iter()
            .position(|(cached, _materialized)| cached == reference)
        else {
            return Ok(None);
        };
        let (cached, materialized) = cache.entries.remove(index).ok_or_else(|| {
            Report::new(BlobError).attach_printable("verified blob cache changed while locked")
        })?;
        cache.entries.push_back((cached, Arc::clone(&materialized)));
        Ok(Some(materialized))
    }

    /// Removes only the verified local cache copy. The authoritative object
    /// remains untouched and can be materialized again after a restart.
    pub async fn evict_cached(&self, reference: &BlobRef) -> Result<(), Report<BlobError>> {
        let path = self.cached_path(reference)?;
        let _object_lock = self.lock_cache_object(&reference.current().sha256).await?;
        match tokio::fs::remove_file(&path).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(Report::new(error)
                .change_context(BlobError)
                .attach_printable(format!("evict cached object {}", path.display()))),
        }
    }

    fn cached_path(&self, reference: &BlobRef) -> Result<PathBuf, Report<BlobError>> {
        let value = reference.current();
        validate_relative_key(&value.key)?;
        validate_sha256(&value.sha256)?;
        let extension = ObjectPath::from(value.key.as_str())
            .extension()
            .map(|value| format!(".{value}"))
            .unwrap_or_default();
        Ok(self
            .cache_root
            .join("objects")
            .join(&value.sha256[..2])
            .join(format!("{}{}", value.sha256, extension)))
    }

    fn enforce_staging_bounds(&self) -> Result<(), Report<BlobError>> {
        let Some(limits) = self.local_limits else {
            return Ok(());
        };
        let staging_parent = self.cache_root.join("staging");
        let used = crate::local_disk::tree_size(&staging_parent).change_context(BlobError)?;
        if used > limits.max_staging_bytes {
            return Err(Report::new(BlobError).attach_printable(format!(
                "blob stages use {used} bytes; RUNNER_MAX_STAGING_BYTES is {} bytes",
                limits.max_staging_bytes
            )));
        }
        let available = fs4::available_space(&staging_parent)
            .change_context(BlobError)
            .attach_printable("inspect blob staging filesystem free space")?;
        if available < limits.min_free_bytes {
            return Err(Report::new(BlobError).attach_printable(format!(
                "blob staging filesystem has {available} bytes available; RUNNER_MIN_FREE_BYTES reserves {} bytes",
                limits.min_free_bytes
            )));
        }
        Ok(())
    }

    async fn lock_cache_object(&self, sha256: &str) -> Result<File, Report<BlobError>> {
        let sha256 = sha256.to_owned();
        let path = self.cache_root.join("locks").join(format!("{sha256}.lock"));
        tokio::task::spawn_blocking(move || {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).change_context(BlobError)?;
            }
            let file = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(&path)
                .change_context(BlobError)?;
            file.lock_exclusive()
                .change_context(BlobError)
                .attach_printable(format!("lock cached object {sha256}"))?;
            Ok(file)
        })
        .await
        .change_context(BlobError)
        .attach_printable("join cache-object lock task")?
    }

    async fn try_lock_cache_object(&self, sha256: &str) -> Result<Option<File>, Report<BlobError>> {
        let sha256 = sha256.to_owned();
        let path = self.cache_root.join("locks").join(format!("{sha256}.lock"));
        tokio::task::spawn_blocking(move || {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).change_context(BlobError)?;
            }
            let file = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(&path)
                .change_context(BlobError)?;
            if file.try_lock_exclusive().change_context(BlobError)? {
                Ok(Some(file))
            } else {
                Ok(None)
            }
        })
        .await
        .change_context(BlobError)
        .attach_printable("join cache-object try-lock task")?
    }

    fn ensure_cache_capacity(
        &self,
        incoming_bytes: u64,
        protected: Option<&FsPath>,
    ) -> Result<Option<CacheReservation>, Report<BlobError>> {
        let Some(limits) = self.local_limits else {
            return Ok(None);
        };
        let objects = self.cache_root.join("objects");
        let eviction_lock_path = self.cache_root.join(".eviction.lock");
        let eviction_lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&eviction_lock_path)
            .change_context(BlobError)?;
        eviction_lock
            .lock_exclusive()
            .change_context(BlobError)
            .attach_printable("lock cache eviction pass")?;

        let mut used = crate::local_disk::tree_size(&objects).change_context(BlobError)?;
        let mut available = fs4::available_space(&objects).change_context(BlobError)?;
        let reserved = active_cache_reservations(&self.cache_root)?;
        let admission_bytes = reserved.checked_add(incoming_bytes).ok_or_else(|| {
            Report::new(BlobError).attach_printable("cache reservations overflowed u64")
        })?;
        if cache_fits(used, available, admission_bytes, limits)? {
            return Ok(Some(reserve_cache_bytes(&self.cache_root, incoming_bytes)?));
        }

        let mut candidates = cache_files(&objects)?;
        for candidate in &mut candidates {
            let access_marker = self
                .cache_root
                .join("locks")
                .join(format!("{}.lock", candidate.sha256));
            if let Ok(metadata) = std::fs::metadata(access_marker) {
                candidate.last_used = metadata.modified().unwrap_or(candidate.last_used);
            }
        }
        candidates.sort_by_key(|candidate| candidate.last_used);
        for candidate in candidates {
            if protected == Some(candidate.path.as_path()) {
                continue;
            }
            let lock_path = self
                .cache_root
                .join("locks")
                .join(format!("{}.lock", candidate.sha256));
            let lock = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(lock_path)
                .change_context(BlobError)?;
            if !lock.try_lock_exclusive().change_context(BlobError)? {
                continue;
            }
            match std::fs::remove_file(&candidate.path) {
                Ok(()) => used = used.saturating_sub(candidate.bytes),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(Report::new(error).change_context(BlobError)),
            }
            available = fs4::available_space(&objects).change_context(BlobError)?;
            if cache_fits(used, available, admission_bytes, limits)? {
                return Ok(Some(reserve_cache_bytes(&self.cache_root, incoming_bytes)?));
            }
        }
        Err(Report::new(BlobError).attach_printable(format!(
            "verified cache cannot admit {incoming_bytes} bytes while retaining active materializations; {} bytes used of {} and {} bytes free with {} reserved",
            used, limits.max_cache_bytes, available, limits.min_free_bytes
        )))
    }

    /// Reads a small JSON CAS document. Missing is distinct from backend
    /// failure; successful reads return the exact provider version to update.
    pub async fn get_json<T: DeserializeOwned>(
        &self,
        key: &str,
    ) -> Result<Option<(T, CasVersion)>, Report<BlobError>> {
        let Some((bytes, version)) = self.get_cas_document(key).await? else {
            return Ok(None);
        };
        let value = serde_json::from_slice(&bytes)
            .change_context(BlobError)
            .attach_printable("decode CAS document")?;
        Ok(Some((value, version)))
    }

    /// Reads the bytes and provider version of a small CAS document. This is
    /// crate-private so versioned control-plane caches can recover from an
    /// invalid payload without discarding the version required to repair it.
    pub(crate) async fn get_cas_document(
        &self,
        key: &str,
    ) -> Result<Option<(Bytes, CasVersion)>, Report<BlobError>> {
        match self.get_cas_document_bounded(key, usize::MAX).await? {
            BoundedCasDocument::Missing => Ok(None),
            BoundedCasDocument::Present(bytes, version) => Ok(Some((bytes, version))),
            BoundedCasDocument::TooLarge {
                actual_bytes,
                max_bytes,
            } => Err(Report::new(BlobError).attach_printable(format!(
                "CAS document {key:?} is {actual_bytes} bytes; maximum is {max_bytes}"
            ))),
        }
    }

    /// Reads a small CAS document while rejecting oversized objects before
    /// downloading their body.
    pub(crate) async fn get_cas_document_bounded(
        &self,
        key: &str,
        max_bytes: usize,
    ) -> Result<BoundedCasDocument, Report<BlobError>> {
        let max_bytes_u64 = u64::try_from(max_bytes).unwrap_or(u64::MAX);
        let location = self.location(key)?;
        let result = match self.store.get(&location).await {
            Ok(result) => result,
            Err(object_store::Error::NotFound { .. }) => return Ok(BoundedCasDocument::Missing),
            Err(error) => return Err(store_report("read CAS document", error)),
        };
        let meta = result.meta.clone();
        if meta.size > max_bytes_u64 {
            return Ok(BoundedCasDocument::TooLarge {
                actual_bytes: meta.size,
                max_bytes,
            });
        }
        let bytes = result
            .bytes()
            .await
            .map_err(|error| store_report("read CAS document body", error))?;
        let version = if self.local_root.is_some() {
            local_cas_version(&bytes)
        } else {
            cas_version(&meta)
        };
        Ok(BoundedCasDocument::Present(bytes, version))
    }

    /// Creates a small JSON document only if absent.
    pub async fn create_json<T: Serialize + Sync>(
        &self,
        key: &str,
        value: &T,
    ) -> Result<CasWrite, Report<BlobError>> {
        self.put_json(key, value, PutMode::Create).await
    }

    pub(crate) async fn create_cas_document(
        &self,
        key: &str,
        bytes: Vec<u8>,
    ) -> Result<CasWrite, Report<BlobError>> {
        self.put_cas_document(key, bytes, PutMode::Create).await
    }

    pub(crate) async fn compare_and_swap_cas_document(
        &self,
        key: &str,
        expected: &CasVersion,
        bytes: Vec<u8>,
    ) -> Result<CasWrite, Report<BlobError>> {
        self.put_cas_document(key, bytes, PutMode::Update(expected.update_version()))
            .await
    }

    /// Replaces a small JSON document only if the supplied version is current.
    pub async fn compare_and_swap_json<T: Serialize + Sync>(
        &self,
        key: &str,
        expected: &CasVersion,
        value: &T,
    ) -> Result<CasWrite, Report<BlobError>> {
        self.put_json(key, value, PutMode::Update(expected.update_version()))
            .await
    }

    async fn put_json<T: Serialize + Sync>(
        &self,
        key: &str,
        value: &T,
        mode: PutMode,
    ) -> Result<CasWrite, Report<BlobError>> {
        let bytes = serde_json::to_vec(value)
            .change_context(BlobError)
            .attach_printable("encode CAS document")?;
        self.put_cas_document(key, bytes, mode).await
    }

    async fn put_cas_document(
        &self,
        key: &str,
        bytes: Vec<u8>,
        mode: PutMode,
    ) -> Result<CasWrite, Report<BlobError>> {
        let location = self.location(key)?;
        if let Some(root) = &self.local_root {
            let full_key = if self.prefix.is_empty() {
                key.to_owned()
            } else {
                format!("{}/{key}", self.prefix)
            };
            let root = root.clone();
            return tokio::task::spawn_blocking(move || {
                local_put_json(&root, &full_key, &bytes, &mode)
            })
            .await
            .change_context(BlobError)
            .attach_printable("join local CAS write")?;
        }
        let options = PutOptions {
            mode,
            ..PutOptions::default()
        };
        let result = match self.store.put_opts(&location, bytes.into(), options).await {
            Ok(result) => result,
            Err(
                object_store::Error::AlreadyExists { .. }
                | object_store::Error::Precondition { .. },
            ) => return Ok(CasWrite::Conflict),
            Err(error) => return Err(store_report("write CAS document", error)),
        };
        Ok(CasWrite::Written(CasVersion::V1(CasVersionV1 {
            e_tag: result.e_tag,
            provider_version: result.version,
        })))
    }

    fn location(&self, key: &str) -> Result<ObjectPath, Report<BlobError>> {
        validate_relative_key(key)?;
        let full = if self.prefix.is_empty() {
            key.to_owned()
        } else {
            format!("{}/{key}", self.prefix)
        };
        ObjectPath::parse(full)
            .change_context(BlobError)
            .attach_printable("invalid object key")
    }

    fn relative_location(&self, location: &ObjectPath) -> Result<String, Report<BlobError>> {
        let value = location.to_string();
        if self.prefix.is_empty() {
            return Ok(value);
        }
        value
            .strip_prefix(&format!("{}/", self.prefix))
            .map(str::to_owned)
            .ok_or_else(|| {
                Report::new(BlobError).attach_printable(format!(
                    "listed object {value:?} is outside configured prefix {:?}",
                    self.prefix
                ))
            })
    }
}

fn blob_ref(
    key: String,
    sha256: String,
    size: u64,
    media_type: &str,
    meta: &object_store::ObjectMeta,
) -> BlobRef {
    BlobRef::V1(BlobRefV1 {
        key,
        sha256,
        size,
        media_type: media_type.to_owned(),
        e_tag: meta.e_tag.clone(),
        provider_version: meta.version.clone(),
    })
}

fn cas_version(meta: &object_store::ObjectMeta) -> CasVersion {
    CasVersion::V1(CasVersionV1 {
        e_tag: meta.e_tag.clone(),
        provider_version: meta.version.clone(),
    })
}

fn local_cas_version(bytes: &[u8]) -> CasVersion {
    CasVersion::V1(CasVersionV1 {
        e_tag: None,
        provider_version: Some(hex::encode(Sha256::digest(bytes))),
    })
}

/// Cross-process conditional JSON update for the development filesystem
/// backend. The provider has atomic Create but no Update support, so a root
/// lock protects version comparison plus an fsync/rename commit. S3 continues
/// to use native If-Match semantics.
fn local_put_json(
    root: &FsPath,
    key: &str,
    bytes: &[u8],
    mode: &PutMode,
) -> Result<CasWrite, Report<BlobError>> {
    use fs4::fs_std::FileExt as _;

    let lock_path = root.join(".integrations-cas.lock");
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .change_context(BlobError)
        .attach_printable("open local CAS lock")?;
    lock.lock_exclusive()
        .change_context(BlobError)
        .attach_printable("lock local CAS store")?;

    let destination = root.join(key);
    let current = match std::fs::read(&destination) {
        Ok(value) => Some(value),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(Report::new(error)
                .change_context(BlobError)
                .attach_printable("read local CAS document"));
        }
    };
    let allowed = match mode {
        PutMode::Overwrite => true,
        PutMode::Create => current.is_none(),
        PutMode::Update(expected) => {
            let Some(current) = current.as_deref() else {
                return Ok(CasWrite::Conflict);
            };
            let expected_hash = expected.version.as_deref();
            expected_hash == Some(hex::encode(Sha256::digest(current)).as_str())
        }
    };
    if !allowed {
        return Ok(CasWrite::Conflict);
    }

    let parent = destination.parent().ok_or_else(|| {
        Report::new(BlobError).attach_printable("local CAS document has no parent")
    })?;
    let parent_existed = parent.is_dir();
    std::fs::create_dir_all(parent)
        .change_context(BlobError)
        .attach_printable("create local CAS directory")?;
    let filename = destination
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document.json");
    // Every CAS temporary lives and dies inside this exclusive lock, so any
    // temporary already present belongs to a crashed writer and is garbage.
    if let Ok(entries) = std::fs::read_dir(parent) {
        let stale_prefix = cas_temp_prefix(filename);
        for entry in entries.flatten() {
            if entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with(&stale_prefix))
            {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    let temporary = parent.join(cas_temp_name(filename));
    let write_result = (|| -> Result<(), Report<BlobError>> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .change_context(BlobError)
            .attach_printable("create local CAS temporary")?;
        file.write_all(bytes)
            .change_context(BlobError)
            .attach_printable("write local CAS temporary")?;
        file.sync_all()
            .change_context(BlobError)
            .attach_printable("fsync local CAS temporary")?;
        drop(file);
        std::fs::rename(&temporary, &destination)
            .change_context(BlobError)
            .attach_printable("commit local CAS document")?;
        // An acked CAS document must not vanish with an un-fsynced parent
        // dirent on power loss. S3 never acks a non-durable PUT; the
        // emulation must not either. When the whole directory chain already
        // existed (every write after the first), only the renamed dirent's
        // parent needs the fsync.
        if parent_existed {
            std::fs::File::open(parent)
                .and_then(|handle| handle.sync_all())
                .change_context(BlobError)
                .attach_printable("fsync local CAS directory")?;
        } else {
            fsync_ancestors(root, parent, "local CAS directory")?;
        }
        Ok(())
    })();
    if write_result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    write_result?;

    Ok(CasWrite::Written(local_cas_version(bytes)))
}

fn source_path_name(path: &FsPath) -> Result<&FsPath, Report<BlobError>> {
    if path.is_file() {
        Ok(path)
    } else {
        Err(Report::new(BlobError).attach_printable(format!(
            "artifact is not a regular file: {}",
            path.display()
        )))
    }
}

fn source_extension(path: &FsPath) -> Result<String, Report<BlobError>> {
    match path.extension().and_then(|value| value.to_str()) {
        Some(value) if !value.is_empty() => {
            validate_segment("file extension", value)?;
            Ok(format!(".{value}"))
        }
        _ => Ok(String::new()),
    }
}

fn hash_and_sync(path: &FsPath) -> Result<(String, u64), Report<BlobError>> {
    let mut file = File::open(path)
        .change_context(BlobError)
        .attach_printable("open artifact for hashing")?;
    file.sync_all()
        .change_context(BlobError)
        .attach_printable("fsync staged artifact")?;
    let mut hasher = Sha256::new();
    let mut size = 0_u64;
    let mut buffer = vec![0_u8; 1024 * 1024].into_boxed_slice();
    loop {
        let read = file
            .read(&mut buffer)
            .change_context(BlobError)
            .attach_printable("hash staged artifact")?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        size += read as u64;
    }
    Ok((hex::encode(hasher.finalize()), size))
}

fn verify_file(
    path: &FsPath,
    expected_hash: &str,
    expected_size: u64,
) -> Result<bool, Report<BlobError>> {
    let metadata = std::fs::metadata(path)
        .change_context(BlobError)
        .attach_printable("stat cache object")?;
    if metadata.len() != expected_size {
        return Ok(false);
    }
    let (hash, _) = hash_and_sync(path)?;
    Ok(hash == expected_hash)
}

#[derive(Debug)]
struct CacheCandidate {
    path: PathBuf,
    sha256: String,
    bytes: u64,
    last_used: std::time::SystemTime,
}

#[allow(
    clippy::filetype_is_file,
    reason = "cache traversal deliberately rejects symlinks and special files"
)]
fn cache_files(root: &FsPath) -> Result<Vec<CacheCandidate>, Report<BlobError>> {
    let mut pending = vec![root.to_owned()];
    let mut files = Vec::new();
    while let Some(path) = pending.pop() {
        for entry in std::fs::read_dir(&path)
            .change_context(BlobError)
            .attach_printable("read verified cache directory")?
        {
            let entry = entry.change_context(BlobError)?;
            let file_type = entry.file_type().change_context(BlobError)?;
            if file_type.is_dir() {
                pending.push(entry.path());
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            let Some(sha256) = name
                .get(..64)
                .filter(|value| validate_sha256(value).is_ok())
            else {
                continue;
            };
            let metadata = entry.metadata().change_context(BlobError)?;
            files.push(CacheCandidate {
                path: entry.path(),
                sha256: sha256.to_owned(),
                bytes: metadata.len(),
                last_used: metadata.modified().unwrap_or(std::time::UNIX_EPOCH),
            });
        }
    }
    Ok(files)
}

fn cache_fits(
    used: u64,
    available: u64,
    incoming: u64,
    limits: crate::local_disk::LocalDiskLimits,
) -> Result<bool, Report<BlobError>> {
    let after = used.checked_add(incoming).ok_or_else(|| {
        Report::new(BlobError).attach_printable("cache byte accounting overflowed u64")
    })?;
    let required_free = limits.min_free_bytes.checked_add(incoming).ok_or_else(|| {
        Report::new(BlobError).attach_printable("cache free-space accounting overflowed u64")
    })?;
    Ok(after <= limits.max_cache_bytes && available >= required_free)
}

#[allow(
    clippy::filetype_is_file,
    clippy::verbose_file_reads,
    reason = "reservation bytes must be read from the exact file descriptor whose process lock was tested"
)]
fn active_cache_reservations(cache_root: &FsPath) -> Result<u64, Report<BlobError>> {
    let root = cache_root.join("reservations");
    std::fs::create_dir_all(&root).change_context(BlobError)?;
    let mut total = 0_u64;
    for entry in std::fs::read_dir(&root).change_context(BlobError)? {
        let entry = entry.change_context(BlobError)?;
        if !entry.file_type().change_context(BlobError)?.is_file() {
            continue;
        }
        let path = entry.path();
        let mut file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .change_context(BlobError)?;
        if file.try_lock_exclusive().change_context(BlobError)? {
            drop(file);
            let _ = std::fs::remove_file(path);
            continue;
        }
        let mut value = String::new();
        file.read_to_string(&mut value).change_context(BlobError)?;
        let bytes = value.trim().parse::<u64>().map_err(|error| {
            Report::new(error)
                .change_context(BlobError)
                .attach_printable("decode active cache reservation")
        })?;
        total = total.checked_add(bytes).ok_or_else(|| {
            Report::new(BlobError).attach_printable("cache reservations overflowed u64")
        })?;
    }
    Ok(total)
}

fn reserve_cache_bytes(
    cache_root: &FsPath,
    bytes: u64,
) -> Result<CacheReservation, Report<BlobError>> {
    let root = cache_root.join("reservations");
    std::fs::create_dir_all(&root).change_context(BlobError)?;
    let path = root.join(format!("{}.reservation", Uuid::new_v4()));
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&path)
        .change_context(BlobError)?;
    file.lock_exclusive().change_context(BlobError)?;
    writeln!(file, "{bytes}").change_context(BlobError)?;
    file.sync_all().change_context(BlobError)?;
    Ok(CacheReservation { path, file })
}

fn touch_cache_lock(file: &mut File) -> Result<(), Report<BlobError>> {
    file.set_len(0).change_context(BlobError)?;
    file.rewind().change_context(BlobError)?;
    write!(
        file,
        "{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )
    .change_context(BlobError)?;
    file.sync_data()
        .change_context(BlobError)
        .attach_printable("persist cache access marker")
}

fn set_read_only(path: &FsPath) -> Result<(), Report<BlobError>> {
    let mut permissions = std::fs::metadata(path)
        .change_context(BlobError)
        .attach_printable("stat materialized blob")?
        .permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(path, permissions)
        .change_context(BlobError)
        .attach_printable("mark materialized blob read-only")
}

fn sync_local_published_object(root: &FsPath, relative: &str) -> Result<(), Report<BlobError>> {
    let object = root.join(relative);
    std::fs::File::open(&object)
        .change_context(BlobError)
        .attach_printable("open published local artifact for fsync")?
        .sync_all()
        .change_context(BlobError)
        .attach_printable("fsync published local artifact")?;
    let parent = object.parent().ok_or_else(|| {
        Report::new(BlobError).attach_printable("published local artifact has no parent")
    })?;
    fsync_ancestors(root, parent, "local artifact directory")
}

/// Fsyncs `from` and every ancestor directory up to `root` inclusive, so a
/// freshly created directory chain cannot lose an already acked object's
/// dirent on power loss. Both durable local write paths (published artifacts
/// and CAS documents) share this walk.
fn fsync_ancestors(
    root: &FsPath,
    from: &FsPath,
    what: &'static str,
) -> Result<(), Report<BlobError>> {
    let mut directory = from;
    loop {
        std::fs::File::open(directory)
            .and_then(|handle| handle.sync_all())
            .change_context(BlobError)
            .attach_printable(format!("fsync {what}"))?;
        if directory == root {
            return Ok(());
        }
        directory = directory.parent().ok_or_else(|| {
            Report::new(BlobError).attach_printable(format!("{what} escaped configured root"))
        })?;
    }
}

/// The local CAS staging temp-name convention, owned in one place: the
/// constructor, the crashed-writer scavenge prefix, and the LIST filter must
/// always agree on this format.
fn cas_temp_name(filename: &str) -> String {
    format!("{}{}", cas_temp_prefix(filename), Uuid::new_v4())
}

fn cas_temp_prefix(filename: &str) -> String {
    format!(".{filename}{CAS_TEMP_INFIX}")
}

const CAS_TEMP_INFIX: &str = ".cas-";

fn validate_sha256(value: &str) -> Result<(), Report<BlobError>> {
    if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(Report::new(BlobError).attach_printable("invalid SHA-256 in blob reference"))
    }
}

fn validate_blob_reference(value: &BlobRefV1) -> Result<(), Report<BlobError>> {
    validate_relative_key(&value.key)?;
    validate_sha256(&value.sha256)?;
    let filename = value.key.rsplit('/').next().unwrap_or_default();
    if filename != value.sha256
        && !filename
            .strip_prefix(&value.sha256)
            .is_some_and(|suffix| suffix.starts_with('.') && suffix.len() > 1)
    {
        return Err(Report::new(BlobError).attach_printable(format!(
            "blob key {:?} is not addressed by its declared SHA-256 {}",
            value.key, value.sha256
        )));
    }
    Ok(())
}

fn validate_suffix(value: &str) -> Result<(), Report<BlobError>> {
    if value.is_empty()
        || (value.starts_with('.')
            && value[1..]
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'))
    {
        Ok(())
    } else {
        Err(Report::new(BlobError).attach_printable(format!("invalid staging suffix {value:?}")))
    }
}

fn validate_segment(kind: &str, value: &str) -> Result<(), Report<BlobError>> {
    if !value.is_empty()
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'@' | b':')
        })
    {
        Ok(())
    } else {
        Err(Report::new(BlobError).attach_printable(format!("invalid {kind} segment {value:?}")))
    }
}

/// True for the local backend's in-flight CAS staging temporaries
/// (`.{name}.cas-{uuid}`). Canonical layouts never produce dotfile keys, so
/// this can only match the emulation's own private artifacts.
fn is_local_cas_staging(key: &str) -> bool {
    key.rsplit('/')
        .next()
        .is_some_and(|name| name.starts_with('.') && name.contains(CAS_TEMP_INFIX))
}

fn validate_relative_key(key: &str) -> Result<(), Report<BlobError>> {
    if key.is_empty() || key.starts_with('/') || key.ends_with('/') {
        return Err(
            Report::new(BlobError).attach_printable(format!("invalid relative object key {key:?}"))
        );
    }
    for segment in key.split('/') {
        validate_segment("object key", segment)?;
        if matches!(segment, "." | "..") {
            return Err(Report::new(BlobError)
                .attach_printable(format!("object key contains traversal: {key}")));
        }
        // Dot-leading names are reserved for the local backend's private
        // staging artifacts. Refusing them at every write is what makes the
        // staging LIST filter unable to hide a committed object.
        if segment.starts_with('.') {
            return Err(Report::new(BlobError).attach_printable(format!(
                "object key contains a reserved dot-leading segment: {key}"
            )));
        }
    }
    Ok(())
}

fn parse_s3_url(url: &str) -> Result<(&str, &str), Report<BlobError>> {
    let value = url
        .strip_prefix("s3://")
        .ok_or_else(|| Report::new(BlobError).attach_printable("blob URL must start with s3://"))?;
    let (bucket, prefix) = value.split_once('/').unwrap_or((value, ""));
    validate_segment("S3 bucket", bucket)?;
    if !prefix.is_empty() {
        validate_relative_key(prefix.trim_end_matches('/'))?;
    }
    Ok((bucket, prefix.trim_matches('/')))
}

fn store_report(operation: &str, error: object_store::Error) -> Report<BlobError> {
    // Provider errors may contain signed request query strings. Keep the
    // operation and safe object_store variant, but never print the full error.
    let kind = match error {
        object_store::Error::NotFound { .. } => "not found",
        object_store::Error::AlreadyExists { .. } => "already exists",
        object_store::Error::Precondition { .. } => "precondition failed",
        object_store::Error::PermissionDenied { .. } => "permission denied",
        object_store::Error::Unauthenticated { .. } => "authentication failed",
        object_store::Error::NotSupported { .. } | object_store::Error::NotImplemented => {
            "not supported"
        }
        _ => "provider error",
    };
    Report::new(BlobError).attach_printable(format!("{operation}: {kind}"))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    #[tokio::test]
    async fn content_objects_are_deduplicated_verified_and_materialized_read_only() {
        let remote = tempdir().unwrap();
        let cache = tempdir().unwrap();
        let store = ArtifactStore::local(remote.path(), cache.path()).unwrap();
        let source = store.stage(".parquet").unwrap();
        tokio::fs::write(&source, b"durable bytes").await.unwrap();

        let first = store
            .publish(&source, "bronze/orders", "application/vnd.apache.parquet")
            .await
            .unwrap();
        let second = store
            .publish(&source, "bronze/orders", "application/vnd.apache.parquet")
            .await
            .unwrap();
        assert_eq!(first, second);

        let local = store.materialize(&first).await.unwrap();
        assert_eq!(tokio::fs::read(&local).await.unwrap(), b"durable bytes");
        assert!(std::fs::metadata(&local).unwrap().permissions().readonly());

        let mut permissions = std::fs::metadata(&local).unwrap().permissions();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            permissions.set_mode(permissions.mode() | 0o200);
        }
        #[cfg(not(unix))]
        {
            #[allow(clippy::permissions_set_readonly_false)]
            permissions.set_readonly(false);
        }
        std::fs::set_permissions(&local, permissions).unwrap();
        tokio::fs::write(&local, b"corrupt").await.unwrap();
        let repaired = store.materialize(&first).await.unwrap();
        assert_eq!(tokio::fs::read(&repaired).await.unwrap(), b"durable bytes");
        store.evict_cached(&first).await.unwrap();
        assert!(!repaired.exists());
        let fetched_again = store.materialize(&first).await.unwrap();
        assert_eq!(
            tokio::fs::read(fetched_again).await.unwrap(),
            b"durable bytes"
        );
    }

    #[tokio::test]
    async fn verified_materializations_are_reused_across_store_clones() {
        let cache = tempdir().unwrap();
        let store = ArtifactStore::in_memory(cache.path()).unwrap();
        let reference = store
            .publish_bytes(
                b"large immutable payload pack",
                ".bin",
                "effects",
                "application/octet-stream",
            )
            .await
            .unwrap();

        let first = store.materialize_guarded_cached(&reference).await.unwrap();
        let second = store
            .clone()
            .materialize_guarded_cached(&reference)
            .await
            .unwrap();

        assert!(Arc::ptr_eq(&first, &second));
        assert_eq!(
            tokio::fs::read(first.path()).await.unwrap(),
            b"large immutable payload pack"
        );
    }

    #[tokio::test]
    async fn dedup_refuses_same_size_corruption_at_a_content_address() {
        let remote = tempdir().unwrap();
        let cache = tempdir().unwrap();
        let store = ArtifactStore::local(remote.path(), cache.path()).unwrap();
        let source = store.stage(".bin").unwrap();
        tokio::fs::write(&source, b"durable bytes").await.unwrap();
        let reference = store
            .publish(&source, "state", "application/octet-stream")
            .await
            .unwrap();
        std::fs::write(
            remote.path().join(&reference.current().key),
            b"corrupt bytes",
        )
        .unwrap();

        let error = store
            .publish(&source, "state", "application/octet-stream")
            .await
            .expect_err("same-size corruption must not be deduplicated");
        assert!(format!("{error:?}").contains("failed byte verification"));
    }

    #[tokio::test]
    async fn json_updates_are_compare_and_swap() {
        let cache = tempdir().unwrap();
        let store = ArtifactStore::in_memory(cache.path()).unwrap();
        let key = "system/admission/01.json";

        let created = store.create_json(key, &json!({"run": 1})).await.unwrap();
        let CasWrite::Written(original) = created else {
            panic!("create unexpectedly conflicted")
        };
        assert_eq!(
            store.create_json(key, &json!({"run": 2})).await.unwrap(),
            CasWrite::Conflict
        );

        let (_, current) = store
            .get_json::<serde_json::Value>(key)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(original, current);
        let updated = store
            .compare_and_swap_json(key, &current, &json!({"run": 2}))
            .await
            .unwrap();
        assert!(matches!(updated, CasWrite::Written(_)));
        assert_eq!(
            store
                .compare_and_swap_json(key, &current, &json!({"run": 3}))
                .await
                .unwrap(),
            CasWrite::Conflict
        );
    }

    #[tokio::test]
    async fn local_json_cas_emulates_provider_update_across_store_handles() {
        let remote = tempdir().unwrap();
        let first_cache = tempdir().unwrap();
        let second_cache = tempdir().unwrap();
        let first = ArtifactStore::local(remote.path(), first_cache.path()).unwrap();
        let second = ArtifactStore::local(remote.path(), second_cache.path()).unwrap();
        let key = "control/test-cas.json";
        let CasWrite::Written(initial) = first
            .create_json(key, &json!({"generation": 1}))
            .await
            .unwrap()
        else {
            panic!("first local create conflicted")
        };

        let (_, second_version) = second
            .get_json::<serde_json::Value>(key)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(initial, second_version);
        assert!(matches!(
            second
                .compare_and_swap_json(key, &second_version, &json!({"generation": 2}))
                .await
                .unwrap(),
            CasWrite::Written(_)
        ));
        assert_eq!(
            first
                .compare_and_swap_json(key, &initial, &json!({"generation": 3}))
                .await
                .unwrap(),
            CasWrite::Conflict
        );
    }

    #[tokio::test]
    async fn cache_eviction_never_removes_an_object_held_for_materialization() {
        let cache = tempdir().unwrap();
        let store = ArtifactStore::in_memory(cache.path())
            .unwrap()
            .with_local_disk_limits(crate::local_disk::LocalDiskLimits {
                max_workspace_bytes: 1024,
                max_cache_bytes: 8,
                min_free_bytes: 0,
                max_staging_bytes: 1024,
                max_staging_age: std::time::Duration::from_secs(60),
            })
            .unwrap();
        let first = store
            .publish_bytes(b"first!", ".bin", "cache", "application/octet-stream")
            .await
            .unwrap();
        let second = store
            .publish_bytes(b"second", ".bin", "cache", "application/octet-stream")
            .await
            .unwrap();
        let active = store.materialize_guarded(&first).await.unwrap();
        let first_path = active.path().to_owned();

        let error = store
            .materialize(&second)
            .await
            .expect_err("an active cache object must not be evicted");
        assert!(format!("{error:?}").contains("retaining active materializations"));
        assert!(first_path.is_file());

        drop(active);
        let second_path = store.materialize(&second).await.unwrap();
        assert!(second_path.is_file());
        assert!(!first_path.exists());
    }

    #[test]
    fn concurrent_cache_misses_reserve_capacity_before_transfer() {
        let cache = tempdir().unwrap();
        let store = ArtifactStore::in_memory(cache.path())
            .unwrap()
            .with_local_disk_limits(crate::local_disk::LocalDiskLimits {
                max_workspace_bytes: 1024,
                max_cache_bytes: 10,
                min_free_bytes: 0,
                max_staging_bytes: 1024,
                max_staging_age: std::time::Duration::from_secs(60),
            })
            .unwrap();
        let first = store.ensure_cache_capacity(6, None).unwrap().unwrap();
        let Err(error) = store.ensure_cache_capacity(6, None) else {
            panic!("active download reservation must count against cache capacity")
        };
        assert!(format!("{error:?}").contains("cannot admit 6 bytes"));
        drop(first);
        assert!(store.ensure_cache_capacity(6, None).unwrap().is_some());
    }

    #[tokio::test]
    async fn cache_pressure_evicts_the_least_recently_used_unlocked_object() {
        let cache = tempdir().unwrap();
        let store = ArtifactStore::in_memory(cache.path())
            .unwrap()
            .with_local_disk_limits(crate::local_disk::LocalDiskLimits {
                max_workspace_bytes: 1024,
                max_cache_bytes: 12,
                min_free_bytes: 0,
                max_staging_bytes: 1024,
                max_staging_age: std::time::Duration::from_secs(60),
            })
            .unwrap();
        let first = store
            .publish_bytes(b"first!", ".bin", "cache", "application/octet-stream")
            .await
            .unwrap();
        let second = store
            .publish_bytes(b"second", ".bin", "cache", "application/octet-stream")
            .await
            .unwrap();
        let third = store
            .publish_bytes(b"third!", ".bin", "cache", "application/octet-stream")
            .await
            .unwrap();
        let first_path = store.materialize(&first).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
        let second_path = store.materialize(&second).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
        assert_eq!(store.materialize(&first).await.unwrap(), first_path);
        tokio::time::sleep(std::time::Duration::from_millis(2)).await;
        let third_path = store.materialize(&third).await.unwrap();

        assert!(first_path.is_file());
        assert!(!second_path.exists());
        assert!(third_path.is_file());
    }

    #[tokio::test]
    async fn object_store_metrics_count_existing_operations_without_probe_reads() {
        let cache = tempdir().unwrap();
        let store = ArtifactStore::in_memory(cache.path()).unwrap();
        let reference = store
            .publish_bytes(b"observed", ".bin", "metrics", "application/octet-stream")
            .await
            .unwrap();
        store.verify_content(&reference).await.unwrap();
        store.list("metrics").await.unwrap();
        let multipart_location = store.location("metrics/multipart.bin").unwrap();
        let mut completed = store
            .store
            .put_multipart(&multipart_location)
            .await
            .unwrap();
        completed
            .put_part(Bytes::from_static(b"part").into())
            .await
            .unwrap();
        completed.complete().await.unwrap();
        let aborted_location = store.location("metrics/aborted.bin").unwrap();
        let mut aborted = store.store.put_multipart(&aborted_location).await.unwrap();
        aborted.abort().await.unwrap();

        let observed = store.telemetry().snapshot(chrono::Utc::now()).object_store;
        // A new bounded immutable object uses atomic create + one confirming
        // HEAD; it no longer needs a speculative existence HEAD.
        assert_eq!(observed.head_operations_total, 1);
        assert!(observed.get_operations_total >= 1);
        assert!(observed.put_operations_total >= 1);
        assert!(observed.put_bytes_total >= reference.current().size);
        assert!(observed.get_bytes_total >= reference.current().size);
        assert_eq!(observed.list_operations_total, 1);
        assert_eq!(observed.multipart_completions_total, 1);
        assert!(observed.multipart_parts_total >= 1);
        assert_eq!(observed.multipart_aborts_total, 1);
    }

    #[tokio::test]
    async fn freshly_published_artifact_materializes_without_a_remote_get() {
        let cache = tempdir().unwrap();
        let store = ArtifactStore::in_memory(cache.path()).unwrap();
        let reference = store
            .publish_bytes(
                b"write-through cache",
                ".bin",
                "cache",
                "application/octet-stream",
            )
            .await
            .unwrap();
        let after_publish = store.telemetry().snapshot(chrono::Utc::now()).object_store;
        assert_eq!(after_publish.get_operations_total, 0);

        let materialized = store.materialize(&reference).await.unwrap();
        assert_eq!(
            tokio::fs::read(materialized).await.unwrap(),
            b"write-through cache"
        );
        let after_materialize = store.telemetry().snapshot(chrono::Utc::now()).object_store;
        assert_eq!(after_materialize.get_operations_total, 0);
    }

    #[tokio::test]
    async fn deduplicated_artifact_is_authoritatively_verified_after_create_conflict() {
        let cache = tempdir().unwrap();
        let store = ArtifactStore::in_memory(cache.path()).unwrap();
        let first = store
            .publish_bytes(
                b"immutable conflict",
                ".bin",
                "dedup",
                "application/octet-stream",
            )
            .await
            .unwrap();
        let before = store.telemetry().snapshot(chrono::Utc::now()).object_store;

        let second = store
            .publish_bytes(
                b"immutable conflict",
                ".bin",
                "dedup",
                "application/octet-stream",
            )
            .await
            .unwrap();
        let after = store.telemetry().snapshot(chrono::Utc::now()).object_store;

        assert_eq!(first, second);
        assert_eq!(after.get_operations_total, before.get_operations_total + 1);
        assert_eq!(
            after.get_bytes_total,
            before.get_bytes_total + first.current().size
        );
        assert_eq!(
            after.failed_operations_total,
            before.failed_operations_total + 1
        );
    }

    #[tokio::test]
    async fn cache_write_through_never_waits_for_a_live_reader_lock() {
        let cache = tempdir().unwrap();
        let store = ArtifactStore::in_memory(cache.path()).unwrap();
        let source = store.stage(".bin").unwrap();
        let bytes = b"reader owns cache lock";
        tokio::fs::write(&source, bytes).await.unwrap();
        let sha256 = hex::encode(Sha256::digest(bytes));
        let held = store.lock_cache_object(&sha256).await.unwrap();

        let reference = tokio::time::timeout(
            Duration::from_millis(100),
            store.publish(&source, "cache-lock", "application/octet-stream"),
        )
        .await
        .expect("best-effort cache population must not wait for a reader")
        .unwrap();
        assert!(!store.cached_path(&reference).unwrap().exists());

        drop(held);
        let before = store.telemetry().snapshot(chrono::Utc::now()).object_store;
        store.materialize(&reference).await.unwrap();
        let after = store.telemetry().snapshot(chrono::Utc::now()).object_store;
        assert_eq!(after.get_operations_total, before.get_operations_total + 1);
    }

    #[test]
    fn namespace_is_tenant_first_and_rejects_traversal() {
        let namespace = BlobNamespace::new("alice", "sap-supply-chain").unwrap();
        assert_eq!(
            namespace.key("runs/019f/record.json").unwrap(),
            "tenants/alice/integrations/sap-supply-chain/runs/019f/record.json"
        );
        assert!(namespace.key("../other-web/state.json").is_err());
    }

    #[test]
    fn v1_namespace_hashes_integration_identity_but_not_tenancy() {
        let tenant = crate::orchestrator::ids::TenantNamespace::parse("alice")
            .expect("valid tenant namespace");
        let id = crate::orchestrator::ids::CanonicalIntegrationId::parse("alice:sap")
            .expect("valid integration ID");
        let integration = crate::orchestrator::routing::integration_path(&id);
        let namespace = BlobNamespace::v1(&tenant, &integration);
        assert_eq!(
            namespace.root(),
            format!("tenants/alice/integrations/{integration}")
        );
        assert!(!namespace.root().contains("alice:sap"));
    }
}
