#[macro_use]
extern crate serde_json;

use futures::executor::block_on;
use futures::stream::StreamExt;
use hashintel_core::{
    cfg::SimulationConfig,
    prelude::{
        create_simulation, AgentState, DatasetMap, DefaultRuntime, Properties, SimulationResult,
        SimulationState,
    },
};
use rand::Rng;
use std::rc::Rc;

fn main() {
    // Let's test out an experiment.
    // Here's the question: for a given starting population,
    // what reproduction rate gets us closest to a target population
    // after a given number of steps?
    let starting_agents = 5;
    let target_agents = 15000;
    let steps = 50;

    println!("The question: Given {} starting agents, what reproduction rate will cause us to have a population closest to {} agents after {} steps?", starting_agents, target_agents, steps);

    // Let's start simple- guess and check.
    println!("Guess & Check");
    let res = reproduce(starting_agents, steps, 0.2);
    let result = block_on(res);
    println!(
        "After guessing a reproduction rate of {}, we found a population of {}",
        0.2, result
    );

    // Cool, that was too high.  Let's try again.
    let res = reproduce(starting_agents, steps, 0.1);
    let result = block_on(res);
    println!(
        "After guessing a reproduction rate of {}, we found a population of {}",
        0.1, result
    );
    // And that's too low.

    // Ok, let's let our computer help us out.
    // Since we've figured out a range of values, let's sweep through that range and see what we find:
    println!("Parameter Sweep");
    let sweep_min = 0.1;
    let sweep_max = 0.2;
    let sweep_increment = 0.001;
    let (best_guess, best_result) = parameter_sweep(
        sweep_min,
        sweep_max,
        sweep_increment,
        target_agents,
        starting_agents,
        steps,
    );

    println!("After sweeping values, our best find is a reproduction rate of {} yielding a population of {}", best_guess, best_result);

    // Ok cool, let's try again but instead use monte-carlo.
    // We need to specify a range of values to test within:
    let mc_min = 0.1;
    let mc_max = 0.2;

    // And we need to specify how many tests to run
    let mc_iters = 200;
    println!("Monte-Carlo ({} iterations)", mc_iters);

    let (best_guess, best_result) = monte_carlo(
        mc_min,
        mc_max,
        mc_iters,
        target_agents,
        starting_agents,
        steps,
    );
    println!("After running monte-carlo, our best find is a reproduction rate of {} yielding a population of {}", best_guess, best_result);
}

fn parameter_sweep(
    min: f32,
    max: f32,
    increment: f32,
    target_agents: usize,
    starting_agents: usize,
    steps: usize,
) -> (f32, usize) {
    let mut val = min;
    let mut best_guess = val;
    let mut best_difference = usize::max_value();
    let mut best_result = 0;
    while val < max {
        let pop = reproduce(starting_agents, steps, val);
        let population = block_on(pop);
        let difference = absolute_difference(target_agents, population);
        if difference < best_difference {
            best_guess = val;
            best_difference = difference;
            best_result = population;
        }

        val += increment;
    }

    (best_guess, best_result)
}

fn monte_carlo(
    min: f32,
    max: f32,
    iterations: usize,
    target_agents: usize,
    starting_agents: usize,
    steps: usize,
) -> (f32, usize) {
    let mut best_guess = 0.0;
    let mut best_difference = usize::max_value();
    let mut best_result = 0;

    let mut rng = rand::thread_rng();

    for _ in 0..iterations {
        // Generate a random value between min and max.
        // Rust defaults to a uniform distribution,
        // though we can choose normal, standard, etc. as desired.
        let val = rng.gen_range(min, max);

        let population = block_on(reproduce(starting_agents, steps, val));
        let difference = absolute_difference(target_agents, population);
        if difference < best_difference {
            best_guess = val;
            best_difference = difference;
            best_result = population;
        }
    }

    (best_guess, best_result)
}

async fn reproduce(starting_agents: usize, steps: usize, rate: f32) -> usize {
    // println!("Running simulation with rate of {}", rate);

    // Generate initial world state:
    let mut initial_state: Vec<AgentState> = vec![];
    for _ in 0..starting_agents {
        initial_state.push(
            json!({
                "reproduction_rate": rate,
                "behaviors": vec!["reproduce"],
            })
            .into(),
        );
    }
    let initial_state = initial_state;

    // Ditto behaviors
    let behaviors = vec![];

    let result: Vec<SimulationResult<Rc<SimulationState>>> = create_simulation(
        initial_state,
        // Configure simulation properties
        // (we don't have any for this simple case, but can use this space to define
        // global config values for agent behaviors to reference, as well as define simulation
        // parameters like topologies)
        Properties::empty(),
        DatasetMap::new(),
        behaviors,
        vec![],
        SimulationConfig::server_parallel(),
        DefaultRuntime::new(),
    )
    .take(steps)
    .collect::<Vec<_>>()
    .await;

    let result: Vec<Rc<SimulationState>> =
        result.iter().map(|r| r.as_ref().unwrap().clone()).collect();

    let population: usize = if let Some(last) = result.into_iter().last() {
        last.len()
    } else {
        0
    };

    // println!("Agent population at step {}: {}", steps, population);
    population
}

fn absolute_difference(a: usize, b: usize) -> usize {
    if a > b {
        a - b
    } else {
        b - a
    }
}
