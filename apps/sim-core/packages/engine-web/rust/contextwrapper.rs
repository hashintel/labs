use crate::util::err_to_jsvalue;
use hashintel_core::prelude::*;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct ContextWrapper {
    messages_values: JsValue,
    neighbor_ids: Vec<String>,
}

impl ContextWrapper {
    pub fn new(context: &Context) -> SimulationResult<ContextWrapper> {
        // we do not store properties in this wrapper because the JS side already has them
        let js_messages = JsValue::from_serde(&context.messages)?;
        let neighbor_ids = context
            .neighbors
            .iter()
            .map(|a| a.agent_id.clone())
            .collect::<Vec<String>>();

        Ok(ContextWrapper {
            messages_values: js_messages,
            neighbor_ids,
        })
    }
}

#[wasm_bindgen]
impl ContextWrapper {
    #[wasm_bindgen(method)]
    pub fn neighbors(&self) -> Result<JsValue, JsValue> {
        JsValue::from_serde(&self.neighbor_ids).map_err(err_to_jsvalue)
    }

    #[wasm_bindgen(method)]
    pub fn messages(&self) -> Result<JsValue, JsValue> {
        Ok(self.messages_values.clone())
    }
}
