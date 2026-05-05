# Clack Prompt Testing Plan (Reusable Across Projects)

## Intent

Standardize how we integrate and test interactive `@clack/*` prompts across projects so that:

- runtime behavior stays unchanged for real users
- interactive flows can be tested with programmatic key events
- cancellation paths (ESC / signals) are verifiable and consistent

This plan is meant to be adopted as a repeatable rule for any repo that uses `@clack/*`.

## Source Principles & Primitives (from clack)

These are the core primitives we will rely on, straight from clack’s source:

- Prompts accept injected I/O streams: `input?: Readable`, `output?: Writable`
  - See `packages/prompts/src/common.ts` (CommonOptions)
- Prompts accept cancellation via `signal?: AbortSignal`
  - See `packages/prompts/src/common.ts`
  - Base prompt wiring in `packages/core/src/prompts/prompt.ts`
- Clack’s own tests drive prompts with mock streams
  - `MockReadable` + `MockWritable` in `packages/prompts/test/test-utils.ts`
- Key events are injected via `input.emit('keypress', ...)`
  - Example: `packages/prompts/test/select-key.test.ts`

These references define the supported surface for prompt I/O injection and keypress simulation.

## Concept

Introduce a prompt adapter (wrapper) layer in each repo that:

1. centralizes all `@clack/prompts` usage
2. allows test-time injection of `input`, `output`, and `signal`
3. keeps default behavior unchanged for production/normal CLI usage

This removes the need for prompt mocking in most interactive tests and enables real, TTY-style
automation without rewriting prompt logic.

## Plan (Reusable Recipe)

1. Prompt Adapter Module
   - Create a small module (e.g. `src/lib/prompts.ts`) that exports the prompt API we use
     (select, text, confirm, multi-select, etc.).
   - The adapter should accept optional `input`, `output`, `signal` defaults, and pass them
     through to `@clack/prompts` calls.
   - Default to `process.stdin` / `process.stdout` and no signal to preserve runtime behavior.

2. Injection Point (Provider)
   - Add a single place to override the adapter defaults for tests.
   - Options:
     - a setter (e.g. `setPromptIO({ input, output, signal })`)
     - or a DI object passed into commands
   - Keep this minimal and consistent across repos.

3. Replace Direct Imports
   - Replace all direct `@clack/prompts` imports in commands with the adapter module.
   - This becomes a rule: **never import `@clack/prompts` directly from application code**.

4. Test Utilities
   - Add `MockReadable` / `MockWritable` test utils in the repo
     (based on `packages/prompts/test/test-utils.ts`).
   - Add helpers for common keypresses (ESC, Enter, arrows).

5. Interactive Integration Tests
   - Use adapter injection + mock streams to exercise real prompt behavior:
     - ESC cancel flows
     - selecting options
     - multi-select interactions
   - Validate returned values and optionally snapshot output buffer.
   - See `packages/prompts/test/select-key.test.ts` for keypress patterns.

6. Repo Policy / Rule
   - Document the rule in AGENTS/README:
     - All prompt calls go through the adapter.
     - Interactive tests use injected I/O, not global mocks.

## Expected Coverage

- Full automation for interactive flows without needing an actual TTY
- Reliable cancellation tests (ESC and signal paths)
- Less brittle testing by avoiding prompt mocks for high-level flows

## Notes

- This plan is intentionally framework-agnostic and works across multiple repos.
- The adapter surface should be small and only expose prompts actually used.
