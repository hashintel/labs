---
name: roadmap
description: "Create or update a strategic roadmap — the outer loop that sequences invariant thresholds across an initiative. Use when direction is not concrete enough for a capsule, multiple strategic bets compete, or you need to capture long-horizon intent, decisions, risks, and verification economics. Owns docs/roadmap.md."
argument-hint: "[create|update|review] [initiative or strategic area]"
---

# Horizon Roadmap

Create or maintain a **strategic roadmap** — the outer loop that sequences
invariant thresholds across an initiative. The roadmap captures long-horizon
intent, strategic bets, key decisions, and verification economics so that
milestone and pragma work is grounded in direction.

See [The Invariant Threshold](../../docs/invariant-threshold.md) for the governing
principle: **before invariants, optimize for validated understanding; after
invariants, optimize for speed on reversible work**.

## Input

Mode + context: $ARGUMENTS

Modes:
- `create` — initialize a new roadmap for an initiative
- `update` — revise after a milestone completes, a decision changes, or new
  evidence arrives
- `review` — assess current roadmap health and recommend next actions

## When to Use

- Direction is not concrete enough for a `/pragma:capsule`
- The active phase/work area is still undecided, so capsule scope cannot be
  selected yet
- Multiple strategic bets compete and need evaluation criteria
- Cross-cutting constraints must persist across multiple milestones and capsules
- Technology or architecture choices need explicit tracking with reversal triggers
- You need to capture what is cheap vs. expensive to verify before committing

## When Not to Use

- You already have stable direction and just need to scope the next slice →
  `/pragma:card`
- You need shared vocabulary and testable invariants → `/pragma:capsule`
- You need to answer one specific technical question → `/pragma:spike`

## Roadmap Location

Default: `docs/roadmap.md`. If it exists, update — don't duplicate.

## Authority and Routing Boundary

- Roadmap owns strategic direction, sequencing, and cross-cutting constraints.
- Milestone owns active phase control (candidate sequence, status, exit
  criteria).
- Capsule owns glossary and formal invariant wording.
- Assumptions ledger owns confidence and epistemic status for uncertain claims.
- Routing precedence: use horizon artifacts first only while initiative or phase
  selection is unresolved; once a concrete work area is selected, route through
  `/pragma:capsule` before `/pragma:card` or `/pragma:slice`.

For updates/reviews, roadmap should absorb strategic deltas only. Route other
lanes to their authority artifact:

- Semantics changed → `/pragma:capsule update`
- Phase control changed → `/pragma:milestone update`
- Confidence changed → `/pragma:assumptions update`
- Enforcement readiness changed → `/pragma:contract`

## Roadmap Sections

### 1. Strategic Intent

What are we trying to make true? One paragraph. This is the success condition
for the entire initiative.

### 2. System Shape

The high-level phase map with typed handoffs between phases. Not implementation
detail — structural understanding of how the system decomposes.

Format:
```
Phase N: [name]
  Input: [typed input]
  Output: [typed output]
  Character: [deterministic | inference | external-service | mixed]
```

This section answers: what are the major transformation boundaries?

### 3. Strategic Constraints

Concerns that must hold **across the entire initiative**, persisting across
milestones and capsules. These are not formal invariants (capsule owns those)
but the persistent truths that every capsule must respect.

Format:
```
- SC-001: [constraint statement]
  Scope: [which phases/boundaries this spans]
  Capsule formalization: [link to capsule invariant, or "not yet formalized"]
```

Rule: when a strategic constraint is mature enough for a testable statement,
it should be formalized in a capsule and enforced via `/pragma:contract`.

`not yet formalized` is temporary. If active milestone delivery is underway,
recommend `/pragma:capsule update` before creating additional cards for that
constraint.

### 4. Key Decisions

Architectural and strategic choices with evidence, rationale, and reversal
triggers. These are choices too significant for a single card but too
provisional for permanent architecture.

Format:
```
- D-001: [decision statement]
  Status: Proposed | Trialing | Adopted | Reversed
  Rationale: [why this, not alternatives]
  Evidence: [links to spikes, probes, slices, external data]
  Reversal trigger: [what would cause reconsideration]
  Irreversibility: [Low | Medium | High — what gets locked in]
```

Rules:
- Every decision must have a reversal trigger
- High-irreversibility decisions should be validated via `/pragma:spike` before
  Adopted status
- Reversed decisions stay recorded with rationale

### 5. Options and Bets

Strategic hypotheses not yet promoted to decisions. These are the speculative
layer — allowed but quarantined and tagged.

Format:
```
- B-001: [option or strategic hypothesis]
  Status: Parked | Exploring | Active | Retired
  Advance when: [what evidence would justify promoting to decision]
  Retire when: [what would eliminate this option]
```

### 6. Risks

Threats to the initiative with trigger conditions and mitigation probes.

