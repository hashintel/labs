---
name: harden
description: Deliberately upgrade the project's feedback harness. Use when adding a verify command, setting up CI, introducing lint/format, or making the dev loop self-enforcing. Covers canonical verify scripts, lint/format, CI configuration, and dev-loop documentation.
argument-hint: "[what to harden, e.g. 'add verify command', 'add CI', 'add formatting']"
---

# Harden

Deliberately upgrade the project's **feedback harness** — the commands, gates, and automation that make verification self-enforcing. Introduce lint, formatting, CI, and a canonical verify command **intentionally and incrementally**.

This resolves the tension between `/pragma:skeleton` ("no lint/format yet") and `/pragma:slice` ("run the verification harness").

## Input

What to harden: $ARGUMENTS

**Preconditions**:
- A walking skeleton must exist. If none → `/pragma:skeleton` first.
- Ideally 1-2 real slices have landed (you want to know what checks actually matter before formalizing).

## Procedure

### 1. Audit the current harness

What commands exist? Are they consistent? Is there a single "everything is green" command? Is there CI? Does CI match local?

### 2. Define the target verify command

One canonical command to trust:
```
bun run verify   # or: npm run verify, make verify, etc.
```

Runs in order: typecheck → lint → format check → unit tests → integration tests → build.

- Must be fast enough for pre-commit (target: < 60s)
- If some checks are slow, split: `verify` (fast) and `verify:full` (CI-only)

### 3. Introduce ONE tool

Pick **one** improvement per `/pragma:harden` invocation:

- **Formatting**: choose one formatter, configure minimally (defaults first), run on whole codebase, add to verify
- **Lint**: choose one linter, default ruleset, fix existing violations, add to verify
- **CI**: create config running the verify command, fail on verify failure
- **Pre-commit hook** (optional): must be fast (< 10s) or it will be bypassed

### 4. Document the dev loop

Create or update a short section (README or `docs/dev-loop.md`):
1. How to verify (canonical command)
2. What it checks (ordered list)
3. How to run subsets
4. CI: where it runs, what triggers it

### 5. Verify and commit

Run the new verify command. If the new tool creates violations, fix them in this commit.
Commit: `Harden: add [tool/command] to verification harness`

## Constraints

- **One tool at a time.** Do not batch formatting + lint + CI in one invocation.
- **Local and CI must agree.** No "CI-only" checks developers can't run locally.
- **Fast by default.** Slow checks go in `verify:full`.
- **No speculative rules.** Add rules that catch real problems you've seen.
- **Minimal configuration.** Defaults first. Customize only when a default causes real pain.
- **Don't block feature work.** Too much friction → back it out and try again later.

## Output

1. **Tool added**: what was introduced and why
2. **Verify command**: current canonical command and what it runs
3. **Violations fixed**: what existing code needed cleanup
4. **Dev loop doc**: where the documentation lives
5. **Recommended next harden step**: what to add next (if anything)
6. **Lifecycle**: `State: governance`, `Next: /pragma:consult`, `Loop: /pragma:consult` (default unless user explicitly continues directly)
