pub use hashintel_core::prelude::*;
pub use serde_json::json;

pub type Result<T, E = Box<dyn std::error::Error + Send + Sync>> = std::result::Result<T, E>;

#[derive(Default)]
pub struct StepParams {
    pub initial_state: SimulationState,
    pub properties: Properties,
    pub custom_behaviors: Vec<NamedBehavior>,
    pub custom_message_handlers: Vec<MessageHandler>,
    pub config: SimulationConfig,
}

pub async fn step(params: StepParams, steps: usize) -> Result<Option<SimulationState>> {
    use futures::{StreamExt, TryStreamExt};

    let next_states: Result<Vec<_>, SimulationError> = hashintel_core::sim::create_simulation(
        params.initial_state,
        params.properties,
        DatasetMap::new(),
        params.custom_behaviors,
        params.custom_message_handlers,
        params.config,
        DefaultRuntime::new(),
    )
    .take(steps)
    .try_collect()
    .await;

    match next_states {
        Ok(mut states) => {
            if let Some(last_rc) = states.pop().map(|rc| std::rc::Rc::try_unwrap(rc).ok()) {
                Ok(last_rc)
            } else {
                Ok(None)
            }
        }
        Err(why) => Err(why.into()),
    }
}
