# Repository Guidelines

## Project Structure & Module Organization

- `src/index.ts` is the CLI entry point using `@clack/prompts` for interactive UI
- `src/commands/` contains command implementations (`sync.ts`, `install.ts`, `status.ts`, `detect.ts`)
- `src/lib/` contains core utilities (`marketplace.ts`, `ide-registry.ts`, `extensions.ts`, `vsix.ts`, `semver.ts`, `storage.ts`, `install-plan.ts`)
- `src/types.ts` contains shared TypeScript type definitions
- VSIX files are cached in `~/.cache/vsix-bridge/<ide>/` (XDG standard)
- Configuration stored in `~/.config/vsix-bridge/` (XDG standard)

## Build, Test, and Development Commands

- `npm install` sets up the environment and installs dependencies
- `npm run build` compiles TypeScript to `dist/` using tsup
- `npm run typecheck` runs TypeScript type checking without emitting
- `npm run test` runs Vitest tests
- `npm run test:watch` runs tests in watch mode
- `node dist/index.js <command>` runs the built CLI

## Coding Style & Naming Conventions

- TypeScript with strict mode; use explicit types for function signatures
- 2-space indentation, single quotes, no semicolons (follows tsup defaults)
- Use `node:` prefix for Node.js built-in imports
- Prefer `Path` operations from `node:path` and `node:fs`
- Use async/await over callbacks; handle errors gracefully
- Export pure functions from `lib/`; commands coordinate between libraries

## Testing Guidelines

- Use Vitest for unit tests; test files are co-located as `*.test.ts`
- Mock external dependencies (fetch, child_process, fs) in tests
- Each library module has corresponding test file
- Run `npm run test` before committing; all tests must pass

## Commit & Pull Request Guidelines

- Using Jujutsu VCS; commit with `jj commit -m "message"`
- Commit messages are short, imperative summaries
- Each phase of work should pass tests before committing
- Include what was changed and verification steps in PR descriptions
