pub mod interval;

use alloc::{
    collections::{btree_map::OccupiedEntry, BTreeMap},
    string::{String, ToString},
};
use core::fmt;

use hashbrown::HashMap;
pub use interval::{
    ClosedTemporalBound, Interval, LeftClosedTemporalInterval, OpenTemporalBound, Timestamp,
};
use serde::{
    de::{value::StrDeserializer, Error},
    Deserialize, Deserializer, Serialize, Serializer,
};
use serde_json::Value;
use time::OffsetDateTime;
use type_system::url::VersionedUrl;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq, PartialOrd, Ord)]
pub struct EntityId {
    pub owned_by_id: Uuid,
    pub entity_uuid: Uuid,
}

impl fmt::Display for EntityId {
    fn fmt(&self, fmt: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(fmt, "{}~{}", self.owned_by_id, self.entity_uuid)
    }
}

impl<'de> Deserialize<'de> for EntityId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        // We can be more efficient than this, we know the byte sizes of all the elements
        let as_string = String::deserialize(deserializer)?;
        let mut parts = as_string.split('~');

        Ok(Self {
            owned_by_id: Uuid::deserialize(StrDeserializer::new(parts.next().ok_or_else(
                || D::Error::custom("failed to find second component of `~` delimited string"),
            )?))?,
            entity_uuid: Uuid::deserialize(StrDeserializer::new(parts.next().ok_or_else(
                || D::Error::custom("failed to find second component of `~` delimited string"),
            )?))?,
        })
    }
}

impl Serialize for EntityId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProvenanceMetadata {
    pub record_created_by_id: Uuid,
    pub record_archived_by_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntityTemporalMetadata {
    pub decision_time: LeftClosedTemporalInterval,
    pub transaction_time: LeftClosedTemporalInterval,
}

#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityRecordId {
    pub entity_id: EntityId,
    pub edition_id: Uuid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EntityLinkOrder {
    #[serde(default, rename = "leftToRightOrder")]
    pub left_to_right: Option<i32>,
    #[serde(default, rename = "rightToLeftOrder")]
    pub right_to_left: Option<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LinkData {
    pub left_entity_id: EntityId,
    pub right_entity_id: EntityId,
    #[serde(flatten)]
    pub order: EntityLinkOrder,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub struct EntityProperties(pub HashMap<String, Value>);

impl EntityProperties {
    #[must_use]
    pub const fn properties(&self) -> &HashMap<String, Value> {
        &self.0
    }

    #[must_use]
    pub fn properties_mut(&mut self) -> &mut HashMap<String, Value> {
        &mut self.0
    }
}

impl From<HashMap<String, Value>> for EntityProperties {
    fn from(value: HashMap<String, Value>) -> Self {
        Self(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EntityMetadata {
    pub record_id: EntityRecordId,
    pub temporal_versioning: EntityTemporalMetadata,
    pub entity_type_id: VersionedUrl,
    pub provenance: ProvenanceMetadata,
    pub archived: bool,
    pub draft: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Entity {
    pub properties: EntityProperties,
    #[serde(default)]
    pub link_data: Option<LinkData>,
    pub metadata: EntityMetadata,
}

#[derive(Debug, PartialEq, Eq, Hash, Copy, Clone, Serialize, Deserialize, Ord, PartialOrd)]
pub struct RevisionId(#[serde(with = "time::serde::iso8601")] OffsetDateTime);

impl RevisionId {
    #[must_use]
    pub fn now() -> Self {
        Self(OffsetDateTime::now_utc())
    }

    #[must_use]
    pub const fn time(&self) -> OffsetDateTime {
        self.0
    }
}

// This isn't super efficient, but by far the easiest way to implement serialization
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Inner<T> {
    inner: T,
}

impl From<Entity> for Inner<Entity> {
    fn from(value: Entity) -> Self {
        Self { inner: value }
    }
}

impl From<Inner<Self>> for Entity {
    fn from(value: Inner<Self>) -> Self {
        value.inner
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EntityVertexInner(BTreeMap<RevisionId, Inner<Entity>>);

impl From<EntityVertexInner> for EntityVertex {
    fn from(value: EntityVertexInner) -> Self {
        Self(
            value
                .0
                .into_iter()
                .map(|(key, value)| (key, value.into()))
                .collect(),
        )
    }
}

impl From<EntityVertex> for EntityVertexInner {
    fn from(value: EntityVertex) -> Self {
        Self(
            value
                .0
                .into_iter()
                .map(|(key, value)| (key, value.into()))
                .collect(),
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(from = "EntityVertexInner", into = "EntityVertexInner")]
pub struct EntityVertex(BTreeMap<RevisionId, Entity>);

impl EntityVertex {
    #[must_use]
    pub fn latest(&self) -> &Entity {
        self.0
            .last_key_value()
            .expect("should have at least one entry")
            .1
    }

    pub fn latest_mut(&mut self) -> &mut Entity {
        self.0
            .last_entry()
            .map(OccupiedEntry::into_mut)
            .expect("should have at least a single entry")
    }

    #[must_use]
    pub fn into_latest(mut self) -> Entity {
        self.0.pop_last().expect("should have at least on entry").1
    }

    #[must_use]
    pub fn latest_version(&self) -> RevisionId {
        *self
            .0
            .last_key_value()
            .expect("should have at least one entry")
            .0
    }

    #[must_use]
    pub const fn versions(&self) -> &BTreeMap<RevisionId, Entity> {
        &self.0
    }

    #[must_use]
    pub fn entity_type_id(&self) -> &VersionedUrl {
        &self.latest().metadata.entity_type_id
    }

    #[must_use]
    pub fn entity_id(&self) -> EntityId {
        self.latest().metadata.record_id.entity_id
    }
}
