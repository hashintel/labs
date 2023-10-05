/// This file is responsible for asserting AgentState axioms
mod common;
use common::{json, step, Result, SimulationState, StepParams};

// https://github.com/hashintel/internal/issues/863
#[tokio::test]
async fn agent_should_be_created_if_position_set_to_null() -> Result<()> {
    let initial_state: SimulationState = vec![json!({
        "agent_id": "original agent",
        "messages": [{
            "type": "create_agent",
            "data": {
                "position": null,
            }
        }]
    })
    .into()];

    let next_state: SimulationState = step(
        StepParams {
            initial_state,
            ..StepParams::default()
        },
        1,
    )
    .await
    .expect("Simulation should run for at least one step")
    .expect("Expected a state");

    assert_eq!(next_state.len(), 2);
    Ok(())
}
