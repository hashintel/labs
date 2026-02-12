# agentprofiles-cli

**Manage per-project configuration profiles for LLM agent tools via `direnv`.**

Currently supports [Claude Code](https://claude.ai/code) and [OpenCode](https://opencode.ai/).

---

## The Problem

You use an AI coding assistant. Maybe Claude Code, maybe OpenCode. You have multiple contexts where you work—personal projects, work repos, client codebases—and you want different settings, histories, or API keys for each.

**The tools support this.** Both Claude Code and OpenCode read their configuration from a directory specified by an environment variable (`CLAUDE_CONFIG_DIR`, `OPENCODE_CONFIG_DIR`). Point the variable at a different directory, and you get a completely isolated profile.

**But managing this manually is tedious:**

- You can't just set the variable in your shell config—that's global, one profile for everything.
- You can't add it to each project's dotfiles—that's not portable across projects with similar needs.
- You don't want to remember to export variables before launching your editor every time.

**agentprofiles-cli solves this.** It gives you named profiles, stores them centrally, and uses `direnv` to automatically activate the right profile when you enter a project directory.

```sh
# Create profiles once
agentprofiles add claude work
agentprofiles add claude personal

# Activate per-project
cd ~/work/client-project
agentprofiles set claude work --allow

cd ~/personal/side-project
agentprofiles set claude personal --allow

# Now "cd" handles everything. Enter a directory, get the right profile.
```

---

## FAQ

### "Just use your global config"

**The problem:** There's only one global config. If you work across multiple contexts (personal/work/clients), you're constantly mixing histories, API keys, and settings that shouldn't mix.

Some people create separate user accounts on their machine for this. That works, but it's heavy-handed for what should be a simple configuration switch.

### "Just use project-local config"

**The problem:** Project-local configs aren't portable. If you have 10 work repos that should all use your "work" profile, you'd need to copy the same configuration into all 10. When you update it, you update it in 10 places.

A profile should be defined once and _applied_ to projects, not duplicated into each one.

### "Just set the env var before launching"

**The problem:** This works for one-off commands, but breaks down for real workflows:

- Interactive sessions that spawn subprocesses inherit the environment—but only if you remembered to set it.
- Multiple terminals need the same treatment.
- You have to remember which profile goes with which project, every time.

Humans are bad at remembering things. Computers are good at it. Let the computer remember.

### "Why direnv specifically?"

[direnv](https://direnv.net/) is a mature, widely-used tool for per-directory environment management. It:

- Automatically loads/unloads environment variables when you `cd` in and out
- Has a security model (`direnv allow`) so you explicitly trust changes
- Works with any shell (zsh, bash, fish, etc.)
- Is already installed on many developer machines

We didn't want to reinvent this. direnv does one job well; agentprofiles-cli just makes it easy to use for agent tool profiles.

### "Do I really need another CLI tool?"

Fair question. You could manage this yourself with handwritten `.envrc` files. agentprofiles-cli is worth it if you value:

- **Named profiles** you can list, create, and remove
- **Consistent file structure** without thinking about it
- **Clean `.envrc` files** that only contain a small bootstrap block
- **Guardrails** like profile name validation and direnv hook detection

If you're comfortable managing raw env vars yourself, you don't need this. But if you want the convenience of `agentprofiles set claude work`, this is for you.

---

## Requirements

### Node.js 20+

This is a Node.js CLI tool.

### direnv (required)

agentprofiles-cli generates direnv-compatible files. Without direnv installed and hooked into your shell, those files won't do anything.

**Install direnv:**

```sh
# macOS
brew install direnv

# Ubuntu/Debian
sudo apt install direnv

# Or see https://direnv.net/docs/installation.html
```

**Hook it into your shell** (add to your shell's rc file):

```sh
# ~/.zshrc
eval "$(direnv hook zsh)"

# ~/.bashrc
eval "$(direnv hook bash)"

# ~/.config/fish/config.fish
direnv hook fish | source
```

After adding the hook, restart your shell or source the rc file.

**Verify it works:**

```sh
direnv --version
```

When you `cd` into a directory with an `.envrc`, you should see direnv print a message about loading or blocking the file.

---

## Installation

```sh
npm install -g agentprofiles-cli
```

---

## Getting Started

### 1. Initialize

```sh
agentprofiles setup
```

This creates the config directory (`~/.config/agentprofiles/` by default) and sets up subdirectories for each supported agent tool.

### 2. Create profiles

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

### 3. Activate a profile in a project

```sh
cd /path/to/your/project
agentprofiles set claude work --allow
```

This writes two files:

- `.envrc` — with a small bootstrap block
- `.envrc.agentprofiles` — with the actual export statements

The `--allow` flag runs `direnv allow` automatically. Without it, you'll need to run `direnv allow` manually.

### 4. Work normally

Now every time you `cd` into that project, direnv automatically exports `CLAUDE_CONFIG_DIR` pointing to your "work" profile. When you `cd` out, it unloads.

### 5. Switch or remove profiles

```sh
# Switch to a different profile
agentprofiles set claude personal --allow

# Remove a profile from this project (keeps the profile itself)
agentprofiles unset claude --allow
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

### Common flags

- `--allow` / `-y` — Auto-run `direnv allow` after modifying files (for `set` and `unset`)
- `--quiet` / `-q` — Suppress the banner

> **Note on `agentprofiles edit` and `$EDITOR`**
>
> The `agentprofiles edit` command uses the `$EDITOR` environment variable if it is set. This value may include arguments, and common patterns like `EDITOR="code --wait"` are supported. When present, the editor command (plus its arguments) is invoked with the profile directory path appended.

---

## How It Works

### Files in your project

When you run `agentprofiles set claude work`, it creates/updates:

**`.envrc`** — Contains a small bootstrap block:

```sh
### agentprofiles:begin
watch_file .envrc.agentprofiles
source_env_if_exists .envrc.agentprofiles
### agentprofiles:end
```

**`.envrc.agentprofiles`** — Contains the actual exports:

```sh
# tool-generated; do not edit

### agentprofiles:begin claude
export CLAUDE_CONFIG_DIR="$HOME/.config/agentprofiles/claude/work"
### agentprofiles:end claude
```

Only the block between `### agentprofiles:begin` and `### agentprofiles:end` in `.envrc` is managed by this tool. Your other environment variables are left alone.

### Profile storage

Profiles are stored in your config directory:

```
~/.config/agentprofiles/
├── config.json
├── claude/
│   ├── .gitignore          # Ignores runtime artifacts
│   ├── work/
│   │   └── meta.json       # Profile metadata
│   └── personal/
│       └── meta.json
└── opencode/
    ├── .gitignore
    └── work/
        └── meta.json
```

Each profile directory _is_ the config directory for that tool. When `CLAUDE_CONFIG_DIR` points to `~/.config/agentprofiles/claude/work`, Claude Code reads its settings, history, and cache from there.

---

## Troubleshooting

### "Nothing happens when I cd into the project"

direnv isn't hooked into your shell.

1. Verify direnv is installed: `direnv --version`
2. Add the hook to your shell rc file (see [Requirements](#direnv-required))
3. Restart your shell or source the rc file
4. Re-enter the directory or run `direnv reload`

### "direnv says the .envrc is blocked"

This is direnv's security model. Run:

```sh
direnv allow
```

Or use `--allow` when running `agentprofiles set` or `agentprofiles unset`.

### "The env var isn't set correctly"

Debug checklist:

1. Check the files exist: `cat .envrc` and `cat .envrc.agentprofiles`
2. Verify direnv loaded: `direnv status`
3. Check the variable: `echo $CLAUDE_CONFIG_DIR`
4. Look for conflicts: Are you exporting the same variable elsewhere?

Force direnv to reload:

```sh
direnv reload
```

### I already have a `.envrc`

That's fine. agentprofiles only manages the section between its markers. Keep your existing content outside that block.

If you export the same variable elsewhere in the file, the last assignment wins.

---

## What to Commit

This depends on your team, but common approaches:

| File                   | Recommendation                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `.envrc`               | **Commit it.** The bootstrap block is generic and portable.                                                                |
| `.envrc.agentprofiles` | **Usually gitignore.** It contains paths that may differ per machine. Have each developer run `agentprofiles set` locally. |

If your team uses identical paths (e.g., everyone uses defaults), committing `.envrc.agentprofiles` is fine.

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

To stop using agentprofiles in a specific project:

```sh
# Remove all agent blocks
agentprofiles unset claude --allow
agentprofiles unset opencode --allow

# Then manually remove the bootstrap block from .envrc
# and delete .envrc.agentprofiles if it's now empty
```

Or manually:

1. Delete the `### agentprofiles:begin` / `### agentprofiles:end` block from `.envrc`
2. Delete `.envrc.agentprofiles`
3. Run `direnv allow`

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
