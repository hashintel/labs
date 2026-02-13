# vsix-bridge-cli

Sync VS Code extensions to fork IDEs (Cursor, Antigravity, Windsurf) by downloading compatible versions from the official Microsoft Marketplace.

## Why?

VS Code forks often use OpenVSIX or custom registries that may:

- Lag behind official Microsoft Marketplace updates
- Miss extensions entirely
- Contain poorly vetted packages

**vsix-bridge-cli** uses your local VS Code installation as the source of truth, downloads the exact compatible versions, and installs them into fork IDEs.

## Installation

```sh
npm install -g vsix-bridge-cli
```

## Usage

### Detect installed IDEs

```sh
vsix-bridge detect
```

Shows all detected IDEs with their VS Code engine versions and CLI availability.

### Sync extensions

```sh
vsix-bridge sync                    # Sync to all detected IDEs
vsix-bridge sync --to cursor        # Sync to Cursor only
vsix-bridge sync --to cursor --to windsurf  # Sync to multiple IDEs
```

Downloads compatible VSIX files from Microsoft Marketplace to `~/.cache/vsix-bridge/<ide>/`.

### View status

```sh
vsix-bridge status                  # Compare VS Code with a fork
vsix-bridge status --to cursor      # Compare with Cursor specifically
```

Shows:

- Extensions in VS Code but not in fork
- Extensions in fork but not in VS Code
- Version differences
- Disabled state differences

### Install extensions

```sh
vsix-bridge install --to cursor     # Install synced extensions
vsix-bridge install --dry-run       # Preview without making changes
```

**Flags:**

| Flag              | Description                                             |
| ----------------- | ------------------------------------------------------- |
| `--sync-removals` | Uninstall extensions in fork that aren't in VS Code     |
| `--dry-run`       | Show what would be done without doing it                |

## Supported IDEs

| IDE         | CLI      | Detected From                   |
| ----------- | -------- | ------------------------------- |
| Cursor      | `cursor` | `/Applications/Cursor.app`      |
| Antigravity | `agy`    | `/Applications/Antigravity.app` |
| Windsurf    | `surf`   | `/Applications/Windsurf.app`    |

## Storage

- **Config:** `~/.config/vsix-bridge/`
- **Cache (VSIX files):** `~/.cache/vsix-bridge/<ide>/`

## Requirements

- Node.js 20+
- VS Code with CLI installed (`code` command in PATH)
- Target IDE CLIs in PATH (run "Install 'X' command in PATH" from each IDE)

## Contributors

`vsix-bridge-cli` was created by [Lu Nelson](https://github.com/lunelson). It is being developed in conjunction with [HASH](https://hash.dev/) as an open-source project. 

If you have questions, please create a [discussion](https://github.com/orgs/hashintel/discussions). 

## License

`vsix-bridge-cli` is available under either of the [Apache License, Version 2.0] or [MIT license] at your option. Please see the [LICENSE] file to review your options.
