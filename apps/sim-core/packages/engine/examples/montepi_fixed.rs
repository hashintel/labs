// This example demonstrates the simplicity of building a useful academic simulation using HASH Core
extern crate hashintel_core;
use futures::executor::block_on;
use futures::stream::StreamExt;
use hashintel_core::{
    behaviors::NamedBehavior,
    prelude::{
        create_simulation, AgentState, Context, DatasetMap, DefaultRuntime, OutboundMessage,
        Properties, SimulationResult, SimulationState, Vec3,
    },
};
use rand::prelude::*;
use serde::{Deserialize, Serialize};
use std::rc::Rc;

fn timed_pi(run_count: usize) -> (Vec<Rc<SimulationState>>, Vec<std::time::Duration>) {
    /*
    Calculating Pi from random walks is an example of type of simulation known as Monte-Carlo.

    Monte-Carlo simulations demonstrate how complex behavior can emerge from simple random behaviors.
    we can design the behaviors with HASH Core and observe the complexity arise with our own code.

    The value of Pi can be estimated through Monte-Carlo by generating a handful of randomly placed points in a square of width 1. The number of points that are within 1 unit of the square's center is related to the area of the circle. From this, we can do some math to uncover the constant of Pi

    This simulation is a great starter simulation and shows off multiple agent types, agent spawning, neighbors, and simulation configuration.

    Any HASH simulation needs to have 3 things:
    * [1] Configuration
    * [2] Behaviors
    * [3] Initial Conditions
    */

    /*
    [1.1]
    First, we need to configure the simulation
    Let's import the SimulationConfig and build a configuration for our simulation
    */
    use hashintel_core::cfg::SimulationConfig;
    let sim_config = SimulationConfig::server_serial();

    /*
    [2.1]
    Great, we set the worldsize of a 1x1 square on the xy plane.
    Let's set up the behaviors of the agents in the simulation

    The primary agent of the simulation will spawn new agents around it every tick. These agents will be randomly distributed in the simulation plane. They won't have any specific behavior themselves but instead will represent the randomness from which we will derive Pi.

    The first behavior we will design will spawn new agents every tick randomly in the simulation space.
    */

    /*
    We need to represent the leader agent with some basic properties. Internally, agents can gain and lose fields during the simulation so the representation is of serde_json::Value. In our simulation though, we can simply use serde to derive a Serializer and Deserializer for a simple struct
    */
    #[derive(Serialize, Deserialize)]
    struct LeaderAgent {
        pub spawned_datapoints: u64,
        pub neighbor_points: u64,
        pub pi_estimate: f64,
        pub behaviors: Vec<String>,
        pub position: Vec3,
        pub agent_name: String,
        pub search_radius: f64,
    }

    #[derive(Serialize, Deserialize)]
    struct SampleAgent {
        pub position: Vec3,
        pub search_radius: f64,
    }
    impl SampleAgent {
        fn new() -> Self {
            let posx: f64 = rand::thread_rng().gen_range(0.0, 1.0);
            let posy: f64 = rand::thread_rng().gen_range(0.0, 1.0);
            Self {
                position: ([posx, posy]).into(),
                search_radius: 1.0,
            }
        }
    }

    // Here we build the spawn behavior to generate new agents each tick
    // By adding more agents, we can get a progressively better estimate of Pi with more datapoints
    fn spawn_fn(state: &mut AgentState, _context: &Context) -> SimulationResult<()> {
        for _ in 0..1 {
            // Clone into an empty agentstate
            let mut child = AgentState::default();

            // Place it randomly on the map
            let posx: f64 = rand::thread_rng().gen_range(0.0, 1.0);
            let posy: f64 = rand::thread_rng().gen_range(0.0, 1.0);
            child.position = Some([posx, posy].into());

            // Tell the simulation that we want to create a new agent with these properties
            state.messages.push(OutboundMessage::create_agent(child));

            // Bump the number of spawned datapoints
            let prev_val: i64 = state
                .custom
                .get("spawned_datapoints")
                .unwrap()
                .as_i64()
                .unwrap();
            *state.custom.get_mut("spawned_datapoints").unwrap() = serde_json::json!(prev_val + 1);
        }
        Ok(())
    }
    let _spawnbehavior = NamedBehavior::new("spawn_samples", spawn_fn, vec![""]);

    // Here we actually estimate Pi by looking at the quantity of neighbors and comparing it to the total number of agents spawned thus far.
    fn estimate_pi(state: &mut AgentState, context: &Context) -> SimulationResult<()> {
        let num_neighbors = context.neighbors.len() as i64;
        /*
        If we spawned infinite points, then we can assume the ratio of neighbors to total points would be the ratio of the circle's area to the square's area. We know that the square will have area 1 and the circle will have area 'pi r^2. Therefore, if we divide the ratio of neighbor points and those generated in the square by r^2, we can derive Pi.
        */
        let spawned_points = state
            .get_as_json("spawned_datapoints")?
            .as_i64()
            .unwrap_or(1);
        if spawned_points > 0 {
            let pi_estimate = 4.0 * ((num_neighbors as f64 / spawned_points as f64) as f64);
            state.set("pi_estimate", pi_estimate)?;
        }
        Ok(())
    }
    let estimate_pi_behavior = NamedBehavior::new("estimate_pi", estimate_pi, vec![""]);

    /*
    [3.1]

    Great, the two behaviors we need are set up, let's build the initial condition.

    We will start with a single leader agent at 0.0, 0.0
    */
    let pos: Vec3 = [0.0, 0.0].into();
    let leader = LeaderAgent {
        spawned_datapoints: run_count as u64,
        neighbor_points: 0,
        pi_estimate: 0.0,
        behaviors: vec!["estimate_pi".to_string()],
        position: pos,
        agent_name: "leader".to_string(),
        search_radius: 1.0,
    };

    let mut initial_state: Vec<AgentState> = vec![serde_json::to_value(&leader).unwrap().into()];

    for _ in 0..run_count {
        initial_state.push(serde_json::to_value(&SampleAgent::new()).unwrap().into())
    }

    // Let's record how long each step takes to get a feel for the performance of hCore
    let t_start = std::time::Instant::now();
    let mut times = Vec::new();

    let mut res: Vec<Rc<SimulationState>> = Vec::with_capacity(run_count);
    let mut sim = Box::pin(create_simulation(
        initial_state,
        Properties::from_json(serde_json::json!({
            "topology": {
                "distance_function": "euclidean_squared",
            }
        }))
        .unwrap(),
        DatasetMap::new(),
        vec![estimate_pi_behavior],
        vec![],
        sim_config,
        DefaultRuntime::new(),
    ));

    // Run the simulation and dump the results into the results buffer
    for _ in 0..10000 {
        res.push(block_on(sim.as_mut().next()).unwrap().unwrap());
        times.push(std::time::Instant::now() - t_start);
    }

    (res, times)
}

fn main() {
    let (results, times) = timed_pi(50);

    let set_times = vec![
        1, 2, 3, 4, 5, 10, 20, 30, 50, 80, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 10000,
    ];
    let len = &times.len();

    for this_time in set_times {
        if this_time <= *len {
            println!(
                "Finished {} counts in: {:?}",
                &this_time,
                times.get(this_time - 1).unwrap()
            );
        }
    }

    let last_state: &Rc<Vec<AgentState>> = results.last().unwrap();
    for agent in last_state.iter() {
        if let Some(_name) = &agent.agent_name {
            println!(
                "===========================\nEstimate for pi: {:}\n===========================",
                agent.custom.get("pi_estimate").unwrap()
            );
        }
    }
}
