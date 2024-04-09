pub(crate) mod facts;
pub(crate) mod unify;

use std::collections::HashMap;

use error_stack::{Report, Result};
use petgraph::graph::{DiGraph, NodeIndex};
use thiserror::Error;
use type_system::{url::VersionedUrl, EntityType, PropertyType, PropertyValues, ValueOrArray};

use crate::{
    graph::{elementary_circuits, Stable},
    AnyType,
};

#[derive(Debug, Clone, Error)]
pub(crate) enum AnalysisError {
    #[error(
        "while trying to remove all cycles, the max iteration count of {iterations} has been \
         reached"
    )]
    CycleMaxIterationCountReached { iterations: usize },
    #[error("Received collection of types is incomplete")]
    IncompleteGraph,
    #[error("While trying to unify types, a cycle has been detected")]
    UnificationCycle,
    #[error("Unable to merge types")]
    UnificationMerge,
    #[error("Unable to convert back from `repr::*Type` to `*Type`")]
    UnificationConvert,
    #[error("Unable to convert `repr::*Type` to `serde_json::Value` and back")]
    UnificationSerde,
}

#[derive(Debug, Copy, Clone)]
#[allow(clippy::enum_variant_names)]
pub(crate) enum NodeKind {
    DataType,
    PropertyType,
    EntityType,
}

#[derive(Debug, Copy, Clone)]
pub(crate) struct Node<'a> {
    id: &'a VersionedUrl,
    kind: NodeKind,
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash)]
pub(crate) enum EdgeKind {
    Plain,
    Boxed,
    Array,
}

#[derive(Debug, Copy, Clone)]
pub(crate) struct Edge {
    pub(crate) kind: EdgeKind,
}

type Graph<'a> = DiGraph<Node<'a>, Edge>;
type TempGraph<'a> = DiGraph<Option<Node<'a>>, Edge>;
type Lookup = HashMap<VersionedUrl, NodeIndex>;

pub(crate) struct DependencyAnalyzer<'a> {
    lookup: Lookup,
    graph: Graph<'a>,
}

impl<'a> DependencyAnalyzer<'a> {
    fn add_link(
        graph: &mut TempGraph<'a>,
        lookup: &mut Lookup,
        source: NodeIndex,
        target: &'a VersionedUrl,
        kind: EdgeKind,
    ) {
        let target = lookup.get(target).copied().map_or_else(
            || {
                let index = graph.add_node(None);
                lookup.insert(target.clone(), index);
                index
            },
            |index| index,
        );

        graph.update_edge(source, target, Edge { kind });
    }

    fn outgoing_entity_type(
        graph: &mut TempGraph<'a>,
        lookup: &mut Lookup,
        index: NodeIndex,
        ty: &'a EntityType,
    ) {
        let references = ty.properties().values().map(|value| match value {
            ValueOrArray::Value(url) => (url, EdgeKind::Plain),
            ValueOrArray::Array(array) => (array.items(), EdgeKind::Array),
        });

        for (reference, kind) in references {
            Self::add_link(graph, lookup, index, reference.url(), kind);
        }
    }

    fn outgoing_property_value(
        graph: &mut TempGraph<'a>,
        lookup: &mut Lookup,
        index: NodeIndex,
        value: &'a PropertyValues,
        kind: Option<EdgeKind>,
    ) {
        let kind = kind.unwrap_or(EdgeKind::Plain);

        match value {
            PropertyValues::DataTypeReference(data) => {
                Self::add_link(graph, lookup, index, data.url(), kind);
            }
            PropertyValues::PropertyTypeObject(object) => {
                for value in object.properties().values() {
                    match value {
                        ValueOrArray::Value(value) => {
                            Self::add_link(graph, lookup, index, value.url(), kind);
                        }

                        ValueOrArray::Array(array) => Self::add_link(
                            graph,
                            lookup,
                            index,
                            array.items().url(),
                            EdgeKind::Array,
                        ),
                    }
                }
            }
            PropertyValues::ArrayOfPropertyValues(array) => {
                for value in array.items().one_of() {
                    Self::outgoing_property_value(
                        graph,
                        lookup,
                        index,
                        value,
                        Some(EdgeKind::Array),
                    );
                }
            }
        }
    }

    fn outgoing_property_type(
        graph: &mut TempGraph<'a>,
        lookup: &mut Lookup,
        index: NodeIndex,
        ty: &'a PropertyType,
    ) {
        for value in ty.one_of() {
            Self::outgoing_property_value(graph, lookup, index, value, None);
        }
    }

    fn outgoing(graph: &mut TempGraph<'a>, lookup: &mut Lookup, index: NodeIndex, ty: &'a AnyType) {
        match ty {
            AnyType::Data(_) => {}
            AnyType::Property(ty) => Self::outgoing_property_type(graph, lookup, index, ty),
            AnyType::Entity(ty) => Self::outgoing_entity_type(graph, lookup, index, ty),
        }
    }

