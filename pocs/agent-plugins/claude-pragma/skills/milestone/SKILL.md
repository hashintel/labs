---
name: milestone
description: "Create or update a milestone — a bounded phase map that defines which invariant bundle to establish through multiple pragma cycles. Use when coordinating multi-slice phases, tracking migration state, or determining readiness to accelerate. Owns docs/milestone.md."
argument-hint: "[create|update|review] [phase name or scope]"
---

# Horizon Milestone

Create or maintain a **milestone** — a bounded phase map that defines which
invariant bundle to establish through multiple pragma cycles. A milestone is a
learning/control point, not a delivery batch.

See [The Invariant Threshold](../../docs/invariant-threshold.md) for the governing
principle. A milestone answers: **which invariants are we establishing in this
phase, and what acceleration does crossing this threshold unlock?** The
milestone identifies invariant bundles for this phase; capsule documents remain
the authority for invariant wording.

## Input

Mode + context: $ARGUMENTS

Modes:
- `create` — define a new milestone from roadmap direction
- `update` — revise after slices land, assumptions change, or phase status shifts
- `review` — assess milestone health and readiness to advance or complete

## When to Use

- A roadmap direction needs decomposing into a bounded multi-slice campaign
- Multiple pragma cycles need coordination toward a phase-level outcome
- Migration state, legacy surfaces, or cutover readiness need tracking
- You need to determine whether the project is ready for pragma acceleration

## When Not to Use

- You need to define one thin slice → `/pragma:card`
- You need shared vocabulary and invariants → `/pragma:capsule`
- Direction itself is unclear → `/pragma:roadmap`

## Milestone Location

Default: `docs/milestone.md` for the active milestone. Completed milestones
move to `docs/milestones/[name].md`. Only one milestone should be active at a
time.

## Milestone Sections

### 1. Outcome

One observable phase-level result. What is true when this milestone is
complete that is not true now?

### 2. Why Now

Which roadmap item(s) this advances. Link to `docs/roadmap.md` decisions,
constraints, or strategic intent.

### 3. Invariant Bundle to Establish

The invariant bundles this milestone must establish. This is the core section
— it defines what the phase is *for* without duplicating capsule law text.

Format:
```
Invariant bundles:
- IB-01: [bundle name]
  Capsule refs: [docs/capsule.md#... | docs/capsule-<feature>.md#... | not yet formalized]
  Threshold evidence: [how we'll know this bundle now holds]
- IB-02: [bundle name]
  Capsule refs: [...]
  Threshold evidence: [...]

Acceleration unlocked:
- [what becomes safe to delegate/accelerate once these hold]
```

Rules:
- Bundle entries are labels + references, not copied law text. Durable wording
  lives in capsule artifacts.
- Stable term and invariant wording must be authored in a capsule, not here.
- `not yet formalized` is allowed only while creating a pre-capsule milestone.
  During `update` or `review`, any active bundle still marked this way must
  route to `/pragma:capsule update` before recommending `/pragma:card` or
  `/pragma:slice`.

### 4. Ready for Pragma? (Gate)

A two-part checklist that separates semantic readiness from execution readiness.
Assess honestly.

```
Ready to formalize/update capsule?
- [ ] Key nouns are stable enough for a capsule
- [ ] 3–7 invariants can be stated clearly
- [ ] One happy path is concrete and specific

Ready to accelerate slices in this phase?
- [ ] Relevant capsule is linked for every active invariant bundle
- [ ] High-risk unknowns are isolated to spikes or assumptions
- [ ] The next slice can be verified cheaply
```

If most boxes are unchecked, the right action is not more implementation
planning — it is more narrowing, spiking, or reframing.

### 5. In Scope

Phase-level outcomes. Not individual cards — those emerge during pragma
execution. These are the boundaries of what this phase covers.

### 6. Deferred Beyond This Phase

Work intentionally sequenced after this milestone. This is a temporary
sequencing boundary, not a permanent project exclusion.

### 7. Authoritative Capsules

Capsule documents this milestone depends on.

Format:
```
- Project capsule: docs/capsule.md
- Feature capsule(s): docs/capsule-<feature>.md
```

If no capsule exists for an active bundle, mark it and route to
`/pragma:capsule` before carding.

### 8. Entry Assumptions

Link to specific assumption IDs from `docs/assumptions.md` that this
milestone depends on. If any are invalidated, the milestone must be reviewed.

Format:
```
- A-001: [statement] (confidence: NN%)
- A-003: [statement] (confidence: NN%)
```

### 9. Exit Criteria

Falsifiable, observable criteria for phase completion. These are phase-level,
not slice-level — they describe the state of the system, not individual
behaviors.

Format:
```
- [ ] [observable criterion]
- [ ] [observable criterion]
```

### 10. Candidate Sequence

Candidate spikes, cards, and supporting actions. This is a **suggested
ordering**, not a locked delivery plan. Resequence when evidence changes.

Format:
```
1. [spike | card | characterize | contract | harden]: [description]
2. [spike | card | characterize | contract | harden]: [description]
3. ...
```

Rules:
- Maximum 6 candidates. If more are needed, the milestone is too broad.
- Candidates are reordered after spikes/slices when evidence changes.
- No candidate directly authorizes coding — each must become a card first.

### 11. Phase Status

Current state of each major work area within the milestone. Use completion
markers and brief status notes.

Format:
```
- [area]: COMPLETE | IN PROGRESS | NOT STARTED — [brief status]
```

### 12. Phase Stability Boundaries

Stability boundaries — components, schemas, interfaces, or behaviors that
this milestone explicitly preserves. This prevents collateral damage and
makes the change surface visible.

