use crate::util::{err_to_jsvalue, from_js_json, to_js_json};
use hashintel_core::prelude::*;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct ImmutableAgentStateWrapper {
    inner: *const AgentState,
}

#[wasm_bindgen]
impl ImmutableAgentStateWrapper {
    /// # Errors
    /// This function will fail if the `JsValue` is not valid JSON (?)
    pub fn get(&self, key: &str) -> Result<JsValue, JsValue> {
        unsafe {
            let value = (*self.inner).get_as_json(key).map_err(err_to_jsvalue)?;
            serde_wasm_bindgen::to_value(&value).map_err(crate::util::serde_wasm_err_to_jsvalue)
        }
    }

    #[must_use]
    pub fn has(&self, key: &str) -> JsValue {
        unsafe { JsValue::from_bool((*self.inner).has(key)) }
    }
}

#[wasm_bindgen]
pub struct AgentStateWrapper {
    pub inner: *mut AgentState,
}

#[wasm_bindgen]
impl AgentStateWrapper {
    /// # Errors
    /// This function will fail if the `JsValue` is not valid JSON (?)
    pub fn get(&self, key: &str) -> Result<JsValue, JsValue> {
        unsafe {
            let value = (*self.inner).get_as_json(key).map_err(err_to_jsvalue)?;
            to_js_json(&value)
        }
    }

    /// # Errors
    /// This function will fail if the conversion of `value` into a `serde_json::Value` fails, or
    /// if we are unable to set a builtin field
    pub fn set(&mut self, key: &str, value: &JsValue) -> Result<(), JsValue> {
        let value: serde_json::Value = from_js_json(value)?;
        unsafe {
            (*self.inner)
                .set_known_field(key, value)
                .map_err(err_to_jsvalue)
        }
    }

    #[must_use]
    pub fn has(&self, key: &str) -> JsValue {
        unsafe { JsValue::from_bool((*self.inner).has(key)) }
    }

    // `add_message` adds a message to the agent's messages vector. The argument "to" may
    // be a JS string, or an array of strings.
    pub fn add_message(&self, to: &JsValue, kind: &str, data: &JsValue) -> Result<(), JsValue> {
        let json_data = if data.is_undefined() {
            None
        } else {
            Some(serde_wasm_bindgen::from_value(data.clone()).map_err(crate::util::serde_wasm_err_to_jsvalue)?)
        };

        if to.is_string() {
            // Single recipient
            let to: String = to
                .as_string()
                .ok_or_else(|| SimulationError::Message("converting 'to' to string".into()))
                .map_err(err_to_jsvalue)?;
            unsafe {
                (*self.inner)
                    .add_message::<&str>(&to.as_str(), kind, json_data)
                    .map_err(err_to_jsvalue)
            }
        } else {
            // Assume multiple recipients
            let to: Vec<String> =
                serde_wasm_bindgen::from_value(to.clone()).map_err(crate::util::serde_wasm_err_to_jsvalue)?;
            unsafe {
                (*self.inner)
                    .add_message(&to, kind, json_data)
                    .map_err(err_to_jsvalue)
            }
        }
    }

    #[must_use]
    pub fn behavior_index(&self) -> JsValue {
        unsafe {
            let value = (*self.inner).get_behavior_index();
            match value {
                Some(i) => JsValue::from_f64(i as f64),
                None => JsValue::UNDEFINED,
            }
        }
    }
}
