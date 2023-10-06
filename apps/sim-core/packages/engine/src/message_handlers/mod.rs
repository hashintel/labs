pub mod builtin;
use crate::cfg::SimulationConfig;
use crate::prelude::{AgentState, IncomingMessage, Properties};
use std::collections::HashSet;

use futures::prelude::*;

use std::pin::Pin;

#[derive(Default)]
pub struct MessageHandlerResultData {
    pub removed: HashSet<String>,
    pub added: Vec<AgentState>,
    pub messages: Vec<IncomingMessage>,
}

pub type MessageHandlerResult = Result<MessageHandlerResultData, String>;

type MessageHandlerBox = Pin<Box<dyn MessageHandlerFn<Output = MessageHandlerResult>>>;

pub struct MessageHandler {
    pub name: String,
    pub handler: MessageHandlerBox,
}

impl MessageHandler {
    pub fn new<N>(source_name: N, source_handler: MessageHandlerBox) -> MessageHandler
    where
        N: Into<String>,
    {
        let name = source_name.into();

        MessageHandler {
            name,
            handler: source_handler,
        }
    }
}

pub trait MessageHandlerFn {
    type Output;

    fn call(
        &self,
        simulation_state: &[AgentState],
        messages: &[IncomingMessage],
        properties: &Properties,
        config: &SimulationConfig,
    ) -> Pin<Box<dyn Future<Output = Self::Output>>>;
}

impl<'a, F, Fut> MessageHandlerFn for F
where
    F: Fn(&[AgentState], &[IncomingMessage], &Properties, &SimulationConfig) -> Fut,
    Fut: Future + 'static,
{
    type Output = Fut::Output;

    fn call(
        &self,
        simulation_state: &[AgentState],
        messages: &[IncomingMessage],
        properties: &Properties,
        config: &SimulationConfig,
    ) -> Pin<Box<dyn Future<Output = Self::Output>>> {
        Box::pin(self(simulation_state, messages, properties, config))
    }
}
