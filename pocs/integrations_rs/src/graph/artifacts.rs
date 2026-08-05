//! Immutable desired Graph projections and paged effect indexes.
//!
//! Planning publishes exact Graph request bytes before a work record becomes
//! durable. Indexes are bounded pages, while payload bytes live in immutable
//! packs so an index never needs to contain or address itself.

use std::collections::BTreeSet;
use std::fmt;
use std::sync::Arc;

use async_trait::async_trait;
use error_stack::{Report, ResultExt};
use futures::{StreamExt as _, TryStreamExt as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::effects::{BlobSliceRefV1, GraphEffect, GraphEffectV1, GRAPH_EFFECT_PAYLOAD_MEDIA_TYPE};
use crate::blob::{ArtifactStore, BlobRef, MaterializedBlob};
use crate::orchestrator::registry::{
    reject_unknown_fields, AlgorithmVersion, CompatError, DurabilityClass, DurableRecord,
    MigrationPolicy, PureUpcastRecord, RecordFamily, VersionedRecord,
};
use crate::orchestrator::work::DesiredProjectionRef;

pub const DESIRED_PROJECTION_SCHEMA_VERSION: u32 = 1;
pub const EFFECT_INDEX_SCHEMA_VERSION: u32 = 1;
pub const DESIRED_PROJECTION_INDEX_MEDIA_TYPE: &str =
    "application/vnd.hash.desired-graph-projection-index+json";
pub const DESIRED_PROJECTION_PAGE_MEDIA_TYPE: &str =
    "application/vnd.hash.desired-graph-projection-page+json";
pub const GRAPH_EFFECT_INDEX_MEDIA_TYPE: &str = "application/vnd.hash.graph-effect-index+json";
pub const GRAPH_EFFECT_PAGE_MEDIA_TYPE: &str = "application/vnd.hash.graph-effect-page+json";

pub(crate) const MAX_INDEX_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const MAX_PAGE_BYTES: usize = 32 * 1024 * 1024;
/// Page width for newly written indexes. Readers must use the index's own
/// `page_entries` field, so changing this default is not a format break.
/// Measured against real S3 (2026-08-05): 1024 was slower than 256 in every
/// phase, because window loads fetch pages 16-wide and wider pages reduce
/// that concurrency while enlarging each verified read-back.
const DEFAULT_PAGE_ENTRIES: usize = 256;
/// Upper bound accepted from a decoded index; byte bounds still apply.
const MAX_PAGE_ENTRIES: u64 = 8192;
const PAGE_PUBLICATION_CONCURRENCY: usize = 16;
const MAX_GRAPH_IDENTITY_BYTES: usize = 8 * 1024;

pub(crate) static DESIRED_PROJECTION_ARTIFACT_FAMILY: RecordFamily = RecordFamily {
    name: "desired_projection_artifact",
    owning_module: "graph::artifacts",
    emitted_version: 1,
    supported_versions: &[1],
    algorithm_versions: &[AlgorithmVersion {
        name: "desired_projection_schema",
        version: DESIRED_PROJECTION_SCHEMA_VERSION,
    }],
    durability: DurabilityClass::ImmutableArtifact,
    migration: MigrationPolicy::PureUpcast,
};

pub(crate) static EFFECT_INDEX_ARTIFACT_FAMILY: RecordFamily = RecordFamily {
    name: "effect_index_artifact",
    owning_module: "graph::artifacts",
    emitted_version: 1,
    supported_versions: &[1],
    algorithm_versions: &[AlgorithmVersion {
        name: "effect_index_schema",
        version: EFFECT_INDEX_SCHEMA_VERSION,
    }],
    durability: DurabilityClass::ImmutableArtifact,
    migration: MigrationPolicy::PureUpcast,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub enum DesiredProjectionArtifact {
    V1(DesiredProjectionArtifactV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "artifact", content = "data", rename_all = "snake_case")]
pub enum DesiredProjectionArtifactV1 {
    Index(DesiredProjectionIndexV1),
    Page(DesiredProjectionPageV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DesiredProjectionIndexV1 {
    pub schema_version: u32,
    pub object_count: u64,
    pub page_entries: u64,
    pub pages: Vec<BlobRef>,
    pub page_bounds: Vec<DesiredProjectionPageBoundsV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DesiredProjectionPageBoundsV1 {
    pub first: DesiredObjectKeyV1,
    pub last: DesiredObjectKeyV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DesiredProjectionPageV1 {
    pub objects: Vec<DesiredGraphObjectV1>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GraphObjectKindV1 {
    Entity,
    Link,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DesiredGraphObjectV1 {
    pub kind: GraphObjectKindV1,
    pub graph_identity: String,
    pub disposition: DesiredDispositionV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum DesiredDispositionV1 {
    Live {
        payload_digest: String,
        payload: BlobSliceRefV1,
    },
    Archived {
        payload_digest: String,
        payload: BlobSliceRefV1,
    },
}

impl DesiredDispositionV1 {
    pub fn payload_digest(&self) -> &str {
        match self {
            Self::Live { payload_digest, .. } | Self::Archived { payload_digest, .. } => {
                payload_digest
            }
        }
    }

    pub fn payload(&self) -> &BlobSliceRefV1 {
        match self {
            Self::Live { payload, .. } | Self::Archived { payload, .. } => payload,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesiredObjectInputV1 {
    pub kind: GraphObjectKindV1,
    pub graph_identity: String,
    pub disposition: DesiredObjectInputDispositionV1,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DesiredObjectInputDispositionV1 {
    Live(Vec<u8>),
    Archived(Vec<u8>),
}

impl DesiredObjectInputDispositionV1 {
    pub fn payload(&self) -> &[u8] {
        match self {
            Self::Live(payload) | Self::Archived(payload) => payload,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublishedDesiredProjectionV1 {
    pub reference: DesiredProjectionRef,
    pub objects: Vec<DesiredGraphObjectV1>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedDesiredObjectV1 {
    pub object: DesiredGraphObjectV1,
    pub payload: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DesiredObjectKeyV1 {
    pub kind: GraphObjectKindV1,
    pub graph_identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "version", content = "data", rename_all = "snake_case")]
pub enum EffectIndexArtifact {
    V1(EffectIndexArtifactV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "artifact", content = "data", rename_all = "snake_case")]
pub enum EffectIndexArtifactV1 {
    Index(EffectIndexV1),
    Page(EffectPageV1),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EffectIndexV1 {
    pub schema_version: u32,
    pub target_state_digest: String,
    pub effect_count: u64,
    pub page_entries: u64,
    pub pages: Vec<BlobRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EffectPageV1 {
    pub effects: Vec<GraphEffect>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedGraphEffectV1 {
    pub effect: GraphEffectV1,
    pub payload: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedEffectWindowV1 {
    pub effect_count: u64,
    pub previous_effect_id: Option<crate::orchestrator::ids::EffectId>,
    pub effects: Vec<ResolvedGraphEffectV1>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffectRepositoryError {
    InvalidInput,
    ArtifactPublication,
    ArtifactIntegrity,
    UnsupportedArtifact,
}

impl fmt::Display for EffectRepositoryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidInput => "effect repository input is invalid",
            Self::ArtifactPublication => "effect repository artifact publication failed",
            Self::ArtifactIntegrity => "effect repository artifact integrity check failed",
            Self::UnsupportedArtifact => "effect repository artifact type is unsupported",
        })
    }
}

impl std::error::Error for EffectRepositoryError {}

#[async_trait]
pub trait EffectRepository: Send + Sync {
    async fn publish_desired_projection(
        &self,
        objects: Vec<DesiredObjectInputV1>,
    ) -> Result<PublishedDesiredProjectionV1, Report<EffectRepositoryError>>;

    async fn load_desired_projection(
        &self,
        reference: &DesiredProjectionRef,
    ) -> Result<Vec<ResolvedDesiredObjectV1>, Report<EffectRepositoryError>>;

    async fn load_desired_objects(
        &self,
        reference: &DesiredProjectionRef,
        keys: &[DesiredObjectKeyV1],
    ) -> Result<Vec<ResolvedDesiredObjectV1>, Report<EffectRepositoryError>> {
        let keys = keys.iter().cloned().collect::<BTreeSet<_>>();
        self.load_desired_projection(reference)
            .await
            .map(|objects| {
                objects
                    .into_iter()
                    .filter(|object| {
                        keys.contains(&DesiredObjectKeyV1 {
                            kind: object.object.kind,
                            graph_identity: object.object.graph_identity.clone(),
                        })
                    })
                    .collect()
            })
    }

    async fn publish_effect_index(
        &self,
        target_state_digest: &str,
        effects: Vec<GraphEffectV1>,
    ) -> Result<BlobRef, Report<EffectRepositoryError>>;

    async fn load_effect_index(
        &self,
        reference: &BlobRef,
    ) -> Result<Vec<ResolvedGraphEffectV1>, Report<EffectRepositoryError>>;

    async fn load_effect_window(
        &self,
        reference: &BlobRef,
        start: u64,
        maximum: usize,
    ) -> Result<LoadedEffectWindowV1, Report<EffectRepositoryError>> {
        let effects = self.load_effect_index(reference).await?;
        let start =
            usize::try_from(start).change_context(EffectRepositoryError::ArtifactIntegrity)?;
        if start > effects.len() {
            return Err(Report::new(EffectRepositoryError::ArtifactIntegrity)
                .attach_printable("effect window starts beyond the effect count"));
        }
        let previous_effect_id = start
            .checked_sub(1)
            .and_then(|index| effects.get(index))
            .map(|resolved| resolved.effect.effect_id.clone());
        Ok(LoadedEffectWindowV1 {
            effect_count: effects.len() as u64,
            previous_effect_id,
            effects: effects.into_iter().skip(start).take(maximum).collect(),
        })
    }
}

#[derive(Debug, Clone)]
pub struct ArtifactEffectRepository {
    store: ArtifactStore,
    logical_root: String,
}

struct MaterializedPackSet<'a> {
    store: &'a ArtifactStore,
    packs: Vec<(BlobRef, Arc<MaterializedBlob>, tokio::fs::File)>,
}

impl<'a> MaterializedPackSet<'a> {
    fn new(store: &'a ArtifactStore) -> Self {
        Self {
            store,
            packs: Vec::new(),
        }
    }

    async fn read_slice(
        &mut self,
        slice: &BlobSliceRefV1,
        expected_digest: &str,
    ) -> Result<Vec<u8>, Report<EffectRepositoryError>> {
        validate_slice(slice).change_context(EffectRepositoryError::ArtifactIntegrity)?;
        validate_sha256(expected_digest)
            .change_context(EffectRepositoryError::ArtifactIntegrity)?;
        let pack_index = match self
            .packs
            .iter()
            .position(|(reference, _materialized, _file)| reference == &slice.artifact)
        {
            Some(index) => index,
            None => {
                let materialized = self
                    .store
                    .materialize_guarded_cached(&slice.artifact)
                    .await
                    .change_context(EffectRepositoryError::ArtifactIntegrity)?;
                let file = tokio::fs::File::open(materialized.path())
                    .await
                    .change_context(EffectRepositoryError::ArtifactIntegrity)?;
                self.packs
                    .push((slice.artifact.clone(), materialized, file));
                self.packs.len() - 1
            }
        };
        read_verified_slice(&mut self.packs[pack_index].2, slice, expected_digest).await
    }
}

impl ArtifactEffectRepository {
    pub fn new(
        store: ArtifactStore,
        logical_root: impl Into<String>,
    ) -> Result<Self, Report<EffectRepositoryError>> {
        let logical_root = logical_root.into().trim_matches('/').to_owned();
        if logical_root.is_empty()
            || logical_root.contains("//")
            || logical_root.contains('\\')
            || logical_root
                .split('/')
                .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
            || logical_root.chars().any(char::is_control)
        {
            return Err(Report::new(EffectRepositoryError::InvalidInput)
                .attach_printable("logical artifact root must be a canonical relative key"));
        }
        Ok(Self {
            store,
            logical_root,
        })
    }

    fn prefix(&self, child: &str) -> String {
        format!("{}/{child}", self.logical_root)
    }

    async fn publish_pack(
        &self,
        ordered: &[DesiredObjectInputV1],
    ) -> Result<(BlobRef, Vec<(String, u64, u64)>), Report<EffectRepositoryError>> {
        use tokio::io::AsyncWriteExt;

        let staged = self
            .store
            .stage(".bin")
            .change_context(EffectRepositoryError::ArtifactPublication)?;
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staged)
            .await
            .change_context(EffectRepositoryError::ArtifactPublication)?;
        let mut offset = 0_u64;
        let mut slices = Vec::with_capacity(ordered.len());
        for object in ordered {
            let payload = object.disposition.payload();
            if payload.is_empty() {
                return Err(Report::new(EffectRepositoryError::InvalidInput)
                    .attach_printable("desired Graph delivery payload must not be empty"));
            }
            let length =
                u64::try_from(payload.len()).change_context(EffectRepositoryError::InvalidInput)?;
            let digest = sha256(payload);
            file.write_all(payload)
                .await
                .change_context(EffectRepositoryError::ArtifactPublication)?;
            slices.push((digest, offset, length));
            offset = offset.checked_add(length).ok_or_else(|| {
                Report::new(EffectRepositoryError::InvalidInput)
                    .attach_printable("payload pack size overflows u64")
            })?;
        }
        file.sync_all()
            .await
            .change_context(EffectRepositoryError::ArtifactPublication)?;
        drop(file);
        if offset == 0 {
            tokio::fs::remove_file(&staged)
                .await
                .change_context(EffectRepositoryError::ArtifactPublication)?;
            return Err(Report::new(EffectRepositoryError::InvalidInput)
                .attach_printable("desired projection payload pack must not be empty"));
        }
        let published = self
            .store
            .publish(
                &staged,
                &self.prefix("payload-packs"),
                GRAPH_EFFECT_PAYLOAD_MEDIA_TYPE,
            )
            .await;
        let cleanup = tokio::fs::remove_file(&staged)
            .await
            .change_context(EffectRepositoryError::ArtifactPublication);
        let artifact = published.change_context(EffectRepositoryError::ArtifactPublication)?;
        cleanup?;
        Ok((artifact, slices))
    }

    async fn publish_desired_pages(
        &self,
        objects: &[DesiredGraphObjectV1],
    ) -> Result<(Vec<BlobRef>, Vec<DesiredProjectionPageBoundsV1>), Report<EffectRepositoryError>>
    {
        let mut page_records = Vec::new();
        let mut page_bounds = Vec::new();
        for chunk in objects.chunks(DEFAULT_PAGE_ENTRIES) {
            let first = chunk
                .first()
                .map(desired_object_key)
                .ok_or_else(|| Report::new(EffectRepositoryError::InvalidInput))?;
            let last = chunk
                .last()
                .map(desired_object_key)
                .ok_or_else(|| Report::new(EffectRepositoryError::InvalidInput))?;
            let page = DesiredProjectionArtifact::V1(DesiredProjectionArtifactV1::Page(
                DesiredProjectionPageV1 {
                    objects: chunk.to_vec(),
                },
            ));
            page_records.push(page);
            page_bounds.push(DesiredProjectionPageBoundsV1 { first, last });
        }
        let pages = futures::stream::iter(page_records.into_iter().map(|page| async move {
            self.store
                .publish_record(
                    &page,
                    MAX_PAGE_BYTES,
                    &self.prefix("desired/pages"),
                    DESIRED_PROJECTION_PAGE_MEDIA_TYPE,
                )
                .await
                .change_context(EffectRepositoryError::ArtifactPublication)
        }))
        .buffered(PAGE_PUBLICATION_CONCURRENCY)
        .try_collect()
        .await?;
        Ok((pages, page_bounds))
    }

    async fn publish_effect_pages(
        &self,
        effects: &[GraphEffectV1],
    ) -> Result<Vec<BlobRef>, Report<EffectRepositoryError>> {
        let page_records = effects
            .chunks(DEFAULT_PAGE_ENTRIES)
            .map(|chunk| {
                EffectIndexArtifact::V1(EffectIndexArtifactV1::Page(EffectPageV1 {
                    effects: chunk.iter().cloned().map(GraphEffect::V1).collect(),
                }))
            })
            .collect::<Vec<_>>();
        futures::stream::iter(page_records)
            .map(|page| async move {
                self.store
                    .publish_record(
                        &page,
                        MAX_PAGE_BYTES,
                        &self.prefix("effects/pages"),
                        GRAPH_EFFECT_PAGE_MEDIA_TYPE,
                    )
                    .await
                    .change_context(EffectRepositoryError::ArtifactPublication)
            })
            .buffered(PAGE_PUBLICATION_CONCURRENCY)
            .try_collect()
            .await
    }
}

#[async_trait]
impl EffectRepository for ArtifactEffectRepository {
    async fn publish_desired_projection(
        &self,
        mut inputs: Vec<DesiredObjectInputV1>,
    ) -> Result<PublishedDesiredProjectionV1, Report<EffectRepositoryError>> {
        inputs.sort_by(|left, right| desired_input_key(left).cmp(&desired_input_key(right)));
        ensure_unique_inputs(&inputs)?;
        let (pack, slices) = if inputs.is_empty() {
            (None, vec![])
        } else {
            let (pack, slices) = self.publish_pack(&inputs).await?;
            (Some(pack), slices)
        };
        let mut objects = Vec::with_capacity(inputs.len());
        for (input, slice) in inputs.into_iter().zip(slices) {
            let DesiredObjectInputV1 {
                kind,
                graph_identity,
                disposition: input_disposition,
            } = input;
            validate_identity(&graph_identity)
                .change_context(EffectRepositoryError::InvalidInput)?;
            let (payload_digest, offset, length) = slice;
            let payload = BlobSliceRefV1 {
                artifact: pack
                    .clone()
                    .ok_or_else(|| Report::new(EffectRepositoryError::ArtifactPublication))?,
                offset,
                length,
            };
            let disposition = match input_disposition {
                DesiredObjectInputDispositionV1::Live(_) => DesiredDispositionV1::Live {
                    payload_digest,
                    payload,
                },
                DesiredObjectInputDispositionV1::Archived(_) => DesiredDispositionV1::Archived {
                    payload_digest,
                    payload,
                },
            };
            objects.push(DesiredGraphObjectV1 {
                kind,
                graph_identity,
                disposition,
            });
        }
        validate_desired_objects(&objects).change_context(EffectRepositoryError::InvalidInput)?;
        let (pages, page_bounds) = self.publish_desired_pages(&objects).await?;
        let index = DesiredProjectionArtifact::V1(DesiredProjectionArtifactV1::Index(
            DesiredProjectionIndexV1 {
                schema_version: DESIRED_PROJECTION_SCHEMA_VERSION,
                object_count: objects.len() as u64,
                page_entries: DEFAULT_PAGE_ENTRIES as u64,
                pages,
                page_bounds,
            },
        ));
        let artifact = self
            .store
            .publish_record(
                &index,
                MAX_INDEX_BYTES,
                &self.prefix("desired/indexes"),
                DESIRED_PROJECTION_INDEX_MEDIA_TYPE,
            )
            .await
            .change_context(EffectRepositoryError::ArtifactPublication)?;
        Ok(PublishedDesiredProjectionV1 {
            reference: DesiredProjectionRef { artifact },
            objects,
        })
    }

    async fn load_desired_projection(
        &self,
        reference: &DesiredProjectionRef,
    ) -> Result<Vec<ResolvedDesiredObjectV1>, Report<EffectRepositoryError>> {
        ensure_media_type(&reference.artifact, DESIRED_PROJECTION_INDEX_MEDIA_TYPE)?;
        let root = load_desired_artifact(&self.store, &reference.artifact, MAX_INDEX_BYTES).await?;
        let DesiredProjectionArtifactV1::Index(index) = root else {
            return Err(Report::new(EffectRepositoryError::UnsupportedArtifact)
                .attach_printable("desired projection reference names a page"));
        };
        let pages = futures::stream::iter(
            index
                .pages
                .iter()
                .cloned()
                .zip(index.page_bounds.iter().cloned()),
        )
        .map(|(page_ref, bounds)| async move {
            ensure_media_type(&page_ref, DESIRED_PROJECTION_PAGE_MEDIA_TYPE)?;
            let page = load_desired_artifact(&self.store, &page_ref, MAX_PAGE_BYTES).await?;
            Ok::<_, Report<EffectRepositoryError>>((page, bounds))
        })
        .buffered(PAGE_PUBLICATION_CONCURRENCY)
        .try_collect::<Vec<_>>()
        .await?;
        let mut objects = Vec::new();
        for (page, bounds) in pages {
            let DesiredProjectionArtifactV1::Page(page) = page else {
                return Err(Report::new(EffectRepositoryError::UnsupportedArtifact)
                    .attach_printable("desired projection page names an index"));
            };
            validate_page_bounds(&page, &bounds)
                .change_context(EffectRepositoryError::ArtifactIntegrity)?;
            objects.extend(page.objects);
        }
        if objects.len() as u64 != index.object_count {
            return Err(
                Report::new(EffectRepositoryError::ArtifactIntegrity).attach_printable(format!(
                    "desired object count is {}, index declares {}",
                    objects.len(),
                    index.object_count
                )),
            );
        }
        validate_desired_objects(&objects)
            .change_context(EffectRepositoryError::ArtifactIntegrity)?;
        let mut resolved = Vec::with_capacity(objects.len());
        let mut packs = MaterializedPackSet::new(&self.store);
        for object in objects {
            let payload = packs
                .read_slice(
                    object.disposition.payload(),
                    object.disposition.payload_digest(),
                )
                .await?;
            resolved.push(ResolvedDesiredObjectV1 { object, payload });
        }
        Ok(resolved)
    }

    async fn load_desired_objects(
        &self,
        reference: &DesiredProjectionRef,
        keys: &[DesiredObjectKeyV1],
    ) -> Result<Vec<ResolvedDesiredObjectV1>, Report<EffectRepositoryError>> {
        ensure_media_type(&reference.artifact, DESIRED_PROJECTION_INDEX_MEDIA_TYPE)?;
        let root = load_desired_artifact(&self.store, &reference.artifact, MAX_INDEX_BYTES).await?;
        let DesiredProjectionArtifactV1::Index(index) = root else {
            return Err(Report::new(EffectRepositoryError::UnsupportedArtifact)
                .attach_printable("desired projection reference names a page"));
        };
        let wanted = keys.iter().cloned().collect::<BTreeSet<_>>();
        let needed = index
            .pages
            .iter()
            .cloned()
            .zip(index.page_bounds.iter().cloned())
            .filter(|(_page_ref, bounds)| {
                wanted
                    .range(bounds.first.clone()..=bounds.last.clone())
                    .next()
                    .is_some()
            });
        let pages = futures::stream::iter(needed)
            .map(|(page_ref, bounds)| async move {
                ensure_media_type(&page_ref, DESIRED_PROJECTION_PAGE_MEDIA_TYPE)?;
                let page = load_desired_artifact(&self.store, &page_ref, MAX_PAGE_BYTES).await?;
                Ok::<_, Report<EffectRepositoryError>>((page, bounds))
            })
            .buffered(PAGE_PUBLICATION_CONCURRENCY)
            .try_collect::<Vec<_>>()
            .await?;
        let mut selected = Vec::with_capacity(wanted.len());
        let mut previous = None;
        for (page, bounds) in pages {
            let DesiredProjectionArtifactV1::Page(page) = page else {
                return Err(Report::new(EffectRepositoryError::UnsupportedArtifact)
                    .attach_printable("desired projection page names an index"));
            };
            if page.objects.is_empty() {
                return Err(Report::new(EffectRepositoryError::ArtifactIntegrity)
                    .attach_printable("desired projection contains an empty page"));
            }
            validate_desired_objects(&page.objects)
                .change_context(EffectRepositoryError::ArtifactIntegrity)?;
            validate_page_bounds(&page, &bounds)
                .change_context(EffectRepositoryError::ArtifactIntegrity)?;
            if let Some(first) = page.objects.first() {
                let first_key = (first.kind, first.graph_identity.clone());
                if previous.as_ref().is_some_and(|value| value >= &first_key) {
                    return Err(Report::new(EffectRepositoryError::ArtifactIntegrity)
                        .attach_printable("desired projection pages are not globally ordered"));
                }
            }
            previous = page
                .objects
                .last()
                .map(|object| (object.kind, object.graph_identity.clone()));
            selected.extend(page.objects.into_iter().filter(|object| {
                wanted.contains(&DesiredObjectKeyV1 {
                    kind: object.kind,
                    graph_identity: object.graph_identity.clone(),
                })
            }));
        }
        let mut resolved = Vec::with_capacity(selected.len());
        let mut packs = MaterializedPackSet::new(&self.store);
        for object in selected {
            let payload = packs
                .read_slice(
                    object.disposition.payload(),
                    object.disposition.payload_digest(),
                )
                .await?;
            resolved.push(ResolvedDesiredObjectV1 { object, payload });
        }
        Ok(resolved)
    }

    async fn publish_effect_index(
        &self,
        target_state_digest: &str,
        mut effects: Vec<GraphEffectV1>,
    ) -> Result<BlobRef, Report<EffectRepositoryError>> {
        if !target_state_digest.is_empty() {
            validate_sha256(target_state_digest)
                .change_context(EffectRepositoryError::InvalidInput)?;
        }
        effects.sort_by(|left, right| effect_key(left).cmp(&effect_key(right)));
        validate_effects(target_state_digest, &effects)
            .change_context(EffectRepositoryError::InvalidInput)?;
        let pages = self.publish_effect_pages(&effects).await?;
        let index = EffectIndexArtifact::V1(EffectIndexArtifactV1::Index(EffectIndexV1 {
            schema_version: EFFECT_INDEX_SCHEMA_VERSION,
            target_state_digest: target_state_digest.to_owned(),
            effect_count: effects.len() as u64,
            page_entries: DEFAULT_PAGE_ENTRIES as u64,
            pages,
        }));
        self.store
            .publish_record(
                &index,
                MAX_INDEX_BYTES,
                &self.prefix("effects/indexes"),
                GRAPH_EFFECT_INDEX_MEDIA_TYPE,
            )
            .await
            .change_context(EffectRepositoryError::ArtifactPublication)
    }

    async fn load_effect_index(
        &self,
        reference: &BlobRef,
    ) -> Result<Vec<ResolvedGraphEffectV1>, Report<EffectRepositoryError>> {
        ensure_media_type(reference, GRAPH_EFFECT_INDEX_MEDIA_TYPE)?;
        let root = load_effect_artifact(&self.store, reference, MAX_INDEX_BYTES).await?;
        let EffectIndexArtifactV1::Index(index) = root else {
            return Err(Report::new(EffectRepositoryError::UnsupportedArtifact)
                .attach_printable("effect index reference names a page"));
        };
        let mut effects = Vec::new();
        for page_ref in &index.pages {
            ensure_media_type(page_ref, GRAPH_EFFECT_PAGE_MEDIA_TYPE)?;
            let page = load_effect_artifact(&self.store, page_ref, MAX_PAGE_BYTES).await?;
            let EffectIndexArtifactV1::Page(page) = page else {
                return Err(Report::new(EffectRepositoryError::UnsupportedArtifact)
                    .attach_printable("effect page reference names an index"));
            };
            for effect in page.effects {
                effects.push(
                    effect
                        .into_current()
                        .change_context(EffectRepositoryError::ArtifactIntegrity)?,
                );
            }
        }
        if effects.len() as u64 != index.effect_count {
            return Err(
                Report::new(EffectRepositoryError::ArtifactIntegrity).attach_printable(format!(
                    "effect count is {}, index declares {}",
                    effects.len(),
                    index.effect_count
                )),
            );
        }
        validate_effects(&index.target_state_digest, &effects)
            .change_context(EffectRepositoryError::ArtifactIntegrity)?;
        let mut resolved = Vec::with_capacity(effects.len());
        let mut packs = MaterializedPackSet::new(&self.store);
        for effect in effects {
            let payload = match (&effect.payload_digest, &effect.payload) {
                (Some(digest), Some(slice)) => Some(packs.read_slice(slice, digest).await?),
                (None, None) => None,
                _ => {
                    return Err(Report::new(EffectRepositoryError::ArtifactIntegrity)
                        .attach_printable("effect payload pair is incoherent"));
                }
            };
            resolved.push(ResolvedGraphEffectV1 { effect, payload });
        }
        Ok(resolved)
    }

    async fn load_effect_window(
        &self,
        reference: &BlobRef,
        start: u64,
        maximum: usize,
    ) -> Result<LoadedEffectWindowV1, Report<EffectRepositoryError>> {
        ensure_media_type(reference, GRAPH_EFFECT_INDEX_MEDIA_TYPE)?;
        let root = load_effect_artifact(&self.store, reference, MAX_INDEX_BYTES).await?;
        let EffectIndexArtifactV1::Index(index) = root else {
            return Err(Report::new(EffectRepositoryError::UnsupportedArtifact)
                .attach_printable("effect index reference names a page"));
        };
        if start > index.effect_count {
            return Err(Report::new(EffectRepositoryError::ArtifactIntegrity)
                .attach_printable("effect window starts beyond the effect count"));
        }
        let page_entries = index.page_entries;
        if page_entries == 0 {
            return Err(Report::new(EffectRepositoryError::ArtifactIntegrity)
                .attach_printable("effect index declares a zero page width"));
        }
        let expected_pages = if index.effect_count == 0 {
            0
        } else {
            ((index.effect_count - 1) / page_entries) + 1
        };
        if index.pages.len() as u64 != expected_pages {
            return Err(Report::new(EffectRepositoryError::ArtifactIntegrity)
                .attach_printable("effect page count disagrees with the effect count"));
        }
        let end = start.saturating_add(maximum as u64).min(index.effect_count);
        let first_needed = start.saturating_sub(1);
        let page_start = if first_needed < index.effect_count {
            first_needed / page_entries
        } else {
            expected_pages
        };
        let page_end = if end > 0 {
            ((end - 1) / page_entries) + 1
        } else {
            0
        };
        let page_refs = (page_start..page_end)
            .map(|page_index| {
                index
                    .pages
                    .get(page_index as usize)
                    .cloned()
                    .map(|page_ref| (page_index, page_ref))
                    .ok_or_else(|| {
                        Report::new(EffectRepositoryError::ArtifactIntegrity)
                            .attach_printable("effect page index is outside the root")
                    })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let pages = futures::stream::iter(page_refs)
            .map(|(page_index, page_ref)| async move {
                ensure_media_type(&page_ref, GRAPH_EFFECT_PAGE_MEDIA_TYPE)?;
                let page = load_effect_artifact(&self.store, &page_ref, MAX_PAGE_BYTES).await?;
                Ok::<_, Report<EffectRepositoryError>>((page_index, page))
            })
            .buffered(PAGE_PUBLICATION_CONCURRENCY)
            .try_collect::<Vec<_>>()
            .await?;
        let mut previous_effect_id = None;
        let mut selected = Vec::new();
        let mut previous_key = None;
        let mut packs = MaterializedPackSet::new(&self.store);
        for (page_index, page) in pages {
            let EffectIndexArtifactV1::Page(page) = page else {
                return Err(Report::new(EffectRepositoryError::UnsupportedArtifact)
                    .attach_printable("effect page reference names an index"));
            };
            let global_page_start = page_index * page_entries;
            let expected_len =
                (index.effect_count - global_page_start).min(page_entries) as usize;
            if page.effects.len() != expected_len {
                return Err(Report::new(EffectRepositoryError::ArtifactIntegrity)
                    .attach_printable("effect page length disagrees with its root position"));
            }
            let mut page_effects = Vec::with_capacity(page.effects.len());
            for effect in page.effects {
                let effect = effect
                    .into_current()
                    .change_context(EffectRepositoryError::ArtifactIntegrity)?;
                if effect.target_state_digest != index.target_state_digest {
                    return Err(Report::new(EffectRepositoryError::ArtifactIntegrity)
                        .attach_printable("effect target differs from the index target"));
                }
                let key = (
                    effect.operation.order(),
                    effect.graph_identity.clone(),
                    effect.effect_id.as_str().to_owned(),
                );
                if previous_key.as_ref().is_some_and(|value| value >= &key) {
                    return Err(Report::new(EffectRepositoryError::ArtifactIntegrity)
                        .attach_printable("effect window pages are not globally ordered"));
                }
                previous_key = Some(key);
                page_effects.push(effect);
            }
            for (offset, effect) in page_effects.into_iter().enumerate() {
                let global = global_page_start + offset as u64;
                if global + 1 == start {
                    previous_effect_id = Some(effect.effect_id.clone());
                }
                if global < start || global >= end {
                    continue;
                }
                let payload = match (&effect.payload_digest, &effect.payload) {
                    (Some(digest), Some(slice)) => Some(packs.read_slice(slice, digest).await?),
                    (None, None) => None,
                    _ => {
                        return Err(Report::new(EffectRepositoryError::ArtifactIntegrity)
                            .attach_printable("effect payload pair is incoherent"));
                    }
                };
                selected.push(ResolvedGraphEffectV1 { effect, payload });
            }
        }
        if start > 0 && previous_effect_id.is_none() {
            return Err(Report::new(EffectRepositoryError::ArtifactIntegrity)
                .attach_printable("effect window could not resolve its preceding cursor"));
        }
        if selected.len() as u64 != end - start {
            return Err(Report::new(EffectRepositoryError::ArtifactIntegrity)
                .attach_printable("effect window length disagrees with its requested range"));
        }
        Ok(LoadedEffectWindowV1 {
            effect_count: index.effect_count,
            previous_effect_id,
            effects: selected,
        })
    }
}

async fn load_desired_artifact(
    store: &ArtifactStore,
    reference: &BlobRef,
    maximum: usize,
) -> Result<DesiredProjectionArtifactV1, Report<EffectRepositoryError>> {
    let path = store
        .materialize(reference)
        .await
        .change_context(EffectRepositoryError::ArtifactIntegrity)?;
    let bytes = tokio::fs::read(path)
        .await
        .change_context(EffectRepositoryError::ArtifactIntegrity)?;
    if bytes.len() > maximum {
        return Err(Report::new(EffectRepositoryError::ArtifactIntegrity)
            .attach_printable("desired projection artifact exceeds its bound"));
    }
    DesiredProjectionArtifact::decode(&bytes)
        .change_context(EffectRepositoryError::ArtifactIntegrity)
        .map(|value| match value {
            DesiredProjectionArtifact::V1(value) => value,
        })
}

async fn load_effect_artifact(
    store: &ArtifactStore,
    reference: &BlobRef,
    maximum: usize,
) -> Result<EffectIndexArtifactV1, Report<EffectRepositoryError>> {
    let path = store
        .materialize(reference)
        .await
        .change_context(EffectRepositoryError::ArtifactIntegrity)?;
    let bytes = tokio::fs::read(path)
        .await
        .change_context(EffectRepositoryError::ArtifactIntegrity)?;
    if bytes.len() > maximum {
        return Err(Report::new(EffectRepositoryError::ArtifactIntegrity)
            .attach_printable("effect artifact exceeds its bound"));
    }
    EffectIndexArtifact::decode(&bytes)
        .change_context(EffectRepositoryError::ArtifactIntegrity)
        .map(|value| match value {
            EffectIndexArtifact::V1(value) => value,
        })
}

async fn read_verified_slice(
    file: &mut tokio::fs::File,
    slice: &BlobSliceRefV1,
    expected_digest: &str,
) -> Result<Vec<u8>, Report<EffectRepositoryError>> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    let length =
        usize::try_from(slice.length).change_context(EffectRepositoryError::ArtifactIntegrity)?;
    file.seek(std::io::SeekFrom::Start(slice.offset))
        .await
        .change_context(EffectRepositoryError::ArtifactIntegrity)?;
    let mut bytes = vec![0; length];
    file.read_exact(&mut bytes)
        .await
        .change_context(EffectRepositoryError::ArtifactIntegrity)?;
    let actual = sha256(&bytes);
    if actual != expected_digest {
        return Err(
            Report::new(EffectRepositoryError::ArtifactIntegrity).attach_printable(format!(
                "payload slice digest is {actual}, expected {expected_digest}"
            )),
        );
    }
    Ok(bytes)
}

fn ensure_unique_inputs(
    inputs: &[DesiredObjectInputV1],
) -> Result<(), Report<EffectRepositoryError>> {
    for pair in inputs.windows(2) {
        if desired_input_key(&pair[0]) == desired_input_key(&pair[1]) {
            return Err(
                Report::new(EffectRepositoryError::InvalidInput).attach_printable(format!(
                    "duplicate desired Graph identity {:?}",
                    pair[0].graph_identity
                )),
            );
        }
    }
    Ok(())
}

fn validate_desired_objects(objects: &[DesiredGraphObjectV1]) -> Result<(), CompatError> {
    let mut previous = None;
    for object in objects {
        validate_identity(&object.graph_identity)?;
        let key = desired_key(object);
        if previous.as_ref().is_some_and(|value| value >= &key) {
            return Err(desired_malformed(
                "desired objects must be strictly ordered and unique".to_owned(),
            ));
        }
        previous = Some(key);
        validate_sha256(object.disposition.payload_digest())?;
        validate_slice(object.disposition.payload())?;
    }
    Ok(())
}

fn validate_effects(target: &str, effects: &[GraphEffectV1]) -> Result<(), CompatError> {
    let mut previous = None;
    for effect in effects {
        effect.verify()?;
        if effect.target_state_digest != target {
            return Err(effect_malformed(format!(
                "effect target {:?} does not match index target {target:?}",
                effect.target_state_digest
            )));
        }
        let key = effect_key(effect);
        if previous.as_ref().is_some_and(|value| value >= &key) {
            return Err(effect_malformed(
                "effects must be strictly ordered and unique".to_owned(),
            ));
        }
        previous = Some(key);
    }
    Ok(())
}

fn validate_identity(value: &str) -> Result<(), CompatError> {
    if value.is_empty()
        || value.len() > MAX_GRAPH_IDENTITY_BYTES
        || value.chars().any(char::is_whitespace)
    {
        Err(desired_malformed(format!(
            "graph identity must be non-empty, whitespace-free, and at most {MAX_GRAPH_IDENTITY_BYTES} bytes"
        )))
    } else {
        Ok(())
    }
}

fn validate_desired_object_key(value: &DesiredObjectKeyV1) -> Result<(), CompatError> {
    validate_identity(&value.graph_identity)
}

fn validate_slice(value: &BlobSliceRefV1) -> Result<(), CompatError> {
    let artifact = value.artifact.current();
    validate_sha256(&artifact.sha256)?;
    if artifact.media_type != GRAPH_EFFECT_PAYLOAD_MEDIA_TYPE {
        return Err(desired_malformed(format!(
            "payload pack media type must be {GRAPH_EFFECT_PAYLOAD_MEDIA_TYPE:?}"
        )));
    }
    if value.length == 0 {
        return Err(desired_malformed(
            "payload slice length must be nonzero".to_owned(),
        ));
    }
    let end = value
        .offset
        .checked_add(value.length)
        .ok_or_else(|| desired_malformed("payload slice range overflows u64".to_owned()))?;
    if end > artifact.size {
        return Err(desired_malformed(format!(
            "payload slice ends at {end}, beyond pack size {}",
            artifact.size
        )));
    }
    Ok(())
}

fn ensure_media_type(
    reference: &BlobRef,
    expected: &str,
) -> Result<(), Report<EffectRepositoryError>> {
    if reference.current().media_type == expected {
        Ok(())
    } else {
        Err(
            Report::new(EffectRepositoryError::UnsupportedArtifact).attach_printable(format!(
                "artifact media type is {:?}, expected {expected:?}",
                reference.current().media_type
            )),
        )
    }
}

fn validate_sha256(value: &str) -> Result<(), CompatError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(desired_malformed(
            "digest must be 64 lowercase hexadecimal characters".to_owned(),
        ))
    }
}

fn desired_input_key(value: &DesiredObjectInputV1) -> (GraphObjectKindV1, &str) {
    (value.kind, value.graph_identity.as_str())
}

fn desired_key(value: &DesiredGraphObjectV1) -> (GraphObjectKindV1, &str) {
    (value.kind, value.graph_identity.as_str())
}

fn desired_object_key(value: &DesiredGraphObjectV1) -> DesiredObjectKeyV1 {
    DesiredObjectKeyV1 {
        kind: value.kind,
        graph_identity: value.graph_identity.clone(),
    }
}

fn validate_page_bounds(
    page: &DesiredProjectionPageV1,
    bounds: &DesiredProjectionPageBoundsV1,
) -> Result<(), CompatError> {
    let first = page
        .objects
        .first()
        .map(desired_object_key)
        .ok_or_else(|| desired_malformed("desired projection page is empty".to_owned()))?;
    let last = page
        .objects
        .last()
        .map(desired_object_key)
        .ok_or_else(|| desired_malformed("desired projection page is empty".to_owned()))?;
    if first != bounds.first || last != bounds.last {
        return Err(desired_malformed(
            "desired projection page content disagrees with its index bounds".to_owned(),
        ));
    }
    Ok(())
}

fn effect_key(value: &GraphEffectV1) -> (u8, &str, &str) {
    (
        value.operation.order(),
        value.graph_identity.as_str(),
        value.effect_id.as_str(),
    )
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn desired_malformed(message: String) -> CompatError {
    CompatError::Malformed {
        family: DesiredProjectionArtifact::FAMILY.name,
        message,
    }
}

fn effect_malformed(message: String) -> CompatError {
    CompatError::Malformed {
        family: EffectIndexArtifact::FAMILY.name,
        message,
    }
}

impl crate::orchestrator::registry::sealed::Sealed for DesiredProjectionArtifact {}

impl DurableRecord for DesiredProjectionArtifact {
    const FAMILY: &'static RecordFamily = &DESIRED_PROJECTION_ARTIFACT_FAMILY;
    const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::PureUpcast;

    fn encode(&self) -> Result<Vec<u8>, CompatError> {
        validate_desired_artifact(self)?;
        let bytes =
            serde_json::to_vec(self).map_err(|error| desired_malformed(error.to_string()))?;
        let maximum = match self {
            Self::V1(DesiredProjectionArtifactV1::Index(_)) => MAX_INDEX_BYTES,
            Self::V1(DesiredProjectionArtifactV1::Page(_)) => MAX_PAGE_BYTES,
        };
        if bytes.len() > maximum {
            return Err(desired_malformed(format!(
                "artifact is {} bytes; maximum is {maximum}",
                bytes.len()
            )));
        }
        Ok(bytes)
    }

    fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
        if bytes.len() > MAX_PAGE_BYTES {
            return Err(desired_malformed(
                "artifact exceeds maximum size".to_owned(),
            ));
        }
        let value: Value =
            serde_json::from_slice(bytes).map_err(|error| desired_malformed(error.to_string()))?;
        validate_artifact_shape(Self::FAMILY.name, &value)?;
        validate_desired_shape(&value)?;
        let decoded: Self =
            serde_json::from_value(value).map_err(|error| desired_malformed(error.to_string()))?;
        validate_desired_artifact(&decoded)?;
        Ok(decoded)
    }
}

impl VersionedRecord for DesiredProjectionArtifact {
    type Current = DesiredProjectionArtifactV1;

    fn normalize(self) -> Result<Self::Current, CompatError> {
        let Self::V1(value) = self;
        Ok(value)
    }
}

impl PureUpcastRecord for DesiredProjectionArtifact {}

impl crate::orchestrator::registry::sealed::Sealed for EffectIndexArtifact {}

impl DurableRecord for EffectIndexArtifact {
    const FAMILY: &'static RecordFamily = &EFFECT_INDEX_ARTIFACT_FAMILY;
    const MIGRATION_POLICY: MigrationPolicy = MigrationPolicy::PureUpcast;

    fn encode(&self) -> Result<Vec<u8>, CompatError> {
        validate_effect_artifact(self)?;
        let bytes =
            serde_json::to_vec(self).map_err(|error| effect_malformed(error.to_string()))?;
        let maximum = match self {
            Self::V1(EffectIndexArtifactV1::Index(_)) => MAX_INDEX_BYTES,
            Self::V1(EffectIndexArtifactV1::Page(_)) => MAX_PAGE_BYTES,
        };
        if bytes.len() > maximum {
            return Err(effect_malformed(format!(
                "artifact is {} bytes; maximum is {maximum}",
                bytes.len()
            )));
        }
        Ok(bytes)
    }

    fn decode(bytes: &[u8]) -> Result<Self, CompatError> {
        if bytes.len() > MAX_PAGE_BYTES {
            return Err(effect_malformed("artifact exceeds maximum size".to_owned()));
        }
        let value: Value =
            serde_json::from_slice(bytes).map_err(|error| effect_malformed(error.to_string()))?;
        validate_artifact_shape(Self::FAMILY.name, &value)?;
        validate_effect_shape(&value)?;
        let decoded: Self =
            serde_json::from_value(value).map_err(|error| effect_malformed(error.to_string()))?;
        validate_effect_artifact(&decoded)?;
        Ok(decoded)
    }
}

impl VersionedRecord for EffectIndexArtifact {
    type Current = EffectIndexArtifactV1;

    fn normalize(self) -> Result<Self::Current, CompatError> {
        let Self::V1(value) = self;
        Ok(value)
    }
}

impl PureUpcastRecord for EffectIndexArtifact {}

fn validate_artifact_shape(family: &'static str, value: &Value) -> Result<(), CompatError> {
    reject_unknown_fields(family, "", value, &["version", "data"])?;
    if value.get("version").and_then(Value::as_str) != Some("v1") {
        return Err(CompatError::UnsupportedVersion {
            family,
            version: value
                .get("version")
                .and_then(Value::as_str)
                .unwrap_or("<missing>")
                .to_owned(),
        });
    }
    let data = value.get("data").ok_or_else(|| CompatError::Malformed {
        family,
        message: "data is required".to_owned(),
    })?;
    reject_unknown_fields(family, "data", data, &["artifact", "data"])?;
    Ok(())
}

fn artifact_body<'a>(
    family: &'static str,
    value: &'a Value,
) -> Result<(&'a str, &'a Value), CompatError> {
    let envelope = value.get("data").ok_or_else(|| CompatError::Malformed {
        family,
        message: "data is required".to_owned(),
    })?;
    let kind = envelope
        .get("artifact")
        .and_then(Value::as_str)
        .ok_or_else(|| CompatError::Malformed {
            family,
            message: "data.artifact must be a string".to_owned(),
        })?;
    let body = envelope.get("data").ok_or_else(|| CompatError::Malformed {
        family,
        message: "data.data is required".to_owned(),
    })?;
    Ok((kind, body))
}

fn validate_desired_shape(value: &Value) -> Result<(), CompatError> {
    let family = DesiredProjectionArtifact::FAMILY.name;
    let (kind, body) = artifact_body(family, value)?;
    match kind {
        "index" => {
            reject_unknown_fields(
                family,
                "data.data",
                body,
                &[
                    "schema_version",
                    "object_count",
                    "page_entries",
                    "pages",
                    "page_bounds",
                ],
            )?;
            for (index, page) in body
                .get("pages")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
            {
                validate_blob_ref_shape(family, &format!("data.data.pages[{index}]"), page)?;
            }
            for (index, bounds) in body
                .get("page_bounds")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
            {
                let path = format!("data.data.page_bounds[{index}]");
                reject_unknown_fields(family, &path, bounds, &["first", "last"])?;
                for field in ["first", "last"] {
                    let key = bounds
                        .get(field)
                        .ok_or_else(|| desired_malformed(format!("{path}.{field} is required")))?;
                    reject_unknown_fields(
                        family,
                        &format!("{path}.{field}"),
                        key,
                        &["kind", "graph_identity"],
                    )?;
                }
            }
        }
        "page" => {
            reject_unknown_fields(family, "data.data", body, &["objects"])?;
            for (index, object) in body
                .get("objects")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
            {
                let path = format!("data.data.objects[{index}]");
                reject_unknown_fields(
                    family,
                    &path,
                    object,
                    &["kind", "graph_identity", "disposition"],
                )?;
                let disposition = object
                    .get("disposition")
                    .ok_or_else(|| desired_malformed(format!("{path}.disposition is required")))?;
                let state = disposition.get("state").and_then(Value::as_str);
                match state {
                    Some("live") => {
                        reject_unknown_fields(
                            family,
                            &format!("{path}.disposition"),
                            disposition,
                            &["state", "payload_digest", "payload"],
                        )?;
                        let payload = disposition.get("payload").ok_or_else(|| {
                            desired_malformed(format!("{path}.disposition.payload is required"))
                        })?;
                        validate_slice_shape(
                            family,
                            &format!("{path}.disposition.payload"),
                            payload,
                        )?;
                    }
                    Some("archived") => {
                        reject_unknown_fields(
                            family,
                            &format!("{path}.disposition"),
                            disposition,
                            &["state", "payload_digest", "payload"],
                        )?;
                        let payload = disposition.get("payload").ok_or_else(|| {
                            desired_malformed(format!("{path}.disposition.payload is required"))
                        })?;
                        validate_slice_shape(
                            family,
                            &format!("{path}.disposition.payload"),
                            payload,
                        )?;
                    }
                    _ => {
                        return Err(desired_malformed(format!(
                            "{path}.disposition.state is unsupported"
                        )));
                    }
                }
            }
        }
        _ => {
            return Err(desired_malformed(format!(
                "data.artifact {kind:?} is unsupported"
            )));
        }
    }
    Ok(())
}

fn validate_effect_shape(value: &Value) -> Result<(), CompatError> {
    let family = EffectIndexArtifact::FAMILY.name;
    let (kind, body) = artifact_body(family, value)?;
    match kind {
        "index" => {
            reject_unknown_fields(
                family,
                "data.data",
                body,
                &[
                    "schema_version",
                    "target_state_digest",
                    "effect_count",
                    "page_entries",
                    "pages",
                ],
            )?;
            for (index, page) in body
                .get("pages")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
            {
                validate_blob_ref_shape(family, &format!("data.data.pages[{index}]"), page)?;
            }
        }
        "page" => {
            reject_unknown_fields(family, "data.data", body, &["effects"])?;
            for (index, effect) in body
                .get("effects")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
            {
                let path = format!("data.data.effects[{index}]");
                reject_unknown_fields(family, &path, effect, &["version", "data"])?;
                let data = effect
                    .get("data")
                    .ok_or_else(|| effect_malformed(format!("{path}.data is required")))?;
                reject_unknown_fields(
                    family,
                    &format!("{path}.data"),
                    data,
                    &[
                        "effect_id",
                        "effect_identity_version",
                        "effect_encoding_version",
                        "target_state_digest",
                        "operation",
                        "graph_identity",
                        "payload_digest",
                        "payload",
                    ],
                )?;
                if let Some(payload) = data.get("payload").filter(|value| !value.is_null()) {
                    validate_slice_shape(family, &format!("{path}.data.payload"), payload)?;
                }
            }
        }
        _ => {
            return Err(effect_malformed(format!(
                "data.artifact {kind:?} is unsupported"
            )));
        }
    }
    Ok(())
}

fn validate_slice_shape(
    family: &'static str,
    path: &str,
    value: &Value,
) -> Result<(), CompatError> {
    reject_unknown_fields(family, path, value, &["artifact", "offset", "length"])?;
    let artifact = value
        .get("artifact")
        .ok_or_else(|| CompatError::Malformed {
            family,
            message: format!("{path}.artifact is required"),
        })?;
    validate_blob_ref_shape(family, &format!("{path}.artifact"), artifact)
}

fn validate_blob_ref_shape(
    family: &'static str,
    path: &str,
    value: &Value,
) -> Result<(), CompatError> {
    reject_unknown_fields(family, path, value, &["version", "value"])?;
    let body = value.get("value").ok_or_else(|| CompatError::Malformed {
        family,
        message: format!("{path}.value is required"),
    })?;
    reject_unknown_fields(
        family,
        &format!("{path}.value"),
        body,
        &[
            "key",
            "sha256",
            "size",
            "mediaType",
            "eTag",
            "providerVersion",
        ],
    )
}

fn validate_desired_artifact(value: &DesiredProjectionArtifact) -> Result<(), CompatError> {
    match value {
        DesiredProjectionArtifact::V1(DesiredProjectionArtifactV1::Index(index)) => {
            if index.schema_version != DESIRED_PROJECTION_SCHEMA_VERSION {
                return Err(desired_malformed(format!(
                    "schema_version must be {DESIRED_PROJECTION_SCHEMA_VERSION}"
                )));
            }
            for page in &index.pages {
                if page.current().media_type != DESIRED_PROJECTION_PAGE_MEDIA_TYPE {
                    return Err(desired_malformed(
                        "index page has the wrong media type".to_owned(),
                    ));
                }
            }
            if index.page_entries == 0 || index.page_entries > MAX_PAGE_ENTRIES {
                return Err(desired_malformed(format!(
                    "page_entries must be 1 through {MAX_PAGE_ENTRIES}"
                )));
            }
            let expected_pages = if index.object_count == 0 {
                0
            } else {
                ((index.object_count - 1) / index.page_entries) + 1
            };
            if index.pages.len() as u64 != expected_pages {
                return Err(desired_malformed(format!(
                    "object_count requires {expected_pages} canonical pages, found {}",
                    index.pages.len()
                )));
            }
            if index.page_bounds.len() != index.pages.len() {
                return Err(desired_malformed(format!(
                    "page_bounds has {} entries for {} pages",
                    index.page_bounds.len(),
                    index.pages.len()
                )));
            }
            let mut previous_last = None;
            for bounds in &index.page_bounds {
                validate_desired_object_key(&bounds.first)?;
                validate_desired_object_key(&bounds.last)?;
                if bounds.first > bounds.last {
                    return Err(desired_malformed(
                        "desired projection page bounds are inverted".to_owned(),
                    ));
                }
                if previous_last
                    .as_ref()
                    .is_some_and(|previous| previous >= &bounds.first)
                {
                    return Err(desired_malformed(
                        "desired projection page bounds are not globally ordered".to_owned(),
                    ));
                }
                previous_last = Some(bounds.last.clone());
            }
        }
        DesiredProjectionArtifact::V1(DesiredProjectionArtifactV1::Page(page)) => {
            if page.objects.is_empty() || page.objects.len() as u64 > MAX_PAGE_ENTRIES {
                return Err(desired_malformed(format!(
                    "page must contain 1 through {MAX_PAGE_ENTRIES} objects"
                )));
            }
            validate_desired_objects(&page.objects)?;
        }
    }
    Ok(())
}

fn validate_effect_artifact(value: &EffectIndexArtifact) -> Result<(), CompatError> {
    match value {
        EffectIndexArtifact::V1(EffectIndexArtifactV1::Index(index)) => {
            if index.schema_version != EFFECT_INDEX_SCHEMA_VERSION {
                return Err(effect_malformed(format!(
                    "schema_version must be {EFFECT_INDEX_SCHEMA_VERSION}"
                )));
            }
            if !index.target_state_digest.is_empty() {
                validate_sha256(&index.target_state_digest)?;
            }
            for page in &index.pages {
                if page.current().media_type != GRAPH_EFFECT_PAGE_MEDIA_TYPE {
                    return Err(effect_malformed(
                        "index page has the wrong media type".to_owned(),
                    ));
                }
            }
            if index.page_entries == 0 || index.page_entries > MAX_PAGE_ENTRIES {
                return Err(effect_malformed(format!(
                    "page_entries must be 1 through {MAX_PAGE_ENTRIES}"
                )));
            }
            let expected_pages = if index.effect_count == 0 {
                0
            } else {
                ((index.effect_count - 1) / index.page_entries) + 1
            };
            if index.pages.len() as u64 != expected_pages {
                return Err(effect_malformed(format!(
                    "effect_count requires {expected_pages} canonical pages, found {}",
                    index.pages.len()
                )));
            }
        }
        EffectIndexArtifact::V1(EffectIndexArtifactV1::Page(page)) => {
            if page.effects.is_empty() || page.effects.len() as u64 > MAX_PAGE_ENTRIES {
                return Err(effect_malformed(format!(
                    "page must contain 1 through {MAX_PAGE_ENTRIES} effects"
                )));
            }
            let effects = page
                .effects
                .iter()
                .map(|effect| effect.clone().into_current())
                .collect::<Result<Vec<_>, _>>()?;
            let target = effects
                .first()
                .map_or("", |effect| effect.target_state_digest.as_str());
            validate_effects(target, &effects)?;
        }
    }
    Ok(())
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::sync::Arc;

    use crate::blob::BlobRefV1;
    use crate::graph::effects::{GraphOperationV1, GRAPH_EFFECT_PAYLOAD_MEDIA_TYPE};
    use tempfile::TempDir;
    use tokio::sync::Mutex;

    #[derive(Debug, Default)]
    struct ReferenceEffectRepository {
        desired: Mutex<BTreeMap<String, Vec<ResolvedDesiredObjectV1>>>,
        effects: Mutex<BTreeMap<String, Vec<ResolvedGraphEffectV1>>>,
        packs: Mutex<BTreeMap<String, Vec<u8>>>,
    }

    impl ReferenceEffectRepository {
        fn reference(bytes: &[u8], key_prefix: &str, media_type: &str) -> BlobRef {
            let digest = sha256(bytes);
            BlobRef::V1(BlobRefV1 {
                key: format!("reference/{key_prefix}/{digest}.json"),
                sha256: digest,
                size: bytes.len() as u64,
                media_type: media_type.to_owned(),
                e_tag: None,
                provider_version: None,
            })
        }

        async fn resolve_slice(
            &self,
            slice: &BlobSliceRefV1,
            digest: &str,
        ) -> Result<Vec<u8>, Report<EffectRepositoryError>> {
            validate_slice(slice).change_context(EffectRepositoryError::ArtifactIntegrity)?;
            let packs = self.packs.lock().await;
            let pack = packs.get(&slice.artifact.current().sha256).ok_or_else(|| {
                Report::new(EffectRepositoryError::ArtifactIntegrity)
                    .attach_printable("reference payload pack is missing")
            })?;
            let start = usize::try_from(slice.offset)
                .change_context(EffectRepositoryError::ArtifactIntegrity)?;
            let length = usize::try_from(slice.length)
                .change_context(EffectRepositoryError::ArtifactIntegrity)?;
            let end = start.checked_add(length).ok_or_else(|| {
                Report::new(EffectRepositoryError::ArtifactIntegrity)
                    .attach_printable("reference payload range overflow")
            })?;
            let bytes = pack.get(start..end).ok_or_else(|| {
                Report::new(EffectRepositoryError::ArtifactIntegrity)
                    .attach_printable("reference payload range is outside pack")
            })?;
            if sha256(bytes) != digest {
                return Err(Report::new(EffectRepositoryError::ArtifactIntegrity)
                    .attach_printable("reference payload digest mismatch"));
            }
            Ok(bytes.to_vec())
        }
    }

    #[async_trait]
    impl EffectRepository for ReferenceEffectRepository {
        async fn publish_desired_projection(
            &self,
            mut inputs: Vec<DesiredObjectInputV1>,
        ) -> Result<PublishedDesiredProjectionV1, Report<EffectRepositoryError>> {
            inputs.sort_by(|left, right| desired_input_key(left).cmp(&desired_input_key(right)));
            ensure_unique_inputs(&inputs)?;
            let mut pack = Vec::new();
            let mut descriptions = Vec::with_capacity(inputs.len());
            for input in &inputs {
                validate_identity(&input.graph_identity)
                    .change_context(EffectRepositoryError::InvalidInput)?;
                let payload = input.disposition.payload();
                if payload.is_empty() {
                    return Err(Report::new(EffectRepositoryError::InvalidInput));
                }
                let offset = pack.len() as u64;
                pack.extend_from_slice(payload);
                descriptions.push((sha256(payload), offset, payload.len() as u64));
            }
            let pack_ref = Self::reference(&pack, "packs", GRAPH_EFFECT_PAYLOAD_MEDIA_TYPE);
            self.packs
                .lock()
                .await
                .insert(pack_ref.current().sha256.clone(), pack);
            let objects = inputs
                .into_iter()
                .zip(descriptions)
                .map(|(input, description)| {
                    let DesiredObjectInputV1 {
                        kind,
                        graph_identity,
                        disposition: input_disposition,
                    } = input;
                    DesiredGraphObjectV1 {
                        kind,
                        graph_identity,
                        disposition: match input_disposition {
                            DesiredObjectInputDispositionV1::Live(_) => {
                                DesiredDispositionV1::Live {
                                    payload_digest: description.0,
                                    payload: BlobSliceRefV1 {
                                        artifact: pack_ref.clone(),
                                        offset: description.1,
                                        length: description.2,
                                    },
                                }
                            }
                            DesiredObjectInputDispositionV1::Archived(_) => {
                                DesiredDispositionV1::Archived {
                                    payload_digest: description.0,
                                    payload: BlobSliceRefV1 {
                                        artifact: pack_ref.clone(),
                                        offset: description.1,
                                        length: description.2,
                                    },
                                }
                            }
                        },
                    }
                })
                .collect::<Vec<_>>();
            validate_desired_objects(&objects)
                .change_context(EffectRepositoryError::InvalidInput)?;
            let bytes = serde_json::to_vec(&objects)
                .change_context(EffectRepositoryError::ArtifactPublication)?;
            let artifact = Self::reference(&bytes, "desired", DESIRED_PROJECTION_INDEX_MEDIA_TYPE);
            let mut resolved = Vec::with_capacity(objects.len());
            for object in &objects {
                let payload = self
                    .resolve_slice(
                        object.disposition.payload(),
                        object.disposition.payload_digest(),
                    )
                    .await?;
                resolved.push(ResolvedDesiredObjectV1 {
                    object: object.clone(),
                    payload,
                });
            }
            self.desired
                .lock()
                .await
                .insert(artifact.current().sha256.clone(), resolved);
            Ok(PublishedDesiredProjectionV1 {
                reference: DesiredProjectionRef { artifact },
                objects,
            })
        }

        async fn load_desired_projection(
            &self,
            reference: &DesiredProjectionRef,
        ) -> Result<Vec<ResolvedDesiredObjectV1>, Report<EffectRepositoryError>> {
            self.desired
                .lock()
                .await
                .get(&reference.artifact.current().sha256)
                .cloned()
                .ok_or_else(|| Report::new(EffectRepositoryError::ArtifactIntegrity))
        }

        async fn publish_effect_index(
            &self,
            target_state_digest: &str,
            mut effects: Vec<GraphEffectV1>,
        ) -> Result<BlobRef, Report<EffectRepositoryError>> {
            effects.sort_by(|left, right| effect_key(left).cmp(&effect_key(right)));
            validate_effects(target_state_digest, &effects)
                .change_context(EffectRepositoryError::InvalidInput)?;
            let mut resolved = Vec::with_capacity(effects.len());
            for effect in &effects {
                let payload = match (&effect.payload_digest, &effect.payload) {
                    (Some(digest), Some(slice)) => Some(self.resolve_slice(slice, digest).await?),
                    (None, None) => None,
                    _ => return Err(Report::new(EffectRepositoryError::InvalidInput)),
                };
                resolved.push(ResolvedGraphEffectV1 {
                    effect: effect.clone(),
                    payload,
                });
            }
            let bytes = serde_json::to_vec(&effects)
                .change_context(EffectRepositoryError::ArtifactPublication)?;
            let artifact = Self::reference(&bytes, "effects", GRAPH_EFFECT_INDEX_MEDIA_TYPE);
            self.effects
                .lock()
                .await
                .insert(artifact.current().sha256.clone(), resolved);
            Ok(artifact)
        }

        async fn load_effect_index(
            &self,
            reference: &BlobRef,
        ) -> Result<Vec<ResolvedGraphEffectV1>, Report<EffectRepositoryError>> {
            self.effects
                .lock()
                .await
                .get(&reference.current().sha256)
                .cloned()
                .ok_or_else(|| Report::new(EffectRepositoryError::ArtifactIntegrity))
        }
    }

    fn repository() -> (TempDir, TempDir, ArtifactEffectRepository) {
        let remote = TempDir::new().expect("remote");
        let cache = TempDir::new().expect("cache");
        let store = ArtifactStore::local(remote.path(), cache.path()).expect("store");
        let repository =
            ArtifactEffectRepository::new(store, "tenants/alice/integration").expect("repository");
        (remote, cache, repository)
    }

    async fn assert_repository_contract(repository: Arc<dyn EffectRepository>) {
        let empty = repository
            .publish_desired_projection(vec![])
            .await
            .expect("publish empty desired projection");
        assert!(empty.objects.is_empty());
        assert!(repository
            .load_desired_projection(&empty.reference)
            .await
            .expect("load empty desired projection")
            .is_empty());

        let inputs = vec![
            DesiredObjectInputV1 {
                kind: GraphObjectKindV1::Link,
                graph_identity: "link:b".to_owned(),
                disposition: DesiredObjectInputDispositionV1::Archived(
                    br#"{"entityId":"link:b","archived":true}"#.to_vec(),
                ),
            },
            DesiredObjectInputV1 {
                kind: GraphObjectKindV1::Entity,
                graph_identity: "entity:a".to_owned(),
                disposition: DesiredObjectInputDispositionV1::Live(br#"{"entityId":"a"}"#.to_vec()),
            },
        ];
        let desired = repository
            .publish_desired_projection(inputs)
            .await
            .expect("publish desired");
        let loaded = repository
            .load_desired_projection(&desired.reference)
            .await
            .expect("load desired");
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].object.graph_identity, "entity:a");
        assert_eq!(
            loaded[0].payload.as_slice(),
            br#"{"entityId":"a"}"#.as_slice()
        );
        assert_eq!(
            loaded[1].payload.as_slice(),
            br#"{"entityId":"link:b","archived":true}"#.as_slice()
        );
        let selected = repository
            .load_desired_objects(
                &desired.reference,
                &[DesiredObjectKeyV1 {
                    kind: GraphObjectKindV1::Link,
                    graph_identity: "link:b".to_owned(),
                }],
            )
            .await
            .expect("load selected desired object");
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].object.graph_identity, "link:b");
        assert_eq!(
            selected[0].payload.as_slice(),
            br#"{"entityId":"link:b","archived":true}"#.as_slice()
        );

        let DesiredDispositionV1::Live {
            payload_digest,
            payload,
        } = desired.objects[0].disposition.clone()
        else {
            panic!("live desired object")
        };
        let target = "1".repeat(64);
        let effect = GraphEffectV1::new(
            target.clone(),
            GraphOperationV1::UpsertEntity,
            "entity:a".to_owned(),
            Some(payload_digest),
            Some(payload),
        )
        .expect("effect");
        let index = repository
            .publish_effect_index(&target, vec![effect])
            .await
            .expect("publish effects");
        let effects = repository
            .load_effect_index(&index)
            .await
            .expect("load effects");
        assert_eq!(effects.len(), 1);
        assert_eq!(
            effects[0].payload.as_deref(),
            Some(br#"{"entityId":"a"}"#.as_slice())
        );
        let window = repository
            .load_effect_window(&index, 0, 1)
            .await
            .expect("load effect window");
        assert_eq!(window.effect_count, 1);
        assert_eq!(window.effects.len(), 1);
        assert_eq!(window.previous_effect_id, None);
        let exhausted = repository
            .load_effect_window(&index, 1, 1)
            .await
            .expect("load exhausted effect window");
        assert!(exhausted.effects.is_empty());
        assert_eq!(
            exhausted.previous_effect_id,
            Some(effects[0].effect.effect_id.clone())
        );
    }

    #[tokio::test]
    async fn shared_contract_passes_reference_repository() {
        assert_repository_contract(Arc::new(ReferenceEffectRepository::default())).await;
    }

    #[tokio::test]
    async fn shared_contract_passes_artifact_repository() {
        let (_remote, _cache, repository) = repository();
        assert_repository_contract(Arc::new(repository)).await;
    }

    #[tokio::test]
    async fn projection_is_canonical_and_exact_payload_bytes_round_trip() {
        let (_remote, _cache, repository) = repository();
        let inputs = vec![
            DesiredObjectInputV1 {
                kind: GraphObjectKindV1::Link,
                graph_identity: "link:b".to_owned(),
                disposition: DesiredObjectInputDispositionV1::Archived(
                    br#"{"entityId":"link:b","archived":true}"#.to_vec(),
                ),
            },
            DesiredObjectInputV1 {
                kind: GraphObjectKindV1::Entity,
                graph_identity: "entity:a".to_owned(),
                disposition: DesiredObjectInputDispositionV1::Live(
                    br#"{"entityId":"a","properties":{"x":1}}"#.to_vec(),
                ),
            },
        ];
        let first = repository
            .publish_desired_projection(inputs.clone())
            .await
            .expect("publish");
        let second = repository
            .publish_desired_projection(inputs.into_iter().rev().collect())
            .await
            .expect("publish reversed");
        assert_eq!(
            first.reference.artifact.current().sha256,
            second.reference.artifact.current().sha256
        );

        let loaded = repository
            .load_desired_projection(&first.reference)
            .await
            .expect("load");
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].object.graph_identity, "entity:a");
        assert_eq!(
            loaded[0].payload.as_slice(),
            br#"{"entityId":"a","properties":{"x":1}}"#.as_slice()
        );
        assert_eq!(
            loaded[1].payload.as_slice(),
            br#"{"entityId":"link:b","archived":true}"#.as_slice()
        );
    }

    #[tokio::test]
    async fn desired_object_lookup_reads_only_pages_covering_requested_keys() {
        let (_remote, _cache, repository) = repository();
        let inputs = (0..DEFAULT_PAGE_ENTRIES + 44)
            .map(|index| DesiredObjectInputV1 {
                kind: GraphObjectKindV1::Entity,
                graph_identity: format!("entity:{index:04}"),
                disposition: DesiredObjectInputDispositionV1::Live(
                    format!(r#"{{"entityId":"entity:{index:04}"}}"#).into_bytes(),
                ),
            })
            .collect();
        let published = repository
            .publish_desired_projection(inputs)
            .await
            .expect("publish");
        let root = load_desired_artifact(
            &repository.store,
            &published.reference.artifact,
            MAX_INDEX_BYTES,
        )
        .await
        .expect("load root");
        let DesiredProjectionArtifactV1::Index(mut index) = root else {
            panic!("root must be an index");
        };
        assert_eq!(index.pages.len(), 2);
        index.pages[1] = BlobRef::V1(BlobRefV1 {
            key: format!(
                "tenants/alice/integration/desired/pages/sha256/ff/{}.json",
                "f".repeat(64)
            ),
            sha256: "f".repeat(64),
            size: 1,
            media_type: DESIRED_PROJECTION_PAGE_MEDIA_TYPE.to_owned(),
            e_tag: None,
            provider_version: None,
        });
        let modified = DesiredProjectionArtifact::V1(DesiredProjectionArtifactV1::Index(index));
        let artifact = repository
            .store
            .publish_record(
                &modified,
                MAX_INDEX_BYTES,
                "tenants/alice/integration/desired/indexes",
                DESIRED_PROJECTION_INDEX_MEDIA_TYPE,
            )
            .await
            .expect("publish modified index");
        let reference = DesiredProjectionRef { artifact };

        let selected = repository
            .load_desired_objects(
                &reference,
                &[DesiredObjectKeyV1 {
                    kind: GraphObjectKindV1::Entity,
                    graph_identity: "entity:0001".to_owned(),
                }],
            )
            .await
            .expect("irrelevant missing page must not be read");
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].object.graph_identity, "entity:0001");
        assert!(repository
            .load_desired_projection(&reference)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn effect_pages_preserve_dependency_order_and_verify_payloads() {
        let (_remote, _cache, repository) = repository();
        let published = repository
            .publish_desired_projection(vec![DesiredObjectInputV1 {
                kind: GraphObjectKindV1::Entity,
                graph_identity: "entity:a".to_owned(),
                disposition: DesiredObjectInputDispositionV1::Live(br#"{"entityId":"a"}"#.to_vec()),
            }])
            .await
            .expect("desired");
        let DesiredDispositionV1::Live {
            payload_digest,
            payload,
        } = published.objects[0].disposition.clone()
        else {
            panic!("live")
        };
        assert_eq!(
            payload.artifact.current().media_type,
            GRAPH_EFFECT_PAYLOAD_MEDIA_TYPE
        );
        let target = "1".repeat(64);
        let upsert = GraphEffectV1::new(
            target.clone(),
            GraphOperationV1::UpsertEntity,
            "entity:a".to_owned(),
            Some(payload_digest),
            Some(payload),
        )
        .expect("effect");
        let archive = GraphEffectV1::new(
            target.clone(),
            GraphOperationV1::ArchiveLink,
            "link:b".to_owned(),
            None,
            None,
        )
        .expect("archive");
        let index = repository
            .publish_effect_index(&target, vec![archive, upsert])
            .await
            .expect("publish effects");
        let loaded = repository
            .load_effect_index(&index)
            .await
            .expect("load effects");
        assert_eq!(loaded[0].effect.operation, GraphOperationV1::UpsertEntity);
        assert_eq!(
            loaded[0].payload.as_deref(),
            Some(br#"{"entityId":"a"}"#.as_slice())
        );
        assert_eq!(loaded[1].effect.operation, GraphOperationV1::ArchiveLink);
    }

    #[tokio::test]
    async fn effect_window_crosses_page_boundary_with_exact_preceding_cursor() {
        let (_remote, _cache, repository) = repository();
        let target = "1".repeat(64);
        let count = DEFAULT_PAGE_ENTRIES + 44;
        let effects = (0..count)
            .map(|index| {
                GraphEffectV1::new(
                    target.clone(),
                    GraphOperationV1::ArchiveEntity,
                    format!("entity:{index:04}"),
                    None,
                    None,
                )
                .expect("effect")
            })
            .collect::<Vec<_>>();
        let start = DEFAULT_PAGE_ENTRIES - 1;
        let previous = effects[start - 1].effect_id.clone();
        let index = repository
            .publish_effect_index(&target, effects)
            .await
            .expect("publish effects");
        let window = repository
            .load_effect_window(&index, start as u64, 3)
            .await
            .expect("cross-page window");
        assert_eq!(window.effect_count, count as u64);
        assert_eq!(window.previous_effect_id, Some(previous));
        assert_eq!(
            window
                .effects
                .iter()
                .map(|effect| effect.effect.graph_identity.as_str())
                .collect::<Vec<_>>(),
            vec![
                format!("entity:{start:04}"),
                format!("entity:{:04}", start + 1),
                format!("entity:{:04}", start + 2),
            ]
        );
    }

    #[tokio::test]
    async fn effect_window_honors_a_declared_page_width_other_than_the_default() {
        let (_remote, _cache, repository) = repository();
        let target = "1".repeat(64);
        let effects = (0..5_usize)
            .map(|index| {
                GraphEffectV1::new(
                    target.clone(),
                    GraphOperationV1::ArchiveEntity,
                    format!("entity:{index:04}"),
                    None,
                    None,
                )
                .expect("effect")
            })
            .collect::<Vec<_>>();
        let mut pages = Vec::new();
        for chunk in effects.chunks(2) {
            let page = EffectIndexArtifact::V1(EffectIndexArtifactV1::Page(EffectPageV1 {
                effects: chunk.iter().cloned().map(GraphEffect::V1).collect(),
            }));
            pages.push(
                repository
                    .store
                    .publish_record(
                        &page,
                        MAX_PAGE_BYTES,
                        "tenants/alice/integration/effects/pages",
                        GRAPH_EFFECT_PAGE_MEDIA_TYPE,
                    )
                    .await
                    .expect("publish narrow page"),
            );
        }
        let index = EffectIndexArtifact::V1(EffectIndexArtifactV1::Index(EffectIndexV1 {
            schema_version: EFFECT_INDEX_SCHEMA_VERSION,
            target_state_digest: target.clone(),
            effect_count: 5,
            page_entries: 2,
            pages: pages.clone(),
        }));
        let reference = repository
            .store
            .publish_record(
                &index,
                MAX_INDEX_BYTES,
                "tenants/alice/integration/effects/indexes",
                GRAPH_EFFECT_INDEX_MEDIA_TYPE,
            )
            .await
            .expect("publish narrow index");
        let window = repository
            .load_effect_window(&reference, 1, 3)
            .await
            .expect("window across narrow pages");
        assert_eq!(window.effect_count, 5);
        assert_eq!(
            window
                .effects
                .iter()
                .map(|effect| effect.effect.graph_identity.as_str())
                .collect::<Vec<_>>(),
            vec!["entity:0001", "entity:0002", "entity:0003"]
        );

        // Encode-side check: the width must agree with the page count.
        let lying = EffectIndexArtifact::V1(EffectIndexArtifactV1::Index(EffectIndexV1 {
            schema_version: EFFECT_INDEX_SCHEMA_VERSION,
            target_state_digest: target,
            effect_count: 5,
            page_entries: 3,
            pages,
        }));
        assert!(lying.encode().is_err());
    }

    #[tokio::test]
    async fn duplicate_identities_and_target_mismatch_fail_closed() {
        let (_remote, _cache, repository) = repository();
        let duplicate = DesiredObjectInputV1 {
            kind: GraphObjectKindV1::Entity,
            graph_identity: "entity:a".to_owned(),
            disposition: DesiredObjectInputDispositionV1::Archived(
                br#"{"entityId":"a","archived":true}"#.to_vec(),
            ),
        };
        assert!(repository
            .publish_desired_projection(vec![duplicate.clone(), duplicate])
            .await
            .is_err());

        let effect = GraphEffectV1::new(
            "2".repeat(64),
            GraphOperationV1::ArchiveEntity,
            "entity:a".to_owned(),
            None,
            None,
        )
        .expect("effect");
        assert!(repository
            .publish_effect_index(&"1".repeat(64), vec![effect])
            .await
            .is_err());
    }

    #[tokio::test]
    async fn payload_digest_is_verified_against_the_selected_slice() {
        let (_remote, _cache, repository) = repository();
        let published = repository
            .publish_desired_projection(vec![DesiredObjectInputV1 {
                kind: GraphObjectKindV1::Entity,
                graph_identity: "entity:a".to_owned(),
                disposition: DesiredObjectInputDispositionV1::Live(br#"{"entityId":"a"}"#.to_vec()),
            }])
            .await
            .expect("desired");
        let DesiredDispositionV1::Live { payload, .. } = published.objects[0].disposition.clone()
        else {
            panic!("live")
        };
        let target = "1".repeat(64);
        let forged = GraphEffectV1::new(
            target.clone(),
            GraphOperationV1::UpsertEntity,
            "entity:a".to_owned(),
            Some("f".repeat(64)),
            Some(payload),
        )
        .expect("internally coherent forged effect");
        let index = repository
            .publish_effect_index(&target, vec![forged])
            .await
            .expect("publish index");
        assert!(repository.load_effect_index(&index).await.is_err());
    }

    #[test]
    fn nested_unknown_fields_and_bad_page_shape_are_rejected() {
        let bytes =
            br#"{"version":"v1","data":{"artifact":"page","data":{"objects":[],"extra":true}}}"#;
        assert!(DesiredProjectionArtifact::decode(bytes).is_err());
        let empty = DesiredProjectionArtifact::V1(DesiredProjectionArtifactV1::Page(
            DesiredProjectionPageV1 { objects: vec![] },
        ));
        assert!(empty.encode().is_err());

        let fixture: Value =
            serde_json::from_slice(include_bytes!("../../tests/golden/graph-artifacts-v1.json"))
                .expect("fixture");
        let mut nested = fixture["desiredPage"].clone();
        nested["data"]["data"]["objects"][0]["disposition"]["payload"]["artifact"]["value"]
            ["future"] = Value::Bool(true);
        assert!(matches!(
            DesiredProjectionArtifact::decode(
                &serde_json::to_vec(&nested).expect("nested drift bytes")
            ),
            Err(CompatError::ExtraField { path, .. })
                if path == "data.data.objects[0].disposition.payload.artifact.value.future"
        ));
    }

    #[test]
    fn wire_shapes_match_independent_goldens() {
        let fixture: Value =
            serde_json::from_slice(include_bytes!("../../tests/golden/graph-artifacts-v1.json"))
                .expect("valid independent fixture");
        for name in ["desiredPage", "desiredArchivedPage", "desiredIndex"] {
            let bytes = serde_json::to_vec(&fixture[name]).expect("fixture bytes");
            let record = DesiredProjectionArtifact::decode(&bytes).expect("desired fixture");
            assert_eq!(record.encode().expect("desired wire"), bytes, "{name}");
        }
        for name in ["effectPage", "effectIndex"] {
            let bytes = serde_json::to_vec(&fixture[name]).expect("fixture bytes");
            let record = EffectIndexArtifact::decode(&bytes).expect("effect fixture");
            assert_eq!(record.encode().expect("effect wire"), bytes, "{name}");
        }
    }
}
