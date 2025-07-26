#![allow(clippy::needless_pass_by_value)]
use crate::util::jsvalue_to_err;
use futures::future::FutureExt;
use hashintel_core::prelude::*;
use js_sys::{Array, Promise};
use wasm_bindgen::{prelude::*, JsCast};
use wasm_bindgen_futures::JsFuture;

#[must_use]
#[allow(clippy::redundant_closure_for_method_calls)]
pub fn run_message_handler(
    js_message_handler: JsMessageHandler,
) -> impl MessageHandlerFn<Output = MessageHandlerResult> {
    move |_agents: &[AgentState],
          messages: &[IncomingMessage],
          _properties: &Properties,
          _config: &SimulationConfig| {
        let message_handler_state = MessageHandlerState {
            messages: messages.to_vec(),
            results: MessageHandlerResultData::default(),
        };
        JsFuture::from(js_message_handler.handle(message_handler_state)).map(|res| {
            res.map(|message_state| message_state.unchecked_into::<MessageHandlerStateWrapper>())
                .map(|state_wrapper| state_wrapper.get_inner().results)
                .map_err(|err| jsvalue_to_err(err).to_string())
        })
    }
}

// Messages

#[wasm_bindgen]
extern "C" {
    pub type JsMessageHandler;

    #[wasm_bindgen(method, getter)]
    pub fn name(this: &JsMessageHandler) -> String;

    #[wasm_bindgen(method, getter)]
    pub fn types(this: &JsMessageHandler) -> Array;

    #[wasm_bindgen(method)]
    pub fn handle(this: &JsMessageHandler, state: MessageHandlerState) -> Promise;
}
unsafe impl Send for JsMessageHandler {}
unsafe impl Sync for JsMessageHandler {}

#[wasm_bindgen]
pub struct MessageHandlerState {
    messages: Vec<IncomingMessage>,
    results: MessageHandlerResultData,
}

#[wasm_bindgen]
impl MessageHandlerState {
    #[must_use]
    pub fn get_messages(&self) -> Array {
        Array::from(&JsValue::from_serde(&self.messages.clone()).unwrap())
    }

    pub fn remove_agent(&mut self, agent_id: String) {
        self.results.removed.insert(agent_id);
    }

    pub fn add_agent(&mut self, agent: &JsValue) -> Result<(), JsValue> {
        let agent_serde = agent
            .into_serde()
            .map_err(|e| JsValue::from(e.to_string()))?;
        self.results.added.push(agent_serde);
        Ok(())
    }

    pub fn add_message(&mut self, message: &JsValue) -> Result<(), JsValue> {
        let message_serde = message
            .into_serde()
            .map_err(|e| JsValue::from(e.to_string()))?;
        self.results.messages.push(message_serde);
        Ok(())
    }
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = MessageHandlerStateWrapper)]
    pub type MessageHandlerStateWrapper;

    #[wasm_bindgen(constructor)]
    pub fn new() -> MessageHandlerStateWrapper;

    #[wasm_bindgen(method)]
    pub fn get_inner(this: &MessageHandlerStateWrapper) -> MessageHandlerState;
}
unsafe impl Send for MessageHandlerStateWrapper {}
unsafe impl Sync for MessageHandlerStateWrapper {}

#[wasm_bindgen]
extern "C" {
    pub type JsMessageHandlers;

    #[wasm_bindgen(method)]
    pub fn len(this: &JsMessageHandlers) -> usize;

    #[wasm_bindgen(method)]
    pub fn handler(this: &JsMessageHandlers, i: usize) -> JsMessageHandler;
}
unsafe impl Send for JsMessageHandlers {}
unsafe impl Sync for JsMessageHandlers {}
