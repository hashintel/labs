mod common;
use common::{json, step, SimulationResult, SimulationState, StepParams};

#[tokio::test]
async fn test_random_away_movement() -> SimulationResult<()> {
    let initial_state = vec![
        json!({
            "position": [0, 0, 0],
            "search_radius": 50,
            "behaviors": ["@hash/random_away_movement.rs"],
        })
        .into(),
        json!({
            "position": [0, 1, 0],
        })
        .into(),
        json!({
            "position": [1, 0, 0],
        })
        .into(),
    ];

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

    assert!(
        next_state[0]
            .position
            .expect("First agent should have position")
            != hashintel_core::prelude::Vec3(0_f64, 0_f64, 0_f64)
    );
    Ok(())
}
