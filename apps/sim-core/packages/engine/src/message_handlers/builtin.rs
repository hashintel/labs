use crate::cfg::SimulationConfig;
use crate::message_handlers::{MessageHandlerFn, MessageHandlerResult, MessageHandlerResultData};
use crate::prelude::{AgentState, IncomingMessage, OutboundMessage, Properties};
use futures::future;
use rayon_cond::CondIterator;

/// # Errors
/// This function cannot fail
#[must_use]
pub fn handle_hash_messages() -> impl MessageHandlerFn<Output = MessageHandlerResult> {
    move |_agents: &[AgentState],
          messages: &[IncomingMessage],
          _properties: &Properties,
          config: &SimulationConfig| {
        let killed_agents = CondIterator::new(messages, config.is_parallel())
            .filter_map(|msg| -> Option<String> {
                match &msg.message {
                    OutboundMessage::RemoveAgent(msg) => Some(msg.data.agent_id.clone()),
                    _ => None,
                }
            })
            .collect();

        let new_agents: Vec<AgentState> = CondIterator::new(messages, config.is_parallel())
            .filter_map(|msg| -> Option<AgentState> {
                match &msg.message {
                    OutboundMessage::CreateAgent(msg) => Some(msg.data.clone()),
                    _ => None,
                }
            })
            .collect();

        future::ok::<MessageHandlerResultData, String>(MessageHandlerResultData {
            removed: killed_agents,
            added: new_agents,
            messages: Vec::new(),
        })
    }
}