Format:
```
- R-001: [risk statement]
  Trigger: [what would make this real]
  Mitigation: [spike | milestone | contract | hardening]
  Current exposure: [Low | Medium | High]
```

### 7. Verification Economics

What is cheap vs. expensive to verify right now? This section directly
informs where AI can be used aggressively vs. where work must stay narrow.

Format:
```
Cheap to verify now:
- [area] — [why: tests exist, types constrain, deterministic, etc.]

Expensive to verify now:
- [area] — [why: no fixtures, unclear requirements, model-dependent, etc.]
  Shrink strategy: [spike | characterize | harness | narrower scope]
```

### 8. Epistemic Status

Declare the initiative's current phase relative to the invariant threshold:

- **Pre-invariant**: core model not yet trusted. Work must be narrow.
  Vocabulary may still shift. AI delegation limited to reversible probes.
- **Invariant-backed**: core laws are stable. Verification is cheap for most
  slices. AI delegation can accelerate. Capsule is authoritative.
- **Mixed**: some areas are post-threshold, others are not. Specify which.

### 9. Milestone Sequence

The ordered sequence of phase-level invariant bundles to establish. Each
milestone is a learning/control point, not a delivery batch.

Format:
```
1. [Milestone name] — [which invariant bundle this establishes]
   Status: Not started | Active | Complete
   See: docs/milestone.md (if active) or docs/milestones/[name].md
```

### 10. Linked Authoritative Artifacts

Cross-references to canonical documents. The roadmap summarizes; these own
authority.

```
- Capsule: docs/capsule.md (vocabulary + formal invariants)
- Assumptions: docs/assumptions.md (epistemic state)
- Contracts: docs/contracts.md (enforcement tracking)
- Milestone: docs/milestone.md (active phase plan)
```

## Validation

After writing or updating, check:
1. Does every strategic constraint either link to a capsule invariant or note
   "not yet formalized"?
2. Does every high-irreversibility decision have evidence or a spike plan?
3. Does the verification economics section identify at least one area that is
   expensive to verify?
4. Is the epistemic status declared?
5. Does the milestone sequence reflect invariant thresholds, not just
   feature delivery?

## Constraints

- **The roadmap is a briefing document, not an authority.** Capsule owns
  vocabulary and formal invariants. Assumptions ledger owns epistemic state.
  Contracts own enforcement. The roadmap summarizes and links.
- **No glossary/law authoring in roadmap.** Stable term definitions and
  testable invariant wording must be formalized in a capsule.
- **Mixed context is fine; mixed authority is not.** The roadmap may contain
  strategic constraints, decisions, and system shape in one coherent place.
  But when any of those mature into testable invariants, they must be
  formalized in the appropriate canonical artifact.
- **No direct roadmap → slice jump.** Everything must flow through capsule →
  card → slice. The roadmap informs direction; it does not authorize
  implementation.
- **Speculation is allowed but quarantined.** Options/bets are explicitly
  tagged and separated from decisions and constraints.
- **Keep it to one document per initiative.** If the roadmap exceeds ~3 pages,
  the initiative may need splitting.

## Procedure

### Mode: create

1. Interview if context is incomplete:
   - What is the strategic goal?
   - What are the major system phases or boundaries?
   - What key decisions have already been made?
   - What is uncertain or risky?
   - What is cheap vs. expensive to verify?
2. Write all sections. Mark unknowns explicitly rather than guessing.
3. Declare epistemic status.
4. Define the first milestone.

### Mode: update

1. Identify what changed: new evidence, completed milestone, invalidated
   assumption, reversed decision, new risk.
2. Classify authority deltas and route non-strategic lanes first:
   - Semantics → `/pragma:capsule update`
   - Strategy → continue roadmap update
   - Phase control → `/pragma:milestone update`
   - Confidence → `/pragma:assumptions update`
   - Enforcement readiness → `/pragma:contract`
3. Update affected roadmap sections.
4. Re-assess epistemic status — has the initiative crossed a threshold?
5. Update milestone sequence if needed.

### Mode: review

1. Check each decision for stale evidence or missed reversal triggers.
2. Check strategic constraints for capsule formalization status.
3. Check verification economics — has anything become cheaper or more
   expensive to verify?
4. Check epistemic status — is the declared phase still accurate?
5. Classify authority deltas and route non-strategic lanes first when needed.
6. Recommend: next milestone action, spikes needed, constraints to formalize.

## Output

1. The roadmap document (created or updated)
2. Epistemic status assessment
3. Top risks or unresolved decisions
4. Authority Delta block (all lanes explicit; `none` required when no change)
5. Recommended next action

## Lifecycle

- **State**: `discovery` (create/review) or current state (update)
- **Next**: `/pragma:milestone` (if milestone needs defining), `/pragma:capsule`
  (once a specific work area is selected and ready to formalize),
  `/pragma:spike` (if key decision needs evidence), or first non-`none`
  authority delta command
- **Loop**: `/pragma:consult`
