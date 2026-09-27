use hashintel_core::prelude::*;
use js_sys::Error;
use serde_json::json;
use wasm_bindgen::prelude::*;

pub(crate) fn serde_wasm_err_to_jsvalue(e: serde_wasm_bindgen::Error) -> JsValue {
    Error::new(&e.to_string()).into()
}

/// Serialize to JsValue via JSON. Use when JS expects plain objects (not Map/Set).
#[allow(deprecated)]
pub fn to_js_json<T: serde::Serialize>(v: &T) -> Result<JsValue, JsValue> {
    JsValue::from_serde(v).map_err(|e| err_to_jsvalue(SimulationError::from(e)))
}

/// Deserialize from JsValue via JSON.
#[allow(deprecated)]
pub fn from_js_json<T: serde::de::DeserializeOwned>(v: &JsValue) -> Result<T, JsValue> {
    v.clone().into_serde().map_err(|e| err_to_jsvalue(SimulationError::from(e)))
}

#[derive(Debug)]
pub struct JsError(JsValue);
unsafe impl Send for JsError {}
unsafe impl Sync for JsError {}

impl std::fmt::Display for JsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self.0)
    }
}

impl std::error::Error for JsError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        None
    }
}

impl Into<SimulationError> for JsError {
    fn into(self) -> SimulationError {
        SimulationError::Inner(Box::new(self))
    }
}

pub fn err_to_jsvalue<E: Into<SimulationError>>(e: E) -> JsValue {
    use SimulationError::Inner;

    let sim_err = e.into();
    match sim_err {
        Inner(err) => {
            if err.is::<JsError>() {
                err.downcast::<JsError>().unwrap().0
            } else {
                Error::new(&err.to_string()).into()
            }
        }
        _ => Error::new(&sim_err.to_string()).into(),
    }
}

#[must_use]
pub fn jsvalue_to_err(v: JsValue) -> SimulationError {
    JsError(v).into()
}

#[wasm_bindgen]
pub fn list_behaviors() -> Result<JsValue, JsValue> {
    let simple_list: Vec<serde_json::Value> = BUILTIN_BEHAVIORS
        .iter()
        .map(|(_, behavior)| {
            json!({
                "name": behavior.name,
                "dependencies": behavior.dependencies,
            })
        })
        .collect();
    serde_wasm_bindgen::to_value(&simple_list).map_err(serde_wasm_err_to_jsvalue)
}
