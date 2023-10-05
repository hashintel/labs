/*

We maintain good performance by leaving the calculation of distance between elements in Rust, but it
also means that we must support distance functions for all sorts of spaces. Here is what is currently
supported:
    - L-p norm for Vector Spaces
        [x] Manhattan for 1 norm
        [x] Euclidean for 2 norm
        [x] Chebyshev/Conway for infinity norm
    - Distance between graph nodes
        [] Hops for graph
        [] A* for digraph
*/

use crate::prelude::{AgentState, TopologyConfig};
use hash_types::{
    topology::{AxisBoundary, WrappingBehavior},
    Vec3,
};

use kdtree::kdtree::Kdtree as KdTree;
use kdtree::kdtree::KdtreePointTrait;
#[derive(Copy, Clone)]
pub struct Point3WithId<'a> {
    pub dims: [f64; 3],
    pub idx: i32,
    pub agent: &'a AgentState,
}

impl<'a> PartialEq for Point3WithId<'a> {
    fn eq(&self, other: &Self) -> bool {
        std::ptr::eq(self.agent, other.agent)
    }
}

impl<'a> Eq for Point3WithId<'a> {}

impl<'a> Point3WithId<'a> {
    #[must_use]
    pub fn new(agent: &'a AgentState, idx: i32, x: f64, y: f64, z: f64) -> Point3WithId {
        Point3WithId {
            dims: [x, y, z],
            idx,
            agent,
        }
    }
}

impl<'a> KdtreePointTrait for Point3WithId<'a> {
    #[inline]
    fn dims(&self) -> &[f64] {
        &self.dims
    }
}

#[allow(clippy::module_name_repetitions)]
pub type AdjacencyMap<'a> = KdTree<Point3WithId<'a>>;

/// Performs all the bounds checking and shifts points over depending on the topology config
/// Takes in a single position and returns a vector containing all the possible wrapping
/// of that position around the boundaries.
#[must_use]
pub fn wrapped_positions(pos: &Vec3, topology: &TopologyConfig) -> Vec<Vec3> {
    let mut all_points = Vec::with_capacity(topology.wrapping_combinations);
    all_points.push(*pos);

    for coord in 0..=2 {
        for i in 0..all_points.len() {
            // Go from z to x: we have to go backward to handle
            // the OffsetReflection case. Look at cfg.rs for more
            // details.
            //
            // Only add to the array if the position will be wrapped.
            if get_wrap_mode(2 - coord, topology) != WrappingBehavior::NoWrap {
                let mut pos = all_points[i];
                wrap_pos_coord(&mut pos, 2 - coord, topology);
                all_points.push(pos);
            }
        }
    }

    all_points
}

/// Wrap the position if the agent is out of bounds
pub fn correct_agent(agent: &mut AgentState, topology: &TopologyConfig) {
    agent.position_was_corrected = false;
    if let Some(ref mut pos) = agent.position {
        for i in 0..=2 {
            let bounds = get_bounds(i, topology);
            if pos[i] < bounds.min || pos[i] >= bounds.max {
                wrap_pos_coord(pos, i, topology);
                if let Some(ref mut dir) = agent.direction {
                    wrap_dir_coord(dir, i, topology);
                }
                agent.position_was_corrected = true;
            }
        }
    }
}

fn wrap_pos_coord(pos: &mut Vec3, i: usize, config: &TopologyConfig) {
    use WrappingBehavior::{Continuous, NoWrap, OffsetReflection, Reflection};
    match get_wrap_mode(i, config) {
        Continuous => {
            if pos[i] > get_half(i, config) {
                pos[i] -= get_size(i, config);
            } else {
                pos[i] += get_size(i, config);
            }
        }
        Reflection => {
            if pos[i] < get_half(i, config) {
                pos[i] += 2.0 * (get_bounds(i, config).min - pos[i]);
            } else {
                pos[i] += 2.0 * (get_bounds(i, config).max - pos[i]) - 1.0;
            }
        }
        OffsetReflection => {
            // we need to reflect along i and offset along j
            let j = if i == 0 { 2 } else { i - 1 };
            if pos[j] < get_half(j, config) {
                pos[j] += get_size(j, config) * 0.5;
            } else {
                pos[j] -= get_size(j, config) * 0.5;
            }
            if pos[i] < get_half(i, config) {
                pos[i] += 2.0 * (get_bounds(i, config).min - pos[i]);
            } else {
                pos[i] += 2.0 * (get_bounds(i, config).max - pos[i]) - 1.0;
            }
        }
        NoWrap => (),
    }
}