### 13. Phase Risks

Risks specific to this phase, with mitigation strategies.

Format:
```
- [risk] (source: A-### | D-### | R-### | local) → [mitigation: spike | assumption tracking | fallback plan]
```

### 14. Open Design Questions

Unresolved questions that may affect sequencing or scope. Each should have a
path to resolution (spike, prototype, stakeholder input).

Format:
```
- [capsule-gap | roadmap-decision | assumption | spike]: [question]
  Resolution path: [/pragma:capsule update | /pragma:roadmap update | /pragma:assumptions update | /pragma:spike]
```

### 15. Active Legacy Surfaces (optional — migration milestones)

For migration milestones, track what legacy components are still live and what
coexistence constraints exist.

Format:
```
- [legacy component]: [status: active | deprecated | removed]
  Coexistence constraint: [what must remain true while both exist]
  Cutover readiness: [criteria for retirement]
```

### 16. Review Triggers

When this milestone should be re-examined, even if no explicit review is
scheduled.

Default triggers (always include):
- An entry assumption is invalidated
- 2–3 slices complete without reviewing phase progress
- An exit criterion becomes unreachable
- A major external constraint changes

## Validation

After writing or updating, check:
1. Does the outcome describe observable system state, not internal components?
2. Does every active invariant bundle link to capsule refs or explicitly note
   `not yet formalized`?
3. Is the "Ready for Pragma?" gate assessed honestly for both capsule and
   execution readiness?
4. Do exit criteria differ from individual card definitions of done?
5. Are candidate sequences bounded (≤ 6 items)?
6. Does "Phase Stability Boundaries" identify real stability boundaries?
7. Is "Deferred Beyond This Phase" clearly temporary (not a permanent non-goal)?
8. Are open design questions tagged with their owning authority lane?
9. During `update`/`review`, are all active bundles capsule-formalized (no
   lingering `not yet formalized`)?

## Constraints

- **One active milestone at a time.** If two milestones compete, one must be
  scoped down or sequenced after the other.
- **Milestones hold candidates, not binding tasks.** The candidate sequence is
  advisory. Cards are created through `/pragma:card` during execution.
- **No direct milestone → slice jump.** Candidates must become cards first.
  Cards feed slices.
- **Capsule remains the only authority for vocabulary and formal invariants.**
  The milestone identifies invariant bundles and links capsule refs; it does
  not author durable law wording.
- **Deferred is temporary; non-goals are permanent.** Durable exclusions belong
  in capsule non-goals, not in milestone deferments.
- **Exit criteria are phase-level.** Individual slice definitions of done live
  in their cards.
- **Resequence freely.** When a spike or slice produces new evidence, update
  the candidate sequence immediately.
- **Milestone is control-plane, not authority sink.** If semantics, strategy,
  assumptions confidence, or enforcement readiness changed, propagate those
  deltas to their authority artifact before resuming card/slice flow.

## Procedure

### Mode: create

1. Confirm a roadmap exists and this milestone advances a roadmap item. If no
   roadmap → `/pragma:roadmap` first.
2. Interview if context is incomplete:
   - What phase-level outcome are we targeting?
   - What must become trustworthy by the end of this phase?
   - What is currently uncertain?
   - What must not change?
3. Write all required sections. Mark optional sections as N/A if not relevant.
4. Assess the two-part "Ready for Pragma?" gate.
5. If capsule readiness fails → recommend `/pragma:capsule`.
6. If capsule readiness passes but execution readiness fails → recommend
   `/pragma:spike`, `/pragma:shaping-*`, or further narrowing.
7. If both pass and next behavior is clear → recommend `/pragma:card`.
8. If both pass but behavior is still unclear → recommend `/pragma:spike`.
9. If direction itself is unstable or scope is too broad → recommend
   `/pragma:roadmap` (and optionally `/pragma:shaping-*` before re-entering).

### Mode: update

1. Identify what changed: slice completed, assumption invalidated, new
   evidence, status shift.
2. Classify authority deltas from new evidence:
   - Semantics changed → `/pragma:capsule update`
   - Strategy changed → `/pragma:roadmap update`
   - Phase control changed → continue milestone update
   - Confidence changed → `/pragma:assumptions update`
   - Enforcement readiness changed → `/pragma:contract`
3. Update affected phase-control sections (especially phase status,
   candidate sequence, entry assumptions links).
4. Re-assess both gate halves if either was previously failing.
5. Check review triggers.
6. If exit criteria are met → recommend milestone completion and roadmap
   update.

### Mode: review

1. Check entry assumptions against `docs/assumptions.md` — any invalidated?
2. Check exit criteria progress.
3. Check candidate sequence — does ordering still make sense?
4. Check "Phase Stability Boundaries" — any stability violations?
5. Check open design questions — any now answerable and where should they land?
6. Classify authority deltas (semantics/strategy/phase-control/confidence/enforcement).
7. Recommend: authority update first when needed, then next card/spike,
   milestone revision, or milestone completion.

## Output

1. The milestone document (created or updated)
2. "Ready for Pragma?" gate assessment (capsule + execution)
3. Top risks or blockers
4. Authority Delta block (all lanes explicit; `none` required when no change)
5. Recommended next action

## Lifecycle

- **State**: `planning`
- **Next**: `/pragma:capsule` (if gate passes and capsule needed),
  `/pragma:card` (if capsule exists and next behavior is clear),
  `/pragma:spike` (if gate fails due to uncertainty),
  `/pragma:roadmap update` (if milestone completes), or first non-`none`
  authority delta command
- **Loop**: `/pragma:consult`
