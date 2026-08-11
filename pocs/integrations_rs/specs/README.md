# Protocol specifications

Status: working TLA+ models. The rationale for modeling at this level — and
for not modeling more — is in
[formal verification](../local/docs/formal-verification.md). These specs check the
*design* under explicit environment axioms; DST checks the implementation;
the credentialed contract suites check that the axioms hold for real
providers. Nothing here is a substitute for the other two.

Run with TLC from the devshell (the `tlaplus` package is in
`nix/devshell/flake.nix`):

```sh
cd specs
nix develop path:../nix/devshell -c tlc -workers auto \
  -config LeaseFencing.cfg LeaseFencing.tla
```

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
| `AdmitChunk`, `ChunkDeadline` | `admit_chunk` / `LeaseChunkPermit`, `src/orchestrator/shard.rs` |
| `Stop` | crash, detected loss, fenced append, shutdown (collapsed; safety-equivalent) |

Environment axioms A1–A4 are documented in the module header, each mapped to
the executable contract (S3 conditional writes, SlateDB fencing, permit
deadlines) or deployment assumption (clock-skew envelope) that discharges it.

### Checked property

`ChunkExclusion`: while any worker's admitted chunk is inside its
send/commit window, no *other* worker holds the lease — the claim in the
`LeaseTiming::new` comment that a fast-clocked competitor cannot overlap an
admitted chunk. Self-reacquisition (crash + restart of the same runner ID,
which takes no grace) is permitted; the module header explains
why that overlap is benign.

Deliberately *not* an invariant: "commits only happen while holding the
lease". A stale owner may commit until the successor opens the writer — the
fence boundary is the storage epoch (A2), not lease replacement — and the
successor recovers the committed prefix. See the note in the module.

### Model strength

Worker clocks **drift**: offsets are redrawn every tick inside the actual
envelope, covering steady clocks, forward steps, and (when the bound
permits) backward steps such as NTP corrections — not just fixed offsets.

Timing values are **not fixed**: Init chooses them from configured ranges,
filtered by the `LeaseTiming::new` chunk-fit inequality (`TimingOK`, the
`ChunkCannotFit` arm). The sweep config checks that the
*validator's inequality* carries the theorem for every configuration it
admits within the ranges, rather than one sampled configuration. The
constructor's `RenewalCannotFit` arm bounds renewal pacing — a liveness
concern; the model lets `Renew` fire at any moment before expiry, which
covers every pacing that arm admits and more.

Chunk windows **overlap**, as they do in the code: the worker's turn loop
is serial, but a turn usually settles before its window's deadline, so a
later admission's window can extend past an earlier one's. `ChunkSlots`
bounds how many live windows the model keeps per worker (2 in the shipped
configs); every live window must independently satisfy `ChunkExclusion`.

Workers are declared symmetric (`SYMMETRY Sym`), which is sound here because
the spec is safety-only; drop it before adding liveness properties.

### Results (2026-08-07, TLC 1.7.4, overlapping-window model)

| Config | Meaning | Result |
|---|---|---|
| `LeaseFencing.cfg` | honest deployment, drifting clocks, fixed timing | **passes** — 7,045,109 distinct states, 25s |
| `LeaseFencingSweep.cfg` | every chunk-fit-validated timing combination in `dur ∈ 4..7, gcd/ccd/margin ∈ {1,2}` | **passes** — 9,089,806 distinct states, 36s |
| `LeaseFencingSkewViolation.cfg` | actual skew 4 vs declared 1 | **violated** — counterexample as before |

The counterexample: w1 (offset 0) acquires at t=0 (expiry 6), admits a chunk
at t=1 (window ends t=3); w2 (offset 4) reads `clk = 7 ≥ expiry + grace = 7`
at real t=3 and replaces the lease while the chunk is still in its window.
This is the expected outcome, and it earns two conclusions: the declared
safety argument needs the skew envelope (a deployment that violates it
loses the chunk-overlap guarantee even though every CAS and fencing check
still works), and the spec is falsifiable by exactly the fault it exists
to exclude.

Model bounds: 2 workers, integer time to 10, ≤ 5 lease writes, ≤ 2 live
chunk windows per worker, `lease_duration=6, skew=1, chunk deadlines 1+1,
margin=1`. The timing theorem's arithmetic does not depend on the
specific values (only on the chunk-fit inequality, enforced as the Init
filter `TimingOK`), but TLC checks only the stated bounds; bump
`MaxTime`/`MaxVer`/`ChunkSlots`/worker count for more confidence at
exponential cost.

### Follow-ups

- **Compose a minimal log/cursor model** to check the end-to-end property
  `ChunkExclusion` only approximates: every acknowledged cursor advance
  survives takeover (the successor's recovered durable prefix contains it),
  and the cursor never regresses. This needs the journal, the fence at
  append (not at admission), and prefix recovery — the next real model.
  The runtime images of its invariants already exist as
  `KRN-A1-ACK-IMPLIES-DURABLE` and `KRN-A4-ACK-SURVIVES-RECOVERY` in the
  property catalog ([property-catalog.md](../local/docs/property-catalog.md)),
  checked by the DST harness on every schedule; the model's invariants and
  those statements must stay the same sentence in two languages.
- Liveness (ownership churn cannot wedge a shard forever; the
  abandoned-acquirer/re-handshake loop terminates) — needs fairness
  conditions and dropping `SYMMETRY`; the current spec is safety-only.
- The admission protocol (ready receipts, depth-one admission pointer CAS,
  run locator) as a second module, per the priority order in
  [formal verification](../local/docs/formal-verification.md).
- **Apalache inductive invariant** to make the timing theorem
  parameter-free: prove `ChunkExclusion` for *all* values satisfying the
  `LeaseTiming::new` inequalities, not just ranges TLC can enumerate.
- A1b (CAS version distinctness) is currently an axiom justified by epoch
  monotonicity + strict renewal extension; modeling read-then-CAS
  non-atomically with content-hash versions would check the ABA argument
  itself instead of assuming its conclusion.
- Feed the skew-violation trace shape back into DST as a biased seed
  scenario (clock-skew fault injection beyond the configured envelope,
  asserting the failure is detected rather than silent).
