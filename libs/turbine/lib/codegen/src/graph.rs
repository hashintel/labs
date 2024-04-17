use std::{
    collections::{HashMap, HashSet},
    hash::Hash,
    iter::once,
};

use indexmap::IndexSet;
use petgraph::{
    algo::tarjan_scc,
    graph::{DiGraph, EdgeIndex, NodeIndex},
    prelude::EdgeRef,
    visit::IntoNodeReferences,
    Direction,
};

type ElementaryCircuit = Vec<EdgeIndex>;

/// Marker type, used so that we don't confuse indices
#[derive(Debug, Copy, Clone, Hash, PartialOrd, PartialEq, Ord, Eq)]
pub(crate) struct Stable<T>(pub(crate) T);

/// The main loop of the cycle-enumeration algorithm of Johnson.
fn johnson_cycle_search(
    graph: &DiGraph<Stable<NodeIndex>, Stable<EdgeIndex>>,
    start: NodeIndex,
) -> Vec<Vec<Stable<EdgeIndex>>> {
    let mut circuits = vec![];

    let mut path = vec![start];
    let mut blocked: HashSet<_> = once(start).collect();

    let mut blocked_subgraph: HashMap<NodeIndex, HashSet<NodeIndex>> = HashMap::new();

    let mut stack = vec![
        graph
            .neighbors_directed(start, Direction::Outgoing)
            .fuse()
            .peekable(),
    ];

    let mut closed = vec![false];

    while let Some(neighbours) = stack.last_mut() {
        if neighbours.peek().is_none() {
            // exhausted; no more neighbours to process
            stack.pop();
            let node = path.pop().expect("infallible; non-empty");

            if closed.pop().expect("infallible; non-empty") {
                if let Some(last) = closed.last_mut() {
                    *last = true;
                }

                let mut unblock = vec![node];

                while let Some(node) = unblock.pop() {
                    if blocked.contains(&node) {
                        blocked.remove(&node);

                        if let Some(nodes) = blocked_subgraph.remove(&node) {
                            unblock.extend(nodes.into_iter());
                        }
                    }
                }
            } else {
                for neighbour in graph.neighbors_directed(node, Direction::Outgoing) {
                    let subgraph = blocked_subgraph.entry(neighbour).or_default();
                    subgraph.insert(node);
                }
            }

            continue;
        }

        // Reason: we resume the iterator in the next phase after some time,
        //  this means we do not consume the iterator and we also do not want to hold
        //  a mutable reference to the iterator while iterating through
        #[allow(clippy::while_let_on_iterator)]
        while let Some(node) = neighbours.next() {
            if node == start {
                let mut circuit = path.clone();
                circuit.push(node);

                circuits.push(circuit);

                *closed.last_mut().expect("infallible; closed is non-empty") = true;
            } else if !blocked.contains(&node) {
                path.push(node);
                closed.push(false);
                stack.push(
                    graph
                        .neighbors_directed(node, Direction::Outgoing)
                        .fuse()
                        .peekable(),
                );
                blocked.insert(node);

                break;
            }
        }
    }

    // convert to stable path identifiers
    circuits
        .into_iter()
        .map(|circuit| {
            circuit
                .windows(2)
                .map(|window| {
                    *graph
                        .edge_weight(
                            graph
                                .find_edge(window[0], window[1])
                                .expect("infallible; must exist"),
                        )
                        .expect("infallible; must exist")
                })
                .collect()
        })
        .collect()
}

/// Modified [`tarjan_scc`], which instead of returning `NodeIndex`, returns the weight.
///
///
/// This is important as we assume that the weight is constant, while node indices are not!
///
/// Returns a [`IndexSet`], as it preserves insertion order, but also allows for fast lookups
/// (needed to verify containment).
fn scc<N, E>(graph: &DiGraph<N, E>) -> impl Iterator<Item = IndexSet<N>> + '_
where
    N: Copy + Hash + Eq,
{
    // ensure that we use the canonical node weight, this is is done by using the graph weight, we
    // convert to `HashSet` as inclusion in `filter_map` is a lot faster that way
    tarjan_scc(&graph).into_iter().filter_map(|scc| {
        (scc.len() > 1).then(|| {
            scc.into_iter()
                .filter_map(|index| graph.node_weight(index).copied())
                .collect()
        })
    })
}

/// Dispatch function for [`elementary_circuits`]
///
/// We generate all cycles of `graph` through binary partition.
///
/// 1. Pick a node `v` in `G` a. Generate all cycles of `G` which contain the node `v` b.
///    Recursively generate all cycles of `G \\ v`
///
/// This is accomplished through the following:
///
/// 1. Compute the strongly connected components `SCC` of `G`
/// 2. Select and remove a biconnected component `C` from `SCC`. Select a non-tree edge `(u, v)` of
///    a depth first search of `G[C]`
/// 3. For each simple cycle `P` containing `v` in `G[C]`, yield `P`
/// 4. Add the biconnected components of `G[C \\ v]` to `SCC`
fn directed_cycle_search(
    mut graph: DiGraph<Stable<NodeIndex>, Stable<EdgeIndex>>,
) -> Vec<Vec<Stable<EdgeIndex>>> {
    let mut components: Vec<_> = scc(&graph).collect();
    let mut circuits = vec![];

    while let Some(component) = components.pop() {
        // filter using the weight, as the index is not stable!
        let mut subgraph = graph.filter_map(
            |_, weight| component.contains(weight).then_some(*weight),
            |_, weight| Some(*weight),
        );

        let node = component
            .first()
            .copied()
            .expect("infallible; `IndexSet` has at least 2 nodes");

        let subgraph_node = subgraph
            .node_references()
            .find_map(|(index, weight)| (*weight == node).then_some(index))
            .expect("infallible; must exist");

        let graph_node = graph
            .node_references()
            .find_map(|(index, weight)| (*weight == node).then_some(index))
            .expect("infallible; must exist");

        circuits.extend(johnson_cycle_search(&subgraph, subgraph_node));

        // delete `node` after searching `graph`, to make sure we can find `v`
        // unlike networkx, subgraph views do not share the same nodes as the graph, therefore need
        // to remove them from both
        graph.remove_node(graph_node);
        subgraph.remove_node(subgraph_node);

        components.extend(scc(&subgraph));
    }

    circuits
}