fn wrap_dir_coord(dir: &mut Vec3, i: usize, config: &TopologyConfig) {
    use WrappingBehavior::{OffsetReflection, Reflection};
    match get_wrap_mode(i, config) {
        Reflection | OffsetReflection => {
            dir[i] = -dir[i];
        }
        _ => (),
    }
}

fn get_half(i: usize, config: &TopologyConfig) -> f64 {
    match i {
        0 => config.get_half_x(),
        1 => config.get_half_y(),
        _ => config.get_half_z(),
    }
}

fn get_size(i: usize, config: &TopologyConfig) -> f64 {
    match i {
        0 => config.get_x_size(),
        1 => config.get_y_size(),
        _ => config.get_z_size(),
    }
}

fn get_wrap_mode(i: usize, config: &TopologyConfig) -> WrappingBehavior {
    match i {
        0 => config.wrap_x_mode,
        1 => config.wrap_y_mode,
        _ => config.wrap_z_mode,
    }
}

fn get_bounds(i: usize, config: &TopologyConfig) -> AxisBoundary {
    match i {
        0 => config.x_bounds,
        1 => config.y_bounds,
        _ => config.z_bounds,
    }
}

pub mod distance_functions {
    pub trait DistanceFn: Fn(&[f64], &[f64]) -> f64 + Send + Sync + 'static {}
    impl<T> DistanceFn for T where T: Fn(&[f64], &[f64]) -> f64 + Send + Sync + 'static {}

    /// The distance function associated with the infinite norm
    /// In simpler terms - the distance function that returns the largest distance in any given axes
    ///
    /// Takes two positions as an array of coordinates
    #[must_use]
    pub fn conway(a: &[f64], b: &[f64]) -> f64 {
        debug_assert!(a.len() == b.len());
        a.iter()
            .zip(b.iter()) // Line the two coordinates up in a set of hstacked pairs
            .map(|(x1, x2)| (*x1 - *x2).abs()) // pull in each hstack pair and return the abs of their difference
            .fold(0_f64, |a, b| a.max(b)) //
    }

    /// The distance function associated with the L-1 norm
    /// Also known as the Taxicab distance - returns the total distance traveled in all axes
    ///
    /// Takes two positions as an array of coordinates
    #[must_use]
    pub fn manhattan(a: &[f64], b: &[f64]) -> f64 {
        debug_assert!(a.len() == b.len());
        a.iter()
            .zip(b.iter())
            .map(|(x1, x2)| (*x1 - *x2).abs())
            .fold(0_f64, |acc, add| acc + add)
    }

    /// The distance function associated with the L-2 norm
    /// Most familiar distance function - is the straightline distance between two points
    /// Results are left squared for efficient comparisons
    ///
    /// Takes two positions as an array of coordinates
    #[must_use]
    pub fn euclidean_squared(a: &[f64], b: &[f64]) -> f64 {
        debug_assert!(a.len() == b.len());
        a.iter()
            .zip(b.iter())
            .map(|(x1, x2)| (*x1 - *x2).powi(2))
            .fold(0_f64, |acc, add| acc + add)
    }

    /// The distance function associated with the L-2 norm
    /// Most familiar distance function - is the straightline distance between two points
    ///
    /// Takes two positions as an array of coordinates
    #[must_use]
    pub fn euclidean(a: &[f64], b: &[f64]) -> f64 {
        debug_assert!(a.len() == b.len());
        a.iter()
            .zip(b.iter())
            .map(|(x1, x2)| (*x1 - *x2).powi(2))
            .fold(0_f64, |acc, add| acc + add)
            .sqrt()
    }
}

#[cfg(test)]
mod tests {
    // use super::*;
    use crate::prelude::*;
    use crate::runtimes::neighbors::{gather_neighbors, try_agents_adjacency_map};
    use crate::sim::adjacency::distance_functions;
    use crate::sim::Properties;
    use assert_approx_eq::assert_approx_eq as assert_approx_eq_;

