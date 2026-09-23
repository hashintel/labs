# Commit Message Guidelines

Write commit messages as concise action statements.

- **Primary line:** Start with a clear verb (Add, Fix, Remove, Update, Refactor) describing what was done
- **Focus:** Capture the purpose (WHY) and the thing accomplished
- **Details:** If needed, add a blank line followed by a bulleted list of specific actions taken

## Examples

```
Fix WASM serialization producing invalid JS object shapes
```

```
Add centralized JSON helpers for Rust-to-JS conversion

- Add to_js_json and from_js_json in util.rs
- Replace serde_wasm_bindgen with JSON path where JS expects plain objects
```

```
Update agent state wrapper to persist custom fields correctly
```