/// Find elementary circuits of a graph
///
/// Implementation of the algorithm described in
/// <https://networkx.org/documentation/stable/_modules/networkx/algorithms/cycles.html#simple_cycles>
/// without the added optional length requirement which is only valid for directed graphs.
///
/// Complexity: $O((n+e)(c+1))$ for $n$ nodes, $e$ edges and $c$ simple circuits.
pub(crate) fn elementary_circuits<N, E>(graph: &DiGraph<N, E>) -> Vec<ElementaryCircuit> {
    // first report all self loops, they are not processed otherwise
    let mut circuits: Vec<_> = graph
        .edge_references()
        .filter(|edge| edge.source() == edge.target())
        .map(|edge| vec![Stable(edge.id())])
        .collect();

    // explicitly convert our graph into a graph where each weight has the original weight index,
    // node weights are not important and are therefore discarded.
    // we need the `EdgeIndex` as weight, because we remove edges, which will force reordering
    // in that case we could mark the wrong edge as circuit.
    let mut graph = graph.filter_map(
        |index, _| Some(Stable(index)),
        |index, _| Some(Stable(index)),
    );
    let mut traversed = HashSet::new();

    // remove all self-loops and parallel edges
    graph.retain_edges(|graph, edge| {
        let (source, target) = graph
            .edge_endpoints(edge)
            .expect("infallible; edge must exist in graph");

        // filter out any parallel edges
        if traversed.contains(&(source, target)) {
            return false;
        }

        traversed.insert((source, target));

        // remove all self loops
        source != target
    });

    circuits.extend(directed_cycle_search(graph));

    circuits
        .into_iter()
        .map(|path| path.into_iter().map(|edge| edge.0).collect())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn self_loop() {
        let mut graph = DiGraph::new();
        let a = graph.add_node(());

        let edge = graph.add_edge(a, a, ());

        let mut expected = vec![vec![edge]];

        for circuit in elementary_circuits(&graph) {
            expected.retain(|expected| *expected != circuit);
        }

        assert!(expected.is_empty());
    }

    #[test]
    fn larger_cycle() {
        let mut graph = DiGraph::new();

        let a = graph.add_node(());
        let b = graph.add_node(());
        let c = graph.add_node(());

        let ab = graph.add_edge(a, b, ());
        let bc = graph.add_edge(b, c, ());
        let ca = graph.add_edge(c, a, ());

        // `filter_map` starts from the back, therefore `ca` is actually first
        let mut expected = vec![vec![ca, ab, bc]];

        for circuit in elementary_circuits(&graph) {
            expected.retain(|expected| *expected != circuit);
        }

        assert!(expected.is_empty());
    }

    #[test]
    fn two_independent_cycles() {
        let mut graph = DiGraph::new();

        let a = graph.add_node(());
        let b = graph.add_node(());
        let c = graph.add_node(());

        let d = graph.add_node(());
        let e = graph.add_node(());
        let f = graph.add_node(());

        let ab = graph.add_edge(a, b, ());
        let bc = graph.add_edge(b, c, ());
        let ca = graph.add_edge(c, a, ());

        let de = graph.add_edge(d, e, ());
        let ef = graph.add_edge(e, f, ());
        let fd = graph.add_edge(f, d, ());

        // `filter_map` starts from the back, therefore `ca` is actually first
        let mut expected = vec![vec![ca, ab, bc], vec![fd, de, ef]];

        for circuit in elementary_circuits(&graph) {
            expected.retain(|expected| *expected != circuit);
        }

        assert!(expected.is_empty());
    }

    #[test]
    fn two_intersecting_cycles() {
        let mut graph = DiGraph::new();

        let a = graph.add_node(());
        let b = graph.add_node(());
        let c = graph.add_node(());
        let d = graph.add_node(());
        let e = graph.add_node(());

        let ab = graph.add_edge(a, b, ());
        let bc = graph.add_edge(b, c, ());
        let ca = graph.add_edge(c, a, ());

        let cd = graph.add_edge(c, d, ());
        let de = graph.add_edge(d, e, ());
        let ec = graph.add_edge(e, c, ());

        // `filter_map` starts from the back, therefore `ca` is actually first
        let mut expected = vec![vec![ca, ab, bc], vec![ec, cd, de]];

        for circuit in elementary_circuits(&graph) {
            expected.retain(|expected| *expected != circuit);
        }

        assert!(expected.is_empty());
    }
}
