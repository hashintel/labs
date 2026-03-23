---
name: refactor
description: Alignment refactor — restore naming, boundaries, and structure to match the concept capsule. Use after a slice lands, or when naming, module boundaries, or structure have drifted from the capsule. Prevents conceptual drift.
argument-hint: "[what feels off, or 'check alignment']"
---

# Alignment Refactor

Restore naming, module boundaries, and structure so the code matches the concept capsule. Refactor immediately after green, while context is fresh.

## Input

What feels off, or the scope to check: $ARGUMENTS

Before starting, locate:
1. The **concept capsule** (glossary, invariants — naming authority). If none exists → `/pragma:capsule` first.
2. The **recent changes** (files touched in the last slice)
3. **What feels off** (if the user has a specific concern, start there)

## Procedure

### 1. Audit naming

Compare every public name (types, functions, modules, test suites) against the capsule glossary:

- **Mismatches**: same concept, different words → rename to match glossary
- **Missing terms**: glossary concept with no code home → note for future slice
- **Extra terms**: code name with no glossary counterpart → add to glossary or delete as speculative

If the glossary says "Worker," the code says "Worker" — not "processor," not "handler."

### 2. Audit module boundaries

For each module, complete: **"This module hides the decision about ___."** (Parnas)

- Can't complete the sentence → module does too much, split it
- Two modules hide the same decision → merge
- Module hides no decision (pass-through) → delete

Check functional core / imperative shell boundary: pure domain logic has zero I/O imports; I/O adapters have zero domain logic; shell calls core, never the reverse.

### 3. Delete dead code

- Speculative abstractions (generics/interfaces with one implementation)
- Commented-out code
- "For later" structure (empty dirs, placeholders, stubs)
- Unused imports and variables

If it doesn't serve a current test or behavior, it goes.

### 4. Check invariant enforcement

For each capsule invariant: type system (best) → constructor/validator (good) → tests (minimum) → none (fix this).

### 5. Classify authority deltas

Before closing refactor work, classify what changed and route durable updates:

- Semantics changed (glossary/invariant/happy-path/non-goal meaning) → `/pragma:capsule update`
- Strategy changed (cross-cutting decision/rationale/reversal trigger) → `/pragma:roadmap update`
- Phase control changed (scope/status/ordering/deferment/exit criteria) → `/pragma:milestone update`
- Confidence changed (assumption validated/invalidated/confidence shift) → `/pragma:assumptions update`
- Enforcement readiness changed (invariant now enforceable in code/tests) → `/pragma:contract`

Use explicit `none` for lanes with no change.

### 6. Verify and commit

Run full verification harness. All checks must pass — remain green throughout. Commit separately from behavior work: `Refactor: align naming/boundaries to capsule after [slice]`

## Constraints

- **Tests stay green.** Refactor under green.
- **No new features.** Structure changes only. Missing behavior → write a `/pragma:card`.
- **The capsule is the authority.** Code wrong + capsule right → change code. Code right + capsule wrong → update capsule first, then change code.

## Output

1. **Renames**: what was renamed to match glossary
2. **Splits/merges**: module boundary changes
3. **Deletions**: speculative or dead code removed
4. **Invariant status**: which invariants are enforced where
5. **Authority Delta**:
   - Semantics: `none` | `/pragma:capsule update` — [reason]
   - Strategy: `none` | `/pragma:roadmap update` — [reason]
   - Phase control: `none` | `/pragma:milestone update` — [reason]
   - Assumptions: `none` | `/pragma:assumptions update` — [reason]
   - Enforcement: `none` | `/pragma:contract` — [reason]
6. **Capsule updates**: if the capsule itself needed updating
7. **Remaining drift**: anything that needs a separate slice to fix
8. **Lifecycle**: `State: stabilizing`, `Next: first non-'none' authority delta command (otherwise /pragma:assumptions update)`, `Loop: /pragma:consult` (default unless user explicitly continues directly)
