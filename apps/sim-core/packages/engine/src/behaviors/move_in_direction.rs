use crate::prelude::{AgentState, Context, SimulationResult};

// deps: 'direction' = a vector (x, y)
// moves the agent in its current direction.
/// # Errors
/// This function cannot fail
pub fn move_in_direction(state: &mut AgentState, _context: &Context) -> SimulationResult<()> {
    if let Some(dir) = &state.direction {
        let (dx, dy) = (dir.x(), dir.y());
        let pos = state.get_pos_mut()?;
        pos[0] += dx;
        pos[1] += dy;
    }

    Ok(())
}