    #[test]
    fn test_gather_neighbors() -> SimulationResult<()> {
        let state: Vec<AgentState> = vec![
            json!({
                "agent_id": "A",
                "position": [0, 0],
                "search_radius": 1
            })
            .into(),
            // to the right
            json!({
                "agent_id": "B",
                "position": [1, 0]
            })
            .into(),
            // above
            json!({
                "agent_id": "C",
                "position": [0, 1]
            })
            .into(),
            // above, to the right
            json!({
                "agent_id": "D",
                "position": [1, 1]
            })
            .into(),
            // too far
            json!({
                "agent_id": "E",
                "position": [5, 5]
            })
            .into(),
            // without a position
            json!({
                "agent_id": "F"
            })
            .into(),
        ];

        let properties = Properties::from_json_unchecked(json!({
            "topology":{
                "distance_function":"chebyshev",
                "search_radius":1
            }
        }));

        let topology_config = properties.topology_config_unchecked();

        let adjacency_map = try_agents_adjacency_map(state.iter()).unwrap();

        let neighbors = gather_neighbors(&adjacency_map, &state[0], &topology_config);
        assert_eq!(neighbors.len(), 3);

        let neighbors = gather_neighbors(&adjacency_map, &state[4], &topology_config);
        assert_eq!(neighbors.len(), 0);

        let neighbors = gather_neighbors(&adjacency_map, &state[5], &topology_config);
        assert_eq!(neighbors.len(), 0);

        Ok(())
    }

    #[test]
    fn validate_distance_functions() {
        // Pairs to test
        let p1 = [0.0, 0.0];

        let p2 = [1.0, 2.0];
        let p3 = [-1.0, -2.0];
        let p4 = [1.0, -2.0];
        let p5 = [-1.0, 2.0];

        use distance_functions::{conway, euclidean_squared, manhattan};

        assert_approx_eq_!(conway(&p1, &p2), 2.0, 1e-5_f64);
        assert_approx_eq_!(conway(&p1, &p3), 2.0, 1e-5_f64);
        assert_approx_eq_!(conway(&p1, &p4), 2.0, 1e-5_f64);
        assert_approx_eq_!(conway(&p1, &p5), 2.0, 1e-5_f64);

        assert_approx_eq_!(euclidean_squared(&p1, &p2), 5.0, 1e-5_f64);
        assert_approx_eq_!(euclidean_squared(&p1, &p3), 5.0, 1e-5_f64);
        assert_approx_eq_!(euclidean_squared(&p1, &p4), 5.0, 1e-5_f64);
        assert_approx_eq_!(euclidean_squared(&p1, &p5), 5.0, 1e-5_f64);

        assert_approx_eq_!(manhattan(&p1, &p2), 3.0, 1e-5_f64);
        assert_approx_eq_!(manhattan(&p1, &p3), 3.0, 1e-5_f64);
        assert_approx_eq_!(manhattan(&p1, &p4), 3.0, 1e-5_f64);
        assert_approx_eq_!(manhattan(&p1, &p5), 3.0, 1e-5_f64);
    }

    #[derive(Clone, Debug)]
    struct TestSearch {
        radius: f64,
        p1: Vec<f64>,
        p2: Vec<f64>,
        x_bounds: (f64, f64),
        y_bounds: (f64, f64),
        z_bounds: (f64, f64),
        dist_func: String,
        wrap_x: String,
        wrap_y: String,
        wrap_z: String,
    }

