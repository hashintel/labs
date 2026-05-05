# Pragma Lifecycle Contract

This document defines the canonical state machine for `pragma:*` and
`pragma:*` (horizon) skills.

See [The Invariant Threshold](./invariant-threshold.md) for the governing
principle: every state in the lifecycle is a position relative to the cycle of
**narrow uncertainty → establish invariants → accelerate → detect drift**.

## Goal

Make pragma methodology feel self-sustaining: every step leaves a clear state and default next command, then returns to `/pragma:consult` for routing unless the user explicitly wants immediate continuation.

## Document Status and References

This is the **normative operations contract** for `pragma:*` and `pragma:*` (horizon)
skill routing.

- Philosophy and first principles live in
  [`invariant-threshold.md`](./invariant-threshold.md).
- Onboarding and index guidance lives in
  [`pragma-skills.md`](./pragma-skills.md).
- Historical rationale for Brooks-driven refinements lives in
  [`pragma-brooks-alignment-spec.md`](./pragma-brooks-alignment-spec.md).
- The diagram companion in [`horizon-pragma-lifecycle.mmd`](./horizon-pragma-lifecycle.mmd)
  is explanatory only; if it conflicts with text, this document wins.

## State Model

- `discovery` — uncertainty about next method step. Verification is expensive; work must stay narrow. *(Pre-threshold: narrowing)*
- `foundation` — capsule/skeleton setup and alignment. Establishing vocabulary, laws, and the first cheap verification path. *(Threshold crossing: invariant establishment)*
- `planning` — carding and slice definition. Choosing the smallest reversible move. *(Post-threshold: acceleration preparation)*
- `delivery` — slice implementation and immediate refactor. Building within established invariants. *(Post-threshold: acceleration)*
- `stabilizing` — legacy lock-down and structural clean-up. Restoring conceptual integrity after drift. *(Drift detection: re-narrowing)*
- `governance` — assumptions, contracts, and verification hardening. Lowering verification cost for the next cycle. *(Drift detection: re-hardening)*

## Canonical Backbone Loop

`/pragma:consult` → `/pragma:capsule` → `/pragma:skeleton` → `/pragma:card` → `/pragma:slice` → `/pragma:refactor` → `/pragma:assumptions update` → `/pragma:consult`

## Slice Execution Rule (Needle First)

Inside `/pragma:slice`, execute behavior work as:

`spec tests red` → `implementation green` → `alignment refactor`

This keeps definition-of-done behavior tests ahead of implementation and
reduces confirmation-style test writing.

## Optional Pre-Planning Adjunct Lane

Use `pragma:shaping-*` skills only when they reduce ambiguity before planning:

- `/pragma:shaping-framing` for transcript distillation into a clear frame
- `/pragma:shaping-kickoff` for converting kickoff transcript timelines into territory maps
- `/pragma:shaping-breadboard` for affordance and wiring maps
- `/pragma:shaping-breadboard-reflect` for code-sync and design smell review of an existing breadboard

This lane is optional and must rejoin the backbone before delivery:

`/pragma:consult` → `/pragma:shaping-*` → `/pragma:capsule` or `/pragma:card` → `/pragma:slice`

No direct adjunct-to-delivery jump is allowed. Never route `/pragma:shaping-*` directly to `/pragma:slice`.

## Conditional Branches

- Use `/pragma:spike` when feasibility or behavior is materially uncertain.
- Use `/pragma:characterize` when existing behavior must be locked before change.
- Use `/pragma:contract` when invariants exist but are weakly enforced.
- Use `/pragma:harden` when verification friction or inconsistency is slowing delivery.

All branch endpoints should default to `/pragma:consult` afterward.

## Change Classification Gate (Propagation Precedence)

Before writing or updating any lifecycle artifact, classify the latest evidence
into one dominant authority lane. If multiple lanes are affected, apply them in
this order:

1. **Durable semantics changed** (new/changed glossary boundary, invariant
   wording, happy-path semantics, permanent non-goal) → `/pragma:capsule update`
2. **Strategic direction changed** (cross-cutting constraint, strategic bet,
   decision rationale, reversal trigger) → `/pragma:roadmap update`
3. **Phase control changed** (active scope, status, deferments, candidate
   ordering, exit criteria) → `/pragma:milestone update`
4. **Confidence changed** (assumption validated/invalidated, confidence shift)
   → `/pragma:assumptions update`
5. **Enforcement readiness changed** (a law is now enforceable in code/tests)
   → `/pragma:contract`

Do not park semantic or strategic updates in milestone notes. Propagate them to
their authority artifact first, then continue delivery.

## Autopilot Handoff Rule

Every `pragma:*` skill output should end with a lifecycle tail:

For routing and evidence-producing outputs (`/pragma:consult`,
`/pragma:slice`, `/pragma:spike`, `/pragma:refactor`, `/pragma:milestone`,
`/pragma:roadmap`), include an explicit authority delta block before lifecycle
tail:

```md
## Authority Delta
- Semantics: none | `/pragma:capsule update` — [reason]
- Strategy: none | `/pragma:roadmap update` — [reason]
- Phase control: none | `/pragma:milestone update` — [reason]
- Assumptions: none | `/pragma:assumptions update` — [reason]
- Enforcement: none | `/pragma:contract` — [reason]
```

`none` must be explicit per lane.

```md
**State**: <one lifecycle state>
**Next**: </pragma-command>
**Loop**: `/pragma:consult` (default unless user explicitly continues directly)
```

## Assumptions Clock Pulse

`/pragma:assumptions update` is mandatory after `/pragma:slice` and `/pragma:spike`.

`/pragma:assumptions review` is recommended periodically (for example every 2-3 slices or when confidence drifts).

## Dead-Branch Heuristic

A branch is considered dormant (not dead) when it has clear activation criteria but low frequency. For dormant branches, maintain explicit trigger language in `/pragma:consult` rather than forcing use on every loop.

## Artifact Authority

When the adjunct lane is used, enforce single authority per concern as defined in [shape-pragma-integration.md](../docs/shape-pragma-integration.md):

- Frame and kickoff artifacts clarify context
- Capsule owns glossary and invariants
- Breadboards map mechanisms
- Cards and slices own implementation planning and delivery

### Authority Matrix

| Concern | Primary authority | Notes |
|---------|-------------------|-------|
| Strategic direction, bets, phase sequencing | `docs/roadmap.md` | Horizon layer owns initiative-level intent and ordering |
| Active phase scope, deferments, candidate sequence, exit criteria | `docs/milestone.md` | Milestone is phase control, not semantic law authority |
| Glossary terms, invariant wording, happy path, permanent non-goals | `docs/capsule.md` / `docs/capsule-<feature>.md` | Capsule is durable semantic authority |
| Assumption confidence and uncertainty tracking | `docs/assumptions.md` | Promote stabilized assumptions to the proper authority artifact |
| Executable invariant enforcement | `docs/contracts.md` + tests | `/pragma:contract` translates capsule laws into enforcement |

### Conflict Resolution Rule

If artifacts disagree, resolve by concern authority instead of recency:

1. Semantic definition conflicts are resolved by capsule.
2. Strategic ordering conflicts are resolved by roadmap.
3. Active phase scope conflicts are resolved by milestone.
4. Confidence-state conflicts are resolved by assumptions ledger.
5. Enforcement-state conflicts are resolved by contracts/tests.

When a conflict reveals stale information, update the stale artifact and add
cross-references rather than duplicating content.
