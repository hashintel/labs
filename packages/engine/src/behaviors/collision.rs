use crate::prelude::{AgentState, Context, SimulationResult, Vec3};

/// Causes the agent to collide with other agents.
pub fn collision(state: &mut AgentState, context: &Context) -> SimulationResult<()> {
    let min_dist: f64 = 1.0;
    let pos = state.position.ok_or("Agent must have position")?;
    let vel = state.velocity.ok_or("Agent must have velocity")?;
    let mass = state["mass"].as_f64().ok_or("Please specify a mass")?;

    // TODO: access globals to determine what the % elasticity of the collision should be
    let epsilon: f64 = 1.0;

    // check if neighbors within distance
    let neighbors_pos = context
        .neighbors
        .iter()
        .filter(|&n| n.position.is_some())
        .filter(|&n| (n.position.unwrap() - pos).magnitude() <= min_dist);

    let mut dv = Vec3(0.0, 0.0, 0.0);
    for neighbor in neighbors_pos {
        let dir = neighbor.position.unwrap() - pos;

        let n_vel = neighbor.velocity.unwrap_or(Vec3(0.0, 0.0, 0.0));

        // Check if agent is actually moving towards neighbor or vice versa
        // Dot product of velocity and direction to neighbor is positive
        if (vel.dot(dir) <= 0.0) && (n_vel.dot(dir) >= 0.0) {
            continue;
        }

        let n_mass = neighbor.get_custom("mass").unwrap_or(f64::INFINITY);

        // Calculate normalized direction of reflection
        let norm = dir.norm();

        // Calculate impulse
        let numer = (epsilon + 1.0) * norm.dot(vel - n_vel);
        let denom = (1.0 / n_mass) + (1.0 / mass);
        let j = numer / denom;

        dv += norm * j / mass;
    }

    state.set("velocity", vel - dv)?;

    Ok(())
}
