use crate::prelude::{AgentState, Context, SimulationError, SimulationResult};
use rand::seq::SliceRandom;
use rand::Rng;

/// Decides whether the agent will exploit (select current best action) or explore (randomly select action)
pub fn action(state: &mut AgentState, context: &Context) -> SimulationResult<()> {
    let epsilon = state["epsilon"]
        .as_f64()
        .ok_or("Agent must have 'epsilon' field")?;

    let actions: Vec<serde_json::Value> = match context.properties.get_cloned("actions") {
        Some(actions) => serde_json::from_value(actions).map_err(SimulationError::from),
        None => Err(SimulationError::from(
            "Globals must have an 'actions' arrray",
        )),
    }?;
    let state_actions: Vec<serde_json::Value> =
        serde_json::from_value(state.get_as_json("actions")?)?;

    let exploit = rand::thread_rng().gen_range(0.0, 1.0) > epsilon;
    let action = if exploit {
        let q_state = state["q_state"]
            .as_f64()
            .ok_or("Agent must have 'q_state' field")?;

        if q_state < 0.0 {
            return Err(SimulationError::from(
                "Agent's 'q_state' field must never be less than 0",
            ));
        }
        let q_state_ind = unsafe { q_state.round().to_int_unchecked::<usize>() };

        let q_table: Vec<Vec<f64>> = serde_json::from_value(state.get_as_json("q_table")?)?;
        let q_values = &q_table[q_state_ind];

        if q_values.is_empty() {
            return Err(SimulationError::from(
                "Agent's q_table not formatted correctly",
            ));
        }

        let (max_index, _) = q_values.iter().enumerate().fold(
            (0, -f64::INFINITY),
            |(acc_idx, acc_max), (idx, &v)| {
                if v > acc_max {
                    (idx, v)
                } else {
                    (acc_idx, acc_max)
                }
            },
        );

        actions.get(max_index).unwrap()
    } else {
        state_actions.choose(&mut rand::thread_rng()).unwrap()
    };

    state.set("action", action)?;

    Ok(())
}
