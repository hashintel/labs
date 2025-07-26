use crate::prelude::{AgentState, Context, SimulationResult};

/// # Errors
/// This function will fail if
/// 1. `x_bounds`, `y_bounds` or `z_bounds` is missing.
/// 2. `x_bounds`, `y_bounds` or `z_bounds` first value is not a number.
/// 3. `template_name` in `grid_template` is not a string
pub fn create_grids(state: &mut AgentState, context: &Context) -> SimulationResult<()> {
    let properties = context.properties;
    let topology = properties
        .get("topology")
        .ok_or("Topology is missing yet it was required")?;

    let x_bounds = topology
        .get("x_bounds")
        .ok_or("x_bounds is missing yet it was required")?;

    let y_bounds = topology
        .get("y_bounds")
        .ok_or("y_bounds is missing yet it was required")?;

    let width = x_bounds[1].as_f64().ok_or("x_bounds[1] is not a number")?
        - x_bounds[0].as_f64().ok_or("x_bounds[0] is not a number")?;
    let height = y_bounds[1].as_f64().ok_or("y_bounds[1] is not a number")?
        - y_bounds[0].as_f64().ok_or("y_bounds[0] is not a number")?;

    if let Some(grid_templates) = state.get_custom::<serde_json::Value>("grid_templates") {
        let mut agents = json!({});
        if let Some(state_agents) = state.get_custom::<serde_json::Value>("agents") {
            if let Some(agent_object) = state_agents.as_object() {
                agents = json!(agent_object);
            }
        }
        if let Some(template_array) = grid_templates.as_array() {
            for grid_template in template_array {
                let template_name = grid_template["template_name"]
                    .as_str()
                    .ok_or("template_name is not a string")?;
                agents[template_name] = json!([]);
                for ind in 0..(width * height) as i64 {
                    let mut template = grid_template.clone();
                    let x = (ind as f64) % width + x_bounds[0].as_f64().ok_or("not a number")?;
                    let y = ((ind as f64) / width).floor()
                        + y_bounds[0].as_f64().ok_or("not a number")?;
                    template["position"] = json!([x, y]);
                    if let Some(template_object) = template.as_object_mut() {
                        template_object.remove("template_name");
                    }
                    if let Some(agent_array) = agents[template_name].as_array_mut() {
                        agent_array.push(template);
                    }
                }
            }
        }
        state.set("agents", json!(agents))?;
    }

    Ok(())
}
