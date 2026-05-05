# Pragma Skills

The `pragma:*` skills implement a tracer-bullet methodology for incremental, behavior-first development.

See [Pragma Lifecycle Contract](./pragma-lifecycle.md) for the canonical loop, state model, and autopilot handoff rules.

## Document Guide

Use these documents in this order:

1. **Start here**: this file for quick orientation and skill discovery.
2. **Run the method**: [Pragma Lifecycle Contract](./pragma-lifecycle.md)
   for routing, authority, and loop behavior.
3. **Understand why**: [The Invariant Threshold](./invariant-threshold.md)
   for first principles.
4. **Historical rationale**: [Pragma x No Silver Bullet Alignment Spec](./pragma-brooks-alignment-spec.md)
   for design-history context (non-normative).
5. **Diagram companion**: [horizon-pragma-lifecycle.mmd](./horizon-pragma-lifecycle.mmd)
   for visual flow (non-authoritative).

## Governing Principle: The Invariant Threshold

> Software progress comes from making truth cheap to check before making
> output cheap to produce.

Every pragma skill is a move in the cycle of **narrow uncertainty → establish
invariants → accelerate → detect drift**. The goal of the early phase is not
artifacts but invariants. Once invariants exist, AI becomes a force multiplier.
Before they exist, AI output is mostly risk.

See [The Invariant Threshold](./invariant-threshold.md) for the full
philosophy. See [Horizon Skills](#horizon-skills) for the outer loop that
sequences invariant thresholds across milestones.

## Design Principles

- No silver bullets: compounding disciplined steps beat one-shot miracles
- Triage essential vs accidental complexity before choosing a method step
- Grow software incrementally using thin end-to-end slices
- Create the needle, then thread it: define strict spec tests first, then
  implement to green, then refactor
- Prefer buy-before-build when package/tool applicability is acceptable
- Preserve conceptual integrity through consistent glossary, invariants, and boundaries
- Verification economics: when verification is cheap, delegate aggressively;
  when expensive, narrow scope until verification becomes cheap
- Delegate what is reversible; protect choices that lock in abstractions

## Suggested entrypoint

If you are unsure what to do next, start with:

- `/pragma:consult`

It interviews briefly, assesses your current state, and recommends the next best `pragma:*` step.

## Typical flow

- `/pragma:capsule` → define shared vocabulary + invariants
- `/pragma:skeleton` → prove build/test/run pipeline end-to-end
- `/pragma:card` → define one thin behavior slice
- `/pragma:slice` → execute the slice spec-first (red → green)
- `/pragma:refactor` → align naming/boundaries to capsule
- `/pragma:assumptions update` → persist new assumptions/validations from the slice
- `/pragma:consult` → reassess and pick the next best step

## Supporting skills (as needed)

- `/pragma:spike` → answer one risky unknown before slicing
- `/pragma:assumptions` → maintain assumption ledger across slices
- `/pragma:characterize` → lock down legacy/unclear behavior before change
- `/pragma:contract` → turn invariants into executable enforcement
- `/pragma:harden` → strengthen verification harness and CI

## Optional Pre-Planning Adjuncts

These are optional and do not replace the `pragma:*` delivery loop:

- `/pragma:shaping-framing` → distill transcript-heavy discovery inputs into a frame
- `/pragma:shaping-kickoff` → convert kickoff transcript timelines into builder territory maps
- `/pragma:shaping-breadboard` → map affordances/wiring before carding
- `/pragma:shaping-breadboard-reflect` → sync and reflect on breadboards before planning/refactor

All adjunct outputs must rejoin through `/pragma:capsule` or `/pragma:card`.

## Horizon Skills

The `pragma:*` (horizon) skills provide the outer loop — strategic steering above the
pragma delivery cycle:

- `/pragma:roadmap` → sequence invariant thresholds across an initiative;
  capture strategic constraints, key decisions, verification economics
- `/pragma:milestone` → define the current phase's invariant bundle;
  gate readiness for pragma acceleration

The relationship: horizon sets direction and defines which invariants to
establish; pragma proves and delivers them. Nothing in the horizon layer can
directly authorize coding — everything must flow through capsule → card → slice.

For artifact authority and conflict resolution, see the matrix in
[Pragma Lifecycle Contract](./pragma-lifecycle.md#artifact-authority).

See [The Invariant Threshold](./invariant-threshold.md) for the governing
principle that spans both layers.

## Independence rule

Each `pragma:*` skill is self-contained and should remain usable on its own.
Root rules may suggest skills, but are not required for the skills to work.

## Loop rule

After any execution-oriented step (`/pragma:slice`, `/pragma:spike`, `/pragma:characterize`, `/pragma:contract`, `/pragma:harden`, `/pragma:refactor`), default back to `/pragma:consult` unless the user explicitly asks to continue directly into a specific next command.
