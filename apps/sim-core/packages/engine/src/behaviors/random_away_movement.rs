use crate::prelude::{AgentState, Context, SimulationResult};
use rand::Rng;

/// # Errors
/// This function cannot fail
pub fn random_away_movement(state: &mut AgentState, context: &Context) -> SimulationResult<()> {
    let neighbors = &context.neighbors;

    if !neighbors.is_empty() {
        let random_neighbor_index = rand::thread_rng().gen_range(0, neighbors.len());
        let random_neighbor = neighbors[random_neighbor_index];

        let neighbor_pos = random_neighbor.get_pos()?;
        let pos = state.get_pos_mut()?;

        pos["x"] += pos.x() - neighbor_pos.x();
        pos["y"] += pos.y() - neighbor_pos.y();
    }

    Ok(())
}
