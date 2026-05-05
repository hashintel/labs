---
name: shaping-framing
description: Create an evidence-backed frame from messy transcripts and notes before capsule/card planning. Use when discovery inputs are conversation-heavy and the problem statement is still diffuse.
argument-hint: "[topic and transcript paths, or context bundle to frame]"
---

# Shape Framing (Adjunct)

Use this adjunct skill to distill conversation artifacts into a clear frame that can feed pragma planning.

## Source And Adaptation Note

Adopted from `rjs/shaping-skills` (`framing-doc`) and adapted for this repository.

Modifications:

- Namespaced as `pragma:shaping-*` to avoid routing ambiguity
- Explicit pragma re-entry requirements
- Authority boundaries aligned to `docs/shape-pragma-integration.md`

## When To Use

- Inputs are transcripts, call notes, or scattered stakeholder messages
- The team agrees a problem exists but cannot state it crisply yet
- You need an evidence-backed "why now" before capsule/card work

## When Not To Use

- You already have a stable capsule and clear next slice
- The task is implementation-ready and only needs `/pragma:card`

## Procedure

1. Collect source inputs and confirm ordering when chronology matters.
2. Extract direct evidence and separate it from synthesis.
3. Produce a frame with Problem, Outcome, and boundaries.
4. Identify what changed in understanding and what remains uncertain.
5. Define the pragma re-entry step.

## Required Output

```md
## Frame
[evidence-backed problem and outcome]

## Handoff To Pragma
- Capsule impacts: [terms/invariants to add or revise]
- Candidate cards: [1-3 candidate slice behaviors]
- Open uncertainty: [items requiring `/pragma:spike`]
- Next command: [`/pragma:capsule` or `/pragma:card`]
```

## Constraints

- Do not prescribe implementation details.
- Do not replace capsule authority over vocabulary and invariants.
- Do not route directly to `/pragma:slice`.

## Lifecycle

- **State**: `discovery`
- **Next**: `/pragma:capsule` (default) or `/pragma:card` (if capsule is stable)
- **Loop**: `/pragma:consult`
