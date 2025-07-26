#![allow(clippy::needless_pass_by_value)]
#![warn(warnings)]
pub mod agentstatewrapper;
pub mod behavior;
pub mod contextwrapper;
pub mod messagehandler;
pub mod simulation;
pub mod util;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn wasm_main() -> Result<(), JsValue> {
    console_error_panic_hook::set_once();
    Ok(())
}

#[wasm_bindgen]
extern "C" {
    // Use `js_namespace` here to bind `console.log(..)` instead of just
    // `log(..)`
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);

    // The `console.log` is quite polymorphic, so we can bind it with multiple
    // signatures. Note that we need to use `js_name` to ensure we always call
    // `log` in JS.
    #[wasm_bindgen(js_namespace = console, js_name = log)]
    fn log_u32(a: u32);

    // Multiple arguments too!
    #[wasm_bindgen(js_namespace = console, js_name = log)]
    fn log_many(a: &str, b: &str);
}
