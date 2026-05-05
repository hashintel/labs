# AGENTS.md

Guidelines for AI agents working in this codebase.

## Project Overview

**agentprofiles-cli** is a Node.js CLI tool that manages named configuration profiles for LLM agent tools. It creates isolated config directories for different profiles (work/personal/client) and switches each agent's global config symlink to the selected profile.

### Key Concepts

- **Profiles**: Named configurations stored under `~/.config/agentprofiles/<agent>/<profile-name>/`
- **Agents**: Supported tools (claude, amp, opencode, codex, gemini, augment) — each uses one of two symlink strategies
- **Two symlink strategies**:
  - **`directory`** (clean agents: amp, opencode, augment, gemini): The agent's global config dir is a symlink to the active profile dir. Switching = one atomic symlink swap.
  - **`include`** (messy agents: claude, codex): The agent's global config dir stays a real directory. Only allow-listed entries inside it are individually symlinked to the active profile. Everything else (caches, session data) lives in the real global dir untouched.
- **`.profileinclude`**: Allow-list file (gitignore-like syntax) that defines which paths inside an include-strategy agent's global dir are managed as profile config. Trailing `/` = directory entry. Lives at `contentDir/{agent}/.profileinclude` (user-editable); CLI defaults are inline strings in `src/lib/profileinclude.ts`. Strategy is determined by whether a default `.profileinclude` exists for the agent.
- **\_base profile**: Reserved profile created during setup; serves as the default for new profiles
- **Shared directories**: Cross-agent resources like `~/.agents/` symlinked to `contentDir/_agents/`

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
├── index.ts              # CLI entry point (Citty setup)
├── commands/             # Command implementations
│   ├── add.ts            # Create new profile
│   ├── create.ts         # Alias for add
│   ├── edit.ts           # Edit profile configuration
│   ├── init.ts           # Alias for setup
│   ├── list.ts           # List available profiles
│   ├── remove.ts         # Remove a profile
│   ├── rm.ts             # Alias for remove
│   ├── set.ts            # Activate profile for an agent (creates symlinks)
│   ├── setup.ts          # Initialize agentprofiles system
│   ├── status.ts         # Show current profile status
│   └── unset.ts          # Switch an agent to base profile
├── lib/                  # Shared utilities
│   ├── config.ts         # ConfigManager class (profile CRUD, symlink management)
│   ├── profileinclude.ts # .profileinclude parser, defaults, and strategy detection
│   ├── symlink.ts        # Symlink creation/removal and validation
│   ├── gitignore.ts      # Agent-specific .gitignore templates
│   ├── validation.ts     # Profile name validation
│   ├── banner.ts         # CLI banner and info rendering
│   ├── onboarding.ts     # Setup wizard and interactive prompts
│   ├── main-menu.ts      # Interactive main menu
│   ├── prompts.ts        # Reusable prompt utilities
│   └── update.ts         # Update notifier integration
└── types/
    └── index.ts          # TypeScript interfaces, SUPPORTED_TOOLS, SHARED_DIRECTORIES

test/
├── cli.test.ts           # CLI integration tests (help, version)
└── config.test.ts        # ConfigManager unit tests

scripts/
└── smoke.sh              # End-to-end smoke test for symlink-based setup
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

Uses Citty for argument parsing:

