use crate::util::err_to_jsvalue;
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
            JsValue::from_serde(&value).map_err(err_to_jsvalue)
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
            JsValue::from_serde(&value).map_err(err_to_jsvalue)
        }
    }

    /// # Errors
    /// This function will fail if the conversion of `value` into a `serde_json::Value` fails, or
    /// if we are unable to set a builtin field
    pub fn set(&mut self, key: &str, value: &JsValue) -> Result<(), JsValue> {
        let value: serde_json::Value = value.into_serde().map_err(err_to_jsvalue)?;
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
            Some(data.into_serde().map_err(err_to_jsvalue)?)
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
            let to: Vec<String> = to.into_serde().map_err(err_to_jsvalue)?;
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
