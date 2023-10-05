use crate::prelude::{AgentState, Context, SimulationResult};

/// # Errors
/// This function will not error
pub fn age(state: &mut AgentState, _context: &Context) -> SimulationResult<()> {
    let age = match state["age"].as_i64() {
        Some(age) => age + 1,
        None => 1,
    };

    state.set("age", json!(age))?;

    Ok(())
}
