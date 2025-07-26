#![allow(clippy::needless_pass_by_value)]
use crate::agentstatewrapper::AgentStateWrapper;
use crate::contextwrapper::ContextWrapper;
use crate::util::jsvalue_to_err;
use hashintel_core::prelude::*;
use js_sys::Array;
use wasm_bindgen::prelude::*;

#[allow(clippy::module_name_repetitions)]
#[must_use]
pub fn behavior_from_js_behavior(js_behavior: JsCustomBehavior) -> impl BehaviorFn {
    move |state: &mut AgentState, context: &Context| -> SimulationResult<()> {
        let context_wrapper = ContextWrapper::new(context)?;
        let state_wrapper = AgentStateWrapper { inner: state };

        // We're handing off our rust objects
        // Make sure to free them on the other side!
        js_behavior
            .apply(state_wrapper, context_wrapper)
            .map_err(jsvalue_to_err)?;

        Ok(())
    }
}

#[wasm_bindgen]
extern "C" {
    pub type JsCustomBehaviors;

    #[wasm_bindgen(method)]
    pub fn len(this: &JsCustomBehaviors) -> usize;

    #[wasm_bindgen(method)]
    pub fn behavior(this: &JsCustomBehaviors, i: usize) -> JsCustomBehavior;
}

#[wasm_bindgen]
extern "C" {
    pub type JsCustomBehavior;

    #[wasm_bindgen(method, getter)]
    pub fn name(this: &JsCustomBehavior) -> String;

    #[wasm_bindgen(method, getter)]
    pub fn dependencies(this: &JsCustomBehavior) -> Array;

    #[wasm_bindgen(method, catch)]
    pub fn apply(
        this: &JsCustomBehavior,
        state_wrapper: AgentStateWrapper,
        context_wrapper: ContextWrapper,
    ) -> Result<(), JsValue>;
}
// we have to implement Send and Sync on JsCustomBehavior because Rust
// does not know that we are running on a single thread for WASM. Eventually,
// when WASM is actually able to run multi-threaded, we have to double check
// that these unsafe implementations are still valid.
unsafe impl Send for JsCustomBehavior {}
unsafe impl Sync for JsCustomBehavior {}
