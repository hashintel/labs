pub mod adjacency;

use crate::prelude::*;
use futures::prelude::*;
use std::{
    collections::{HashMap, HashSet},
    iter::FromIterator,
    rc::Rc,
};

use crate::prelude::SimulationResult;

pub fn create_simulation<T: SimulationRuntime + Send + Sync>(
    initial_state: SimulationState,
    properties: Properties,
    datasets: DatasetMap,
    custom_behaviors: Vec<NamedBehavior>,
    custom_message_handlers: Vec<MessageHandler>,
    config: SimulationConfig,
    runtime: T,
) -> impl stream::Stream<Item = SimulationResult<Rc<SimulationState>>> {
    let topology_config = properties.topology_config().unwrap_or_default();

    let custom_behaviors =
        custom_behaviors
            .into_iter()
            .fold(HashMap::new(), |mut map, behavior| {
                map.insert(behavior.name.clone(), behavior);
                map
            });

    let message_handler_names: HashSet<String> = HashSet::from_iter(
        properties
            .get("messageHandlers")
            .and_then(serde_json::Value::as_array)
            .map_or_else(Vec::new, |arr| {
                arr.iter()
                    .filter_map(|item| item.as_str().map(str::to_lowercase))
                    .collect()
            }),
    );

    let custom_message_handlers = custom_message_handlers
        .into_iter()
        .filter(|mh| message_handler_names.contains(&mh.name.to_lowercase() as &str))
        .fold(HashMap::new(), |mut map, message_handler| {
            map.insert(message_handler.name.to_lowercase(), message_handler);
            map
        });

    let iterator = StateIterator {
        state: Rc::new(initial_state),
        properties,
        datasets,
        custom_behaviors,
        custom_message_handlers,
        config,
        topology_config,
        runtime,
    };

    stream::unfold(iterator, |mut state_iterator| async move {
        let new_agents = state_iterator.try_next_state().await;
        match new_agents {
            Ok(agents) => {
                state_iterator.state = Rc::new(agents);
                Some((Ok(Rc::clone(&state_iterator.state)), state_iterator))
            }
            Err(error) => Some((Err(error), state_iterator)),
        }
    })
}

pub struct StateIterator<T: SimulationRuntime + Send + Sync> {
    state: Rc<SimulationState>,
    properties: Properties,
    datasets: DatasetMap,
    custom_behaviors: HashMap<String, NamedBehavior>,
    custom_message_handlers: HashMap<String, MessageHandler>,
    config: SimulationConfig,
    topology_config: TopologyConfig,
    runtime: T,
}

impl<T: SimulationRuntime> StateIterator<T> {
    pub fn custom_behaviors(&self) -> &HashMap<String, NamedBehavior> {
        &self.custom_behaviors
    }

    pub fn custom_message_handlers(&self) -> &HashMap<String, MessageHandler> {
        &self.custom_message_handlers
    }

    /// # Errors
    /// This function may fail if the next state may not be generated
    /// TODO(haze) elaborate
    pub async fn try_next_state(&mut self) -> SimulationResult<SimulationState> {
        self.runtime
            .try_next_state(
                self.state.clone(),
                &self.properties,
                &self.datasets,
                &self.custom_behaviors,
                &self.custom_message_handlers,
                &self.config,
                &self.topology_config,
            )
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_simulation() -> SimulationResult<()> {
        let initial_state = vec![];
        create_simulation(
            initial_state,
            Properties::empty(),
            DatasetMap::new(),
            vec![],
            vec![],
            SimulationConfig::server_serial(),
            DefaultRuntime::default(),
        )
        .take(10)
        .collect::<Vec<_>>()
        .await;
        Ok(())
    }
}
