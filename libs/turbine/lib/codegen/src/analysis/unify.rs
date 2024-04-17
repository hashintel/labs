use std::{
    collections::{HashMap, HashSet},
    str::FromStr,
};

use error_stack::{Report, Result, ResultExt};
use once_cell::sync::Lazy;
use petgraph::{
    algo::toposort,
    graph::{DiGraph, NodeIndex},
    visit::{Dfs, Walker},
};
use serde_json::json;
use type_system::{repr, url::VersionedUrl, EntityType, EntityTypeReference};

use crate::{
    analysis::{facts::Facts, AnalysisError},
    error::ErrorAccumulator,
    AnyType,
};

pub(super) static LINK_REF: Lazy<EntityTypeReference> = Lazy::new(|| {
    EntityTypeReference::new(
        VersionedUrl::from_str(
            "https://blockprotocol.org/@blockprotocol/types/entity-type/link/v/1",
        )
        .expect("should be valid url"),
    )
});

enum CacheResult<'a> {
    Hit(&'a AnyType),
    Miss(&'a AnyType),
}

type FetchFn = Box<dyn FnMut(&VersionedUrl) -> Option<AnyType>>;

// We cannot handle lifetimes here, because we own the data already, doing so would create a
// self-referential struct, which is considered a war crime in some states.
pub(crate) struct UnificationAnalyzer {
    cache: HashMap<VersionedUrl, AnyType>,
    fetch: Option<FetchFn>,
    facts: Facts,

    missing: HashSet<VersionedUrl>,
}

impl UnificationAnalyzer {
    pub(crate) fn new(values: impl IntoIterator<Item = AnyType>) -> Self {
        let cache: HashMap<_, _> = values
            .into_iter()
            .map(|value| (value.id().clone(), value))
            .collect();

        Self {
            cache,
            fetch: None,
            facts: Facts::new(),

            missing: HashSet::new(),
        }
    }

    pub(crate) fn with_fetch(
        &mut self,
        func: impl FnMut(&VersionedUrl) -> Option<AnyType> + 'static,
    ) {
        self.fetch = Some(Box::new(func));
    }

    fn fetch(&mut self, id: &VersionedUrl) -> Result<CacheResult, AnalysisError> {
        // Optimization, we don't need to query twice, if we know the type is missing
        if self.missing.contains(id) {
            return Err(Report::new(AnalysisError::IncompleteGraph));
        }

        // I'd like to use `.get()` here, but then we get a lifetime error
        if self.cache.contains_key(id) {
            return Ok(CacheResult::Hit(&self.cache[id]));
        }

        let Some(fetch) = &mut self.fetch else {
            self.missing.insert(id.clone());
            return Err(Report::new(AnalysisError::IncompleteGraph));
        };

        let Some(any) = (fetch)(id) else {
            self.missing.insert(id.clone());
            return Err(Report::new(AnalysisError::IncompleteGraph));
        };

        self.cache.insert(any.id().clone(), any);

        Ok(CacheResult::Miss(&self.cache[id]))
    }

    pub(crate) fn entity_or_panic(&mut self, id: &VersionedUrl) -> &EntityType {
        let any = &self.cache[id];

        match any {
            AnyType::Entity(entity) => entity,
            _ => panic!("expected entity"),
        }
    }

    pub(crate) fn remove_entity_or_panic(&mut self, id: &VersionedUrl) -> EntityType {
        let any = self.cache.remove(id).expect("entity not found");

        match any {
            AnyType::Entity(entity) => entity,
            _ => panic!("expected entity"),
        }
    }

    /// This is the main unification function for entity types. It takes an entity type and merges
    /// all parents into it.
    ///
    /// This is done in the following steps:
    ///
    /// A) convert to `repr::EntityType`
    /// B) for every parent in parent:
    ///      1) get the parent
    ///      2) convert to [`repr::EntityType`]
    ///      3) merge
    /// C) convert to `Value`
    /// D) set `allOf` again to parents (used later in analysis stage)
    /// E) convert to `repr::EntityType`
    /// F) convert back to `EntityType`
    /// G) insert into cache
    ///
    /// This is only called from `unify`, which already checks for cycles and ensures that every
    /// type exists.
    pub(crate) fn unify_entity(&mut self, id: &VersionedUrl) -> Result<(), AnalysisError> {
        let mut errors = ErrorAccumulator::new();

        let entity = self.remove_entity_or_panic(id);

        let parents: Vec<_> = entity
            .inherits_from()
            .all_of()
            .iter()
            .map(EntityTypeReference::url)
            .cloned()
            .collect();

        let mut entity: repr::EntityType = entity.into();

        for url in &parents {
            if url == LINK_REF.url() {
                // We need to skip the link type, as it is hard-coded in the type system and
                // special.
                continue;
            }

            let parent: repr::EntityType = self.entity_or_panic(url).clone().into();

            let result = entity
                .merge_parent(parent)
                .change_context(AnalysisError::UnificationMerge);

            errors.push(result);
        }

        errors.into_result()?;

        // time to be evil
        let mut entity =
            serde_json::to_value(entity).change_context(AnalysisError::UnificationSerde)?;
        entity["allOf"] = parents
            .into_iter()
            .map(|url| json!({ "$ref": url }))
            .collect();

        let entity: repr::EntityType =
            serde_json::from_value(entity).change_context(AnalysisError::UnificationSerde)?;

        let entity =
            EntityType::try_from(entity).change_context(AnalysisError::UnificationConvert)?;

        self.cache
            .insert(entity.id().clone(), AnyType::Entity(entity));

        Ok(())
    }

    pub(crate) fn unify(&mut self, id: &VersionedUrl) -> Result<(), AnalysisError> {
        let any = &self.cache[id];

        match any {
            AnyType::Entity(_) => self.unify_entity(id),
            // currently not supported, so we skip
            _ => Ok(()),
        }
    }

    pub(crate) fn gather_facts(
        &mut self,
        graph: &mut DiGraph<VersionedUrl, ()>,
        lookup: &HashMap<VersionedUrl, NodeIndex>,
    ) {
        if let Some(link) = lookup.get(LINK_REF.url()) {
            // find all types that are links, this is simply done by
            // A) reversing the tree
            // B) DFS the tree starting from the link and collect all nodes
            graph.reverse();

            let dfs = Dfs::new(&*graph, *link);

            for node in dfs.iter(&*graph) {
                let url = graph.node_weight(node).expect("node not found");
                self.facts.links.insert(url.clone());
            }

            // reverse again so that we can use the graph again
            graph.reverse();
        }
    }

    pub(crate) fn stack(&mut self) -> Result<Vec<VersionedUrl>, AnalysisError> {
        // we will insert things later, therefore we need to clone, not take references
        let mut stack: Vec<_> = self.cache.keys().cloned().collect();

        let mut errors = ErrorAccumulator::new();

        let mut graph = DiGraph::new();
        let mut lookup = HashMap::new();

        while let Some(url) = stack.pop() {
            let entry = &self.cache[&url];

            if let AnyType::Entity(entity) = entry {
                let lhs = *lookup
                    .entry(url.clone())
                    .or_insert_with(|| graph.add_node(url));

                // need to clone here, as otherwise we borrow the cache mutable and immutable at the
                // same time (through fetch)
                let all_of = entity.inherits_from().all_of().to_vec();
                for parent in all_of {
                    let rhs = *lookup
                        .entry(parent.url().clone())
                        .or_insert_with(|| graph.add_node(parent.url().clone()));

                    graph.add_edge(lhs, rhs, ());

                    if parent.url() == LINK_REF.url() {
                        continue;
                    }

                    let result = self.fetch(parent.url());

                    let Some(entry) = errors.push(result) else {
                        continue;
                    };

                    match entry {
                        CacheResult::Miss(any) => stack.push(any.id().clone()),
                        CacheResult::Hit(_) => {}
                    }
                }
            }
        }

        errors.into_result()?;

        self.gather_facts(&mut graph, &lookup);

        // remove the LINK_REF node, it is only used to find all types that are links
        if let Some(id) = lookup.get(LINK_REF.url()) {
            graph.remove_node(*id);
        }

        let mut topo = toposort(&graph, None)
            .map_err(|_error| Report::new(AnalysisError::UnificationCycle))?;

        topo.reverse();

        Ok(topo
            .into_iter()
            .map(|id| graph.node_weight(id).expect("node not found").clone())
            .collect())
    }

    pub(crate) fn run(mut self) -> Result<(HashMap<VersionedUrl, AnyType>, Facts), AnalysisError> {
        let mut errors = ErrorAccumulator::new();
        let stack = self.stack()?;

        for id in stack {
            errors.push(self.unify(&id));
        }

        errors.into_result()?;
        Ok((self.cache, self.facts))
    }
}
