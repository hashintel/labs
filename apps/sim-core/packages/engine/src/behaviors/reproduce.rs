use crate::prelude::{AgentState, Context, OutboundMessage, SimulationResult};
use rand::Rng;

/// # Errors
/// This function cannot fail
pub fn reproduce(state: &mut AgentState, _context: &Context) -> SimulationResult<()> {
    let rate = state["reproduction_rate"].as_f64().unwrap_or(1.0);

    let mut num_children = (rate / 1.0) as i64;

    let chance = rate - (num_children as f64);

    if rand::thread_rng().gen_range(0.0, 1.0) < chance {
        num_children += 1;
    }

    let mut child = state.child();
    if let Some(map) = state["reproduction_child_values"].as_object() {
        for (key, value) in map {
            child.set(key, value.clone())?;
        }
    }

    for _x in 0..num_children {
        state
            .messages
            .push(OutboundMessage::create_agent(child.child()));
    }

    Ok(())
}
