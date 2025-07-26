use crate::prelude::{AgentState, Context, SimulationResult};
use std::collections::HashMap;

// TODO(haze): investigate if is clippy false pos
#[allow(clippy::map_entry)]
/// # Errors
/// This function can fail when the value to orient to is not a string
pub fn orient_toward_value(state: &mut AgentState, context: &Context) -> SimulationResult<()> {
    if !state["orient_toward_value"].is_string() {
        return Ok(());
    }

    let target = state["orient_toward_value"]
        .as_str()
        .ok_or("not a string")?;

    // True -> looking for max (greater) value
    // False -> looking for min (smaller) value
    let uphill = state["orient_toward_value_uphill"]
        .as_bool()
        .unwrap_or(true);

    let cumulative = state["orient_toward_value_cumulative"]
        .as_bool()
        .unwrap_or(false);

    if let Some(target_value) = state.get_as_json(target)?.as_f64() {
        dbg!(target_value);
        let neighbors = context.neighbors.iter();

        let mut current_max = target_value;

        let mut neighbor_map = HashMap::new();

        for (_i, neighbor) in neighbors.enumerate() {
            if let Some(neighbor_value) = neighbor.get_as_json(target)?.as_f64() {
                let position = neighbor.get_pos()?.to_grid();

                if neighbor_map.contains_key(&position) {
                    let old_value = *neighbor_map.get(&position).unwrap();
                    let monotone = uphill == (old_value < neighbor_value);
                    if cumulative {
                        neighbor_map.insert(position, old_value + neighbor_value);
                    } else if monotone {
                        neighbor_map.insert(position, neighbor_value);
                    }
                } else {
                    neighbor_map.insert(position, neighbor_value);
                }
            }
        }

        for (position, neighbor_value) in neighbor_map {
            let my_position = state.get_pos()?;
            if uphill {
                if neighbor_value > current_max {
                    current_max = neighbor_value;

                    let x_change = position[0] as f64 - my_position[0];
                    let y_change = position[1] as f64 - my_position[1];

                    state.direction = Some([x_change, y_change].into());
                }
            } else if neighbor_value < current_max {
                current_max = neighbor_value;

                let x_change = position[0] as f64 - my_position[0];
                let y_change = position[1] as f64 - my_position[1];

                state.direction = Some([x_change, y_change].into());
            }
        }

        // compare within same error
        if (current_max - target_value).abs() <= std::f64::EPSILON {
            state.direction = Some([].into());
        }
    }

    Ok(())
}