    /// Try to resolve all cycles in a graph by boxing individual nodes
    ///
    /// This is by far the most computationally intensive task.
    fn remove_cycles(graph: &mut Graph) -> Result<(), AnalysisError> {
        const ITERATIONS: usize = 1024;

        let mut iterations: usize = ITERATIONS;

        loop {
            // we need to retain the original edge index, we generate this every time, as otherwise
            // our edge indices would get out of sync
            let plain = graph.filter_map(
                |_, _| Some(()),
                |index, weight| (weight.kind == EdgeKind::Plain).then_some(Stable(index)),
            );

            let circuits = elementary_circuits(&plain);

            if circuits.is_empty() {
                break;
            }

            let mut occurrences = vec![0usize; plain.edge_count()];

            for circuit in circuits {
                for edge in circuit {
                    occurrences[edge.index()] += 1;
                }
            }

            let mut edges: Vec<_> = plain
                .edge_indices()
                .filter(|edge| occurrences[edge.index()] > 0)
                .collect();

            if edges.is_empty() {
                // should never happen, but in that case we can already stop, as there is no cycle
                break;
            }

            // sort by occurrences then index to stay stable
            edges.sort_by(|a, b| {
                occurrences[a.index()]
                    .cmp(&occurrences[b.index()])
                    .then(a.cmp(b))
            });
            edges.reverse();

            let chosen = plain[edges[0]];
            graph
                .edge_weight_mut(chosen.0)
                .expect("should exist in graph")
                .kind = EdgeKind::Boxed;

            iterations -= 1;

            if iterations == 0 {
                return Err(Report::new(AnalysisError::CycleMaxIterationCountReached {
                    iterations: ITERATIONS,
                }));
            }
        }

        Ok(())
    }

    pub(crate) fn new(types: impl IntoIterator<Item = &'a AnyType>) -> Result<Self, AnalysisError> {
        let mut graph = TempGraph::new();
        let mut lookup = Lookup::new();

        for ty in types {
            let node = match ty {
                AnyType::Data(data) => Node {
                    id: data.id(),
                    kind: NodeKind::DataType,
                },
                AnyType::Property(property) => Node {
                    id: property.id(),
                    kind: NodeKind::PropertyType,
                },
                AnyType::Entity(entity) => Node {
                    id: entity.id(),
                    kind: NodeKind::EntityType,
                },
            };

            let index = if let Some(index) = lookup.get(ty.id()) {
                let weight = graph
                    .node_weight_mut(*index)
                    .expect("lookup table contract violated");
                *weight = Some(node);

                *index
            } else {
                let index = graph.add_node(Some(node));
                lookup.insert(ty.id().clone(), index);

                index
            };

            Self::outgoing(&mut graph, &mut lookup, index, ty);
        }

        let count = graph.node_count();

        let mut missing = vec![];
        let mut graph = graph.filter_map(
            |index, node| {
                if node.is_none() {
                    missing.push(index);
                }

                *node
            },
            |_, edge| Some(*edge),
        );

        if graph.node_count() != count {
            let reverse: HashMap<_, _> = lookup
                .into_iter()
                .map(|(key, value)| (value, key))
                .collect();

            let missing: Vec<_> = missing
                .into_iter()
                .filter_map(|missing| reverse.get(&missing))
                .collect();

            tracing::error!(?missing, "incomplete graph");

            return Err(Report::new(AnalysisError::IncompleteGraph));
        }

        Self::remove_cycles(&mut graph)?;

        Ok(Self { lookup, graph })
    }

    /// ## Panics
    ///
    /// if no edge exists between them
    pub(crate) fn edge(&self, from: &VersionedUrl, to: &VersionedUrl) -> Edge {
        let from = self.lookup[from];
        let to = self.lookup[to];

        let edge = self
            .graph
            .find_edge(from, to)
            .expect("edge between points does not exist");

        self.graph[edge]
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::*;

    #[test]
    fn two_intersecting_cycles() {
        let a_url = VersionedUrl::from_str("https://example.com/v/1").unwrap();
        let b_url = VersionedUrl::from_str("https://example.com/v/2").unwrap();
        let c_url = VersionedUrl::from_str("https://example.com/v/3").unwrap();
        let d_url = VersionedUrl::from_str("https://example.com/v/4").unwrap();
        let e_url = VersionedUrl::from_str("https://example.com/v/5").unwrap();
        let f_url = VersionedUrl::from_str("https://example.com/v/5").unwrap();

        let mut graph = Graph::new();

        let a = graph.add_node(Node {
            id: &a_url,
            kind: NodeKind::PropertyType,
        });
        let b = graph.add_node(Node {
            id: &b_url,
            kind: NodeKind::PropertyType,
        });
        let c = graph.add_node(Node {
            id: &c_url,
            kind: NodeKind::PropertyType,
        });
        let d = graph.add_node(Node {
            id: &d_url,
            kind: NodeKind::PropertyType,
        });
        let e = graph.add_node(Node {
            id: &e_url,
            kind: NodeKind::PropertyType,
        });
        let f = graph.add_node(Node {
            id: &f_url,
            kind: NodeKind::PropertyType,
        });

        // a ◀─ d ─▶ e
        // │    ▲    │
        // ▼    │    ▼
        // b ─▶ c ◀─ f
        let ab = graph.add_edge(a, b, Edge {
            kind: EdgeKind::Plain,
        });
        let bc = graph.add_edge(b, c, Edge {
            kind: EdgeKind::Plain,
        });
        let cd = graph.add_edge(c, d, Edge {
            kind: EdgeKind::Plain,
        });
        let da = graph.add_edge(d, a, Edge {
            kind: EdgeKind::Plain,
        });

        let de = graph.add_edge(d, e, Edge {
            kind: EdgeKind::Plain,
        });
        let ef = graph.add_edge(e, f, Edge {
            kind: EdgeKind::Plain,
        });
        let fc = graph.add_edge(f, c, Edge {
            kind: EdgeKind::Plain,
        });

        DependencyAnalyzer::remove_cycles(&mut graph).unwrap();

        // `cd` is in both cycles and should therefore be removed!
        assert_eq!(graph[cd].kind, EdgeKind::Boxed);
    }
}
