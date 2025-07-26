#[macro_use]
extern crate serde_json;

use hash_types::message::GenericPayload;
use hashintel_core::behaviors::NamedBehavior;
use hashintel_core::cfg::SimulationConfig;
use hashintel_core::message_handlers::{
    MessageHandler, MessageHandlerResult, MessageHandlerResultData,
};
use hashintel_core::{
    prelude::{
        AgentState, Context, DatasetMap, DefaultRuntime, IncomingMessage, OutboundMessage,
        Properties, SimulationState, Vec3,
    },
    sim,
};

use futures::{future, stream::StreamExt};
use rand::Rng;
use std::collections::HashSet;
use std::rc::Rc;

async fn collect_simulation(
    initial_state: SimulationState,
    properties: Properties,
    custom_behaviors: Vec<NamedBehavior>,
    config: SimulationConfig,
    steps: usize,
) -> Vec<SimulationState> {
    collect_simulation_handlers(
        initial_state,
        properties,
        custom_behaviors,
        vec![],
        config,
        steps,
    )
    .await
}

async fn collect_simulation_handlers(
    initial_state: SimulationState,
    properties: Properties,
    custom_behaviors: Vec<NamedBehavior>,
    custom_handlers: Vec<MessageHandler>,
    config: SimulationConfig,
    steps: usize,
) -> Vec<SimulationState> {
    let result: Vec<Rc<SimulationState>> = sim::create_simulation(
        initial_state,
        properties,
        DatasetMap::new(),
        custom_behaviors,
        custom_handlers,
        config,
        DefaultRuntime::new(),
    )
    .take(steps)
    .map(std::result::Result::unwrap)
    .collect::<Vec<_>>()
    .await;

    result
        .into_iter()
        .map(|state| Rc::try_unwrap(state).unwrap())
        .collect()
}

async fn no_op(config: SimulationConfig) {
    let state_count = 500;
    let initial_state = std::iter::repeat(
        json!({
            "behaviors": Vec::<String>::new(),
        })
        .into(),
    )
    .take(state_count)
    .collect();
    collect_simulation(initial_state, Properties::empty(), vec![], config, 20).await;
}

#[tokio::test]
async fn no_op_parallel() {
    no_op(SimulationConfig::server_parallel()).await;
}

#[tokio::test]
async fn no_op_serial() {
    no_op(SimulationConfig::server_serial()).await;
}

#[tokio::test]
async fn agent_creation() {
    // a behavior should be able to create new agents
    const AGENTS: usize = 5;
    const STEPS: usize = 5;
    const CHILD_NUM: usize = 2;
    let last_iteration_child_count: usize = AGENTS * (CHILD_NUM + 1).pow(STEPS as u32 - 1);
    let mut initial_state = vec![];
    for _ in 0..AGENTS {
        initial_state.push(
            json!({
                "behaviors": vec!["creation"],
            })
            .into(),
        );
    }
    let creation = |state: &mut AgentState, _: &Context| {
        let create_agent_message = OutboundMessage::unchecked_from_json_value_with_state(
            json!({
                "to": ["HASH"],
                "type": "create_agent",
                "data": {
                    "behaviors": ["creation"]
                }
            }),
            &state,
        );
        std::iter::repeat(create_agent_message)
            .take(CHILD_NUM)
            .for_each(|msg| state.messages.push(msg));
        Ok(())
    };

    let custom_behaviors = vec![NamedBehavior::new("creation", creation, vec![])];

    let results = collect_simulation(
        initial_state,
        Properties::empty(),
        custom_behaviors,
        SimulationConfig::server_parallel(),
        STEPS,
    )
    .await;
    assert_eq!(results.last().unwrap().len(), last_iteration_child_count);
}

#[tokio::test]
async fn neighbors() {
    // a behavior should be able to create new agents
    const AGENTS: usize = 5;

    let mut initial_state = vec![];
    for id in 0..AGENTS {
        initial_state.push(
            json!({
                "name": "philbert",
                "agent_name":format!("philbert_{}", id),
                "behaviors": [],
                "position": [id, id]
            })
            .into(),
        );
    }
    initial_state.push(
        json!({
            "name": "chucky",
            "agent_name":format!("chucky_{}", 0),
            "behaviors": ["neighbor_check"],
            "position": [3, 3]
        })
        .into(),
    );

    let neighbor_check = |_state: &mut AgentState, context: &Context| {
        let neighbors = &context.neighbors;

        // I'm at [3,3], so I should have 3 neighbors.
        assert_eq!(neighbors.len(), 3);
        // ...all named philbert.
        for neighbor in neighbors {
            assert_eq!(neighbor.get_as_json("name").unwrap(), json!("philbert"))
        }

        Ok(())
    };

    let custom_behaviors = vec![NamedBehavior::new("neighbor_check", neighbor_check, vec![])];

    collect_simulation(
        initial_state,
        Properties::from_json_unchecked(json!({
            "topology":{
                "distance_function":"chebyshev",
                "search_radius":1
            }
        })),
        custom_behaviors,
        SimulationConfig::server_parallel(),
        3,
    )
    .await;
}

