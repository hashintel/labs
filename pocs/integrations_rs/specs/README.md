# Protocol specifications

Status: working TLA+ models. For the rationale for modeling at this level,
and for not modeling more, see
[formal verification](../local/docs/formal-verification.md). These specs
check the design under explicit environment axioms. The DST checks the
implementation. The credentialed contract suites check that the axioms hold
for real providers. Each layer covers what the other two cannot.

Run TLC from the devshell (the `tlaplus` package is in
`nix/devshell/flake.nix`):

```sh
cd specs
nix develop path:../nix/devshell -c tlc -workers auto \
  -config LeaseFencing.cfg LeaseFencing.tla
nix develop path:../nix/devshell -c tlc -workers auto \
  -config LogCursor.cfg LogCursor.tla
```

Each module has one honest config, which must pass, and at least one
falsification config, on which TLC must find a counterexample. The config
headers state the expected outcome.

## LeaseFencing

Models shard lease acquisition, renewal, skew-graced takeover, the
open/revalidate/recover/revalidate handshake, SlateDB epoch fencing, and the
chunk admission window, against:

| Spec element | Code |
|---|---|
| `Acquire`, `CanTake` | `plan_acquisition`, `src/orchestrator/lease.rs` |
| `Renew` | `renew` + `plan_renewal`, `src/orchestrator/lease.rs` |
| `IsCurrent` | `is_current`, `src/orchestrator/lease.rs` |
| `ChunkWindow`, timing `ASSUME` | `LeaseTiming::new` validation arms |
| `OpenWriter` → `RevalidateOk/Fail` ×2 | the handshake in `src/orchestrator/shard.rs` |
| `AdmitChunk`, `WindowDeadline` | `admit_chunk` / `LeaseChunkPermit`, `src/orchestrator/shard.rs` |
| `Stop` | crash, detected loss, fenced append, shutdown (collapsed; safety-equivalent) |

The module header documents environment axioms A1–A4. Each axiom maps to an
executable contract (S3 conditional writes, SlateDB fencing, permit
deadlines) or to a stated deployment assumption (the clock-skew envelope).

### Checked property

`ChunkExclusion`: while any worker's admitted chunk is inside its
send/commit window, the lease belongs to that worker alone. This is the claim in
the `LeaseTiming::new` comment that a fast-clocked competitor cannot
overlap an admitted chunk. Self-reacquisition (crash and restart of the
same runner ID, which takes no grace) is permitted. The module header
explains why that overlap is safe.

