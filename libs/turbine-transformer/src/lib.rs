#![no_std]
#![feature(error_in_core)]
#![feature(impl_trait_in_assoc_type)]

mod path;
pub mod property;
mod reachable;
pub mod select;
mod value;

extern crate alloc;

use alloc::collections::{BTreeMap, BTreeSet};

use petgraph::{graph::NodeIndex, Graph};
use turbine::{
    entity::{Entity, EntityId, LinkData},
    VersionedUrl, VersionedUrlRef,
};

const fn no_lookup(_: VersionedUrlRef) -> BTreeSet<VersionedUrlRef<'static>> {
    BTreeSet::new()
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum LinkEdge {
    Left,
    Right,
}

pub struct View<'a> {
    graph: Graph<EntityId, LinkEdge>,
    entities: &'a mut [Entity],

    exclude: BTreeSet<NodeIndex>,

    lookup: BTreeMap<EntityId, NodeIndex>,
    lookup_index: BTreeMap<EntityId, usize>,
    lookup_inherits_from: fn(VersionedUrlRef) -> BTreeSet<VersionedUrlRef<'static>>,
}

impl<'a> View<'a> {
    fn empty() -> Self {
        Self {
            graph: Graph::new(),
            entities: &mut [],

            exclude: BTreeSet::new(),

            lookup: BTreeMap::new(),
            lookup_index: BTreeMap::new(),
            lookup_inherits_from: no_lookup,
        }
    }

    fn prepare(&mut self, entities: &[Entity]) {
        for (index, entity) in entities.iter().enumerate() {
            self.lookup_index
                .insert(entity.metadata.record_id.entity_id, index);
        }
    }

    fn get_or_create(&mut self, id: EntityId) -> NodeIndex {
        if let Some(node) = self.lookup.get(&id) {
            return *node;
        }

        let node = self.graph.add_node(id);
        self.lookup.insert(id, node);

        node
    }

    fn exclude_complement(&mut self, nodes: &BTreeSet<NodeIndex>) {
        let indices: BTreeSet<_> = self.graph.node_indices().collect();

        let complement = &indices - nodes;
        self.exclude = &complement | &self.exclude;
    }

    fn exclude(&mut self, nodes: &BTreeSet<NodeIndex>) {
        self.exclude = nodes | &self.exclude;
    }

    #[must_use]
    pub fn new(entities: &'a mut [Entity]) -> Self {
        let mut this = Self::empty();
        this.prepare(entities);

        for (index, entity) in entities.iter().enumerate() {
            let node = this.get_or_create(entity.metadata.record_id.entity_id);
            this.lookup_index
                .insert(entity.metadata.record_id.entity_id, index);

            if let Some(link_data) = entity.link_data {
                let lhs = this.get_or_create(link_data.left_entity_id);
                let rhs = this.get_or_create(link_data.right_entity_id);

                this.graph.add_edge(lhs, node, LinkEdge::Left);
                this.graph.add_edge(node, rhs, LinkEdge::Right);
            }
        }

        this.entities = entities;
        this
    }

    #[must_use]
    pub const fn entities(&self) -> &[Entity] {
        self.entities
    }

    #[must_use]
    pub fn entity(&self, id: EntityId) -> Option<&Entity> {
        let index = *self.lookup_index.get(&id)?;

        self.entities.get(index)
    }

    #[must_use]
    fn entity_type(&self, id: EntityId) -> Option<VersionedUrlRef> {
        let index = *self.lookup_index.get(&id)?;
        let entity = self.entities.get(index)?;

        Some(VersionedUrlRef::from(&entity.metadata.entity_type_id))
    }

    #[must_use]
    fn entity_link(&self, id: EntityId) -> Option<LinkData> {
        let index = *self.lookup_index.get(&id)?;
        let entity = self.entities.get(index)?;

        entity.link_data
    }

    #[must_use]
    pub const fn graph(&self) -> &Graph<EntityId, LinkEdge> {
        &self.graph
    }

    #[must_use]
    pub const fn excluded(&self) -> &BTreeSet<NodeIndex> {
        &self.exclude
    }

    #[must_use]
    pub const fn lookup(&self) -> &BTreeMap<EntityId, NodeIndex> {
        &self.lookup
    }

    #[must_use]
    pub fn with_inherits_from(
        mut self,
        lookup_inherits_from: fn(VersionedUrlRef) -> BTreeSet<VersionedUrlRef<'static>>,
    ) -> Self {
        self.lookup_inherits_from = lookup_inherits_from;

        self
    }
}

impl<'a> IntoIterator for View<'a> {
    type Item = &'a Entity;

    type IntoIter = impl Iterator<Item = Self::Item>;

    fn into_iter(self) -> Self::IntoIter {
        self.entities.iter().filter(move |entity| {
            let Some(node) = self.lookup.get(&entity.metadata.record_id.entity_id) else {
                return false;
            };

            !self.exclude.contains(node)
        })
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn compile() {}
}
