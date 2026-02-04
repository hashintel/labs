# Roadmap

This document tracks longer-term follow-ups and deferred options discovered during the
`clones-cli-review.md` remediation. Items are intentionally scoped and can be revisited
as user needs evolve.

## Backlog

### Subgroup URL support (GitLab-style namespaces)

Support URLs like `https://gitlab.com/group/subgroup/repo` by treating the owner as a
namespace path.

- Update URL parsing to allow subgroup paths.
- Decide on on-disk layout (e.g., `owner/subgroup/repo`).
- Update scan/adopt logic to walk deeper than depth 2.
- Extend tests for subgroup parsing and discovery.

### Preserve display casing for owner/repo

Keep canonical lowercase IDs/paths, but store display fields for UI output.

- Add optional `displayOwner` and `displayRepo` (or `displayName`) in registry entries.
- Populate from original input and prefer for rendering.

### Path sanitization mode (optional)

Consider offering a permissive mode that sanitizes unsafe segments instead of rejecting
and failing.

- Decide whether sanitization should be opt-in or default.
- Define collision handling (e.g., `owner` vs `Owner`).

### Adopt mismatch handling options

Current behavior skips adoption when on-disk `owner/repo` does not match remote.
Optional behaviors to consider:

- Prompt or flag-based override (`--adopt-mismatch=allow|prompt|rename`).
- Auto-rename folder to match the remote (with safeguards).
- Adopt using the remote identity but keep path (explicit warning).

### Hard cancel in-flight git operations

Cancellation currently prevents new work from starting, but in-flight git operations
continue until they complete. Consider switching to subprocess-based git execution
with AbortSignal support to terminate long-running operations.

## Context

- Original remediation notes live in `clones-cli-review.md`.
