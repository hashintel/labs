---
name: shaping-kickoff
description: Turn kickoff transcripts into a builder-facing territory map before carding. Use when kickoff conversations are rich but implementation slices are not yet legible.
argument-hint: "[kickoff transcript paths and project topic]"
---

# Shape Kickoff (Adjunct)

Convert kickoff conversation timelines into a territory-oriented artifact that can feed pragma planning.

## Source And Adaptation Note

Adopted from `rjs/shaping-skills` (`kickoff-doc`) and adapted for this repository.

Modifications:

- Namespaced as `pragma:shaping-*`
- Explicit handoff into `pragma:*`
- Guardrails against replacing capsule/card authority

## When To Use

- The team has a kickoff transcript that contains decisions across many topics
- The builder needs a coherent map by system area, not by conversation order
- You need a reliable planning handoff artifact before card creation

## Procedure

1. Read the full kickoff source before writing.
2. Organize by territory (system area), not timeline.
3. Capture decision rationale where each decision matters.
4. Separate provisional choices from committed boundaries.
5. Produce pragma handoff notes.

## Required Output

```md
## Kickoff Territory Map
[organized by system area with key decisions inline]

## Handoff To Pragma
- Capsule impacts: [terminology/invariant updates]
- Candidate cards: [specific vertical behaviors]
- Validation risk: [items requiring `/pragma:spike` or `/pragma:characterize`]
- Next command: [`/pragma:card` by default]
```

## Constraints

- Do not output implementation sequencing as an alternative planning system.
- Do not redefine glossary terms outside the capsule.
- Do not bypass `/pragma:card`.

## Lifecycle

- **State**: `planning`
- **Next**: `/pragma:card`
- **Loop**: `/pragma:consult`