#[tokio::test]
async fn neighbor_removal() {
    // a removed agent shouldn't be a neighbor
    const AGENTS: usize = 5;

    let mut initial_state = vec![];
    for id in 0..AGENTS {
        initial_state.push(
            json!({
                "agent_id": id,
                "name": "philbert",
                "agent_name":format!("philbert_{}", id),
                "behaviors": [],
                "position": [id, id]
            })
            .into(),
        );
    }
    initial_state.push(
        json!({
            "name": "chucky",
            "agent_name":format!("chucky_{}", 0),
            "behaviors": ["neighbor_check"],
            "position": [3, 3],
            "messages": [{"type": "remove_agent", "to": ["HASH"], "data": {"agent_id": "2"}}]
        })
        .into(),
    );

    let neighbor_check = |_state: &mut AgentState, context: &Context| {
        let neighbors = &context.neighbors;

        // I'm at [3,3], so I should have 3 neighbors minus 1 deleted one is 2.
        assert_eq!(neighbors.len(), 2);
        // ...all named philbert.
        for neighbor in neighbors {
            assert_eq!(neighbor.get_as_json("name").unwrap(), json!("philbert"))
        }

        Ok(())
    };

    let custom_behaviors = vec![NamedBehavior::new("neighbor_check", neighbor_check, vec![])];

    let results = collect_simulation(
        initial_state,
        Properties::from_json_unchecked(json!({
            "topology":{
                "distance_function":"chebyshev",
                "search_radius":1
            }
        })),
        custom_behaviors,
        SimulationConfig::server_parallel(),
        3,
    )
    .await;

    for agents in results {
        assert_eq!(agents.len(), 5);
    }
}

#[tokio::test]
async fn agent_uuid_assignment() {
    // An agent without an agent_id gets a new UUID assigned to it.
    const AGENTS: usize = 2;

    let mut initial_state = vec![];
    for _ in 0..AGENTS {
        initial_state.push(AgentState::default());
    }

    let results = collect_simulation(
        initial_state,
        Properties::empty(),
        vec![],
        SimulationConfig::server_parallel(),
        2,
    )
    .await;

    // They get set immediately
    assert_ne!(results[0][0].agent_id, json!(null));
    assert_ne!(results[0][1].agent_id, json!(null));
    // ...and they're different values
    assert_ne!(results[1][0].agent_id, results[1][1].agent_id);
    // And they stay the same through steps
    assert_eq!(results[1][0].agent_id, results[0][0].agent_id);
    assert_eq!(results[1][1].agent_id, results[0][1].agent_id);
}

#[tokio::test]
async fn agent_uuid_preservation() {
    // existing agent ids are preserved
    let mut initial_state = vec![];
    initial_state.push(json!({"agent_id": 1}).into());
    initial_state.push(json!({"agent_id": "fishcakes"}).into());
    initial_state.push(json!({}).into());

    let results = collect_simulation(
        initial_state,
        Properties::empty(),
        vec![],
        SimulationConfig::server_parallel(),
        1,
    )
    .await;

    // We only preserve strings
    assert_eq!(results[0][0].agent_id, "1");
    assert_eq!(results[0][1].agent_id, "fishcakes");
    // and we also backfill missing ids
    assert_eq!(results[0][2].agent_id.len(), 36); // length of uuid
}

#[tokio::test]
async fn implicit_agent_destruction() {
    // a behavior should be able to create new agents
    const AGENTS: usize = 5;

    let mut initial_state = Vec::with_capacity(AGENTS);
    for _ in 0..AGENTS {
        initial_state.push(
            json!({
                "behaviors": ["death"],
            })
            .into(),
        );
    }

    let death = |state: &mut AgentState, _: &Context| {
        let message = OutboundMessage::unchecked_from_json_value_with_state(
            json!({"type": "remove_agent"}),
            &state,
        );
        state.messages.push(message);

        Ok(())
    };

    let custom_behaviors = vec![NamedBehavior::new("death", death, vec![])];

    let results = collect_simulation(
        initial_state,
        Properties::empty(),
        custom_behaviors,
        SimulationConfig::server_parallel(),
        2,
    )
    .await;

    assert_eq!(results[0].len(), AGENTS);
    assert_eq!(results[1].len(), 0);
}

