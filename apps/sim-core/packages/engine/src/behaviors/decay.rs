use crate::{
    behaviors::get_state_or_property,
    prelude::{AgentState, Context, OutboundMessage, SimulationResult},
};
use rand::Rng;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
enum DecayEffect {
    ModifyDecayed,
    RemoveBehavior,
    RemoveAgent,
}

/// # Errors
/// This function cannot fail
pub fn decay(state: &mut AgentState, context: &Context) -> SimulationResult<()> {
    let decay_chance = get_state_or_property(&state, &context, "decay_chance", 0.5);
    let decay_effect =
        get_state_or_property(&state, &context, "decay_effect", DecayEffect::ModifyDecayed);
    if rand::thread_rng().gen_range(0.0, 1.0) < decay_chance {
        match decay_effect {
            // Change the decayed property
            DecayEffect::ModifyDecayed => state.set("decayed", serde_json::Value::Bool(true))?,
            // Change the decayed property and remove the "decay" behavior
            DecayEffect::RemoveBehavior => {
                state.set("decayed", serde_json::Value::Bool(true))?;
                state.behaviors.retain(|behavior| (&*behavior) != "decay");
            }
            // Remove the agent
            DecayEffect::RemoveAgent => state
                .messages
                .push(OutboundMessage::remove_agent(state.agent_id.to_string())),
        }
    }

    Ok(())
}