The model does not check "commits only happen while holding the lease",
because that claim is false for this protocol. A stale owner may commit
until the successor opens the writer: the fence boundary is the storage
epoch (A2), and lease replacement does not fence. The successor recovers
the committed prefix. See the note in the module. The
[LogCursor](#logcursor) model covers what the journal guarantees across
that handover.

### Model coverage

Worker clocks drift. Offsets are redrawn on every tick inside the actual
envelope, which covers steady clocks, forward steps, and (when the bound
permits) backward steps such as NTP corrections. Fixed offsets are a
special case of this behavior.

Timing values are chosen by Init from configured ranges, filtered by the
`LeaseTiming::new` chunk-fit inequality (`TimingOK`, the `ChunkCannotFit`
arm). A sweep pass shows that the validator's inequality carries the
theorem for every configuration it admits within the ranges. The
constructor's `RenewalCannotFit` arm bounds renewal pacing, which is a
liveness concern. The model lets `Renew` fire at any moment before expiry,
which covers every pacing that arm admits and more.

Chunk windows overlap, as they do in the code. The worker's turn loop is
serial, but a turn usually settles before its window's deadline, so a
later admission's window can extend past an earlier one's. `ChunkSlots`
bounds how many live windows the model keeps per worker (2 in the shipped
configs). Every live window must independently satisfy `ChunkExclusion`.

Workers are declared symmetric (`SYMMETRY Sym`). This is sound because the
spec checks only safety. Remove the symmetry declaration before adding
liveness properties.

### Results (2026-08-11, TLC 1.7.4, overlapping-window model)

| Config | Meaning | Result |
|---|---|---|
| `LeaseFencing.cfg` | honest deployment, drifting clocks, fixed timing | **passes** — 7,045,109 distinct states, 34s |
| `LeaseFencingSweep.cfg` | every chunk-fit-validated timing combination in `dur ∈ 4..7, gcd/ccd/margin ∈ {1,2}` | **passes** — 9,089,806 distinct states, 41s |
| `LeaseFencingSkewViolation.cfg` | actual skew 4 vs declared 1 | **violated** — counterexample as before |

The counterexample: w1 (offset 0) acquires at t=0 (expiry 6) and admits a
chunk at t=1 (window ends t=3). w2 (offset 4) reads
`clk = 7 ≥ expiry + grace = 7` at real t=3 and replaces the lease while
the chunk is still in its window. This is the expected outcome. It shows
two things. First, the safety argument requires the skew envelope: a
deployment that exceeds it loses the chunk-overlap guarantee even though
every CAS and fencing check still works. Second, the model detects the
fault it exists to exclude.

Model bounds: 2 workers, integer time to 10, ≤ 5 lease writes, ≤ 2 live
chunk windows per worker, `lease_duration=6, skew=1, chunk deadlines 1+1,
margin=1`. The timing theorem's arithmetic depends only on the chunk-fit
inequality, which the Init filter `TimingOK` enforces, but TLC checks only
the stated bounds. Raise `MaxTime`, `MaxVer`, `ChunkSlots`, or the worker
count for more confidence at exponential cost.

## LogCursor

Models what the journal guarantees across takeover: append
acknowledgement, the CommitUnknown ambiguity discipline (adopt-or-retry
through a recovery scan), storage-epoch fencing, and full-prefix recovery.
The fence in this model is the storage epoch at append time; LeaseFencing
fences at chunk admission. Modeled against:

| Spec element | Code |
|---|---|
| `AppendApplied`, `AppendAmbiguous` | append dispositions, `crates/durable-kernel/src/shard_log/mod.rs` |
| `Recover` (scan + adopt + prove absence) | `recover_inner`, `crates/durable-kernel/src/shard_log/command_loop.rs` |
| `RetryProvenAbsent`, `RetryAmbiguous` | the command loop's adopt-or-retry discipline |
| `OpenWriter` / `CanAppend` | SlateDB storage-epoch fencing (axiom B2) |
| `Stop` | crash, fenced-append discovery, shutdown (collapsed; safety-equivalent) |

`DefinitelyNotCommitted` is not an action. It changes neither the journal
nor the acknowledgement state, so it is a stutter step at this
abstraction.

The module header documents environment axioms B1–B3 (durable appends
persist, fencing at append, complete recovery scans). Each axiom maps to
its executable contract.

### Checked properties

Invariant statements are the property catalog's sentences
([property-catalog.md](../local/docs/property-catalog.md),
`crates/durable-kernel/src/properties.rs`). The model invariant and the
catalog statement must remain word-for-word identical. The DST harness
checks the same claims against the implementation on every schedule.

| Invariant | Catalog property |
|---|---|
| `AckImpliesDurable` | `KRN-A1-ACK-IMPLIES-DURABLE` |
| `DurableEndNeverRegresses` (action property) | `KRN-A2-DURABLE-END-MONOTONIC` |
| `ServedProjectionCurrent` | `KRN-A3-PROJECTION-REFOLD` (the fold-currency half; the DST covers the dedupe clause. Under B2 the model journal never holds a duplicate identity, which `NoDuplicateIdentity` checks as a consequence) |
| `AckSurvivesRecovery` | `KRN-A4-ACK-SURVIVES-RECOVERY` |
| `AppliedAtMostOnce` | `KRN-A5-APPLIED-ONCE` |
| `AdoptionImpliesDurable` | the AlreadyDurable companion to KRN-A1 |

The coverage shapes KRN-S1 (ambiguous-durable adopted), KRN-S2
(ambiguous-lost proven absent, retried to Applied), KRN-S3 (fenced loop
stops), and KRN-S4 (crash with an unacknowledged durable event) are the
model's actions. The adopt and proven-absent branches are reachable: if
you assert that either branch never fires, TLC reports a violation.

### Results (2026-08-11, TLC 1.7.4)

| Config | Meaning | Result |
|---|---|---|
| `LogCursor.cfg` | fencing at append (B2 holds) | **passes** — 657 distinct states, <1s |
| `LogCursorNoFence.cfg` | B2 dropped: any open writer's appends land | **violated** — `AckSurvivesRecovery` counterexample |

The state space is small because the discipline is restrictive: an
ambiguous append closes the writer, and every resolution path runs through
a fresh open and scan. The counterexample (7 states): w2 opens epoch 2 and
serves. w1 opens epoch 3 and recovers an empty prefix. Stale w2 appends
`e1` and acknowledges it Applied. The newest incarnation now serves a
prefix that misses an acknowledged event. The append fence prevents this
loss. In both falsification configs, removing one axiom produces the fault
that the axiom excludes.

Model bounds: 2 writers, 2 event identities, journal length ≤ 4, ≤ 4
writer opens. The invariants quantify over the newest serving writer, so
`SYMMETRY` over writers and events is sound (safety-only).

## Follow-ups

- Liveness (ownership churn cannot wedge a shard forever; the
  abandoned-acquirer/re-handshake loop terminates). This needs fairness
  conditions and removal of `SYMMETRY`. The current specs check only
  safety.
- The admission protocol (ready receipts, depth-one admission pointer CAS,
  run locator) as a third module, per the priority order in
  [formal verification](../local/docs/formal-verification.md).
- An Apalache inductive invariant to make the timing theorem
  parameter-free: prove `ChunkExclusion` for all values satisfying the
  `LeaseTiming::new` inequalities, beyond the ranges TLC can enumerate.
- A1b (CAS version distinctness) is currently an axiom justified by epoch
  monotonicity plus strict renewal extension. Modeling read-then-CAS
  non-atomically with content-hash versions would check the ABA argument
  directly.
- Feed the skew-violation trace shape back into the DST as a biased seed
  scenario: clock-skew fault injection beyond the configured envelope,
  asserting that the failure is detected.
- Extend LogCursor with snapshot-bounded recovery (recovery from a
  committed snapshot plus suffix replay, and the corruption fallback
  ladder). These are the KRN-S7/S8 shapes, currently covered only by the
  DST.
- Compose LeaseFencing and LogCursor. Today the lease model assumes the
  journal behaves, and the journal model assumes opens happen at arbitrary
  times. A composed model would check that lease-paced opens preserve the
  journal invariants.
