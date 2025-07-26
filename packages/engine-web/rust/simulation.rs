use crate::behavior::{behavior_from_js_behavior, JsCustomBehaviors};
use crate::messagehandler::{run_message_handler, JsMessageHandlers};

use crate::util::err_to_jsvalue;
use futures::future::FutureExt;
use futures::stream::{Stream, StreamExt};
use hashintel_core::prelude::*;
use js_sys::Promise;
use std::pin::Pin;
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

#[wasm_bindgen]
#[allow(clippy::module_name_repetitions)]
pub fn start_simulation(
    initial_state: &JsValue,
    properties: &JsValue,
    datasets: &JsValue,
    js_custom_behaviors: &JsCustomBehaviors,
    js_message_handlers: &JsMessageHandlers,
) -> Result<StateIteratorWrapper, JsValue> {
    let initial_state: SimulationState = initial_state.into_serde().map_err(err_to_jsvalue)?;

    // Create a place in memory to store our behavior lambdas
    let mut custom_behaviors = vec![];
    for i in 0..js_custom_behaviors.len() {
        let js_behavior = js_custom_behaviors.behavior(i);
        let name = js_behavior.name();
        let dependencies: Vec<String> = js_behavior
            .dependencies()
            .into_serde()
            .map_err(err_to_jsvalue)?;
        let behavior = behavior_from_js_behavior(js_behavior);
        custom_behaviors.push(NamedBehavior::new(&name, behavior, &dependencies));
    }

    let mut custom_message_handlers = Vec::with_capacity(js_message_handlers.len());
    for i in 0..js_message_handlers.len() {
        let js_message_handler = js_message_handlers.handler(i);
        let name = js_message_handler.name();
        let pinned = run_message_handler(js_message_handler);

        custom_message_handlers.push(MessageHandler::new(&name, Box::pin(pinned)));
    }

    let properties: Properties = properties.into_serde().map_err(err_to_jsvalue)?;

    let datasets: serde_json::Value = datasets.into_serde().map_err(err_to_jsvalue)?;
    let datasets = datasets
        .as_object()
        .unwrap_or(&DatasetMap::new())
        .to_owned();

    Ok(StateIteratorWrapper {
        iterator: Box::pin(create_simulation(
            initial_state.clone(),
            properties,
            datasets,
            custom_behaviors,
            custom_message_handlers,
            SimulationConfig::wasm_serial(),
            DefaultRuntime::new(),
        )),
        initial_state,
    })
}

#[wasm_bindgen]
pub struct StateIteratorWrapper {
    iterator: Pin<Box<dyn Stream<Item = SimulationResult<Rc<SimulationState>>>>>,
    initial_state: SimulationState,
}

// @note you might notice that this is unsafe
// It's done this way so that JS can call a promise wrapping state.iterator.next() future even if that
// promise can technically last longer than StateIteratorWrapper itself.
#[wasm_bindgen]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub fn next_state(iter: *mut StateIteratorWrapper) -> Promise {
    unsafe {
        future_to_promise((*iter).iterator.next().map(|state| {
            match state {
                Some(Ok(state)) => JsValue::from_serde(&*state).map_err(err_to_jsvalue),
                Some(Err(err)) => Err(err_to_jsvalue(err)),

                // cannot happen
                None => panic!("Invalid next"),
            }
        }))
    }
}

#[wasm_bindgen]
impl StateIteratorWrapper {
    // For use with `next_state`
    #[wasm_bindgen]
    pub fn get_iter(&mut self) -> *mut StateIteratorWrapper {
        self
    }

    #[wasm_bindgen]
    pub fn initial_state(&self) -> Result<JsValue, JsValue> {
        JsValue::from_serde(&self.initial_state).map_err(err_to_jsvalue)
    }
}
