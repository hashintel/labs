# AGENTS.md

Guidelines for AI agents working in this codebase.

## Project Overview

**agentprofiles-cli** is a Node.js CLI tool that manages per-project configuration profiles for LLM agent tools (Claude Code, OpenCode) via `direnv`. It creates isolated config directories for different profiles (work/personal/client) and uses direnv to automatically set the appropriate environment variables when entering a project directory.

### Key Concepts

- **Profiles**: Named configurations stored under `~/.config/agentprofiles/<agent>/<profile-name>/`
- **Agents**: Supported tools (currently `claude` and `opencode`) that read config from env vars
- **Bootstrap block**: Section in `.envrc` that sources the managed file
- **Managed file**: `.envrc.agentprofiles` containing per-agent export statements

## Commands

### Development

| Command                   | Description                                |
| ------------------------- | ------------------------------------------ |
| `npm install`             | Install dependencies                       |
| `npm run start`           | Run CLI directly via tsx (no build needed) |
| `npm run start -- --help` | Run CLI with arguments                     |
| `npm run build`           | Compile TypeScript to `dist/`              |
| `npm run typecheck`       | Type-check without emitting files          |
| `npm test`                | Run tests with Vitest                      |
| `npm run test:watch`      | Run tests in watch mode                    |
| `npm run lint`            | Lint source files with ESLint              |
| `npm run lint:fix`        | Lint and auto-fix issues                   |
| `npm run format`          | Format all files with Prettier             |
| `npm run format:check`    | Check formatting without writing           |
| `npm run smoke`           | Run smoke test (requires build first)      |

### CI Pipeline

CI runs on Node.js 20 and 22:

1. `npm run format:check`
2. `npm run lint`
3. `npm run build` (acts as typecheck)
4. `npm test`

Run all checks locally before pushing:

```sh
npm run format:check && npm run lint && npm run typecheck && npm run test
```

## Code Organization

```
src/
├── index.ts              # CLI entry point (Commander.js setup)
├── commands/             # Command implementations
│   ├── add.ts            # Create new profile
│   ├── edit.ts           # Edit profile configuration
│   ├── list.ts           # List available profiles
│   ├── remove.ts         # Remove a profile
│   ├── set.ts            # Activate profile for current directory
│   ├── setup.ts          # Initialize agentprofiles system
│   └── unset.ts          # Deactivate profile for current directory
├── lib/                  # Shared utilities
│   ├── config.ts         # ConfigManager class (profile CRUD, directory management)
│   ├── direnv.ts         # direnv hook detection and shell hints
│   ├── envrc.ts          # .envrc file manipulation (bootstrap blocks, agent blocks)
│   ├── gitignore.ts      # Agent-specific .gitignore templates
│   └── validation.ts     # Profile name validation
└── types/
    └── index.ts          # TypeScript interfaces and SUPPORTED_TOOLS constant

test/
├── cli.test.ts           # CLI integration tests (help, version)
└── config.test.ts        # ConfigManager unit tests

scripts/
└── smoke-envrc.sh        # End-to-end smoke test for envrc generation
```

## Code Patterns and Conventions

### TypeScript Configuration

- Extends `@tsconfig/strictest` and `@tsconfig/node20`
- ES modules (`"type": "module"` in package.json)
- File extensions required in imports (`.js` for compiled output)
- Strict mode enabled

### Import Patterns

```typescript
// Node.js built-ins with node: prefix
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Local imports require .js extension
import { ConfigManager } from '../lib/config.js';
import { SUPPORTED_TOOLS } from '../types/index.js';
```

### CLI Framework

Uses Commander.js for argument parsing:

```typescript
program
  .command('set')
  .description('Set the active profile for the current directory')
  .argument('<agent>', 'Agent name')
  .argument('[name]', 'Profile name')
  .option('-y, --allow', 'Run direnv allow after updating files')
  .action(setCommand);
```

### Interactive Prompts

Uses `@clack/prompts` for user interaction:

```typescript
import { intro, outro, text, select, isCancel, cancel, spinner, note } from '@clack/prompts';

// Always handle cancellation
const response = await text({ message: 'Enter profile name:' });
if (isCancel(response)) {
  cancel('Operation cancelled.');
  process.exit(0);
}
```

### Colored Output

Uses `picocolors` for terminal colors:

```typescript
import color from 'picocolors';

console.log(color.cyan('highlighted text'));
console.log(color.red(`Error: ${message}`));
console.log(color.dim('secondary text'));
console.log(color.bold('important text'));
```

### Error Handling

Commands exit with status code 1 on error:

```typescript
if (!SUPPORTED_TOOLS[agent]) {
  console.error(color.red(`Unsupported agent: ${agent}`));
  process.exit(1);
}
```

