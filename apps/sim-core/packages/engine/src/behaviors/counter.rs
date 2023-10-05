use crate::prelude::{AgentState, Context, SimulationResult};

/// # Errors
/// This function cannot fail
pub fn counter(state: &mut AgentState, _context: &Context) -> SimulationResult<()> {
    let mut counter = state["counter"].as_f64().unwrap_or(0.0);

    let increment = state["counter_increment"].as_f64().unwrap_or(1.0);

    if let Some(value) = state["counter_reset_at"].as_f64() {
        // compare within same error
        if (counter - value).abs() < std::f64::EPSILON {
            if let Some(reset_value) = state.get_as_json("counter_reset_to").unwrap().as_f64() {
                state["counter"] = json!(reset_value);
                return Ok(());
            }
        }
    }

    counter += increment;
    state["counter"] = json!(counter);

    Ok(())
}
