# Roadmap

This document tracks longer-term follow-ups and deferred options for `clones-cli`.
Items are intentionally scoped and can be revisited as user needs evolve.

## Active Priorities

### 1) Local index database and startup performance

Current startup for interactive browsing requires full registry hydration and broad status checks.
Introduce a local SQLite sidecar as derived state to make startup and filtering fast.

- Add `clones.db` under `~/.config/clones/`.
- Keep `registry.toml` as the portable source of truth.
- Make browse/search read from SQLite, not full in-memory registry structures.
- Cache repo status (`exists`, `is_dirty`, `last_checked_at`) and refresh lazily.

### 2) Search quality for weak READMEs

Move from substring filtering to chunked retrieval with hybrid lexical + semantic ranking.

#### Phase 1: lexical baseline

- Add chunk tables for README/high-signal files and a profile chunk per repo.
- Add FTS5 BM25 over chunk text + profile fields.
- Add `clones search <query>` and `clones index rebuild` commands.
- Add hash-based incremental indexing.

#### Phase 2: semantic retrieval

- Add embeddings for chunks/profile text.
- Add `--mode bm25|vector|hybrid` and configurable blend weight.
- Fuse candidates with RRF and optional top-N rerank.
- Add `--explain` output for score transparency.

#### Phase 3: quality harness

- Build a query set from real resurfacing failures.
- Track Recall@k/MRR and latency by mode.
- Prevent hybrid regressions on exact-match queries.

### 3) Cross-project parity with starbase-cli

Keep retrieval semantics aligned with `/Users/lunelson/Code/lunelson/starbase-cli` so behavior stays predictable across both CLIs.

- Shared search modes (`bm25|vector|hybrid`).
- Shared fusion strategy (RRF).
- Shared explain-output shape.
- Similar chunk/profile indexing conventions.

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
