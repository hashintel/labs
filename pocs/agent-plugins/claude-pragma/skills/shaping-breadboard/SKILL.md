---
name: shaping-breadboard
description: Build affordance and wiring maps for existing or proposed systems before carding. Use when implementation planning needs a concrete mechanism view across UI and code boundaries.
argument-hint: "[workflow or shaped direction to map]"
---

# Shape Breadboard (Adjunct)

Map system behavior using affordance tables and wiring so the next card is grounded in concrete mechanism understanding.

## Source And Adaptation Note

Adopted from `rjs/shaping-skills` (`breadboarding`) and adapted for this repository.

Modifications:

- Namespaced as `pragma:shaping-*`
- Scoped to pre-card clarity, not delivery planning authority
- Explicit pragma handoff requirements

## When To Use

- A selected direction exists but mechanism-level mapping is unclear
- Existing behavior needs mapping before choosing safe slice boundaries
- UI and non-UI affordances span multiple places and boundaries

## Procedure

1. Define the workflow to map (operator perspective).
2. Identify places and key boundaries.
3. Produce affordance tables as source of truth.
4. Add wiring and data flow consistency checks.
5. Extract card-ready behaviors and unresolved uncertainty.

## Required Output

```md
## Breadboard
- Places table
- UI affordances table
- Code affordances table
- Data stores table

## Handoff To Pragma
- Candidate cards: [vertical behaviors ready to card]
- Capsule impacts: [new terms or invariants discovered]
- Open uncertainty: [items requiring `/pragma:spike`]
- Next command: [`/pragma:card`]
```

## Constraints

- Do not become a second implementation planning system.
- Do not output direct coding steps as a substitute for cards.
- Do not route directly to `/pragma:slice`.

## Lifecycle

- **State**: `planning`
- **Next**: `/pragma:card`
- **Loop**: `/pragma:consult`
