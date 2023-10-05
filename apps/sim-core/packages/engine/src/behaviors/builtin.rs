use crate::{
    behaviors::{get_state_or_property, BehaviorFn},
    cfg,
    prelude::AgentState,
    sim::{state::OutboundMessage, Context, SimulationResult},
};
use rand::prelude::*;
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashMap;

// to consider--
// add some macros to make behaviors easier to write.
// e.g. behavior!("my_name", "my dependencies", {})
// result: defines fn my_name, of proper type, and registers it an its deps.

