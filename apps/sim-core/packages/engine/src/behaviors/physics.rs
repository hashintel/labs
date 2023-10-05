//! Moves an agent's position based on the applied force
use crate::prelude::{AgentState, Context, SimulationResult, Vec3};

// Simple Euler's method for now, can add more complex functionality later
/// # Errors
/// This function may fail when
/// 1. `properties` does not have `dt` specified
/// 2. `dt` is not a number
/// 3. `velocity` not specified (or is an invalid `Vec3`) within the agent state
/// 4. `force` not specified (or is an invalid `Vec3`) within the agent state
pub fn vintegrate(state: &mut AgentState, context: &Context) -> SimulationResult<()> {
    let m = state["mass"].as_f64().ok_or("Please specify a mass")?;

    let dt = context
        .properties
        .get("dt")
        .ok_or("Need a dt specified")?
        .as_f64()
        .ok_or("dt needs to be a number")?;

    let mut v: Vec3 = state
        .get_custom("velocity")
        .ok_or("Velocity not specified, or not a proper Vec3")?;
    let f: Vec3 = state
        .get_custom("force")
        .ok_or("Velocity not specified, or not a proper Vec3")?;

    let p = state.get_pos_mut()?;

    // Newton's law, F = MA
    // v = a t
    // x = 1/2 a t^2
    v += f * dt / m;

    // Move the agent as well
    *p += v * dt;

    state.set("velocity", v)?;

    Ok(())
}
