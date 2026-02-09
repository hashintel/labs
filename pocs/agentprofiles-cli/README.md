# agentprofiles-cli

**Manage per-project configuration profiles for LLM agent tools.**

Supports 6 agents: [Claude Code](https://claude.ai/code), [Amp](https://amp.dev/), [OpenCode](https://opencode.ai/), [Codex](https://codex.dev/), [Gemini](https://gemini.google.com/), and [Augment](https://augment.dev/).

---

## The Problem

You use AI coding assistants. You have multiple contexts where you work—personal projects, work repos, client codebases—and you want different settings, histories, or API keys for each.

**The tools support this.** Each agent reads its configuration from a directory. Point that directory at a different location, and you get a completely isolated profile.

**But managing this manually is tedious:**

- You can't just set a global symlink—that's one profile for everything.
- You can't add symlinks to each project's dotfiles—that's not portable across projects with similar needs.
- You don't want to remember to update symlinks before launching your editor every time.

**agentprofiles-cli solves this.** It gives you named profiles, stores them centrally, and automatically activates the right profile when you enter a project directory using symlinks.

```sh
# Create profiles once
agentprofiles add claude work
agentprofiles add claude personal
agentprofiles add opencode work

# Activate per-project
cd ~/work/client-project
agentprofiles set claude work
agentprofiles set opencode work

cd ~/personal/side-project
agentprofiles set claude personal

# Now "cd" handles everything. Enter a directory, get the right profiles.
```

---

## FAQ

### "Just use your global symlink"

**The problem:** There's only one global symlink. If you work across multiple contexts (personal/work/clients), you're constantly mixing histories, API keys, and settings that shouldn't mix.

Some people create separate user accounts on their machine for this. That works, but it's heavy-handed for what should be a simple configuration switch.

### "Just use project-local config"

**The problem:** Project-local configs aren't portable. If you have 10 work repos that should all use your "work" profile, you'd need to copy the same configuration into all 10. When you update it, you update it in 10 places.

A profile should be defined once and _applied_ to projects, not duplicated into each one.

### "Just update the symlink manually"

**The problem:** This works for one-off commands, but breaks down for real workflows:

- You have to remember which profile goes with which project, every time.
- Multiple projects with the same profile need manual coordination.
- Switching between projects means manually updating symlinks.

Humans are bad at remembering things. Computers are good at it. Let the computer remember.

### "Why symlinks instead of environment variables?"

Symlinks are simpler and more direct:

- No shell hooks or environment variable management needed
- Works with any shell (zsh, bash, fish, etc.)
- Agents read config from their standard directory (e.g., `~/.claude`)
- No need for external tools like direnv
- Portable across machines (just update the symlink)

### "Do I really need another CLI tool?"

Fair question. You could manage this yourself with handwritten symlinks. agentprofiles-cli is worth it if you value:

- **Named profiles** you can list, create, and remove
- **Consistent file structure** without thinking about it
- **Automatic activation** when you enter a project directory
- **Guardrails** like profile name validation and symlink verification
- **Cross-agent support** for managing multiple tools at once

If you're comfortable managing raw symlinks yourself, you don't need this. But if you want the convenience of `agentprofiles set claude work`, this is for you.

---

## Requirements

### Node.js 18+

This is a Node.js CLI tool.

### No external dependencies

agentprofiles-cli uses symlinks, which are built into all modern operating systems. No direnv, no environment variable management, no shell hooks needed.

Just install the CLI and start creating profiles.

---

## Quick Start

### 1. Install

```sh
npm install -g agentprofiles-cli
```

### 2. Initialize

```sh
agentprofiles setup
```

This creates the config directory (`~/.config/agentprofiles/` by default) and sets up:

- Subdirectories for each supported agent tool
- A `_base` profile template for each agent
- Shared directories for cross-agent resources

### 3. Create profiles

```sh
agentprofiles add claude work
agentprofiles add claude personal
agentprofiles add opencode work
```

Or let it prompt you for a name:

```sh
agentprofiles add claude
# Suggests a random name like "jolly-curie", or enter your own
```

### 4. Activate profiles

```sh
agentprofiles set claude work
agentprofiles set opencode work
```

This creates symlinks:

- `~/.claude` → `~/.config/agentprofiles/claude/work`
- `~/.config/opencode` → `~/.config/agentprofiles/opencode/work`

The agents now read config from the active profiles.

### 5. Switch profiles

```sh
# Switch to a different profile
agentprofiles set claude personal

# Switch back to base profile
agentprofiles unset claude
```

---

## Commands

| Command                 | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `setup`                 | Initialize the agentprofiles system (alias: `init`) |
| `list [agent]`          | List profiles, optionally filtered by agent         |
| `add <agent> [name]`    | Create a new profile                                |
| `edit <agent> <name>`   | Open a profile's directory in your editor           |
| `remove <agent> [name]` | Delete a profile (alias: `rm`)                      |
| `set <agent> [name]`    | Activate a profile for the current directory        |
| `unset <agent>`         | Deactivate a profile for the current directory      |
| `status [agent]`        | Show current profile status for this directory      |
| `release <agent>`       | Stop managing an agent (restore original config)    |

### Common flags

- `--quiet` / `-q` — Suppress the banner

### Supported agents

- `claude` — Claude Code
- `amp` — Amp
- `opencode` — OpenCode
- `codex` — Codex
- `gemini` — Gemini
- `augment` — Augment

> **Note on `agentprofiles edit` and `$EDITOR`**
>
> The `agentprofiles edit` command uses the `$EDITOR` environment variable if it is set. This value may include arguments, and common patterns like `EDITOR="code --wait"` are supported. When present, the editor command (plus its arguments) is invoked with the profile directory path appended.

---

## How It Works

### Symlink-based activation

When you run `agentprofiles set claude work`, the tool creates a symlink:

```
~/.claude → ~/.config/agentprofiles/claude/work
```

The agent reads config from its standard directory (`~/.claude`). The symlink points to the active profile, so switching profiles is just updating the symlink target.

### Profile storage

Profiles are stored in your config directory:

```
~/.config/agentprofiles/
├── config.json
├── claude/
│   ├── .gitignore          # Ignores runtime artifacts
│   ├── _base/              # Base profile (default)
│   │   └── meta.json
│   ├── work/
│   │   └── meta.json       # Profile metadata
│   └── personal/
│       └── meta.json
├── opencode/
│   ├── .gitignore
│   ├── _base/
│   │   └── meta.json
│   └── work/
│       └── meta.json
└── _agents/                # Shared cross-agent resources
    └── meta.json
```

Each profile directory _is_ the config directory for that tool. When `~/.claude` points to `~/.config/agentprofiles/claude/work`, Claude Code reads its settings, history, and cache from there.

### Shared directories

The tool also manages shared resources:

```
~/.agents → ~/.config/agentprofiles/_agents/
```

This allows all agents to access shared skills, tools, and resources.

---

## Troubleshooting

### "The symlink isn't being created"

Debug checklist:

1. Check the profile exists: `agentprofiles list claude`
2. Check symlink status: `ls -la ~/.claude`
3. Verify permissions: Can you write to `~/.`?
4. Run `agentprofiles status` to see the current state

### "The agent isn't reading the right config"

1. Verify the symlink points to the right place: `ls -la ~/.claude`
2. Check the profile directory exists: `ls -la ~/.config/agentprofiles/claude/work`
3. Verify the agent is reading from the symlinked directory (check agent settings)

### "I want to use a different config location"

You can override the config directory:

```sh
export AGENTPROFILES_CONFIG_DIR=/path/to/config
export AGENTPROFILES_CONTENT_DIR=/path/to/content
```

Or set `contentDir` in `config.json` to point to a different location.

### "I already have a symlink at ~/.claude"

agentprofiles will overwrite it. If you have existing config there, move it first:

```sh
mv ~/.claude ~/.claude.backup
agentprofiles set claude work
```

Then migrate your config from the backup to the new location.

### "How do I see what's currently active?"

Use the `status` command:

```sh
agentprofiles status
```

This shows which profiles are active for each agent and the status of all symlinks.

---

## Configuration

### Default locations

- **Config directory:** `~/.config/agentprofiles/` (or `$XDG_CONFIG_HOME/agentprofiles/`)
- **Content directory:** Same as config directory by default

### Environment variable overrides

| Variable                    | Purpose                                 |
| --------------------------- | --------------------------------------- |
| `AGENTPROFILES_CONFIG_DIR`  | Override where `config.json` lives      |
| `AGENTPROFILES_CONTENT_DIR` | Override where profile directories live |

You can also set `contentDir` in `config.json` to point to a different location.

---

## Removing agentprofiles from a project

To stop using agentprofiles for an agent:

```sh
# Switch back to base profile (keeps the symlink, but points to base)
agentprofiles unset claude
agentprofiles unset opencode
```

To completely remove agentprofiles (remove symlinks):

```sh
# Manually remove symlinks
rm ~/.claude
rm ~/.config/opencode
rm ~/.agents
```

Or use the `release` command (if available in your version):

```sh
agentprofiles release claude
agentprofiles release opencode
```

---

## Development

```sh
# Install dependencies
npm install

# Run in development
npm run start -- --help

# Build
npm run build

# Run all checks (matches CI)
npm run format:check && npm run lint && npm run typecheck && npm run test
```

| Script              | Description                   |
| ------------------- | ----------------------------- |
| `npm run build`     | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting   |
| `npm run start`     | Run via tsx (no build needed) |
| `npm run test`      | Run tests                     |
| `npm run lint`      | Lint with ESLint              |
| `npm run format`    | Format with Prettier          |

---

## Contributors

`agent-profiles-cli` was created by [Lu Nelson](https://github.com/lunelson). It is being developed in conjunction with [HASH](https://hash.dev/) as an open-source project. 

If you have questions, please create a [discussion](https://github.com/orgs/hashintel/discussions). 

## License

`agent-profiles-cli` is available under either of the [Apache License, Version 2.0] or [MIT license] at your option. Please see the [LICENSE] file to review your options.
