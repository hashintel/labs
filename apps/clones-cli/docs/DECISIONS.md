# Decisions

This document records durable decisions made during maintenance and remediation.

## 2026-02-10: Add SQLite sidecar as derived state

- Decision: Introduce a local SQLite database (`clones.db`) for indexed read paths and faster startup.
- Rationale: Interactive browse/search should not require full registry hydration and full repo status probing on every launch.
- Consequence: Two-state model: `registry.toml` remains portable intent; SQLite becomes machine-local derived state that can be rebuilt.

## 2026-02-10: Adopt phased hybrid retrieval (BM25 + vector)

- Decision: Implement search in phases: chunked FTS5 baseline, then embeddings + hybrid fusion.
- Rationale: Weak or sparse README content causes low lexical recall; semantic retrieval improves resurfacing quality.
- Consequence: Adds indexing complexity and embedding infrastructure, but materially improves recall on hard queries.

## 2026-02-10: Keep retrieval semantics aligned with starbase-cli

- Decision: Keep search modes and fusion strategy compatible with `/Users/lunelson/Code/lunelson/starbase-cli` (`bm25|vector|hybrid`, RRF, explain output).
- Rationale: Reduces cognitive overhead and allows shared evaluation/tuning across both CLIs.
- Consequence: Some implementation choices should prefer parity over per-project novelty.

## 2026-01-31: Canonical IDs and paths

- Decision: Canonicalize `host`, `owner`, and `repo` to lowercase for IDs and on-disk paths.
- Rationale: Prevent duplicate entries caused by casing differences and simplify comparisons.
- Consequence: Display casing is not preserved; revisit if UI needs require it.

## 2026-01-31: Path safety policy

- Decision: Reject unsafe path segments (empty, `.`, `..`, path separators, control characters).
- Rationale: Prioritize safety and prevent path traversal outside the clones root.
- Consequence: Some edge-case names may be rejected; revisit if real-world repos demand it.

## 2026-01-31: Subgroup URL support

- Decision: Reject subgroup-style URLs for now (e.g., GitLab `group/subgroup/repo`).
- Rationale: Current user base is GitHub-only; avoid expanding namespace complexity prematurely.
- Consequence: Subgroup support is deferred to the roadmap.

## 2026-01-31: Adopt mismatch handling

- Decision: Skip adoption when on-disk `owner/repo` does not match the remote URL; log a warning.
- Rationale: Avoid silently registering a repo under a misleading path.
- Consequence: Manual intervention required for renamed or moved folders; alternative behaviors are in the roadmap.

## 2026-01-31: Skip dirty repos during sync without --force

- Decision: When a repo has a dirty working tree, `clones sync` skips updates unless `--force` is provided.
- Rationale: Default update strategy uses hard reset; skipping avoids accidental loss of uncommitted changes.
- Consequence: Users must either clean/stash or run with `--force` to update those repos.
