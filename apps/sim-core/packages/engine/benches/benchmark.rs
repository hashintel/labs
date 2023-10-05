#[macro_use]
extern crate criterion;

#[macro_use]
extern crate serde_json;

use criterion::Criterion;

use futures::executor::block_on;
use futures::prelude::*;
use hashintel_core::cfg::SimulationConfig;
use hashintel_core::prelude::{
    create_simulation, DatasetMap, DefaultRuntime, Properties, SimulationState,
};

use serde_json::json;
use std::rc::Rc;

fn bench_neighbors(c: &mut Criterion) {
    c.bench_function("pile_of_agents", |b| {
        let mut initial_state = vec![];
        for _ in 0..50 {
            initial_state.push(
                json!({
                    "position": [1, 1],
                    "behaviors": vec!["random_movement"],
                })
                .into(),
            );
        }

        async fn __sim(initial_state: SimulationState) -> usize {
            let a: Vec<Rc<SimulationState>> = create_simulation(
                initial_state,
                Properties::empty(),
                DatasetMap::new(),
                vec![],
                vec![],
                SimulationConfig::server_serial(),
                DefaultRuntime::new(),
            )
            .take(100)
            .map(std::result::Result::unwrap)
            .collect::<Vec<Rc<SimulationState>>>()
            .await;

            a.len()
        }
        b.iter(|| block_on(__sim(initial_state.clone())))
    });
}

fn bench_long_behavior_chain(c: &mut Criterion) {
    c.bench_function("long_behavior_chain", |b| {
        let mut initial_state = vec![];
        let mut behaviors = vec![];
        for _ in 0..10 {
            behaviors.push("random_movement");
        }
        for _ in 0..50 {
            initial_state.push(
                json!({
                    "position": [1, 1],
                    "behaviors": behaviors,
                })
                .into(),
            );
        }

        async fn __sim(initial_state: SimulationState) -> usize {
            let a = create_simulation(
                initial_state,
                Properties::empty(),
                DatasetMap::new(),
                vec![],
                vec![],
                SimulationConfig::server_serial(),
                DefaultRuntime::new(),
            )
            .take(100)
            .map(std::result::Result::unwrap)
            .collect::<Vec<Rc<SimulationState>>>()
            .await;
            a.len()
        }

        b.iter(|| block_on(__sim(initial_state.clone())))
    });
}

// Configuration options buried a little, but find them here:
//  https://docs.rs/criterion/0.2.11/criterion/struct.Criterion.html
criterion_group! {
    name = benches;
    config = Criterion::default().sample_size(15);
    targets = bench_neighbors, bench_long_behavior_chain
}
criterion_main!(benches);
