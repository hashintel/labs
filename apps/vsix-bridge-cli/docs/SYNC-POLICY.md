# Extension Sync Policy

This document defines how vsix-bridge synchronizes extensions from VSCode to target IDEs (Cursor, Windsurf, Antigravity).

## Core Principles

1. **VSCode is the source of truth** for which extensions should exist
2. **Target IDEs own their activation state** after initial install
3. **One-way sync only** - targets never update VSCode

## Sync Behavior

### Installation (always performed)

| Source (VSCode)           | Target IDE                | Action                              |
| ------------------------- | ------------------------- | ----------------------------------- |
| Installed                 | Not installed             | **Install** extension in target     |
| Installed + Disabled      | Not installed             | **Install** + **Disable** in target |
| Installed (newer version) | Installed (older version) | **Update** to newer version         |

### Activation State

- **On fresh install**: Copy VSCode's enabled/disabled state to target
- **On update**: Preserve target's current enabled/disabled state
- **On existing extensions**: Never change target's enabled/disabled state

This allows users to disable incompatible extensions (e.g., GitHub Copilot) in fork IDEs without those decisions being overwritten by future syncs.

### Removal (optional, via `syncRemovals` flag)

| Source (VSCode) | Target IDE | Action                                                   |
| --------------- | ---------- | -------------------------------------------------------- |
| Not installed   | Installed  | **Uninstall** from target (only if `syncRemovals: true`) |

When `syncRemovals` is disabled (default), extensions removed from VSCode remain in target IDEs until manually removed.

## Handling Incompatible Extensions

Some extensions (GitHub Copilot, GitHub Pull Requests) rely on proprietary APIs and don't work in fork IDEs. The recommended workflow:

1. Let vsix-bridge install the extension (it will appear with a warning in the fork IDE)
2. **Disable** (not uninstall) the extension in the fork IDE
3. Future syncs will leave it disabled

This avoids the need for exclusion lists or sync state tracking.

## Options Summary

| Option         | Default | Description                                        |
| -------------- | ------- | -------------------------------------------------- |
| `syncRemovals` | `false` | Remove from target what's been removed from VSCode |
