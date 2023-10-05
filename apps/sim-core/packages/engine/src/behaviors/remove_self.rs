use crate::prelude::{AgentState, Context, OutboundMessage, SimulationResult};

/// # Errors
/// This function cannot fail
pub fn remove_self(state: &mut AgentState, _context: &Context) -> SimulationResult<()> {
    state
        .messages
        .push(OutboundMessage::remove_agent(state.agent_id.to_string()));
    Ok(())
}
