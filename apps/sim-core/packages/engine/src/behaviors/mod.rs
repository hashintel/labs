use crate::{
    cfg,
    prelude::{AgentState, Context, DatasetMap, Properties, SimulationResult, TopologyConfig},
};
use lazy_static::lazy_static;
use serde::Deserialize;
use std::collections::HashMap;

pub mod action;
pub mod age;
pub mod collision;
pub mod control;
pub mod conway;
pub mod counter;
pub mod create_agents;
pub mod create_grids;
pub mod create_scatters;
pub mod create_stacks;
pub mod decay;
pub mod diffusion;
pub mod forces;
pub mod gravity;
pub mod move_in_direction;
pub mod orient_toward_value;
pub mod physics;
pub mod random_away_movement;
pub mod random_movement;
pub mod remove_self;
pub mod reproduce;
pub mod spring;
pub mod update_q;
pub mod viral_spread;

// Ok cool, so then what's an _agent_?
// Well, its state is external, and that state _also describes_ its behaviors.
// So an Agent, then, is a thing which takes agent state, applies is behaviors,
// then returns its new state and any messages it wishes to send.
// ...so what's a behavior: WELL,
// A behavior is a function!
// An an agent is a set of NAMED behaviors.

// wait wait, named?
// yeah, named.
// So we pull in behaviors from our library.
// Our library lives in behaviors.rs

pub struct NamedBehavior {
    pub name: String,
    pub behavior: Box<dyn BehaviorFn>,
    pub dependencies: Vec<String>,
}

impl NamedBehavior {
    pub fn new<S, B, D>(source_name: S, source_behavior: B, source_dependencies: D) -> NamedBehavior
    where
        S: Into<String>,
        B: BehaviorFn,
        D: IntoIterator<Item = S>,
    {
        let name = source_name.into();
        let behavior = Box::new(source_behavior);
        let dependencies = source_dependencies.into_iter().map(Into::into).collect();

        NamedBehavior {
            name,
            behavior,
            dependencies,
        }
    }
}

pub trait BehaviorFn:
    Fn(&mut AgentState, &Context) -> SimulationResult<()> + Send + Sync + 'static
{
}
impl<T> BehaviorFn for T where
    T: Fn(&mut AgentState, &Context) -> SimulationResult<()> + Send + Sync + 'static
{
}

// Utilities for the built-in behaviors.
pub fn get_state_or_property<T: for<'de> Deserialize<'de>>(
    state: &AgentState,
    context: &Context,
    key: &str,
    default: T,
) -> T {
    if let Ok(value) = serde_json::from_value(state.get_as_json(key).unwrap_or_default()) {
        return value;
    }

    if let Some(value) = context
        .properties
        .get_cloned(&key)
        .and_then(|v| serde_json::from_value(v).ok())
    {
        return value;
    }

    default
}

// container
//
// deps "id"
// listens to messages of 'take' or 'give'
// give -> accepts the item of [name] and [amount], adds to its current balance. Responds with the new amount total, and 'thanks'.
// take -> if has an item, subtracts amount requested from balance and responds with "ok, {amount}, {amount remaining}".
//         If insufficient remaining, responds "Sorry", and amount remaining.

// color
//
// deps: 'color', a string value representing a color.
// listens to message 'set_color' : 'color',
// and sets it color accordingly.

// dies
//
// deps: 'alive'
// config:
//     die_if: expr // die if expr evalutes to true
//     clear_behaviors_on_death: 'all' (default)
// listens to message "die", responds "I am slain.", sets state to 'dead', sets behaivors to [] (depending on config),
// e.g. "dies if food is 0"

// takes
// deps: neighbors
//
// config: 'takes_what' = [item, amount]
// tries to take [item](amount) from its neighbors who are containers each turn

// gives
//
// config: 'takes_what' = [item, amount]
// tries to give [item](amount) to its neighbors each turn

// langtons_ant
//
// deps: direction, position
//
// takes config according to the extension definition from https://en.wikipedia.org/wiki/Langton%27s_ant
// -> an array of colors, e.g. ['red','green','blue']
// -> an array of behaviors, e.g. ['L','L','R']

// fn conway_game_of_life() {
//     //...
// }

