use crate::prelude::{AgentState, Context, SimulationError, SimulationResult};

/// Update the agent's q table based on the reward for the action being taken
pub fn update_q(state: &mut AgentState, context: &Context) -> SimulationResult<()> {
    let mut q_table: Vec<Vec<f64>> = serde_json::from_value(state.get_as_json("q_table")?)?;
    let q_state = state["q_state"]
        .as_f64()
        .ok_or("Agent must have q_state assigned")?;

    if q_state < 0.0 {
        return Err(SimulationError::from(
            "Agent's 'q_state' field must never be less than 0",
        ));
    }
    let q_state_ind = unsafe { q_state.round().to_int_unchecked::<usize>() };

    let action = state.get_as_json("action")?;

    let actions: Vec<serde_json::Value> = match context.properties.get_cloned("actions") {
        Some(actions) => serde_json::from_value(actions).map_err(SimulationError::from),
        None => Err(SimulationError::from(
            "Globals must have an 'actions' arrray",
        )),
    }?;

    let q_action = actions
        .iter()
        .position(|x| x == &action)
        .ok_or("Did not find a valid action")?;

    // Calculate the learned q value
    let q = q_table[q_state_ind][q_action];
    let next_q_state = state["next_q_state"]
        .as_f64()
        .ok_or("Agent must have 'next_q_state' field")?;

    if next_q_state < 0.0 {
        return Err(SimulationError::from(
            "Agent's 'next_q_state' field must never be less than 0",
        ));
    }
    let next_q_state_ind = unsafe { next_q_state.round().to_int_unchecked::<usize>() };

    let reward = state["reward"]
        .as_f64()
        .ok_or("Agent must have 'reward' field assigned")?;

    let discount_factor = match context.properties.get("discount_factor") {
        Some(f) => f
            .as_f64()
            .ok_or("discount_factor global property must be a number"),
        None => Err("hi"),
    }?;
    let max_future_q = q_table[next_q_state_ind]
        .iter()
        .cloned()
        .fold(f64::NAN, f64::max);

    let learned_q = reward + discount_factor * max_future_q - q;
    let learning_rate = state["learning_rate"]
        .as_f64()
        .ok_or("Agent must have 'learning_rate' field")?;

    // Assign the new q value
    q_table[q_state_ind][q_action] += learned_q * learning_rate;
    state.set("q_state", next_q_state)?;
    state.set("q_table", q_table)?;

    // Track the total reward for the episode
    state.set(
        "episode_reward",
        state["episode_reward"]
            .as_f64()
            .ok_or("Agent must have 'episode_reward' field")?
            + reward,
    )?;
    state.set("reward", 0)?;

    Ok(())
}