#[tokio::test]
async fn agent_destruction() {
    // a behavior should be able to create new agents
    const AGENTS: usize = 5;

    let mut initial_state = vec![];
    for _ in 0..AGENTS {
        initial_state.push(
            json!({
                "behaviors": ["death"],
            })
            .into(),
        );
    }
    let death = |state: &mut AgentState, _: &Context| {
        let message = OutboundMessage::unchecked_from_json_value_with_state(
            json!({
                "to": ["hash"],
                "type": "remove_agent",
                "data": {
                    "agent_id": state.agent_id
                }
            }),
            &state,
        );
        state.messages.push(message);

        Ok(())
    };

    let custom_behaviors = vec![NamedBehavior::new("death", death, vec![])];

    let results = collect_simulation(
        initial_state,
        Properties::empty(),
        custom_behaviors,
        SimulationConfig::server_parallel(),
        2,
    )
    .await;

    assert_eq!(results[0].len(), AGENTS);
    assert_eq!(results[1].len(), 0);
}

#[tokio::test]
async fn random_movement() {
    const AGENTS: usize = 5;
    const STEP_SIZE: f64 = 10.0;

    let mut positions: Vec<Vec3> = (0..AGENTS)
        .map(|_| [rand::random::<f64>(), rand::random::<f64>()].into())
        .collect();

    let mut initial_state = vec![];
    for i in 0..AGENTS {
        initial_state.push(
            json!({
                "position": positions[i].as_ref(),
                "behaviors": vec!["random_movement"],
                "random_movement_step_size": STEP_SIZE,
            })
            .into(),
        );
    }

    let results = collect_simulation(
        initial_state,
        Properties::empty(),
        vec![],
        SimulationConfig::server_parallel(),
        50,
    )
    .await;

    for agents in results {
        for (i, agent) in agents.iter().enumerate() {
            let position = agent.position.expect("Agent should have position");
            if positions[i] != position {
                let eps = 1.0e-6;
                assert!((positions[i][0] - position[0]).abs() - eps <= STEP_SIZE);
                assert!((positions[i][1] - position[1]).abs() - eps <= STEP_SIZE);
                positions[i] = position;
            }
        }
    }
}

#[tokio::test]
async fn random_min_movement() {
    const AGENTS: usize = 30;

    let mut initial_state = vec![];
    for _ in 0..AGENTS {
        initial_state.push(
            json!({
                "position": [rand::random::<i64>(), rand::random::<i64>()],
                "behaviors": vec!["random_movement"],
                "random_movement_seek_min_neighbors": 2,
            })
            .into(),
        );
    }

    collect_simulation(
        initial_state,
        Properties::empty(),
        vec![],
        SimulationConfig::server_parallel(),
        50,
    )
    .await;
}

#[tokio::test]
async fn messages() {
    const AGENTS: usize = 5;

    let mut initial_state = vec![];
    for id in 0..AGENTS {
        initial_state.push(
            json!({
                "agent_id": id,
                "friend_id": (id + 1) % AGENTS,
                "position": [rand::random::<i64>(), rand::random::<i64>()],
                "behaviors": ["message_move"],
            })
            .into(),
        );
    }

    use std::convert::TryInto;
    let message_move = |state: &mut AgentState, context: &Context| {
        // Check my messages and follow the movement instructions.
        let position = state.get_pos_mut()?;

        for message in &context.messages {
            let mod_position: Vec3 = message.data()["position"].clone().try_into()?;
            position[0] += mod_position[0];
            position[1] += mod_position[1];
        }

        // Then, send friend a message to move in a direction.
        let friend_id = state
            .get_as_json("friend_id")
            .unwrap()
            .as_u64()
            .ok_or("Expected 'friend_id' in agent state")?;

        let message = OutboundMessage::unchecked_from_json_value_with_state(
            json!({
                "to": friend_id,
                "data" : {
                    "position": [
                        rand::thread_rng().gen_range(-1, 2),
                        rand::thread_rng().gen_range(-1, 2),
                    ]
                },
                "type": "move",
            }),
            &state,
        );
        state.messages.push(message);

        Ok(())
    };

    let custom_behaviors = vec![NamedBehavior::new(
        "message_move",
        message_move,
        vec!["friend_id", "position"],
    )];

    collect_simulation(
        initial_state,
        Properties::empty(),
        custom_behaviors,
        SimulationConfig::server_parallel(),
        50,
    )
    .await;
}

