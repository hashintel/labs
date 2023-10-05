use crate::prelude::{AgentState, Context, SimulationError, SimulationResult};

/// Retrieve a global property
fn get_global(context: &Context, key: &str) -> Result<serde_json::Value, SimulationError> {
    match context.properties.get_cloned(key) {
        Some(value) => serde_json::from_value(value).map_err(SimulationError::from),
        None => Err(SimulationError::from("test")),
    }
}

/// Reset the agent when an episode ends. Store relevant data for analysis.
pub fn control(state: &mut AgentState, context: &Context) -> SimulationResult<()> {
    // Retrieve globals
    let episode_length = get_global(context, "episode_length")?
        .as_i64()
        .ok_or("'episode_length' globals value must be an integer")?;
    let epsilon_decay = get_global(context, "epsilon_decay")?
        .as_f64()
        .ok_or("'epsilon_decay' globals value must be a number")?;
    let agent_reset = get_global(context, "agent_reset")?;

    let mut steps = state["steps"]
        .as_i64()
        .ok_or("Agent must have 'steps' field")?;
    let done = state["done"].as_bool().unwrap_or(false);

    if steps == episode_length || done {
        // Reset agent
        for (key, value) in agent_reset
            .as_object()
            .ok_or("'agent_reset' globals value must be an object")?
        {
            state.set(key, value)?;
        }

        // Store and reset episode data
        let episode = state["episode"].as_i64().unwrap_or(1);
        state.set("episode", episode + 1)?;

        let episode_reward = state["episode_reward"].as_f64().unwrap_or(0.0);
        state.set("final_episode_reward", episode_reward)?;

        state.set("episode_reward", 0.0)?;
        steps = 1;

        // Adjust hyperparameters
        let epsilon = state["epsilon"]
            .as_f64()
            .ok_or("Agent must have 'epsilon' field")?;
        state.set("epsilon", epsilon * (1.0 - epsilon_decay))?;
    }

    state.set("steps", steps + 1)?;

    Ok(())
}
