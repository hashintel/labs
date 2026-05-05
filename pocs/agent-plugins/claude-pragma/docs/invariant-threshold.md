# The Invariant Threshold

This document defines the governing principle of the `pragma:*` and
`pragma:*` (horizon) skill systems.

## Document Roles

Use this document for first principles. For operational rules and routing,
follow the lifecycle contract.

- **Normative operations**: [`pragma-lifecycle.md`](./pragma-lifecycle.md)
- **Onboarding and skill map**: [`pragma-skills.md`](./pragma-skills.md)
- **Historical design rationale (non-normative)**:
  [`pragma-brooks-alignment-spec.md`](./pragma-brooks-alignment-spec.md)
- **Visualization companion (non-authoritative)**:
  [`horizon-pragma-lifecycle.mmd`](./horizon-pragma-lifecycle.mmd)

## The Principle

> Software progress comes from making truth cheap to check before making
> output cheap to produce.

The scarce resource in LLM-assisted development is not output; it is
trustworthy understanding. Before invariants are established, more generation
usually increases irreversible complexity faster than it increases knowledge.
Therefore the goal of the early phase is not artifacts but **invariants**:
shared vocabulary, testable laws, cheap verification signals, and bounded
interfaces.

Once those invariants exist, AI becomes a force multiplier: reversible
implementation can be delegated aggressively because correctness is
constrained and verification is cheap.

Productivity is therefore **minimum irreversible complexity for maximum
validated learning**.

## The Cycle

Every skill in horizon and pragma is a move in a four-phase cycle:

1. **Uncertainty** — we do not yet know what must be true. Verification is
   expensive or fuzzy. AI output is dangerous because it can anesthetize
   uncertainty with plausible-looking artifacts that defer the moment of truth.

2. **Invariant establishment** — we narrow scope and create vocabulary, laws,
   fixtures, contracts, characterization tests, skeletons, or harnesses. The
   key outcome is not more code but more things that are now safe to check.

3. **Acceleration** — once correctness is bounded, we delegate reversible work
   aggressively. AI is now useful because it operates inside known constraints.

4. **Drift detection** — as the system grows, verification cost rises again.
   Conceptual integrity erodes. New unknowns emerge. The cycle restarts.

## The Cycle Is Fractal

The same four phases repeat at every scale of work:

| Scale | Uncertainty question | Invariant established | Acceleration unlocked |
|-------|---------------------|-----------------------|----------------------|
| **Horizon** (roadmap → milestone) | What must be true across the initiative? | Strategic constraints, phase-level invariant bundles, success criteria | Safe delegation across multiple milestones |
| **Pragma** (capsule → skeleton → card → slice) | What is the next smallest thing we can make trustworthy? | Glossary, laws, walking skeleton, slice behavior, contracts, tests | Safe slice implementation and refactoring |
| **Slice** (core → shell → E2E) | What domain truth can we establish first? | Functional core invariants (pure transformations, no I/O) | Thin shell + E2E wiring with low risk |

At every scale, the move is the same: **narrow until you can state what must
be true, make that cheap to verify, then build on that foundation**.

## Three Operational Heuristics

### 1. Verification Economics

When verification is cheap (unit tests, type checks, deterministic
assertions), use AI aggressively. When verification is expensive
(architectural fitness, conceptual coherence, abstractions-under-future-load),
use AI to **shrink the problem until verification becomes cheap** — via
spikes, skeletons, characterization tests, harnesses, and narrower scope.

### 2. Delegate What Is Reversible

Let AI generate options, drafts, probes, test scaffolds, alternate
implementations, edge-case inventories, critique passes. Be careful about
delegating choices that lock in abstractions, interfaces, architecture, or
commitments that shape all downstream reasoning. Those are not just bigger
tasks; they are higher-cost epistemic commitments.

### 3. Epistemic Status Awareness

Know which phase you are in. The temptation to accept broad AI output is
strongest exactly when it is most dangerous: in the pre-invariant phase where
understanding is the bottleneck, not implementation speed. AI's force
multiplier has a **sign** that depends on where you are in the uncertainty
curve. Before validation, more output is more risk. After validation, more
output is more value.

## How the Skills Map to the Cycle

### Uncertainty → Invariant Establishment

| Skill | Role |
|-------|------|
| `/pragma:consult` | Diagnoses where you are relative to the invariant threshold |
| `/pragma:spike` | Shrinks one risky unknown until verification becomes cheap |
| `/pragma:characterize` | Captures existing invariants when they are implicit in legacy behavior |
| `/pragma:feedback-loops` | Makes verification economically viable when it otherwise wouldn't be |
| `/pragma:shaping-*` | Pre-invariant distillation: turns transcript fog into something capsule/card can formalize |
| `/pragma:roadmap` | Identifies strategic invariants for the initiative and sequences them |
| `/pragma:milestone` | Defines which invariant bundle the current phase must establish |

### Invariant Establishment → Acceleration

| Skill | Role |
|-------|------|
| `/pragma:capsule` | Names the invariants in English: vocabulary + laws + happy path + non-goals |
| `/pragma:skeleton` | Establishes the first cheap end-to-end verification path |
| `/pragma:contract` | Converts English invariants into executable types, validators, and tests |
| `/pragma:card` | Chooses the smallest reversible move that establishes or exploits an invariant |

### Acceleration

| Skill | Role |
|-------|------|
| `/pragma:slice` | Builds one thin behavior safely within established invariants (inside-out) |

### Drift Detection → Re-Narrowing

| Skill | Role |
|-------|------|
| `/pragma:refactor` | Restores conceptual integrity after acceleration-induced drift |
| `/pragma:assumptions update` | Preserves epistemic continuity: what was validated, what remains open |
| `/pragma:harden` | Lowers verification cost when delivery friction rises |

## Methodological Lineage

This principle synthesizes ideas from several traditions:

- **Brooks** — productivity from disciplined composition, not magic;
  requirements are discovered; essential complexity dominates; conceptual
  integrity matters.
- **Beck / XP** — smallest safe step, spikes, YAGNI, reversible change,
  learning over speculative architecture, planning game.
- **Cockburn** — walking skeleton and thin end-to-end progress; get a real
  signal early; multiple altitudes of goal.
- **Parnas** — hide volatile decisions; don't lock in abstractions before you
  understand what must remain stable.
- **Meyer** — invariants become real when expressed as contracts, not prose.
- **Bernhardt** — establish domain truth in the functional core before shell
  complexity muddies it.
- **Feathers** — when inheriting unclear systems, capture observed behavior
  first; implicit invariants must be surfaced before change.

## Relationship to This Repository

- [`pragma-lifecycle.md`](./pragma-lifecycle.md) — canonical lifecycle,
  routing, and authority matrix
- [`pragma-skills.md`](./pragma-skills.md) — onboarding index and quick-start
  map
- [`pragma-brooks-alignment-spec.md`](./pragma-brooks-alignment-spec.md) —
  historical Brooks alignment record
- [`horizon-roadmap/SKILL.md`](./pragma:roadmap/SKILL.md) — strategic outer
  loop: invariant sequencing
- [`horizon-milestone/SKILL.md`](./pragma:milestone/SKILL.md) — phase-level
  outer loop: invariant bundles
- [`horizon-pragma-lifecycle.mmd`](./horizon-pragma-lifecycle.mmd) — companion
  lifecycle diagram