#[tokio::test]
async fn messages_cleaned_up() {
    const AGENTS: usize = 5;

    let mut initial_state = vec![];
    for id in 0..AGENTS {
        initial_state.push(
            json!({
                "agent_id": id,
                "messages":[{
                    "to": (id + 1) % AGENTS,
                    "data": {
                        "sample": "data"
                    },
                    "type": "sample"
                }]
            })
            .into(),
        );
    }
    let results = collect_simulation(
        initial_state,
        Properties::empty(),
        vec![],
        SimulationConfig::server_parallel(),
        1,
    )
    .await;

    let sample = &results[0][0];
    // No longer has outbound messages.
    assert_eq!(sample.messages.len(), 0);
}

#[tokio::test]
async fn child_creation_messages() {
    const PARENT_NAME: &str = "parent";

    let initial_state = vec![json!({
        "agent_name": PARENT_NAME,
        "behaviors": vec!["creation"],
    })
    .into()];

    let creation = |state: &mut AgentState, _: &Context| {
        let message = OutboundMessage::unchecked_from_json_value_with_state(
            json!({
                "to": ["hash"],
                "type": "create_agent",
                "data": {
                    "messages": [{
                        "to": [PARENT_NAME],
                        "data": {},
                        "type": "message_test"
                    }],
                    "behaviors": ["creation"]
                }
            }),
            &state,
        );
        state.messages.push(message);

        Ok(())
    };

    let custom_behaviors = vec![NamedBehavior::new("creation", creation, vec![])];

    let results = collect_simulation(
        initial_state,
        Properties::empty(),
        custom_behaviors,
        SimulationConfig::server_parallel(),
        1,
    )
    .await;

    assert_eq!(results[0][0].messages.len(), 1_usize);
}

#[tokio::test]
async fn conway_lib() {
    /*
        my environment is 2d
        my size is NxM
        adjacency is defined

        I have agents in the environment, in this case one per cell
        each agent has its location,
        a state (for GoL, we use alive/dead)
        and a step.  Step needs current state plus neighbors, it outputs state; doesn't modify neighbors.

    */

    const WIDTH: usize = 20;
    const HEIGHT: usize = 20;
    const CONWAY_STEPS: usize = 30;

    let mut initial_state = vec![];
    for id in 0..WIDTH * HEIGHT {
        initial_state.push(
            json!({
                "agent_id": id,
                "position": [id % WIDTH, id / WIDTH],
                "alive": rand::random::<bool>(),
                "behaviors": vec!["conway"],
            })
            .into(),
        );
    }

    collect_simulation(
        initial_state,
        Properties::empty(),
        vec![],
        SimulationConfig::server_parallel(),
        CONWAY_STEPS,
    )
    .await;
}

#[tokio::test]
async fn increment_age() {
    const AGENTS: usize = 5;
    const STEPS: usize = 50;

    let mut initial_state = vec![];

    //age initialized
    for _ in 0..AGENTS {
        initial_state.push(
            json!({
                "age": 0,
                "behaviors": vec!["age"],
            })
            .into(),
        );
    }

    //age not initialized
    for _ in 0..AGENTS {
        initial_state.push(
            json!({
                "behaviors": vec!["age"],
            })
            .into(),
        );
    }

    let results = collect_simulation(
        initial_state,
        Properties::empty(),
        vec![],
        SimulationConfig::server_parallel(),
        STEPS,
    )
    .await;

    for agents in results.last() {
        for agent in agents {
            assert_eq!(agent.get_as_json("age").unwrap(), STEPS);
        }
    }
}

#[tokio::test]
async fn increment_age_hash_behaviors() {
    const AGENTS: usize = 5;
    const STEPS: usize = 50;

    let mut initial_state = vec![];

    //age initialized
    for _ in 0..AGENTS {
        initial_state.push(
            json!({
                "age": 0,
                "behaviors": vec!["@hash/age.rs"],
            })
            .into(),
        );
    }

    //age not initialized
    for _ in 0..AGENTS {
        initial_state.push(
            json!({
                "behaviors": vec!["@hash/age.rs"],
            })
            .into(),
        );
    }

    let results = collect_simulation(
        initial_state,
        Properties::empty(),
        vec![],
        SimulationConfig::server_parallel(),
        STEPS,
    )
    .await;

    for agents in results.last() {
        for agent in agents {
            assert_eq!(agent.get_as_json("age").unwrap(), STEPS);
        }
    }
}

