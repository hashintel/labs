# Decisions

This document records durable decisions made during maintenance and remediation.

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
