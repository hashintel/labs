pub mod behaviors;
pub mod messaging;
pub mod neighbors;
pub mod sim;
use crate::prelude::{
    AdjacencyMap, AgentState, Context, DatasetMap, IncomingMessage, MessageHandler, MessageMap,
    NamedBehavior, Properties, SimulationConfig, SimulationResult, SimulationState, TopologyConfig,
};
use async_trait::async_trait;
use rayon_cond::CondIterator;
use std::collections::HashMap;
/// By default, we provide a local runtime for running simulations
/// Use the `DefaultRuntime` to develop behaviors locally before using them on HASH Core

#[derive(Default)]
pub struct DefaultRuntime {}

impl SimulationRuntime for DefaultRuntime {}

impl DefaultRuntime {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }
}
/// Runtimes are used to swap out how parts of the simulation work on different platforms
/// The default runtime is portable, but individual functionality can be swapped out on a per-target basis
/// The Runtime is shared among threads, so any field that isn't Send-Sync on your runtime needs to wrapped in Arc
// We can provide a unified inteface for the different targets that do the same thing with different methods
#[async_trait(?Send)]
pub trait SimulationRuntime: Send + Sync {
    /// Inform the interface that a simulation is about to start
    /// Here, boot up anything that might be useful
    fn starting_simulation(&mut self) {}

    /// Take in the state of an agent and its behaviors to produce a new agent state
    fn apply_behaviors(
        &self,
        agent_state: &mut AgentState,
        custom_behaviors: &HashMap<String, NamedBehavior>,
        context: &Context,
        topology: &TopologyConfig,
    ) -> SimulationResult<()> {
        sim::apply_behaviors(agent_state, custom_behaviors, context, topology)
    }

    /// Create an adjacency map from a list of agent states
    fn try_agents_adjacency_map<'a>(
        &self,
        agents: &'a [AgentState],
        _config: &'a SimulationConfig,
        _topology_config: &'a TopologyConfig,
    ) -> SimulationResult<AdjacencyMap<'a>> {
        neighbors::try_agents_adjacency_map(agents.iter())
    }

    /// Query the adjacnecy map for neighbors
    fn gather_neighbors<'a>(
        &self,
        adjacency_map: &'a AdjacencyMap,
        agent: &'a AgentState,
        topology: &TopologyConfig,
    ) -> Vec<&'a AgentState> {
        neighbors::gather_neighbors(adjacency_map, agent, topology)
    }

    ///
    fn gather_agent_messages<'a>(
        &self,
        message_map: &'a MessageMap,
        agent: &AgentState,
    ) -> Vec<&'a IncomingMessage> {
        messaging::gather_agent_messages(message_map, agent)
    }

    /// Apply the handlers
    async fn apply_message_handlers<'a>(
        &self,
        current_state_mut: &'a mut SimulationState,
        custom_message_handlers: &HashMap<String, MessageHandler>,
        properties: &Properties,
        config: &SimulationConfig,
    ) -> SimulationResult<MessageMap> {
        messaging::apply_message_handlers(
            current_state_mut,
            custom_message_handlers,
            properties,
            config,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    /// Produce the next state of the simulation
    async fn try_next_state(
        &mut self,
        current_state: std::rc::Rc<SimulationState>,
        properties: &Properties,
        datasets: &DatasetMap,
        custom_behaviors: &HashMap<String, NamedBehavior>,
        custom_message_handlers: &HashMap<String, MessageHandler>,
        config: &SimulationConfig,
        topology_config: &TopologyConfig,
    ) -> SimulationResult<SimulationState> {
        let mut current_state_mut = (*current_state).clone();

        // Make immutable again
        let messages = self
            .apply_message_handlers(
                &mut current_state_mut,
                custom_message_handlers,
                properties,
                config,
            )
            .await?;

        let adjacency_map =
            self.try_agents_adjacency_map(&current_state_mut, config, topology_config)?;

        CondIterator::new(&current_state_mut, config.is_parallel())
            .map(|agent_state: &AgentState| {
                let my_neighbors =
                    self.gather_neighbors(&adjacency_map, &agent_state, &topology_config);

                let my_messages = self.gather_agent_messages(&messages, &agent_state);

                let context = Context {
                    properties: &properties,
                    neighbors: my_neighbors,
                    messages: my_messages,
                    datasets,
                };
                let mut new_agent = agent_state.clone();
                new_agent.messages = Vec::new();
                self.apply_behaviors(&mut new_agent, custom_behaviors, &context, topology_config)?;
                Ok(new_agent)
            })
            .collect()
    }
}