#[tokio::test]
async fn diffusion_single() {
    const WIDTH: usize = 10;
    const HEIGHT: usize = 10;
    const STEPS: usize = 50;

    let mut initial_state = vec![];
    for id in 0..WIDTH * HEIGHT {
        initial_state.push(
            json!({
                "agent_id": id,
                "position": [id % WIDTH, id / WIDTH],
                "height": rand::thread_rng().gen_range(0, 50),
                "diffusion_targets": ["height"],
                "diffusion_coef": 0.1,
                "behaviors": vec!["diffusion"],
            })
            .into(),
        );
    }

    collect_simulation(
        initial_state,
        Properties::empty(),
        vec![],
        SimulationConfig::server_parallel(),
        STEPS,
    )
    .await;
}

#[tokio::test]
async fn diffusion_array() {
    const WIDTH: usize = 10;
    const HEIGHT: usize = 10;
    const STEPS: usize = 50;

    let mut initial_state = vec![];
    for id in 0..WIDTH * HEIGHT {
        initial_state.push(json!({
            "agent_id": id,
            "position": [id % WIDTH, id / WIDTH],
            "rgb": [rand::thread_rng().gen_range(0, 256), rand::thread_rng().gen_range(0, 256), rand::thread_rng().gen_range(0, 256)],
            "diffusion_targets": ["rgb"],
            "behaviors": vec!["diffusion"],
        }).into());
    }

    collect_simulation(
        initial_state,
        Properties::empty(),
        vec![],
        SimulationConfig::server_parallel(),
        STEPS,
    )
    .await;
}

#[tokio::test]
async fn diffusion_stability() {
    const WIDTH: usize = 10;
    const HEIGHT: usize = 10;
    const STEPS: usize = 50;

    let mut initial_state = vec![];
    for id in 0..WIDTH * HEIGHT {
        initial_state.push(
            json!({
                "agent_id": id,
                "position": [id % WIDTH, id / WIDTH],
                "height": 1,
                "diffusion_targets": ["height"],
                "behaviors": vec!["diffusion"],
            })
            .into(),
        );
    }

    let results = collect_simulation(
        initial_state,
        Properties::empty(),
        vec![],
        SimulationConfig::server_parallel(),
        STEPS,
    )
    .await;

    for agents in results.last() {
        for agent in agents {
            assert_eq!(agent.get_as_json("height").unwrap(), 1.0);
        }
    }
}

#[tokio::test]
async fn orient_toward_value() {
    const WIDTH: usize = 20;
    const HEIGHT: usize = 20;
    const STEPS: usize = 30;
    const AREA: usize = WIDTH * HEIGHT;

    let mut initial_state = vec![];
    for id in 0..AREA {
        let sugar = rand::thread_rng().gen_range(0, 25);
        initial_state.push(
            json!({
                "agent_id": id,
                "position": [id % WIDTH, id / WIDTH],
                "sugar": sugar,
            })
            .into(),
        );
    }

    for id in AREA..(AREA + 100) {
        initial_state.push(
            json!({
                "agent_id": id,
                "position": [
                    rand::thread_rng().gen_range(0, WIDTH),
                    rand::thread_rng().gen_range(0, WIDTH),
                ],
                "orient_toward_value": "sugar",
                "sugar": 0,
                "color": "blue",
                "behaviors": ["orient_toward_value", "move_in_direction"],
            })
            .into(),
        );
    }

    for id in (AREA + 100)..(AREA + 120) {
        initial_state.push(
            json!({
                "agent_id": id,
                "position": [
                    rand::thread_rng().gen_range(0, WIDTH),
                    rand::thread_rng().gen_range(0, WIDTH),
                ],
                "sugar": 0,
                "color": "red",
                "behaviors": ["orient_toward_value", "move_in_direction"],
            })
            .into(),
        );
    }

    collect_simulation(
        initial_state,
        Properties::empty(),
        vec![],
        SimulationConfig::server_parallel(),
        STEPS,
    )
    .await;
}

#[tokio::test]
async fn reproduce() {
    const AGENTS: usize = 5;
    const STEPS: usize = 5;
    const REPRODUCTION_RATE: f64 = 2.5;

    let mut initial_state = vec![];
    for _ in 0..AGENTS {
        initial_state.push(
            json!({
                "reproduction_rate": REPRODUCTION_RATE,
                "reproduction_child_values": json!({"age": 0}),
                "behaviors": vec!["reproduce", "age"],
            })
            .into(),
        );
    }

    let results = collect_simulation(
        initial_state,
        Properties::empty(),
        vec![],
        SimulationConfig::server_parallel(),
        STEPS,
    )
    .await;

    for (i, agents) in results.into_iter().enumerate() {
        assert!(agents.len() >= AGENTS * (REPRODUCTION_RATE as usize + 1).pow(i as u32));
        assert!(agents.len() <= AGENTS * ((REPRODUCTION_RATE + 1.0) as usize + 1).pow(i as u32));
    }
}

