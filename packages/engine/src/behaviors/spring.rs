use crate::prelude::{AgentState, Context, SimulationResult, Vec3};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct SpringDefinition {
    agent_id: String,
    length: f64,
    k: f64, // Hooke's constant
    damping: Option<f64>,
}

/// Applies a spring force to the agent based on the parameters specified in `springs`
pub fn spring(state: &mut AgentState, context: &Context) -> SimulationResult<()> {
    // Retrieve spring parameters
    let springs = state
        .get_custom::<serde_json::Value>("springs")
        .map_or_else(
            || Ok(vec![]),
            serde_json::from_value::<Vec<SpringDefinition>>,
        )
        .map_err(|_| "agent field 'springs' must be an array of spring definitions")?;

    let pos = state.get_pos()?;

    let mut s_force = Vec3(0.0, 0.0, 0.0);

    for s in springs {
        let other = match context
            .neighbors
            .iter()
            .find(|&&n| n.agent_id == s.agent_id)
        {
            Some(val) => val,
            None => continue,
        };

        let dx = *other.get_pos()? - *pos;
        let norm = dx.norm();

        let x = dx.magnitude() - s.length;
        s_force += norm * x * s.k;

        if let Some(beta) = s.damping {
            let v = state.velocity.unwrap_or(Vec3(0.0, 0.0, 0.0));
            // calculate damping force
            let norm_v = norm * v.dot(norm);
            s_force -= norm_v * beta;
        }
    }

    let force = state.get_custom("force").unwrap_or(Vec3(0.0, 0.0, 0.0));
    state.set("force", force + s_force)?;

    Ok(())
}
