---
name: spike
description: Time-boxed throwaway investigation to answer one hard question. Use when facing technical uncertainty before a slice — the output is knowledge, not production code. Retires risk by producing a spike verdict with clear recommendations.
argument-hint: "[question to answer and what you'll try]"
---

# Spike Solution (XP)

Run a throwaway experiment to answer one specific, falsifiable technical question. **Spikes produce knowledge, not code.**

A spike is NOT a prototype (prototypes try to be kept). Spike code is explicitly discarded.

## Input

The question and approach: $ARGUMENTS

Before starting, confirm:
1. **Question** — one specific, falsifiable thing you don't know (e.g., "Can library X parse format Y and return structure Z?")
2. **Approach** — what you'll try
3. **Time box** — default: one focused session

If the question is vague, sharpen it before proceeding.

## Procedure

### 1. State the question

Write the exact falsifiable question. Examples:
- "Can Bun's `Bun.file()` API read a 500MB file without loading it all into memory?"
- "Does the Stripe API return pagination cursors that survive for more than 5 minutes?"

### 2. Minimal experiment

Single throwaway file. Hardcode everything. Print to stdout. Let crashes be information.

**Do not** modify project source files. Install dependencies in isolation if needed.

### 3. Run, observe, write verdict

The verdict is the deliverable. Capture: did it work, any surprises, any conditional constraints, performance (if relevant).

### 4. Classify authority deltas

Before returning, classify what changed and route durable outcomes:

- Semantics changed (glossary/invariant/happy-path/non-goal meaning) → `/pragma:capsule update`
- Strategy changed (cross-cutting decision/rationale/reversal trigger) → `/pragma:roadmap update`
- Phase control changed (scope/status/ordering/deferment/exit criteria) → `/pragma:milestone update`
- Confidence changed (assumption validated/invalidated/confidence shift) → `/pragma:assumptions update`
- Enforcement readiness changed (invariant now enforceable in code/tests) → `/pragma:contract`

Use explicit `none` for lanes with no change.

## Constraints

- **One question per spike.** New questions → new spikes.
- **Spike code is discarded.** Do not commit, integrate, or refactor it.
- **No production standards.** No tests, types, lint, or error handling.
- **"No" is a successful answer.** The answer matters, not the code.

## Output

1. **Question**: exact question investigated
2. **Verdict**: Yes / No / Conditional (with conditions)
3. **Evidence**: what you observed
4. **Surprises**: anything unexpected
5. **Implications**: how this affects the planned `/pragma:card` or `/pragma:slice`
6. **Authority Delta**:
   - Semantics: `none` | `/pragma:capsule update` — [reason]
   - Strategy: `none` | `/pragma:roadmap update` — [reason]
   - Phase control: `none` | `/pragma:milestone update` — [reason]
   - Assumptions: `none` | `/pragma:assumptions update` — [reason]
   - Enforcement: `none` | `/pragma:contract` — [reason]
7. **Ledger**: run `/pragma:assumptions update` (mandatory after every spike) to record which assumption was validated/invalidated
8. **Lifecycle**: `State: discovery`, `Next: first non-'none' authority delta command (otherwise /pragma:consult or /pragma:card when uncertainty is retired and next behavior is clear)`, `Loop: /pragma:consult` (default unless user explicitly continues directly)