#[tokio::test]
async fn orient_toward_value_downhill() {
    const WIDTH: usize = 20;
    const HEIGHT: usize = 20;
    const STEPS: usize = 30;
    const AREA: usize = WIDTH * HEIGHT;

    let mut initial_state = vec![];
    for id in 0..AREA {
        let sugar = rand::thread_rng().gen_range(0, 25);
        initial_state.push(
            json!({
                "agent_id": id,
                "position": [id % WIDTH, id / WIDTH],
                "sugar": sugar,
            })
            .into(),
        );
    }

    for id in AREA..(AREA + 100) {
        initial_state.push(
            json!({
                "agent_id": id,
                "position": [
                    rand::thread_rng().gen_range(0, WIDTH),
                    rand::thread_rng().gen_range(0, WIDTH),
                ],
                "orient_toward_value": "sugar",
                "sugar": 0,
                "orient_toward_value_uphill": false,
                "color": "blue",
                "behaviors": vec!["orient_toward_value", "move_in_direction"],
            })
            .into(),
        );
    }

    for id in (AREA + 100)..(AREA + 120) {
        initial_state.push(
            json!({
                "agent_id": id,
                "position": [
                    rand::thread_rng().gen_range(0, WIDTH),
                    rand::thread_rng().gen_range(0, WIDTH),
                ],
                "sugar": 0,
                "color": "red",
                "behaviors": vec!["orient_toward_value", "move_in_direction"],
            })
            .into(),
        );
    }

    collect_simulation(
        initial_state,
        Properties::empty(),
        vec![],
        SimulationConfig::server_parallel(),
        STEPS,
    )
    .await;
}

#[tokio::test]
async fn decay() {
    const WIDTH: usize = 10;
    const HEIGHT: usize = 10;
    const STEPS: usize = 50;

    let mut initial_state = vec![];
    for id in 0..WIDTH * HEIGHT {
        initial_state.push(
            json!({
                "agent_id": id,
                "position": [id % WIDTH, id / WIDTH],
                "decay_chance": 0.03,
                "behaviors": vec!["decay"],
            })
            .into(),
        );
    }

    collect_simulation(
        initial_state,
        Properties::empty(),
        vec![],
        SimulationConfig::server_parallel(),
        STEPS,
    )
    .await;
}

#[tokio::test]
async fn increment_counter() {
    const AGENTS: usize = 2;
    const STEPS: usize = 50;
    const COUNTER_START: usize = 5;
    const COUNTER_RESET_TO: usize = 10;
    const COUNTER_RESET_AT: usize = 20;

    let mut initial_state = vec![];

    for _ in 0..AGENTS {
        initial_state.push(
            json!({
                "counter_reset_at": COUNTER_RESET_AT,
                "counter_reset_to": COUNTER_RESET_TO,
                "counter": COUNTER_START,
                "behaviors": vec!["counter"],
            })
            .into(),
        );
    }

    let results = collect_simulation(
        initial_state,
        Properties::empty(),
        vec![],
        SimulationConfig::server_parallel(),
        STEPS,
    )
    .await;

    for (i, agents) in results.into_iter().enumerate() {
        let target = if i < COUNTER_RESET_AT - COUNTER_START {
            COUNTER_START + i + 1
        } else {
            (i - (COUNTER_RESET_AT - COUNTER_START))
                .rem_euclid(COUNTER_RESET_AT - COUNTER_RESET_TO + 1)
                + COUNTER_RESET_TO
        };
        for agent in agents {
            assert_eq!(agent.get_custom::<f64>("counter"), Some(target as f64));
        }
    }
}

#[tokio::test]
async fn decrement_counter() {
    const AGENTS: usize = 2;
    const STEPS: usize = 50;
    const COUNTER_START: i64 = 10;
    const COUNTER_RESET_TO: i64 = -5;
    const COUNTER_RESET_AT: i64 = -20;

    let mut initial_state = vec![];

    for _ in 0..AGENTS {
        initial_state.push(
            json!({
                "counter": COUNTER_START,
                "counter_increment": -1,
                "counter_reset_at": COUNTER_RESET_AT,
                "counter_reset_to": COUNTER_RESET_TO,
                "behaviors": vec!["counter"],
            })
            .into(),
        );
    }

    let results = collect_simulation(
        initial_state,
        Properties::empty(),
        vec![],
        SimulationConfig::server_parallel(),
        STEPS,
    )
    .await;

    for (i, agents) in results.into_iter().enumerate() {
        let target = if (i as i64) < COUNTER_START - COUNTER_RESET_AT {
            COUNTER_START - i as i64 - 1
        } else {
            COUNTER_RESET_TO
                - (i as i64 - (COUNTER_START - COUNTER_RESET_AT))
                    .rem_euclid(COUNTER_RESET_TO - COUNTER_RESET_AT + 1) as i64
        };
        for agent in agents {
            assert_eq!(agent.get_custom::<f64>("counter"), Some(target as f64));
        }
    }
}

