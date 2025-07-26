use crate::{
    behaviors::get_state_or_property,
    prelude::{AgentState, Context, SimulationResult, Vec3},
};

/// Adds gravity to the forces acting on the agent. Won't cause an agent to fall into the ground
pub fn gravity(state: &mut AgentState, context: &Context) -> SimulationResult<()> {
    let pos = state.position.ok_or("Agent must have position")?;
    if pos[2] < 0.0 {
        return Ok(());
    };

    let g: f64 = get_state_or_property(&state, &context, "gravity", 9.81);
    let g_force = Vec3(0.0, 0.0, -g);

    let force = state.get_custom("force").unwrap_or(Vec3(0.0, 0.0, 0.0));
    state.set("force", force + g_force)?;

    Ok(())
}
