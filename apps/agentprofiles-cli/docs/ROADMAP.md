# Roadmap

## Backport: patterns proven in `dot-agents/profiles`

The following patterns were developed and validated manually in
[`lunelson/dot-agents`](https://github.com/lunelson/dot-agents) and should be
incorporated into the CLI's `setup` command so they are created automatically.

---

### 1. Deny-all `.gitignore` strategy

**Current behavior:** The CLI generates per-agent `.gitignore` files that
name specific files/directories to ignore (deny-list). This is fragile because
agents frequently add new transient files (caches, sessions, logs), requiring
constant updates.

**Required behavior:** Switch to a deny-all/allow-list pattern. Each agent's
`.gitignore` should:

1. Ignore everything inside profile directories by default (`*/*`)
2. Allow-list only the portable config files worth tracking

Here are the exact patterns per agent:

```gitignore
# claude/.gitignore
*/*
!*/meta.json
!*/settings.json
!*/CLAUDE.md
!*/README.md
!*/plugins/
*/plugins/*
!*/plugins/known_marketplaces.json
!*/commands/

# amp/.gitignore
*/*
!*/meta.json
!*/settings.json
!*/AGENTS.md
!*/README.md

# opencode/.gitignore
*/*
!*/meta.json
!*/opencode.json
!*/opencode.jsonc
!*/AGENTS.md
!*/README.md
!*/agents/
!*/plugins/
!*/commands/

# codex/.gitignore
*/*
!*/meta.json
!*/config.toml
!*/README.md
!*/rules/
!*/prompts/
!*/skills/

# gemini/.gitignore
*/*
!*/meta.json
!*/settings.json
!*/GEMINI.md
!*/AGENTS.md
!*/README.md
!*/skills/

# augment/.gitignore
*/*
!*/meta.json
!*/settings.json
!*/README.md
!*/commands/
```

**Why this matters:** The deny-all pattern is future-proof. When an agent adds
new cache directories or state files, they are automatically ignored. Only
explicitly allow-listed config files are tracked.

---

### 2. Global rules file with cross-agent symlinks

**Problem:** Each agent reads its global rules from a different filename in its
config directory. Maintaining the same instructions across agents and profiles
requires manual duplication.

**Required behavior:** The `setup` command should create a single source of
truth and symlink it into each agent's `_base` profile under the filename that
agent expects. When creating named profiles (`add` command), the CLI should
also create a symlink from the named profile to `_base`.

#### File layout

```
<contentDir>/
├── _agents/
│   └── AGENTS.md              ← single source of truth
├── claude/
│   ├── _base/
│   │   └── CLAUDE.md          → ../../_agents/AGENTS.md
│   └── <profile>/
│       └── CLAUDE.md          → ../_base/CLAUDE.md
├── amp/
│   ├── _base/
│   │   └── AGENTS.md          → ../../_agents/AGENTS.md
│   └── <profile>/
│       └── AGENTS.md          → ../_base/AGENTS.md
├── opencode/
│   ├── _base/
│   │   └── AGENTS.md          → ../../_agents/AGENTS.md
│   └── <profile>/
│       └── AGENTS.md          → ../_base/AGENTS.md
├── codex/
│   ├── _base/
│   │   └── (no documented global rules file)
│   └── ...
├── gemini/
│   ├── _base/
│   │   └── GEMINI.md          → ../../_agents/AGENTS.md
│   └── <profile>/
│       └── GEMINI.md          → ../_base/GEMINI.md
└── augment/
    ├── _base/
    │   └── (no documented global rules file)
    └── ...
```

#### Per-agent filename mapping

| Agent    | Rules filename | Notes                                       |
| -------- | -------------- | ------------------------------------------- |
| claude   | `CLAUDE.md`    | Primary; also reads `AGENTS.md` as fallback |
| amp      | `AGENTS.md`    | Primary; also reads `CLAUDE.md` as fallback |
| opencode | `AGENTS.md`    | Primary; also reads `CLAUDE.md` as fallback |
| codex    | —              | Not documented for global rules             |
| gemini   | `GEMINI.md`    | Proprietary; no `AGENTS.md` fallback        |
| augment  | —              | Not documented for global rules             |

#### Symlink chain design

The two-hop chain (`<profile>/CLAUDE.md → ../_base/CLAUDE.md → ../../_agents/AGENTS.md`)
is intentional. It provides an override point: if a named profile needs custom
rules, the user replaces the symlink with a real file. The `_base` level
inherits directly from `_agents/AGENTS.md`, so the default is always the
shared global rules.

#### Implementation notes

- `setup` should create `_agents/AGENTS.md` if it doesn't exist (with default
  content or empty).
