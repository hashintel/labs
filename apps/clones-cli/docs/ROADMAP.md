# Roadmap

This document tracks longer-term follow-ups and deferred options for `clones-cli`.
Items are intentionally scoped and can be revisited as user needs evolve.

## Status Snapshot (2026-02-22)

- `✅ Done`: multi-repo `clones add`, post-add action menu, implicit single selection in browse multiselect, copy remote URL actions.
- `🟡 In progress`: lexical + local semantic retrieval baseline (`bm25|vector|hybrid` with RRF/explain).
- `✅ Done`: SQLite sidecar adoption for browse/search reads with lazy status caching.
- `⚪ Not started`: quality harness metrics, subgroup support, display casing fields, path sanitization mode, adopt-mismatch modes, hard-cancel in-flight git operations.

## Active Priorities

### 1) Local index database and startup performance

Current startup for interactive browsing requires full registry hydration and broad status checks.
Introduce a local SQLite sidecar as derived state to make startup and filtering fast.

Status: `✅ Done`

- Add `clones.db` under `~/.config/clones/`.
- Keep `registry.toml` as the portable source of truth.
- Make browse/search read from SQLite, not full in-memory registry structures.
- Cache repo status (`exists`, `is_dirty`, `last_checked_at`) and refresh lazily.

### 2) Search quality for weak READMEs

Move from substring filtering to chunked retrieval with hybrid lexical + semantic ranking.

Status: `🟡 In progress` (Phase 1 done; Phase 2 partial; Phase 3 not started)

#### Phase 1: lexical baseline

Status: `✅ Done`

- Add chunk tables for README/high-signal files and a profile chunk per repo.
- Add FTS5 BM25 over chunk text + profile fields.
- Add `clones search <query>` and `clones index rebuild` commands.
- Add hash-based incremental indexing.

#### Phase 2: semantic retrieval

Status: `🟡 Partial`

- Add embeddings for chunks/profile text. `✅` (local deterministic embeddings baseline)
- Add `--mode bm25|vector|hybrid` and configurable blend weight. `✅`
- Fuse candidates with RRF and optional top-N rerank. `✅`
- Add `--explain` output for score transparency. `✅`
- Add pluggable external embedding providers for higher-fidelity semantics. `⚪`

#### Phase 3: quality harness

Status: `⚪ Not started`

- Build a query set from real resurfacing failures.
- Track Recall@k/MRR and latency by mode.
- Prevent hybrid regressions on exact-match queries.

### 3) Cross-project parity with starbase-cli

Keep retrieval semantics aligned with `/Users/lunelson/Code/lunelson/starbase-cli` so behavior stays predictable across both CLIs.

Status: `⚪ Not started`

- Shared search modes (`bm25|vector|hybrid`).
- Shared fusion strategy (RRF).
- Shared explain-output shape.
- Similar chunk/profile indexing conventions.

## UX Improvements

### Multi-repo `clones add`

Allow `clones add` to accept multiple repos as space-separated arguments
(e.g., `clones add owner/a owner/b owner/c`). Process each in sequence.

Status: `✅ Done`

### Post-add action menu

After adding a clone, don't exit immediately. Instead, present the same
single-repo action menu shown after selecting a repo in browse mode
(copy path, copy URL, open, etc.) with the option to exit.

Status: `✅ Done`

### Implicit single selection in browse multi-select

When the user presses Enter in the browse multi-select without having
toggled any items via Tab, treat the item under the active cursor as
a single selection instead of submitting an empty set.

Status: `✅ Done`

### Copy remote URL action

Add a "Copy remote URL" option to the single-repo and batch action menus
in browse mode, alongside the existing "Copy path" options.

Status: `✅ Done`

## Backlog

### Subgroup URL support (GitLab-style namespaces)

Support URLs like `https://gitlab.com/group/subgroup/repo` by treating the owner as a
namespace path.

- Update URL parsing to allow subgroup paths.
- Decide on on-disk layout (e.g., `owner/subgroup/repo`).
- Update scan/adopt logic to walk deeper than depth 2.
- Extend tests for subgroup parsing and discovery.

Status: `⚪ Not started`

### Preserve display casing for owner/repo

Keep canonical lowercase IDs/paths, but store display fields for UI output.

- Add optional `displayOwner` and `displayRepo` (or `displayName`) in registry entries.
- Populate from original input and prefer for rendering.

Status: `⚪ Not started`

### Path sanitization mode (optional)

Consider offering a permissive mode that sanitizes unsafe segments instead of rejecting
and failing.

- Decide whether sanitization should be opt-in or default.
- Define collision handling (e.g., `owner` vs `Owner`).

Status: `⚪ Not started`

### Adopt mismatch handling options

Current behavior skips adoption when on-disk `owner/repo` does not match remote.
Optional behaviors to consider:

- Prompt or flag-based override (`--adopt-mismatch=allow|prompt|rename`).
- Auto-rename folder to match the remote (with safeguards).
- Adopt using the remote identity but keep path (explicit warning).

Status: `⚪ Not started`

### Hard cancel in-flight git operations

Cancellation currently prevents new work from starting, but in-flight git operations
continue until they complete. Consider switching to subprocess-based git execution
with AbortSignal support to terminate long-running operations.

Status: `⚪ Not started`

## Context

- Original remediation notes live in `clones-cli-review.md`.