### ConfigManager Pattern

All profile operations go through ConfigManager:

```typescript
const config = new ConfigManager();
await config.init();  // Must call init() before use

// Available methods:
config.getConfigDir()
config.getContentDir()
await config.ensureConfigDir()
await config.getProfiles(agent)
await config.createProfile(agent, name, description?)
```

### Validation

Profile names must be slug-like:

- Start with letter or number
- Contain only letters, numbers, `.`, `-`, `_`
- No `..` sequences
- No surrounding whitespace

```typescript
import { validateProfileName } from '../lib/validation.js';

const error = validateProfileName(name);
if (error) {
  console.error(color.red(error));
  process.exit(1);
}
```

### Environment Variables

Key environment variables this tool uses:

- `AGENTPROFILES_CONFIG_DIR` - Override config directory location
- `AGENTPROFILES_CONTENT_DIR` - Override content directory location
- `XDG_CONFIG_HOME` - Standard XDG config location (defaults to `~/.config`)

Environment variables it sets (via direnv):

- `CLAUDE_CONFIG_DIR` - Claude Code config directory
- `OPENCODE_CONFIG_DIR` - OpenCode config directory

### File Manipulation

The tool manages two files in project directories:

1. **`.envrc`** - Contains bootstrap block between markers:

   ```sh
   ### agentprofiles:begin
   watch_file .envrc.agentprofiles
   source_env_if_exists .envrc.agentprofiles
   ### agentprofiles:end
   ```

2. **`.envrc.agentprofiles`** - Contains agent-specific exports:

   ```sh
   # tool-generated; do not edit

   ### agentprofiles:begin claude
   export CLAUDE_CONFIG_DIR="$HOME/.config/agentprofiles/claude/work"
   ### agentprofiles:end claude
   ```

### Adding New Agents

To add support for a new agent tool:

1. Add to `SUPPORTED_TOOLS` in `src/types/index.ts`:

   ```typescript
   newtool: {
     envVar: 'NEWTOOL_CONFIG_DIR',
     xdgCompliant: true,
     description: 'New Tool',
   },
   ```

2. Add gitignore template in `src/lib/gitignore.ts` if needed

## Testing

### Test Framework

Uses Vitest with globals enabled:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
```

### Test Patterns

**CLI integration tests** (`test/cli.test.ts`):

- Use `execa` to run CLI via tsx
- Test help output and version

**Unit tests** (`test/config.test.ts`):

- Use temp directories for isolation
- Snapshot and restore environment variables
- Clean up in `afterEach`

```typescript
beforeEach(async () => {
  envSnapshot = snapshotEnv(ENV_KEYS);
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentprofiles-test-'));
});

afterEach(async () => {
  restoreEnv(envSnapshot);
  await fs.rm(tmpRoot, { recursive: true, force: true });
});
```

### Smoke Test

The smoke test (`scripts/smoke-envrc.sh`) performs end-to-end testing:

- Creates isolated config directory
- Tests profile creation, setting, and unsetting
- Verifies file contents with assertions
- Cleans up on exit

Run with `npm run smoke` (requires `npm run build` first).

## Formatting and Style

### Prettier Configuration

```json
{
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100,
  "tabWidth": 2
}
```

### ESLint

- Uses ESLint 9 flat config
- Extends recommended + TypeScript recommended
- Prettier integration (eslint-config-prettier)
- Unused vars allowed if prefixed with `_`

## Common Gotchas

1. **File extensions in imports**: All TypeScript imports must use `.js` extension (for ES module compatibility)

2. **ConfigManager.init()**: Must call `await config.init()` before using ConfigManager methods that depend on config.json

3. **Shell paths**: Use `toShellPath()` to convert absolute paths to `$HOME`-based paths for portability in envrc files

4. **Legacy file migration**: The tool migrates `.envrc.agent` to `.envrc.agentprofiles` automatically

5. **direnv hook detection**: Check `isDirenvHookLoaded()` to warn users if direnv isn't properly configured

6. **Random profile names**: Uses `@criblinc/docker-names` to generate suggested profile names (Docker-style: `adjective-scientist`)

## Dependencies

### Runtime

- `commander` - CLI argument parsing
- `@clack/prompts` - Interactive prompts
- `picocolors` - Terminal colors
- `zod` - Schema validation (available but not heavily used yet)
- `@criblinc/docker-names` - Random name generation

### Development

- `typescript` - TypeScript compiler
- `tsx` - TypeScript execution for development
- `vitest` - Test framework
- `execa` - Process execution in tests
- `eslint` + `typescript-eslint` - Linting
- `prettier` - Formatting
