use crate::prelude::{
    handle_hash_messages, AgentState, IncomingMessage, MessageHandler, MessageHandlerResult,
    MessageMap, OutboundMessage, Properties, SimulationConfig, SimulationError, SimulationResult,
    SimulationState,
};

use futures::{future::join_all, prelude::*};
use rayon_cond::CondIterator;
use std::collections::HashMap;
use tokio::sync::mpsc::unbounded_channel;

#[must_use]
pub fn gather_agent_messages<'a>(
    message_map: &'a MessageMap,
    agent: &AgentState,
) -> Vec<&'a IncomingMessage> {
    let mut ret: Vec<&'a IncomingMessage> = Vec::new();
    if let Some(messages) = message_map.get(&agent.agent_id.to_lowercase()) {
        for message in messages {
            ret.push(message);
        }
    }

    if let Some(messages) = agent
        .agent_name
        .as_ref()
        .and_then(|name| message_map.get(&name.0.to_lowercase()))
    {
        for message in messages {
            ret.push(message);
        }
    }

    ret
}

/// # Errors
/// This function will return any errors raised by message handlers
pub async fn apply_message_handlers<'a, H: std::hash::BuildHasher>(
    current_state_mut: &'a mut SimulationState,
    custom_message_handlers: &HashMap<String, MessageHandler, H>,
    properties: &Properties,
    config: &SimulationConfig,
) -> SimulationResult<MessageMap> {
    let mut messages = collect_messages(&current_state_mut.as_slice(), config);

    let (sender, mut receiver) = unbounded_channel::<MessageHandlerResult>();
    let create_destroy = MessageHandler::new("hash".to_string(), Box::pin(handle_hash_messages()));

    let mut message_handlers: Vec<&MessageHandler> = custom_message_handlers.values().collect();
    message_handlers.push(&create_destroy);

    // run each message handler in parallel
    join_all(message_handlers.into_iter().map(|mh| {
        messages
            .get(&mh.name)
            .map_or(future::Either::Right(future::ready(())), |messages| {
                future::Either::Left(
                    mh.handler
                        .call(&current_state_mut, &messages, properties, config)
                        .then(|res| match sender.send(res) {
                            Ok(_) => future::ready(()),
                            Err(err) => panic!("{}", err),
                        }),
                )
            })
    }))
    .await;

    receiver.close();

    while let Some(result) = receiver.recv().await {
        match result {
            Ok(result) => {
                current_state_mut.retain(|agent| !result.removed.contains(&agent.agent_id));
                current_state_mut.extend(result.added);
                result.messages.iter().for_each(|m| {
                    let recipients = match &m.message {
                        OutboundMessage::Generic(msg) => msg.to.clone(),
                        _ => vec!["HASH".to_string()],
                    };

                    for id in recipients {
                        messages.entry(id).or_insert_with(Vec::new).push(m.clone());
                    }
                });
            }
            Err(err) => return Err(SimulationError::new(&*err)),
        }
    }

    Ok(messages)
}

#[must_use]
pub fn collect_messages(agents: &[AgentState], config: &SimulationConfig) -> MessageMap {
    let maps: Vec<MessageMap> = CondIterator::new(agents, config.is_parallel())
        .fold(MessageMap::new, |mut map, agent| {
            agent
                .messages
                .iter()
                .map(|message| IncomingMessage {
                    from: agent.agent_id.clone(),
                    message: message.clone(),
                })
                .for_each(|message| {
                    let recipients = match &message.message {
                        OutboundMessage::Generic(msg) => {
                            msg.to.iter().map(|toval| toval.to_lowercase()).collect()
                        }
                        _ => vec!["hash".to_string()],
                    };

                    for recipient in recipients {
                        map.entry(recipient)
                            .or_insert_with(Vec::new)
                            .push(message.clone());
                    }
                });

            map
        })
        .collect();

    // this part can't be done in parallel because we have to merge
    // all the maps into one.
    maps.into_iter().fold(MessageMap::new(), |mut ret, map| {
        for (recipient, messages) in map {
            ret.entry(recipient)
                .or_insert_with(Vec::new)
                .extend(messages);
        }

        ret
    })
}
