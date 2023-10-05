use crate::prelude::*;
use crate::util::{wrapped_positions, Point3WithId, Vec3};
use std::collections::HashSet;

/// # Errors
/// This function will not fail
pub fn try_agents_adjacency_map<'a, T: Iterator<Item = &'a AgentState>>(
    agents: T,
) -> SimulationResult<AdjacencyMap<'a>> {
    let mut positionables = agents
        .enumerate()
        .fold(Vec::new(), |mut acc, (idx, state)| {
            if let Some(position) = state.position {
                acc.push(Point3WithId::new(
                    state, idx as i32, position.0, position.1, position.2,
                ));
            }
            acc
        });
    let ret = kdtree::kdtree::Kdtree::new(positionables.as_mut_slice());
    Ok(ret)
}

#[allow(clippy::module_name_repetitions)]
#[must_use]
pub fn gather_neighbors<'a>(
    adjacency_map: &'a AdjacencyMap,
    agent: &'a AgentState,
    topology: &TopologyConfig,
) -> Vec<&'a AgentState> {
    // Check if the agent has a custom search radius. If not, fall back to the topology search radius
    let search_radius = match agent.search_radius {
        Some(radius) => radius,
        None => match topology.search_radius {
            Some(global_radius) => global_radius,
            None => return Vec::new(),
        },
    };

    if agent.position.is_none() {
        return Vec::new();
    }

    // We just checked if it was none, okay, it can't be none
    let position = agent.position.unwrap();

    // if wrapping_combinations is 1, it means that we don't wrap around the boundaries
    // so let's leave it as is.

    let mut final_neighbors: Vec<&'a AgentState> = Vec::new();
    if topology.wrapping_combinations == 1 {
        adjacency_map
            .within(
                &Point3WithId::new(agent, -1, position.0, position.1, position.2),
                search_radius,
                &topology.distance_function,
            )
            .into_iter()
            .filter(|point: &Point3WithId| !std::ptr::eq(point.agent, agent))
            .for_each(|point: Point3WithId| final_neighbors.push(point.agent));
    } else {
        // We keep the idxs of the agents in the agent state
        // This assumes the idxs don't change from step to step.
        // This is fine for when the kdtree gets rebuilt every step but will be unreliable when the vec changes
        // A better approach would be to use a hashmap to hold all the agents and use a resouce id uuid rather than string
        // We can't actually use the agent id because it's a string, which sucks
        let mut seen_neighbors_idxs = HashSet::<i32>::new();

        let wrapped = wrapped_positions(&position, topology);
        wrapped.into_iter().for_each(|pos: Vec3| {
            adjacency_map
                .within(
                    &Point3WithId::new(&agent, -1, pos.0, pos.1, pos.2),
                    search_radius,
                    &topology.distance_function,
                )
                .into_iter()
                .filter(|point: &Point3WithId| seen_neighbors_idxs.insert(point.idx))
                .filter(|point: &Point3WithId| !std::ptr::eq(point.agent, agent))
                .for_each(|point: Point3WithId| final_neighbors.push(point.agent));
        });
    }

    final_neighbors
}