- `setup` should create the `_base` → `_agents` symlink for each agent that
  has a documented global rules file.
- `add` should create the `<profile>` → `_base` symlink for each new profile.
- The `.gitignore` allow-lists (see section 1) must include the rules filename
  for each agent.

---

### 3. Content directory `AGENTS.md` for agent context

**Problem:** When an AI agent works inside the content directory (e.g. editing
profile configs), it has no context about what the directory structure means,
how profiles work, or what it should avoid touching.

**Required behavior:** The `setup` command should generate an `AGENTS.md` file
at the root of the content directory that explains the structure and rules to
any AI agent working in the codebase.

The file should include:

1. What the directory is (the content directory for agentprofiles-cli)
2. The directory structure (agent subdirectories, `_agents/` shared resources)
3. How profiles work (symlink-based activation, `_base` as default)
4. Rules for editing:
   - Do not rename or move profile directories (breaks symlinks)
   - Do not delete `meta.json` (CLI uses it to enumerate profiles)
   - Agent config files can be edited freely
   - `.gitignore` files at the agent level are managed by the CLI

This file should be regenerated on each `setup` run to stay in sync with the
current set of supported agents.

---

### 4. `_shared` directory for auth and state symlinks

**Problem:** Some agents (e.g. `claude`, `codex`) store authentication
tokens and session state inside their config directory, unlike agents
like `amp` and `opencode` which keep state separate in XDG-compliant
locations. When switching profiles, auth and state would be lost unless
duplicated into every profile.

**Current manual solution (in `dot-agents/profiles`):** A `_shared`
directory exists alongside `_base` in each agent's content directory
that needs it. It holds the actual auth/state files and directories.
Each profile (including `_base`) symlinks these files back to `_shared`,
so authentication and session state carry across profile switches.

#### Example layout

```
<contentDir>/
└── claude/
    ├── _shared/
    │   ├── credentials.json      ← real file (auth tokens)
    │   ├── statsig/              ← real directory (session state)
    │   └── ...
    ├── _base/
    │   ├── credentials.json      → ../_shared/credentials.json
    │   ├── statsig/              → ../_shared/statsig/
    │   └── ...
    └── <profile>/
        ├── credentials.json      → ../_shared/credentials.json
        ├── statsig/              → ../_shared/statsig/
        └── ...
```

#### Which agents need `_shared`

| Agent    | Needs `_shared` | Reason                                    |
| -------- | --------------- | ----------------------------------------- |
| claude   | Yes             | Stores auth tokens and session state      |
| codex    | Yes             | Stores auth tokens in config directory    |
| amp      | No              | XDG-compliant; state kept separately      |
| opencode | No              | XDG-compliant; state kept separately      |
| gemini   | TBD             | Needs investigation                       |
| augment  | TBD             | Needs investigation                       |

#### Implementation notes

- `_shared` is already a reserved slug (`SHARED_PROFILE_SLUG`) and is
  filtered out of `getProfiles()` and the `list` command display.
- `setup` should create `_shared` for agents that need it and populate
  with the appropriate auth/state files.
- `add` should create symlinks from the new profile to `_shared` for
  each auth/state file.
- The deny-all `.gitignore` (section 1) already ignores `_shared/`
  contents — auth and state files must never be tracked.

---

## UX Improvements

### ~~Fix banner to say "agentprofiles" (plural)~~ ✅

~~The cfont banner currently renders "agentprofile" (singular).~~
Done — banner regenerated with `cfonts "agentprofiles" -f tiny -c candy`.

### ~~Try `joyful` for profile name generation~~ ✅

~~Replace `@criblinc/docker-names` with `joyful`.~~
Done — swapped to [`joyful`](https://github.com/haydenbleasel/joyful).

### ~~Align `list` output with Clack visual style~~ ✅

~~Rewrite `list` to use `@clack/prompts` functions.~~
Done — uses `log.info` for config summary and `note` boxes for each
agent's profiles. `_base` is hidden from the list; a `● Base profile`
indicator appears when the active profile is `_base`. Descriptions are
only shown when present.