//randomize_direction
// .. sets 'direction' randomly.
// allows 'random movement' to be created by combining 'randomize_direction' and 'move_in_direction'

// a static array is fine for now; eventually this will be a more complicated data structure.
lazy_static! {
    pub static ref BUILTIN_BEHAVIORS: HashMap<String, NamedBehavior> = {
        let builtin_behaviors: Vec<NamedBehavior> = vec![
            NamedBehavior::new(
                "action",
                action::action,
                vec!["epsilon", "actions", "q_state", "q_table", "action"],
            ),
            NamedBehavior::new(
                "control",
                control::control,
                vec!["steps", "done", "episode", "episode_reward", "epsilon"],
            ),
            NamedBehavior::new(
                "update_q",
                update_q::update_q,
                vec![
                    "q_table",
                    "q_state",
                    "action",
                    "next_q_state",
                    "reward",
                    "learning_rate",
                    "episode_reward",
                ],
            ),
            NamedBehavior::new("spring", spring::spring, vec!["position", "velocity"]),
            NamedBehavior::new(
                "forces",
                forces::forces,
                vec!["mass", "force", "dt", "position", "velocity"],
            ),
            NamedBehavior::new(
                "collision",
                collision::collision,
                vec!["position", "velocity"],
            ),
            NamedBehavior::new("gravity", gravity::gravity, vec!["gravity", "force"]),
            NamedBehavior::new(
                "viral_spread",
                viral_spread::viral_spread,
                vec![
                    "infection_chance",
                    "recovery_chance",
                    "immunity_exists",
                    "immune",
                    "infected",
                ],
            ),
            NamedBehavior::new(
                "random_movement",
                random_movement::random_movement,
                vec![
                    "position",
                    "random_movement_step_size",
                    "random_movement_seek_min_neighbors",
                    "random_movement_seek_max_neighbors",
                ],
            ),
            NamedBehavior::new(
                "random_away_movement",
                random_away_movement::random_away_movement,
                vec!["position"],
            ),
            NamedBehavior::new(
                "move_in_direction",
                move_in_direction::move_in_direction,
                vec!["position", "direction"],
            ),
            NamedBehavior::new("conway", conway::conway, vec!["position", "alive"]),
            NamedBehavior::new("age", age::age, vec!["age"]),
            NamedBehavior::new("diffusion", diffusion::diffusion, vec!["diffusion_targets"]),
            NamedBehavior::new(
                "orient_toward_value",
                orient_toward_value::orient_toward_value,
                vec![
                    "orient_toward_value",
                    "direction",
                    "orient_toward_value_uphill",
                    "orient_toward_value_cumulative",
                ],
            ),
            NamedBehavior::new(
                "reproduce",
                reproduce::reproduce,
                vec!["reproduction_child_values", "reproduction_rate"],
            ),
            NamedBehavior::new("decay", decay::decay, vec!["color", "decay_chance"]),
            NamedBehavior::new(
                "counter",
                counter::counter,
                vec![
                    "counter",
                    "counter_increment",
                    "counter_reset_at",
                    "counter_reset_to",
                ],
            ),
            NamedBehavior::new("remove_self", remove_self::remove_self, vec![]),
            NamedBehavior::new(
                "create_agents",
                create_agents::create_agents,
                vec!["agents"],
            ),
            NamedBehavior::new("create_grids", create_grids::create_grids, vec![]),
            NamedBehavior::new("create_stacks", create_stacks::create_stacks, vec![]),
            NamedBehavior::new("create_scatters", create_scatters::create_scatters, vec![]),
            NamedBehavior::new(
                "vintegrate",
                physics::vintegrate,
                vec!["position", "velocity", "force", "mass"],
            ),
        ];

        let mut map = HashMap::new();

        for behavior in builtin_behaviors {
            map.insert(behavior.name.clone(), behavior);
        }

        map
    };
}

#[derive(Default)]
pub struct TestParameters {
    agent: Option<TestEnvironment>,
    properties: Option<Properties>,
    topology_config: Option<TopologyConfig>,
    config: Option<cfg::SimulationConfig>,
}

enum TestEnvironment {
    Single(AgentState),
    Many(Vec<AgentState>),
}

