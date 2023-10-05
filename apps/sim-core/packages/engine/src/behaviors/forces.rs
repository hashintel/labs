use crate::{
    behaviors::get_state_or_property,
    prelude::{AgentState, Context, SimulationResult, Vec3},
};

/// Runs a semi-implicit Euler integration to calculate the change in velocity and position, based on the the current forces acting on the agent
pub fn forces(state: &mut AgentState, context: &Context) -> SimulationResult<()> {
    let dt = get_state_or_property(&state, &context, "dt", 0.01); // should just get property
    let mass = state["mass"].as_f64().ok_or("Please specify a mass")?;

    let force = state.get_custom("force").unwrap_or(Vec3(0.0, 0.0, 0.0));

    let dv = force * (dt / mass);
    let v = state.velocity.unwrap_or(Vec3(0.0, 0.0, 0.0)) + dv;

    state.set("velocity", v)?;
    let dp = v * dt;

    let pos = state.position.ok_or("Agent must have a position")?;

    state.set("position", pos + dp)?;
    state.set("force", Vec3(0.0, 0.0, 0.0))?;

    Ok(())
}
