---
name: card
description: Write a tracer-bullet card — a precise specification for one thin end-to-end slice of work. Use when scoping a new slice, defining what to build next, or breaking a feature into provable increments. Covers target behavior, boundary crossings, risks, and definition of done.
argument-hint: "[behavior to deliver in this slice]"
---

# Tracer-Bullet Card

Write a **tracer-bullet card** — a precise specification for one slice of work that will be implemented with `/pragma:slice`.

## Input

The behavior to deliver: $ARGUMENTS

**Precondition**: a concept capsule must exist. If none exists, stop and recommend `/pragma:capsule` first. Read the capsule — the card must use glossary terms and respect invariants.

## Output: The Card

Write a card with exactly these four fields:

### Target Behavior (one sentence)

What should be true when this slice is done? Single declarative sentence.

Good: "A markdown file with YAML front-matter is parsed into a Post with title, date, and body."
Bad: "Implement the parsing system" (too vague) / "Add support for markdown, YAML, TOML, and JSON" (too many things)

- Must be observable / testable
- Must reference glossary terms from the capsule
- If it needs "and", split into two cards

### Boundary Crossings

Every boundary the tracer bullet passes through:
```
→ [entry point] (e.g., CLI argument, HTTP request, function call)
→ [layer/boundary] (e.g., parser, domain core, adapter)
→ [exit point] (e.g., file written, response sent, value returned)
```

Be specific ("the PostgreSQL adapter", not "the backend"). Note boundaries that don't exist yet.

### Risks / Assumptions

```
- RISK: [what might not work] → MITIGATION: [how we'll handle it]
- ASSUMPTION: [what we're assuming] → VALIDATED BY: [how we'll know]
- BUY-OR-BUILD: [buy|build + why package/tool fit is or is not acceptable]
- PROTOTYPE PLAN: [if requirement behavior is unclear, how we'll prototype and observe it]
- OUT OF SCOPE: [explicitly excluded for this slice]
```

- High + unmitigated risk → this card needs a `/pragma:spike` first, not a `/pragma:slice`
- "No risks" is almost always wrong — dig harder
- BUY-OR-BUILD is mandatory (even if answer is "build")
- PROTOTYPE PLAN is mandatory when behavior is unclear; skip only when behavior is already concrete
- Always include at least one OUT OF SCOPE line

### Definition of Done

```
✓ [test name] — [observable assertion checked by that test]
✓ [test name] — [observable assertion checked by that test]
```

- Every assertion must be executable
- Treat these as **spec tests** to write first in `/pragma:slice` (red step)
- Prefer black-box assertions at boundaries over implementation-detail assertions
- Do NOT include "code is clean" — that's the refactor step's job

## Validation

1. Is the target behavior one sentence?
2. Are glossary terms from the capsule used correctly?
3. Is every risk either mitigated or flagged for a spike?
4. Is buy-vs-build resolved explicitly for this slice?
5. If behavior is unclear, is there a concrete prototype plan before delivery?
6. Does the definition of done map to concrete test names and observable checks?
7. Can the definition of done be checked by running a command?
8. Could this slice be implemented in one focused session?

## Where to put it

Cards are ephemeral — consumed by `/pragma:slice`, then the definition of done becomes the test.
- Print to the conversation (default)
- Write to `docs/cards/` if the user wants to track them

## Lifecycle tail (required)

Append to the response:

- **State**: `planning`
- **Next**: `/pragma:slice`
- **Loop**: `/pragma:consult` (default unless user explicitly continues directly)
