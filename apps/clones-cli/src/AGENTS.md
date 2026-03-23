# clones-cli Source

## Purpose

Owns the TypeScript CLI entrypoint, command definitions, and shared libraries for registry/local state, git operations, prompts, and UI output.

## Entry Points

- `src/cli.ts` - CLI entrypoint and command registration.
- `src/commands/*.ts` - Individual commands (add, list, rm, sync, etc.).
- `src/lib/*` - Shared logic used by commands.
- `src/types/*` - Shared types.

## Contracts & Invariants

- Commands export a default `defineCommand(...)` and are registered in `src/cli.ts`.
- Persistent state lives under the config dir from `src/lib/config.ts` and is read/written via:
- `src/lib/registry.ts` (registry.jsonl)
  - `src/lib/local-state.ts` (local.json)
- Registry/local state writes are atomic (write temp file, then rename). Preserve that behavior.

## Patterns

To add a new command:

1. Create `src/commands/<name>.ts` exporting `defineCommand` as default.
2. Register it in `src/cli.ts` under `subCommands`.
3. Reuse helpers in `src/lib/*` instead of duplicating logic.

## Anti-patterns

- Do not read/write registry or local-state JSON directly from commands.
- Do not bypass config path helpers in `src/lib/config.ts`.

## Related Context

- Root instructions: `../AGENTS.md`
