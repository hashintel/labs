use crate::prelude::*;
use crate::util;

use std::collections::HashMap;

/// # Errors
/// This function will fail if
/// 1. Any of the behaviors being ran returns an error
/// 2. The custom behavior being executed is not found
pub fn apply_behaviors<H: std::hash::BuildHasher>(
    agent_state: &mut AgentState,
    custom_behaviors: &HashMap<String, NamedBehavior, H>,
    context: &Context,
    topology: &TopologyConfig,
) -> SimulationResult<()> {
    // let's prepare the agent for the next state
    let orig_id = agent_state.agent_id.clone();

    // Once we have the behavior names, we collect the actual behavior code
    let behaviors: Vec<&NamedBehavior> = {
        let mut buf = Vec::with_capacity(agent_state.behaviors.len());
        for behavior in &agent_state.behaviors {
            if let Some(named_behavior) = BUILTIN_BEHAVIORS.get(&extract_hash_builtin(behavior)) {
                buf.push(named_behavior);
            } else if let Some(named_behavior) = custom_behaviors.get(behavior) {
                buf.push(named_behavior);
            } else if let Some(named_behavior) = BUILTIN_BEHAVIORS.get(behavior) {
                buf.push(named_behavior);
            } else {
                return Err(SimulationError::UnknownBehavior(behavior.to_string()));
            }
        }
        buf
    };

    // Apply the behaviors
    for (i, NamedBehavior { behavior, .. }) in behaviors.iter().enumerate() {
        agent_state.set_behavior_index(i);
        behavior(agent_state, &context)?;
        if topology.move_wrapped_agents {
            util::correct_agent(agent_state, topology);
        }
    }

    agent_state.clear_behavior_index();

    // do not allow the user to change the agent id
    if agent_state.agent_id != *orig_id {
        agent_state.agent_id = orig_id;
    }

    Ok(())
}

fn extract_hash_builtin(name: &str) -> String {
    if name.starts_with("@hash/") && name.ends_with(".rs") {
        name.split_terminator('/')
            .last()
            .unwrap_or(name)
            .trim_end_matches(".rs")
            .to_string()
    } else {
        name.to_string()
    }
}

#[test]
fn ensure_hash_builtin_works() {
    assert_eq!(extract_hash_builtin("@hash/age/age.rs"), "age");
    assert_eq!(extract_hash_builtin("@hash/age.rs"), "age");
    assert_eq!(extract_hash_builtin("age"), "age");
}
