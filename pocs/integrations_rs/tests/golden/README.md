# Golden vectors

Most JSON fixtures are dumped from the TypeScript integration engine
(`labs/pocs/integrations`) and capture byte-exact behavior of deterministic UUIDs,
content-hash SQL, sink config hashes, link op ids, pending-link payloads, and
snapshot `_key` SQL for parity with the Elixir port. Regenerate those fixtures
with the TypeScript dump script rather than editing them by hand.

`routing.json`, `control-baseline-v1.json`, `current-state-hint-v1.json`,
`graph-effects-v1.json`,
`internal-metadata-v1.json`, the state/work/control/journal/submission fixtures,
`protocol-identities-v1.json`, and `expected-record-families-v1.json` are Rust orchestrator
protocol fixtures, not TypeScript parity fixtures. They are independently
reviewed inputs and must never be generated from the Rust implementation they
test. `registry-omitted-family.json` is a deliberate negative fixture.
