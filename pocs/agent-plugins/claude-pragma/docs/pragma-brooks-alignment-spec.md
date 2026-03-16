# Pragma x No Silver Bullet Alignment Spec

> Status: historical alignment record (non-normative).
>
> Operational authority lives in [`pragma-lifecycle.md`](./pragma-lifecycle.md),
> with first principles in [`invariant-threshold.md`](./invariant-threshold.md)
> and onboarding/index guidance in [`pragma-skills.md`](./pragma-skills.md).

This document translates Frederick P. Brooks Jr.'s
_No Silver Bullet: Essence and Accident in Software Engineering_ (1986)
into concrete refinements for the `pragma:*` methodology skills.

## Intent

1. Preserve what the current pragma system already does well.
2. Sharpen places where Brooks's guidance can be made operational.
3. Keep changes small, composable, and compatible with the current lifecycle contract.

## Core Brooks Principles (Operational Form)

1. **No silver bullet**: Expect steady gains from disciplined composition, not singular miracles.
2. **Essential vs accidental complexity**: Triage first; solve the right class of problem.
3. **Requirements are discovered iteratively**: Use rapid feedback loops with runnable artifacts.
4. **Grow systems incrementally**: Prefer always-running vertical slices over big-bang construction.
5. **Buy before build**: Reuse package/tool capability whenever applicability is acceptable.
6. **Conceptual integrity matters**: Keep one coherent model across names, boundaries, and behavior.

## Current Pragma Strengths

1. Strong incremental flow (`capsule -> skeleton -> card -> slice -> refactor`).
2. Explicit anti-speculation stance (one slice, no speculative abstraction).
3. Assumptions ledger for epistemic continuity.
4. Contract and hardening branches for governance maturity.
5. Refactor step formalized as part of done.

## Gaps Found

1. **No explicit essential-vs-accidental triage step** in `/pragma:consult`.
2. **Buy-vs-build not encoded** as a mandatory checkpoint in planning/execution.
3. **Requirement uncertainty handling is implicit**; rapid prototype loop criteria are not explicit.
4. **Tool chasing anti-pattern** is not named directly (for accidental-only optimization loops).

## Implemented Refinements

These refinements have been incorporated into operational documents and skills;
this file remains as rationale and change history.

## `/pragma:consult`

1. Add a triage mini-phase to classify the current bottleneck as essential, accidental, or mixed.
2. Add routing cues:
   - accidental-heavy friction -> `/pragma:harden`
   - requirement uncertainty -> `/pragma:spike` before `/pragma:card`
   - repeated custom work where package fit is plausible -> buy-vs-build checkpoint before slicing
3. Add anti-pattern:
   - **Tool chasing**: replacing tools/editors/languages without changing conceptual clarity.

## `/pragma:card`

1. In `Risks / Assumptions`, require a **BUY-OR-BUILD** line for each slice.
2. Add conditional **PROTOTYPE PLAN** line when requirements are behaviorally unclear.
3. Add validation checks to enforce both decisions before approving card quality.

## `/pragma:slice`

1. Add step-0 preflight:
   - confirm buy-vs-build was considered and resolved
   - if requirement behavior is still unclear, route to `/pragma:spike` instead of implementing prematurely

## `/pragma-skills.md`

1. Add explicit design principles section capturing Brooks-style constraints:
   - no silver bullets
   - triage essential vs accidental
   - grow software
   - buy before build

## Recommended Next Iteration (Not Yet Implemented)

1. Add a dedicated `rapid-prototype` supporting skill focused on requirement discovery loops
   (distinct from throwaway technical spikes).
2. Add a lightweight `buy-build` gate artifact template for card/slice handoffs.
3. Add optional periodic conceptual-integrity review pass in `/pragma:refactor`.

## Acceptance Criteria For This Spec

1. At least one pragma skill performs explicit essential-vs-accidental triage.
2. Card and slice steps include explicit buy-vs-build checkpoint language.
3. Requirement uncertainty is routed to prototype/spike before delivery work.
4. The lifecycle remains compatible with `pragma-lifecycle.md`.

## Maintenance Policy

Update this document only when performing a new philosophy-level alignment
pass. For routine methodology updates, edit `pragma-lifecycle.md`,
`pragma-skills.md`, and relevant `SKILL.md` files directly.
