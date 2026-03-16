---
name: assumptions
description: Create and maintain an Assumption Ledger — a persistent record of assumptions, their confidence, and validation status. Use when starting a new slice, resuming work in a new context window, or when implicit assumptions risk causing drift. Tracks requirements, architecture, and implementation assumptions.
argument-hint: "[create|update|review] [paste a card/spike verdict/slice summary or describe what changed]"
---

# Assumption Ledger

Maintain a project-wide **Assumption Ledger** — durable memory of what was assumed, how sure we were, and how it was proved or disproved. Supports fresh context per slice without losing epistemic continuity.

## Input

Mode + context: $ARGUMENTS

Modes:
- `create` — initialize a new ledger
- `update` — add/update assumptions from a card, spike verdict, or slice result
- `review` — summarize current ledger and recommend what to validate next

## Ledger location

Default: `docs/assumptions.md`. If it exists, update — don't duplicate.

## Ledger schema

Each entry MUST include:

- **ID**: `A-###` (stable identifier)
- **Statement**: one sentence, falsifiable if possible
- **Type**: Requirement | Architecture | Implementation
- **Confidence**: 0-100%
- **Status**: Proposed | Validated | Invalidated | Obsolete
- **Introduced by**: (card / spike / slice / commit)
- **Validated by**: (test name, command, spike evidence) — required for Validated/Invalidated
- **Last reviewed**: YYYY-MM-DD

## Graduation Protocol

Assumptions track uncertainty and confidence. They are not permanent authority.
When assumptions stabilize, promote them to their canonical home:

- **Capsule promotion**: durable semantic law or glossary boundary →
  `docs/capsule.md` or `docs/capsule-<feature>.md`
- **Roadmap/decision promotion**: strategic initiative choice with
  reversibility/rationale → `docs/roadmap.md` (and/or decisions log)
- **Milestone promotion**: temporary phase sequencing or deferment →
  `docs/milestone.md`
- **Contract promotion**: enforceable invariant now ready for code-level checks
  → `/pragma:contract` + tests

When promoted, keep the assumption entry for history and add a "Promoted to"
reference with path/anchor.

## Procedure

### Mode: create

Create `docs/assumptions.md` with sections: Active (Proposed), Validated, Invalidated/Obsolete, Open Questions. Seed with 3-10 initial assumptions if obvious from capsule/card.

### Mode: update

1. Extract assumptions from context ("ASSUMPTION:" lines in cards, spike verdicts, slice summaries)
2. Match against existing entries → update confidence/status/evidence. New → assign ID, add under Active.
3. **Confidence < 70%** → mark High Risk, recommend clarification or `/pragma:spike`
4. Disproved by spike/test → move to Invalidated, note "Replaced by A-###" if superseded
5. For any stabilized assumption, apply the graduation protocol and add
   cross-reference links to the promoted artifact

### Mode: review

1. List Active (Proposed) sorted by: lowest confidence first, highest impact first
2. Recommend: `/pragma:spike` for unknowns, `/pragma:card`+`/pragma:slice` for E2E-validatable assumptions, `/pragma:characterize` for behavior already in code
3. Identify stale assumptions (not reviewed recently, weak evidence)
4. Identify promotable assumptions and their target authority document

## Constraints

- **No vague assumptions.** "Should be scalable" → rewrite as falsifiable statement.
- **Validated/Invalidated requires evidence.** Cite test, command output, or spike verdict.
- **Do not delete history.** Invalidated assumptions stay recorded.
- **Assumptions are not features.** The ledger records knowledge state, not work.
- **Do not treat assumptions as semantic authority.** Durable definitions and
  laws must be promoted to capsule.

## Output

1. The updated `docs/assumptions.md` diff summary
2. The top 3 highest-risk active assumptions
3. Promotion summary (assumptions promoted, with destination artifacts)
4. The recommended next step (often `/pragma:spike` or `/pragma:card`)
5. **Lifecycle**: `State: governance`, `Next: /pragma:consult` (or the explicitly recommended next step), `Loop: /pragma:consult` (default unless user explicitly continues directly)