    #[test]
    fn validate_wrapping() {
        let a = TestSearch {
            radius: 1_f64,
            p1: [0.0, 0.0].to_vec(),
            p2: [1.0, 0.0].to_vec(),
            x_bounds: (0.0, 10.0),
            y_bounds: (0.0, 10.0),
            z_bounds: (0.0, 10.0),
            dist_func: "manhattan".to_string(),
            wrap_x: "none".to_string(),
            wrap_y: "none".to_string(),
            wrap_z: "none".to_string(),
        };

        // Validate our input first
        let properties = Properties::from_json_unchecked(json!({
            "topology":{
                "x_bounds": [a.x_bounds.0, a.x_bounds.1],
                "y_bounds": [a.y_bounds.0, a.y_bounds.1],
                "z_bounds": [a.z_bounds.0, a.z_bounds.1],
                "search_radius": a.radius,
                "distance_function": a.dist_func,
                "wrap_x_mode": a.wrap_x,
                "wrap_y_mode": a.wrap_y,
                "wrap_z_mode": a.wrap_z,
            }
        }));

        let topology_config = properties.topology_config_unchecked();
        assert_approx_eq_!(topology_config.x_bounds.max, 10.0);
        assert_approx_eq_!(topology_config.y_bounds.max, 10.0);
        assert_approx_eq_!(topology_config.z_bounds.max, 10.0);

        let mut _manhattan = a.clone();
        _manhattan.radius = 2.1_f64;
        assert_eq!(neighbors_from_search(&_manhattan), 1);

        // Check wrapping condition
        let mut _manhattan_wrapped = a.clone();
        _manhattan_wrapped.radius = 1.1_f64;
        _manhattan_wrapped.p2 = [9.0, 0.0].to_vec();
        _manhattan_wrapped.wrap_x = "continuous".to_string();
        assert_eq!(neighbors_from_search(&_manhattan_wrapped), 1);

        // Make sure no neighbors are found when the search dist is low
        _manhattan_wrapped.radius = 0.1_f64;
        assert_eq!(neighbors_from_search(&_manhattan_wrapped), 0);

        // Double wrapping
        println!("Checking the double wrap");
        let mut _manhattan_wrapped_double = a;
        _manhattan_wrapped_double.radius = 2.1_f64;
        _manhattan_wrapped_double.p2 = [9.0, 9.0].to_vec();
        _manhattan_wrapped_double.wrap_x = "continuous".to_string();
        _manhattan_wrapped_double.wrap_y = "continuous".to_string();
        assert_eq!(neighbors_from_search(&_manhattan_wrapped_double), 1);
    }

    fn neighbors_from_search(a: &TestSearch) -> usize {
        let properties = Properties::from_json_unchecked(json!({
            "topology":{
                "x_bounds": [a.x_bounds.0, a.x_bounds.1],
                "y_bounds": [a.y_bounds.0, a.y_bounds.1],
                "z_bounds": [a.z_bounds.0, a.z_bounds.1],
                "search_radius": a.radius,
                "distance_function": a.dist_func,
                "wrap_x_mode": a.wrap_x,
                "wrap_y_mode": a.wrap_y,
                "wrap_z_mode": a.wrap_z,
            }
        }));

        let topology_config = properties.topology_config_unchecked();

        // Pairs to test
        let state: Vec<AgentState> = vec![
            json!({
                "id": "A",
                "position": a.p1
            })
            .into(),
            json!({
                "id": "B",
                "position": a.p2
            })
            .into(),
        ];

        let adjacency_map = try_agents_adjacency_map(state.iter()).unwrap();
        let neighbors = gather_neighbors(&adjacency_map, &state[0], &topology_config);
        neighbors.len()
    }

    #[test]
    fn validate_multiple_wrapping() -> SimulationResult<()> {
        let properties = Properties::from_json_unchecked(json!({
            "topology":{
                "x_bounds": (0,5),
                "y_bounds": (0,5),
                "z_bounds": (0,5),
                "search_radius": 1,
                "distance_function": "conway",
                "wrapping_preset": "torus"
            }
        }));

        let topology_config = properties.topology_config_unchecked();

        // Pairs to test
        let state: Vec<AgentState> = vec![
            json!({
                "id": "A",
                "position": [0, 0]
            })
            .into(),
            // Within range
            json!({
                "id": "B",
                "position": [1, 0]
            })
            .into(),
            // Within range
            json!({
                "id": "C",
                "position": [0, 1]
            })
            .into(),
            // Within range
            json!({
                "id": "D",
                "position": [1, 1]
            })
            .into(),
            // Not within range
            json!({
                "id": "E",
                "position": [2, 2]
            })
            .into(),
            // Wrapped, but within range
            json!({
                "id": "F",
                "position": [4, 4]
            })
            .into(),
            // Wrapped, but within range
            json!({
                "id": "G",
                "position": [4, 0]
            })
            .into(),
            // Wrapped, but within range
            json!({
                "id": "H",
                "position": [0, 4]
            })
            .into(),
        ];

        let adjacency_map = try_agents_adjacency_map(state.iter()).unwrap();
        let neighbors = gather_neighbors(&adjacency_map, &state[0], &topology_config);
        assert_eq!(neighbors.len(), 6);

        Ok(())
    }
}