#[tokio::test]
async fn _test_stream() {
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

    let a = sim::create_simulation(
        initial_state.clone(),
        Properties::empty(),
        DatasetMap::new(),
        vec![],
        vec![],
        SimulationConfig::server_parallel(),
        DefaultRuntime::new(),
    )
    .take(100)
    .map(std::result::Result::unwrap)
    .collect::<Vec<Rc<SimulationState>>>()
    .await;

    assert_eq!(a.len(), 100);
}

#[tokio::test]
async fn boundary() {
    const AGENTS: usize = 5;
    const STEPS: usize = 50;
    const WIDTH: i32 = 2;
    const HEIGHT: i32 = 3;

    let mut initial_state = vec![];

    for _ in 0..AGENTS {
        initial_state.push(
            json!({
                "position": [
                    rand::thread_rng().gen_range(0, WIDTH),
                    rand::thread_rng().gen_range(0, HEIGHT),
                ],
                "behaviors": vec!["random_movement"],
            })
            .into(),
        );
    }

    let results = collect_simulation(
        initial_state,
        Properties::from_json_unchecked(
            json!({"topology": {"x_bounds": [0, WIDTH], "y_bounds": [0, HEIGHT]}}),
        ),
        vec![],
        SimulationConfig::server_parallel(),
        STEPS,
    )
    .await;

    for agents in results {
        for agent in agents {
            assert!(agent.get_pos().unwrap().x() >= f64::from(0));
            assert!(agent.get_pos().unwrap().x() <= f64::from(WIDTH - 1));
            assert!(agent.get_pos().unwrap().y() >= f64::from(0));
            assert!(agent.get_pos().unwrap().y() <= f64::from(HEIGHT - 1));
        }
    }
}

#[tokio::test]
async fn remove_self() {
    const AGENTS: usize = 1;
    const STEPS: usize = 2;

    let mut initial_state = vec![];
    for _ in 0..AGENTS {
        initial_state.push(
            json!({
                "behaviors": vec!["remove_self"],
            })
            .into(),
        );
    }

    let results = collect_simulation(
        initial_state,
        Properties::empty(),
        vec![],
        SimulationConfig::server_parallel(),
        STEPS,
    )
    .await;

    assert_eq!(results[0].len(), AGENTS);
    assert_eq!(results[1].len(), 0);
}

#[tokio::test]
async fn create_agents() {
    const AGENTS: usize = 1;
    const STEPS: usize = 2;

    let mut initial_state = vec![];
    for _ in 0..AGENTS {
        initial_state.push(
            json!({
                "behaviors": vec!["create_agents", "remove_self"],
                "agents": {"new": [{ "behaviors": ["age"], "color": "blue"}]}
            })
            .into(),
        );
    }

    let results = collect_simulation(
        initial_state,
        Properties::empty(),
        vec![],
        SimulationConfig::server_parallel(),
        STEPS,
    )
    .await;

    assert_eq!(results[0].len(), AGENTS);
    assert_eq!(results[1].len(), 1);

    for agent in &results[1] {
        assert_eq!(agent.get_as_json("color").unwrap(), "blue");
        assert_eq!(agent.behaviors, vec!["age"]);
    }
}

#[tokio::test]
async fn create_grids() {
    const AGENTS: usize = 1;
    const STEPS: usize = 2;

    let mut initial_state = vec![];
    for _ in 0..AGENTS {
        initial_state.push(
            json!({
                "behaviors": vec!["create_grids", "create_agents", "remove_self"],
                "grid_templates": [{
                    "template_name": "shops",
                    "height": 2,
                    "color": "blue"
                  }],
                "agents": {}
            })
            .into(),
        );
    }

    let results = collect_simulation(
        initial_state,
        Properties::from_json_unchecked(json!({
            "topology":{
                "x_bounds": [0,10],
                "y_bounds": [0, 10],
                "search_radius":1
            }
        })),
        vec![],
        SimulationConfig::server_parallel(),
        STEPS,
    )
    .await;

    assert_eq!(results[0].len(), AGENTS);
    assert_eq!(results[1].len(), 100);

    for (ind, agent) in results[1].iter().enumerate() {
        assert_eq!(agent.get_as_json("color").unwrap(), "blue");
        assert_eq!(agent.get_as_json("height").unwrap(), json!(2.0));
        assert_eq!(agent.get_pos().unwrap().x(), (ind % 10) as f64);
        assert_eq!(agent.get_pos().unwrap().y(), (ind / 10) as f64);
    }
}