impl TestParameters {
    #[must_use]
    pub fn agent(json: serde_json::Value) -> TestParameters {
        TestParameters {
            agent: Some(TestEnvironment::Single(json.into())),
            ..TestParameters::default()
        }
    }

    pub fn simulation<I: Iterator<Item = serde_json::Value>>(i: I) -> TestParameters {
        TestParameters {
            agent: Some(TestEnvironment::Many(i.map(|state| state.into()).collect())),
            ..TestParameters::default()
        }
    }

    fn state(&self) -> Vec<AgentState> {
        match &self.agent {
            Some(TestEnvironment::Single(agent)) => vec![agent.clone()],
            Some(TestEnvironment::Many(agents)) => agents.clone(),
            None => vec![],
        }
    }
}

use crate::runtimes::{
    messaging::{collect_messages, gather_agent_messages},
    neighbors::{gather_neighbors, try_agents_adjacency_map},
};

/// # Errors
/// This function may fail when
/// 1. Gathering neighbors
/// 2. The behavior function returns an error
pub fn test_behavior<T>(
    params: TestParameters,
    behavior_function: T,
) -> SimulationResult<AgentState>
where
    T: BehaviorFn,
{
    let initial_state = params.state();
    let properties = params.properties.unwrap_or_default();
    let topology_config = params.topology_config.unwrap_or_default();
    let config = params.config.unwrap_or_default();

    let messages = collect_messages(initial_state.as_slice(), &config);

    let adjacency_map = try_agents_adjacency_map(initial_state.iter())?;

    let agent = initial_state.get(0).expect("This should not fail");
    let my_neighbors = gather_neighbors(&adjacency_map, &agent, &topology_config);

    let my_messages = gather_agent_messages(&messages, &agent);
    let context = Context {
        properties: &properties,
        neighbors: my_neighbors,
        messages: my_messages,
        datasets: &DatasetMap::new(),
    };
    let mut new_agent = initial_state
        .get(0)
        .expect("The agent should exist")
        .clone();
    // TODO(haze): figure out the borrows on this stuff / get nicer, unified method
    behavior_function(&mut new_agent, &context)?;
    Ok(new_agent)
}

#[cfg(test)]
mod tests {
    use super::{
        age::age, conway::conway, counter::counter, decay::decay, diffusion::diffusion,
        move_in_direction::move_in_direction, orient_toward_value::orient_toward_value,
        random_away_movement::random_away_movement, random_movement::random_movement,
        reproduce::reproduce, test_behavior, viral_spread::viral_spread, SimulationResult,
        TestParameters,
    };

