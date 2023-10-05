use crate::prelude::{AgentState, Context, OutboundMessage, SimulationResult};

/// # Errors
/// This function cannot fail
pub fn create_agents(state: &mut AgentState, _context: &Context) -> SimulationResult<()> {
    if let Some(agents_object) = state.get_custom::<serde_json::Value>("agents") {
        if let Some(agents_to_create) = agents_object.as_object() {
            for (_key, agent_array) in agents_to_create.iter() {
                if let Some(agents) = agent_array.as_array() {
                    for agent in agents {
                        let message = OutboundMessage::from_json_value_with_state(
                            json!({
                                "to": ["HASH"],
                                "type": "create_agent",
                                "data": agent
                            }),
                            &state,
                        )?;

                        state.messages.push(message);
                    }
                }
            }
        }
    }

    Ok(())
}