```typescript
export const set = defineCommand({
  meta: {
    name: 'set',
    description: 'Set the active profile for an agent',
  },
  args: {
    agent: {
      type: 'string',
      description: 'Agent name',
      required: true,
    },
    name: {
      type: 'string',
      description: 'Profile name',
    },
  },
  run: async ({ args }) => {
    // Creates symlinks for the agent
  },
});
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

- `AGENTPROFILES_CONFIG_DIR` - Override config directory location (where `config.json` lives)
- `AGENTPROFILES_CONTENT_DIR` - Override content directory location (where profile directories are stored)

The tool does **not** set agent-specific environment variables. Instead, it manages symlinks:

- Agents read config from their global config directory (e.g., `~/.claude`)
- The tool creates symlinks pointing to the active profile
- No shell hooks or environment variable management needed

> **Note on `edit` and `$EDITOR`**
>
> The `edit` command respects the `$EDITOR` environment variable if it is set. This value may include arguments (for example `EDITOR="code --wait"`), and the command is parsed so that the editor binary and its arguments are invoked with the profile directory path appended as the final argument.

### Profile Activation

The tool manages symlinks differently per agent strategy:

1. **Include-strategy agents** (`agentprofiles set claude work`):
   - `~/.claude` stays a real directory (agent writes freely to it)
   - Each allow-listed entry gets a per-file symlink: `~/.claude/settings.json` → `contentDir/claude/work/settings.json`
   - Switching repoints each managed symlink to the new profile

2. **Directory-strategy agents** (`agentprofiles set amp work`):
   - `~/.config/amp` → `contentDir/amp/work` (entire dir is a symlink)
   - Switching is a single atomic symlink swap

3. **Shared directory symlinks** - For cross-agent resources:
   - Creates/updates `~/.agents` → `~/.config/agentprofiles/_agents/`
   - Accessible to all agents for shared skills, tools, etc.

### Adding New Agents

To add support for a new agent tool:

1. Add to `SUPPORTED_TOOLS` in `src/types/index.ts`:

   ```typescript
   newtool: {
     globalConfigDir: '.newtool',  // Path relative to home directory
     description: 'New Tool',
     envVar: 'NEWTOOL_CONFIG_DIR', // Optional: for reference/compatibility
   },
   ```

2. If the agent mixes config and state in its global dir (like claude/codex), add a `.profileinclude` default in `src/lib/profileinclude.ts`:

   ```typescript
   // In DEFAULT_PROFILE_INCLUDES:
   newtool: `# newtool .profileinclude\nsettings.json\nplugins/\n`,
   ```

   This automatically enables include-strategy for the agent. The `.gitignore` is auto-generated from the `.profileinclude`. Also add a fallback gitignore in `src/lib/gitignore.ts` only if needed.

3. If the agent keeps state separate from config (XDG-compliant), no `.profileinclude` is needed — it automatically uses directory-strategy. Add a gitignore template in `src/lib/gitignore.ts` if needed.

4. The tool automatically:
   - Creates profile directories under `~/.config/agentprofiles/newtool/`
   - Detects strategy from whether a `.profileinclude` default exists
   - Handles the \_base profile scaffold (including `.gitkeep` for empty dirs)

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

The smoke test (`scripts/smoke.sh`) performs end-to-end testing:

- Creates isolated config directory
- Tests profile creation, setting, and unsetting
- Verifies symlink creation and removal
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

3. **Symlink permissions**: Ensure the user has write permissions to the agent's global config directory (e.g., `~/.claude`)

4. **\_base profile**: This reserved profile is created during setup and serves as a template. Don't delete it.

5. **Shared directories**: The `_agents` directory in contentDir is symlinked to `~/.agents` for cross-agent resources

6. **Random profile names**: Uses `joyful` to generate suggested profile names (e.g. `amber-fox`)

7. **Strategy detection**: A new agent uses directory-strategy by default. Add a `DEFAULT_PROFILE_INCLUDES` entry in `src/lib/profileinclude.ts` to enable include-strategy.

8. **Bundle constraint**: tsup bundles everything to a single `dist/index.js`. Template content (`.profileinclude` defaults, gitignore strings) must be inline TypeScript strings — not external files in `src/templates/`.

## Dependencies

### Runtime

- `citty` - CLI argument parsing and command routing
- `@clack/prompts` - Interactive prompts
- `picocolors` - Terminal colors
- `zod` - Schema validation
- `joyful` - Random name generation
- `update-notifier` - Notify users of new versions

### Development

- `typescript` - TypeScript compiler
- `tsx` - TypeScript execution for development
- `vitest` - Test framework
- `execa` - Process execution in tests
- `eslint` + `typescript-eslint` - Linting
- `prettier` - Formatting
- `tsup` - TypeScript bundler for distribution
