---
name: shaping-breadboard-reflect
description: Reflect on an existing breadboard by syncing it to code and surfacing structural smells before planning the next slice or refactor.
argument-hint: "[breadboard artifact and relevant code paths]"
---

# Shape Breadboard Reflection (Adjunct)

Use this adjunct skill to reconcile breadboard artifacts with implementation reality, then identify design smells that affect planning.

## Source And Adaptation Note

Adopted from `rjs/shaping-skills` (`breadboard-reflection`) and adapted for this repository.

Modifications:

- Namespaced as `pragma:shaping-*`
- Added compatibility with `characterize` safety gate
- Added mandatory pragma re-entry instructions

## Procedure

1. Sync the breadboard to current code first.
2. Identify mismatches, missing nodes, and stale wires.
3. Run smell checks on naming, boundaries, and causality.
4. Classify findings as planning fixes vs. risky behavior changes.
5. Route to the right pragma next step.

## Required Output

```md
## Reflection Findings
- Sync fixes: [breadboard updates required]
- Smells: [specific boundary/name/wiring issues]

## Handoff To Pragma
- Safe planning follow-up: [`/pragma:card` or `/pragma:refactor`]
- Behavior uncertainty gate: [use `/pragma:characterize` before refactor when behavior is unclear]
- Next command: [single recommended pragma command]
```

## Constraints

- Do not refactor blindly when behavior is not yet characterized.
- If behavior is uncertain, route to `/pragma:characterize` first.
- Do not bypass carding for new behavior.

## Lifecycle

- **State**: `stabilizing`
- **Next**: `/pragma:consult` (or `/pragma:characterize` when required)
- **Loop**: `/pragma:consult`
