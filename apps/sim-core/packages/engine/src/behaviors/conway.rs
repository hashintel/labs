use crate::prelude::{AgentState, Context, SimulationResult};

/// Implements Conway's Game of Life rules for an agent.
/// Depends on the agent and its neighbors having position, and alive properties.
/// This version assumes that each "Grid cell" will be an agent.
///
/// # Errors
/// `conway` will error if there is no `alive` field in the `AgentState`
pub fn conway(state: &mut AgentState, context: &Context) -> SimulationResult<()> {
    // Every cell interacts with its eight neighbors, which are the cells that are horizontally, vertically, or diagonally adjacent. At each step in time, the following transitions occur:

    // Any live cell with fewer than two live neighbors dies, as if by underpopulation.
    // Any live cell with two or three live neighbors lives on to the next generation.
    // Any live cell with more than three live neighbors dies, as if by overpopulation.
    // Any dead cell with exactly three live neighbors becomes a live cell, as if by reproduction.
    // --    https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life

    let alive = state["alive"]
        .as_bool()
        .ok_or("Expected 'alive' in agent state")?;

    let live_neighbors = context
        .neighbors
        .iter()
        .filter(|neighbor| neighbor["alive"].as_bool().unwrap_or(false))
        .count();

    let is_alive = if alive {
        (2..=3).contains(&live_neighbors)
    } else {
        live_neighbors == 3
    };

    if is_alive == alive {
        // no modifications.
        return Ok(());
    }

    state["alive"] = json!(is_alive);

    Ok(())
}