    #[test]
    fn age_test() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::agent(json!({
                "age": 0,
            })),
            age,
        )?;
        assert_eq!(next_state.get_custom::<i64>("age"), Some(1));
        Ok(())
    }

    #[test]
    fn conway_test_rule_1() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::simulation(
                vec![
                    json!({
                        "position": [0, 0, 0],
                        "alive": true,
                        "search_radius": 1,
                    }),
                    json!({
                        "position": [0, 1, 0],
                        "alive": true,
                    }),
                ]
                .into_iter(),
            ),
            conway,
        )?;

        assert_eq!(next_state.get_custom::<bool>("alive"), Some(false));
        Ok(())
    }

    #[test]
    fn conway_test_rule_2() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::simulation(
                vec![
                    json!({
                        "position": [0, 0, 0],
                        "alive": true,
                        "search_radius": 1,
                    }),
                    json!({
                        "position": [0, 1, 0],
                        "alive": true,
                    }),
                    json!({
                        "position": [1, 0, 0],
                        "alive": true,
                    }),
                    json!({
                        "position": [1, 0, 0],
                        "alive": false,
                    }),
                ]
                .into_iter(),
            ),
            conway,
        )?;

        assert_eq!(next_state.get_custom::<bool>("alive"), Some(true));
        Ok(())
    }

    #[test]
    fn conway_test_rule_3() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::simulation(
                vec![
                    json!({
                        "position": [0, 0, 0],
                        "alive": true,
                        "search_radius": 1,
                    }),
                    json!({
                        "position": [0, 1, 0],
                        "alive": true,
                    }),
                    json!({
                        "position": [1, 0, 0],
                        "alive": true,
                    }),
                    json!({
                        "position": [1, 0, 0],
                        "alive": true,
                    }),
                    json!({
                        "position": [1, 1, 1],
                        "alive": true,
                    }),
                ]
                .into_iter(),
            ),
            conway,
        )?;

        assert_eq!(next_state.get_custom::<bool>("alive"), Some(false));
        Ok(())
    }

    #[test]
    fn conway_test_rule_4() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::simulation(
                vec![
                    json!({
                        "position": [0, 0, 0],
                        "alive": false,
                        "search_radius": 1,
                    }),
                    json!({
                        "position": [0, 1, 0],
                        "alive": true,
                    }),
                    json!({
                        "position": [1, 0, 0],
                        "alive": true,
                    }),
                    json!({
                        "position": [1, 0, 0],
                        "alive": true,
                    }),
                ]
                .into_iter(),
            ),
            conway,
        )?;

        assert_eq!(next_state.get_custom::<bool>("alive"), Some(true));
        Ok(())
    }

    #[test]
    fn counter_test() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::agent(json!({
                "counter": 0,
            })),
            counter,
        )?;
        assert_eq!(next_state.get_custom::<f64>("counter"), Some(1.0));
        Ok(())
    }

    #[test]
    fn decay_test_modify() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::agent(json!({
                "decayed": false,
                "decay_chance": 1.0,
                "decay_effect": "ModifyDecayed",
            })),
            decay,
        )?;
        assert_eq!(next_state.get_custom::<bool>("decayed"), Some(true));
        Ok(())
    }

    #[test]
    fn decay_test_remove_behavior() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::agent(json!({
                "decayed": false,
                "decay_chance": 1.0,
                "decay_effect": "RemoveBehavior",
            })),
            decay,
        )?;
        assert_eq!(next_state.get_custom::<bool>("decayed"), Some(true));
        assert!(next_state.behaviors.is_empty());
        Ok(())
    }

    #[test]
    fn decay_test_remove_agent() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::agent(json!({
                "decayed": false,
                "decay_chance": 1.0,
                "decay_effect": "RemoveAgent",
            })),
            decay,
        )?;
        assert_eq!(next_state.messages.len(), 1);
        Ok(())
    }

    #[test]
    fn diffusion_array_test() -> SimulationResult<()> {
        let diff_arrays = vec![
            vec![0.0, 1.0, 2.0],
            vec![3.0, -3.0, 0.0],
            vec![6.0, 5.0, 4.0],
        ];
        let diffusion_coef = 0.5;

        let next_state = test_behavior(
            TestParameters::simulation(
                vec![
                    json!({
                        "position": [0, 0, 0],
                        "diff_array" : diff_arrays[0].clone(),
                        "diffusion_targets": ["diff_array"],
                        "diffusion_coef": diffusion_coef,
                        "search_radius": 1,
                    }),
                    json!({
                        "position": [0, 1, 0],
                        "diff_array" : diff_arrays[1].clone(),
                    }),
                    json!({
                        "position": [1, 0, 0],
                        "diff_array" : diff_arrays[2].clone(),
                    }),
                ]
                .into_iter(),
            ),
            diffusion,
        )?;

        assert_eq!(
            next_state.get_custom::<Vec<f64>>("diff_array"),
            Some(vec![1.5, 1.0, 2.0])
        );
        Ok(())
    }

    #[test]
    fn diffusion_float_test() -> SimulationResult<()> {
        let diff_floats = vec![42.0, 3.14, 14.86];
        let diffusion_coef = 0.5;

        let next_state = test_behavior(
            TestParameters::simulation(
                vec![
                    json!({
                        "position": [0, 0, 0],
                        "diff_float" : diff_floats[0],
                        "diffusion_targets": ["diff_float"],
                        "diffusion_coef": diffusion_coef,
                        "search_radius": 1,
                    }),
                    json!({
                        "position": [0, 1, 0],
                        "diff_float" : diff_floats[1],
                    }),
                    json!({
                        "position": [1, 0, 0],
                        "diff_float" : diff_floats[2],
                    }),
                ]
                .into_iter(),
            ),
            diffusion,
        )?;

        assert_eq!(next_state.get_custom::<f64>("diff_float"), Some(31.0));
        Ok(())
    }

    #[test]
    fn move_in_direction_test() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::agent(json!({
                "position": [1.0, 1.0, 2.0],
                "direction": [2.0, -3.0, 3.0],
            })),
            move_in_direction,
        )?;
        assert_eq!(
            next_state.position.expect("Agent should have position"),
            [3.0, -2.0, 2.0].into()
        );
        Ok(())
    }

    #[test]
    fn orient_toward_value_test_uphill() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::simulation(
                vec![
                    json!({
                        "position": [0, 0, 0],
                        "orient_toward_value_uphill": true,
                        "orient_toward_value": "height",
                        "height": 0.0,
                        "search_radius": 2,
                        "direction": [-1, 3],
                    }),
                    json!({
                        "position": [0, 1, 0],
                        "height": 1.0,
                    }),
                    json!({
                        "position": [0, 1, 0],
                        "height": 7.0,
                    }),
                    json!({
                        "position": [1, 0, 0],
                        "height": 6.0,
                    }),
                ]
                .into_iter(),
            ),
            orient_toward_value,
        )?;
        assert_eq!(
            next_state.direction.expect("Agent should have direction"),
            [0.0, 1.0, 0.0].into()
        );
        Ok(())
    }

    #[test]
    fn orient_toward_value_test_downhill() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::simulation(
                vec![
                    json!({
                        "position": [0, 0, 0],
                        "orient_toward_value_uphill": false,
                        "orient_toward_value": "height",
                        "height": 10.0,
                        "search_radius": 2,
                        "direction": [-1, 3],
                    }),
                    json!({
                        "position": [0, 1, 0],
                        "height": 7.0,
                    }),
                    json!({
                        "position": [0, 1, 0],
                        "height": 1.0,
                    }),
                    json!({
                        "position": [1, 0, 0],
                        "height": 6.0,
                    }),
                ]
                .into_iter(),
            ),
            orient_toward_value,
        )?;
        assert_eq!(
            next_state.direction.expect("Agent should have direction"),
            [0.0, 1.0, 0.0].into()
        );
        Ok(())
    }

    #[test]
    fn orient_toward_value_test_uphill_cumulative() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::simulation(
                vec![
                    json!({
                        "position": [0, 0, 0],
                        "orient_toward_value_uphill": true,
                        "orient_toward_value_cumulative": true,
                        "orient_toward_value": "height",
                        "height": 0.0,
                        "search_radius": 2,
                        "direction": [-1, 3],
                    }),
                    json!({
                        "position": [0, 1, 0],
                        "height": 4.0,
                    }),
                    json!({
                        "position": [0, 1, 0],
                        "height": 3.0,
                    }),
                    json!({
                        "position": [1, 0, 0],
                        "height": 6.0,
                    }),
                ]
                .into_iter(),
            ),
            orient_toward_value,
        )?;
        assert_eq!(
            next_state.direction.expect("Agent should have direction"),
            [0.0, 1.0, 0.0].into()
        );
        Ok(())
    }

    #[test]
    fn orient_toward_value_test_downhill_cumulative() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::simulation(
                vec![
                    json!({
                        "position": [0, 0, 0],
                        "orient_toward_value_uphill": false,
                        "orient_toward_value_cumulative": true,
                        "orient_toward_value": "height",
                        "height": 10.0,
                        "search_radius": 2,
                        "direction": [-1, 3],
                    }),
                    json!({
                        "position": [0, 1, 0],
                        "height": 4.0,
                    }),
                    json!({
                        "position": [0, 1, 0],
                        "height": -3.0,
                    }),
                    json!({
                        "position": [1, 0, 0],
                        "height": 2.0,
                    }),
                ]
                .into_iter(),
            ),
            orient_toward_value,
        )?;
        assert_eq!(
            next_state.direction.expect("Agent should have direction"),
            [0.0, 1.0, 0.0].into()
        );
        Ok(())
    }

    #[test]
    fn random_away_movement_test() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::simulation(
                vec![
                    json!({
                        "position": [0, 0, 0],
                        "search_radius": 1,
                    }),
                    json!({
                        "position": [0, 1, 0],
                    }),
                    json!({
                        "position": [-1, 1, 1],
                    }),
                ]
                .into_iter(),
            ),
            random_away_movement,
        )?;

        let position = next_state.position.expect("Agent should have position");

        assert!(position == [0.0, -1.0, 0.0].into() || position == [1.0, -1.0, 0.0].into());
        Ok(())
    }

    #[test]
    fn random_movement_test_seek_satisfied() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::simulation(
                vec![
                    json!({
                        "position": [0, 0, 0],
                        "random_movement_step_size": 5,
                        "random_movement_seek_min_neighbors": 2,
                        "search_radius": 1,
                    }),
                    json!({
                        "position": [0, 1, 0],
                    }),
                    json!({
                        "position": [-1, 1, 1],
                    }),
                ]
                .into_iter(),
            ),
            random_movement,
        )?;

        assert_eq!(
            next_state.position.expect("Agent should have position"),
            [0.0, 0.0, 0.0].into()
        );
        Ok(())
    }
    #[test]
    fn reproduce_test() -> SimulationResult<()> {
        let reproduction_rate = 5;
        let next_state = test_behavior(
            TestParameters::agent(json!({
                "reproduction_rate": reproduction_rate,
                "reproduction_child_values": {
                    "behaviors": ["reproduce"],
                    "height": 1,
                },
                "height" : 5,
            })),
            reproduce,
        )?;

        assert_eq!(next_state.messages.len(), reproduction_rate);

        for message in next_state.messages {
            assert!(matches!(
                message,
                crate::prelude::OutboundMessage::CreateAgent(_)
            ));
            if let crate::prelude::OutboundMessage::CreateAgent(x) = message {
                assert_eq!(x.data.height, Some(1.0));
            }
        }

        Ok(())
    }

    #[test]
    fn viral_spread_test_immunity() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::simulation(
                vec![
                    json!({
                        "position": [0, 0, 0],
                        "infection_chance": 1.0,
                        "infected": false,
                        "immune": true,
                        "search_radius": 1,
                    }),
                    json!({
                        "position": [0, 1, 0],
                        "infected": true,
                    }),
                ]
                .into_iter(),
            ),
            viral_spread,
        )?;

        assert!(!next_state
            .get_custom::<bool>("infected")
            .expect("Agent should have infection status"));

        Ok(())
    }
    #[test]
    fn viral_spread_test_infection() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::simulation(
                vec![
                    json!({
                        "position": [0, 0, 0],
                        "infection_chance": 1.0,
                        "search_radius": 1,
                    }),
                    json!({
                        "position": [0, 1, 0],
                        "infected": true,
                    }),
                ]
                .into_iter(),
            ),
            viral_spread,
        )?;

        assert!(next_state
            .get_custom::<bool>("infected")
            .expect("Agent should have infection status"));
        Ok(())
    }

    #[test]
    fn viral_spread_test_recovery_with_immunity() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::simulation(
                vec![
                    json!({
                        "position": [0, 0, 0],
                        "recovery_chance": 1.0,
                        "infected": true,
                        "search_radius": 1,
                    }),
                    json!({
                        "position": [0, 1, 0],
                        "infected": true,
                    }),
                ]
                .into_iter(),
            ),
            viral_spread,
        )?;

        assert!(!next_state
            .get_custom::<bool>("infected")
            .expect("Agent should have infection status"));

        assert!(next_state
            .get_custom::<bool>("immune")
            .expect("Agent should have immunity status"));
        Ok(())
    }

    #[test]
    fn viral_spread_test_recovery_without_immunity() -> SimulationResult<()> {
        let next_state = test_behavior(
            TestParameters::simulation(
                vec![
                    json!({
                        "position": [0, 0, 0],
                        "recovery_chance": 1.0,
                        "immunity_exists": false,
                        "infected": true,
                        "search_radius": 1,
                        "immune": false,
                    }),
                    json!({
                        "position": [0, 1, 0],
                        "infected": true,
                    }),
                ]
                .into_iter(),
            ),
            viral_spread,
        )?;

        assert!(!next_state
            .get_custom::<bool>("infected")
            .expect("Agent should have infection status"));

        assert!(!next_state
            .get_custom::<bool>("immune")
            .expect("Agent should have immunity status"));
        Ok(())
    }
}
