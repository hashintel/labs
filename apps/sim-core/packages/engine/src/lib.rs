#![deny(warnings)]
#![allow(clippy::cast_possible_wrap)]

#[macro_use]
extern crate serde_json;
extern crate serde_aux;

pub mod behaviors;
pub mod cfg;
pub mod message_handlers;
pub mod runtimes;
pub mod sim;

pub mod util {
    use super::sim;
    pub use hash_types::Vec3;
    pub use sim::adjacency::Point3WithId;
    pub use sim::adjacency::{correct_agent, wrapped_positions};
}

// Globally used keywords for building new simulations
pub mod prelude {
    use super::{behaviors, cfg, message_handlers, runtimes, sim};
    pub use {
        super::util::{self, *},
        behaviors::{BehaviorFn, NamedBehavior, BUILTIN_BEHAVIORS},
        cfg::SimulationConfig,
        hash_types::{
            error::{Error as SimulationError, Result as SimulationResult},
            message::{
                Incoming as IncomingMessage, Map as MessageMap, Outbound as OutboundMessage,
            },
            properties::Properties,
            state::DatasetMap,
            topology::Config as TopologyConfig,
            Agent as AgentState, Context, SimulationState,
        },
        message_handlers::{
            builtin::handle_hash_messages, MessageHandler, MessageHandlerFn, MessageHandlerResult,
            MessageHandlerResultData,
        },
        runtimes::{DefaultRuntime, SimulationRuntime},
        sim::{adjacency::AdjacencyMap, create_simulation},
    };
}