#[tokio::test]
async fn create_stacks() {
    const AGENTS: usize = 1;
    const STEPS: usize = 2;

    let mut initial_state = vec![];
    for _ in 0..AGENTS {
        initial_state.push(
            json!({
                "behaviors": vec!["create_stacks", "create_agents", "remove_self"],
                "stack_templates": [{
                    "template_name": "shops",
                    "template_count": 10,
                    "template_position": "center",
                    "color": "green"
                  }],
                "agents": {}
            })
            .into(),
        );
    }

    let results = collect_simulation(
        initial_state,
        Properties::from_json_unchecked(json!({
            "topology":{
                "x_bounds": [0,10],
                "y_bounds": [0, 10],
                "search_radius":1
            }
        })),
        vec![],
        SimulationConfig::server_parallel(),
        STEPS,
    )
    .await;

    assert_eq!(results[0].len(), AGENTS);
    assert_eq!(results[1].len(), 10);

    for agent in &results[1] {
        assert_eq!(agent.get_as_json("color").unwrap(), "green");
        assert_eq!(agent.get_pos().unwrap().x(), 5_f64);
        assert_eq!(agent.get_pos().unwrap().y(), 5_f64);
    }
}

#[tokio::test]
async fn create_scatters() {
    const AGENTS: usize = 1;
    const STEPS: usize = 2;

    let mut initial_state = vec![];
    for _ in 0..AGENTS {
        initial_state.push(
            json!({
                "behaviors": vec!["create_scatters", "create_agents", "remove_self"],
                "scatter_templates": [{
                    "template_name": "shops",
                    "template_count": 10,
                    "color": "green",
                    "height": 2,
                  }],
                "agents": {}
            })
            .into(),
        );
    }

    let results = collect_simulation(
        initial_state,
        Properties::from_json_unchecked(json!({
            "topology":{
                "x_bounds": [0,10],
                "y_bounds": [0, 10],
                "search_radius":1
            }
        })),
        vec![],
        SimulationConfig::server_parallel(),
        STEPS,
    )
    .await;

    assert_eq!(results[0].len(), AGENTS);
    assert_eq!(results[1].len(), 10);

    for agent in &results[1] {
        assert_eq!(agent.get_as_json("color").unwrap(), "green");
        assert_eq!(agent.get_as_json("height").unwrap(), json!(2.0))
    }
}

#[tokio::test]
async fn message_handler_message_sending() {
    // a behavior should receive messages sent by a message handler
    let initial_state = vec![json!({
      "agent_id": "xyz",
      "behaviors": vec!["receive"],
      "messages": vec![json!({
        "to": ["sender"],
        "type": "test",
        "data": json!({})
      })]
    })
    .into()];

    let receive = |state: &mut AgentState, context: &Context| {
        state
            .set(
                "received",
                json!(context.messages.iter().fold(false, |v: bool, m| {
                    if let OutboundMessage::Generic(message) = &m.message {
                        if let Some(data) = &message.data {
                            return data["received"].as_bool().unwrap() || v;
                        }
                    }
                    false
                })),
            )
            .ok();
        state.messages = vec![OutboundMessage::new(GenericPayload {
            to: vec!["sender".to_string()],
            r#type: "test".to_string(),
            data: None,
        })];
        Ok(())
    };

    let custom_behaviors = vec![NamedBehavior::new("receive", receive, vec![])];

    let send_message = Box::pin(
        move |_agents: &[AgentState],
              _message_map: &[IncomingMessage],
              _properties: &Properties,
              _config: &SimulationConfig| {
            future::ready::<MessageHandlerResult>(Ok(MessageHandlerResultData {
                removed: HashSet::new(),
                added: vec![],
                messages: vec![IncomingMessage {
                    from: "sender".to_string(),
                    message: OutboundMessage::new(GenericPayload {
                        r#type: "sender".to_string(),
                        to: vec!["xyz".to_string()],
                        data: Some(json!({"received": true})),
                    }),
                }],
            }))
        },
    );

    let custom_handlers = vec![MessageHandler::new("sender", send_message)];

    let results = collect_simulation_handlers(
        initial_state,
        Properties::from_json_unchecked(json!({
            "messageHandlers":["sender"]
        })),
        custom_behaviors,
        custom_handlers,
        SimulationConfig::server_parallel(),
        8,
    )
    .await;
    assert_eq!(results.last().unwrap()[0].custom["received"], true);
}
