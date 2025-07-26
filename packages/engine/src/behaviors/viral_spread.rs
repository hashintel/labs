use crate::{
    behaviors::get_state_or_property,
    prelude::{AgentState, Context, SimulationResult},
};
use rand::Rng;

/// # Errors
/// This function cannot fail
pub fn viral_spread(state: &mut AgentState, context: &Context) -> SimulationResult<()> {
    let infection_chance: f32 = get_state_or_property(&state, &context, "infection_chance", 0.0);
    let recovery_chance: f32 = get_state_or_property(&state, &context, "recovery_chance", 0.0);
    let immunity_exists: bool = get_state_or_property(&state, &context, "immunity_exists", true);
    let immune: bool = get_state_or_property(&state, &context, "immune", false);
    let infected: bool = get_state_or_property(&state, &context, "infected", false);

    if infected {
        if recovery_chance > rand::thread_rng().gen_range(0.0, 1.0) {
            state["infected"] = json!(false);
            if immunity_exists {
                state["immune"] = json!(true);
            }
        }
    } else if !immune {
        // for each neighbor, rand number vs infection chance
        let infected_neighbors = context
            .neighbors
            .iter()
            .filter(|neighbor| neighbor["infected"].as_bool().unwrap_or(false));

        for _neighbor in infected_neighbors {
            if infection_chance > rand::thread_rng().gen_range(0.0, 1.0) {
                state["infected"] = json!(true);
                break;
            }
        }
    }

    Ok(())
}
