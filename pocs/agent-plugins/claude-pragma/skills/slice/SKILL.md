---
name: slice
description: Implement one tracer-bullet slice following the inside-out methodology. Use when you have a tracer-bullet card ready to build. Implements functional core first, then imperative shell, then end-to-end wiring, then alignment refactor.
argument-hint: "[paste tracer-bullet card (or provide path to it)]"
---

# Tracer-Bullet Slice

Implement **one** thin end-to-end slice of functionality, following the inside-out procedure.

## Input

The slice is defined by a **tracer-bullet card**: $ARGUMENTS

**Preconditions**:
- A concept capsule must exist. If none → `/pragma:capsule` first.
- A card must exist. If none → `/pragma:card` first.

Extract from the card: (1) target behavior, (2) boundary crossings, (3) risks/assumptions, (4) definition of done. If the card is incomplete, stop and recommend rerunning `/pragma:card`.

## Procedure

Follow these steps in order. Do not skip or reorder.

### 0. Preflight gates

Before writing implementation code:

- Confirm card includes explicit **BUY-OR-BUILD** decision. If missing, stop and refine `/pragma:card`.
- If requirement behavior is still unclear in practice, stop and run `/pragma:spike` first to prototype/observe.

### 1. Spec tests first (red)

Before implementing behavior, translate card Definition of Done into tests:

- Add or update tests named in the card DoD
- Run tests and confirm at least one fails for the expected reason
- If tests pass unexpectedly, tighten test assertions or refine the card scope
  before writing implementation code

This is the "create the needle" step: define a narrow path to success first.

### 2. Functional core (pure domain logic)

Implement using the functional core / imperative shell pattern (Bernhardt):

- Define types/structures using capsule glossary terms
- Write core function(s) as pure transformations — no I/O, no side effects
- Write tests covering the target behavior
- Enforce invariants at construction boundaries

No frameworks, no infrastructure, no I/O in this step. No speculative abstractions.

### 3. Imperative shell (thin I/O adapter)

Add the minimal I/O boundary connecting the core to the real world. The shell calls the core, never the reverse. No business logic in the shell.

### 4. Wire end-to-end

Connect the full path: entry point → shell → core → shell → output. Make it actually run. Write or update an integration test proving the target behavior.

### 4.5. Commit the behavior (recommended)

Commit the smallest set of changes that makes the E2E path pass.
Message style: `Behavior: <target behavior>`

### 5. Alignment refactor — NOT optional

Refactor immediately while context is fresh:
- **Naming**: all names match the capsule glossary? Rename if not.
- **Module boundaries**: can you complete "This module hides the decision about ___" (Parnas) for each module?
- **Dead code**: delete anything speculative, unused, or "for later."
- **Slice cohesion**: does this slice form a coherent vertical unit?

### 6. Verify

Run the project's existing verification harness. All checks must pass. If any fails, fix and re-run from step 1 of verification.

### 7. Commit the refactor

Separate from the behavior commit. Message style: `Refactor: align slice to capsule`

### 8. Classify authority deltas (mandatory)

Before closing the slice, classify what changed and route updates to the
correct authority artifact:

- Semantics changed (glossary/invariant/happy-path/non-goal meaning) → `/pragma:capsule update`
- Strategy changed (cross-cutting decision/rationale/reversal trigger) → `/pragma:roadmap update`
- Phase control changed (scope/status/ordering/deferment/exit criteria) → `/pragma:milestone update`
- Confidence changed (assumption validated/invalidated/confidence shift) → `/pragma:assumptions update`
- Enforcement readiness changed (invariant now enforceable in code/tests) → `/pragma:contract`

Use explicit `none` for lanes with no change.

### 9. Update the assumptions ledger (mandatory)

Run `/pragma:assumptions update` with the slice summary, assumptions made, and validation evidence.

## Constraints

- **One slice only.** No adjacent behaviors, future features, or "while we're here" improvements.
- **Needle before thread.** Do not write behavior code until spec tests go red for the right reason.
- **No speculative abstractions.** No generic frameworks, no "future extensibility."
- **No new abstractions unless forced.** Only abstract when two concrete cases demand it.
- **Refactor is part of done.** A slice is not done until step 5 is complete.
- **Explicit assumptions.** State them. If risky, flag for a spike.
- **No silent authority drift.** Any non-`none` authority delta must be surfaced
  and routed before additional delivery work.

## Output

1. **Behavior delivered**: what is now true that wasn't before
2. **Files changed**: list
3. **Authority Delta**:
   - Semantics: `none` | `/pragma:capsule update` — [reason]
   - Strategy: `none` | `/pragma:roadmap update` — [reason]
   - Phase control: `none` | `/pragma:milestone update` — [reason]
   - Assumptions: `none` | `/pragma:assumptions update` — [reason]
   - Enforcement: `none` | `/pragma:contract` — [reason]
4. **Assumptions made**: anything that should be validated
5. **Suggested next step**: what slice or action follows
6. **Ledger**: run `/pragma:assumptions update` (mandatory after every slice)
7. **Lifecycle**: `State: delivery`, `Next: first non-'none' authority delta command (otherwise /pragma:assumptions update)`, `Loop: /pragma:consult` (default unless user explicitly continues directly)
