---------------------------- MODULE LeaseFencing ----------------------------
(***************************************************************************)
(* Shard lease acquisition, renewal, takeover grace, and the chunk         *)
(* admission window, modeled against:                                      *)
(*                                                                         *)
(*   plan_acquisition   src/orchestrator/lease.rs                          *)
(*   renew / is_current src/orchestrator/lease.rs                          *)
(*   LeaseTiming::new   src/orchestrator/lease.rs                          *)
(*   handshake          src/orchestrator/shard.rs (acquire -> open writer  *)
(*                      -> revalidate -> recover -> revalidate -> enable)  *)
(*   admit_chunk        src/orchestrator/shard.rs                          *)
(*                                                                         *)
(* Timing values are NOT fixed constants: Init chooses them from the       *)
(* configured ranges, filtered by the LeaseTiming::new chunk-fit           *)
(* inequality (the ChunkCannotFit arm). A passing run therefore checks     *)
(* every configuration the validator admits within the ranges, not one     *)
(* sample point. The constructor's second arm, RenewalCannotFit, bounds    *)
(* renewal PACING (interval + timeout + margin < duration) and is a        *)
(* liveness concern; this model lets Renew fire at any moment before       *)
(* expiry, which covers every pacing the arm admits and more.              *)
(*                                                                         *)
(* Environment axioms (each must stay mapped to an executable contract):   *)
(*                                                                         *)
(*   A1  The lease object supports atomic conditional create and           *)
(*       compare-and-swap on a version token. Modeled by making Acquire    *)
(*       and Renew atomic actions over the current lease state; a read     *)
(*       followed by a CAS on the observed version is equivalent because   *)
(*       any interleaved write changes the version and forces Conflict.    *)
(*       Contract: S3 conditional-write suite, record_io CAS tests.        *)
(*                                                                         *)
(*   A1b Version tokens are distinct across writes. For ETag-style tokens  *)
(*       this requires that no two lease writes carry identical bytes,     *)
(*       which the code guarantees structurally: acquisition strictly      *)
(*       increments lease_epoch and renewal strictly extends expires_at    *)
(*       (RenewalDoesNotExtend). The model's monotonic ver counter encodes *)
(*       this consequence rather than re-deriving it; if either structural *)
(*       guarantee is ever weakened, this axiom is the one that breaks     *)
(*       (classic ABA on content-equal ETags).                             *)
(*                                                                         *)
(*   A2  SlateDB writer fencing: opening a writer advances a monotonic     *)
(*       storage epoch and only the holder of the newest epoch can append. *)
(*       Modeled by the writerEpoch / opened variables and the append      *)
(*       guard in CommitChunk. Contract: SlateDB fencing suite.            *)
(*                                                                         *)
(*   A3  Chunk deadlines are enforced: an admitted chunk's Graph send and  *)
(*       cursor commit cannot occur after                                  *)
(*       admit + graph_chunk_deadline + cursor_commit_deadline. Modeled by *)
(*       the WindowDeadline guard on CommitChunk. Code: the                *)
(*       LeaseChunkPermit deadlines minted in admit_chunk (monotonic       *)
(*       clock, so no skew term applies to the deadlines themselves).      *)
(*                                                                         *)
(*   A4  Wall-clock disagreement between any two runners is bounded by     *)
(*       the declared clock_skew. Worker clocks DRIFT: each tick redraws   *)
(*       every offset from 0..ActualSkewBound, so clocks wobble, step      *)
(*       forward, and (when the bound permits) step backward, as long as   *)
(*       pairwise disagreement stays within ActualSkewBound. A deployment  *)
(*       honors the envelope iff ActualSkewBound <= ClockSkew; running     *)
(*       with ActualSkewBound > ClockSkew checks what a violation costs.   *)
(*       Contract: deployment assumption (operations doc), not testable.  *)
(*                                                                         *)
(* The checked property, ChunkExclusion, is the claim in the LeaseTiming   *)
(* comment: a foreign competitor can never hold the lease while another    *)
(* worker's admitted chunk is still inside its send/commit window. The     *)
(* SAME worker reacquiring (crash + restart; no takeover grace applies)    *)
(* is allowed: the new incarnation's handshake fences the old writer (A2)  *)
(* and external sends are convergent, so self-overlap of the send window   *)
(* is benign.                                                              *)
(***************************************************************************)
EXTENDS Integers, FiniteSets, TLC

CONSTANTS
  Workers,               \* symmetric model values, e.g. {w1, w2}
  NoOwner,               \* model value: the unowned lease
  LeaseDurations,        \* range for LeaseTiming.lease_duration
  GraphChunkDeadlines,   \* range for LeaseTiming.graph_chunk_deadline
  CursorCommitDeadlines, \* range for LeaseTiming.cursor_commit_deadline
  SafetyMargins,         \* range for LeaseTiming.safety_margin
  ClockSkew,             \* declared clock_skew == takeover grace
  ActualSkewBound,       \* true pairwise offset bound; = ClockSkew when honest
  MaxTime,               \* model bound on real time
  MaxVer,                \* model bound on lease CAS writes
  ChunkSlots             \* model bound on concurrently live chunk windows

ASSUME ClockSkew >= 0 /\ ActualSkewBound >= 0 /\ ChunkSlots >= 1

Sym == Permutations(Workers)

\* LeaseTiming::new, ChunkCannotFit arm. Only validated configurations are
\* reachable; configurations the constructor rejects are filtered in Init,
\* exactly as the code refuses to build them.
TimingOK(t) ==
  t.dur > t.gcd + t.ccd + t.margin + ClockSkew

VARIABLES
  now,          \* real time, advanced by Tick
  off,          \* per-worker wall-clock offset; redrawn every tick (A4)
  timing,       \* Init-chosen validated LeaseTiming
  lease,        \* the S3 lease object: owner / epoch / expiry / CAS version
  pc,           \* handshake stage per worker
  token,        \* per-worker held acquisition (epoch / expiry / version)
  writerEpoch,  \* SlateDB storage epoch: highest writer ever opened (A2)
  opened,       \* per-worker epoch of its open writer, 0 = none
  chunk         \* per-worker set of admitted chunk windows

vars == <<now, off, timing, lease, pc, token, writerEpoch, opened, chunk>>

Stages == {"idle", "acquired", "opened", "recovered", "running"}

Clk(w) == now + off[w]

ChunkWindow == timing.gcd + timing.ccd + timing.margin + ClockSkew

NoToken == [epoch |-> 0, expiry |-> 0, ver |-> 0]

Init ==
  /\ now = 0
  /\ off \in [Workers -> 0..ActualSkewBound]
  /\ timing \in {t \in [dur: LeaseDurations,
                        gcd: GraphChunkDeadlines,
                        ccd: CursorCommitDeadlines,
                        margin: SafetyMargins] : TimingOK(t)}
  /\ lease = [owner |-> NoOwner, epoch |-> 0, expiry |-> 0, ver |-> 0]
  /\ pc = [w \in Workers |-> "idle"]
  /\ token = [w \in Workers |-> NoToken]
  /\ writerEpoch = 0
  /\ opened = [w \in Workers |-> 0]
  /\ chunk = [w \in Workers |-> {}]

\* A3: a permit's send + cursor-commit budget, in real time (the code
\* mints these from a monotonic clock, so worker offsets do not apply).
WindowDeadline(c) == c.admitAt + timing.gcd + timing.ccd
LiveWindows(w) == {c \in chunk[w] : now <= WindowDeadline(c)}

--------------------------------------------------------------------------
(* Actions *)

\* Real time advances and every wall clock drifts anywhere inside the
\* actual envelope: steady, stepping forward, or (relative to real time)
\* stepping backward, e.g. an NTP correction.
Tick ==
  /\ now < MaxTime
  /\ now' = now + 1
  /\ off' \in [Workers -> 0..ActualSkewBound]
  /\ UNCHANGED <<timing, lease, pc, token, writerEpoch, opened, chunk>>

\* plan_acquisition: absent lease -> create; own lease -> immediate
\* reacquire (self-inflicted stop; no grace); foreign lease -> honor the
\* skew grace: replacement waits until the observed expiry has passed even
\* on a clock running behind by the whole declared envelope.
CanTake(w) ==
  \/ lease.owner = NoOwner
  \/ lease.owner = w
  \/ Clk(w) >= lease.expiry + ClockSkew

Acquire(w) ==
  /\ pc[w] = "idle"
  /\ lease.ver < MaxVer
  /\ CanTake(w)
  /\ LET next == [owner  |-> w,
                  epoch  |-> lease.epoch + 1,
                  expiry |-> Clk(w) + timing.dur,
                  ver    |-> lease.ver + 1]
     IN /\ lease' = next
        /\ token' = [token EXCEPT ![w] =
                       [epoch |-> next.epoch, expiry |-> next.expiry, ver |-> next.ver]]
  /\ pc' = [pc EXCEPT ![w] = "acquired"]
  /\ UNCHANGED <<now, off, timing, writerEpoch, opened, chunk>>

\* Handshake stage 2: opening the SlateDB writer advances the storage epoch
\* and thereby fences every previously opened writer -- including the
\* legitimate owner's, if this acquirer later turns out to be stale.
OpenWriter(w) ==
  /\ pc[w] = "acquired"
  /\ writerEpoch' = writerEpoch + 1
  /\ opened' = [opened EXCEPT ![w] = writerEpoch + 1]
  /\ pc' = [pc EXCEPT ![w] = "opened"]
  /\ UNCHANGED <<now, off, timing, lease, token, chunk>>

\* is_current: exact CAS version, exact value, unexpired on the caller's
\* clock. Version equality subsumes value equality in this model (A1b).
IsCurrent(w) ==
  /\ lease.ver = token[w].ver
  /\ lease.owner = w
  /\ lease.expiry > Clk(w)

\* Handshake stages 3..5: revalidate after open, recover (time may pass),
\* revalidate again, enable.
RevalidateOk(w) ==
  /\ pc[w] \in {"opened", "recovered"}
  /\ IsCurrent(w)
  /\ pc' = [pc EXCEPT ![w] = IF pc[w] = "opened" THEN "recovered" ELSE "running"]
  /\ UNCHANGED <<now, off, timing, lease, token, writerEpoch, opened, chunk>>

RevalidateFail(w) ==
  /\ pc[w] \in {"opened", "recovered"}
  /\ ~IsCurrent(w)
  /\ pc' = [pc EXCEPT ![w] = "idle"]
  /\ token' = [token EXCEPT ![w] = NoToken]
  /\ opened' = [opened EXCEPT ![w] = 0]   \* close; storage epoch stays
  /\ UNCHANGED <<now, off, timing, lease, writerEpoch, chunk>>

\* renew: CAS against the exact held version; extension is strict
\* (RenewalDoesNotExtend). Conflict and expiry are ordinary loss outcomes,
\* covered by Stop below.
Renew(w) ==
  /\ pc[w] = "running"
  /\ lease.ver < MaxVer
  /\ lease.ver = token[w].ver
  /\ Clk(w) < token[w].expiry
  /\ Clk(w) + timing.dur > token[w].expiry
  /\ lease' = [lease EXCEPT !.expiry = Clk(w) + timing.dur, !.ver = lease.ver + 1]
  /\ token' = [token EXCEPT ![w].expiry = Clk(w) + timing.dur, ![w].ver = lease.ver + 1]
  /\ UNCHANGED <<now, off, timing, pc, writerEpoch, opened, chunk>>

\* admit_chunk: remaining time on the worker's own lease view must strictly
\* exceed the chunk window. The worker's turn loop is serial, but a turn
\* usually settles before its window's deadline, so consecutive windows
\* OVERLAP; every live window must independently satisfy ChunkExclusion.
\* ChunkSlots bounds how many the model keeps; windows past their deadline
\* carry no obligation and are dropped at the next admission.
AdmitChunk(w) ==
  /\ pc[w] = "running"
  /\ Cardinality(LiveWindows(w)) < ChunkSlots
  /\ token[w].expiry > Clk(w) + ChunkWindow
  /\ chunk' = [chunk EXCEPT ![w] =
                 LiveWindows(w) \cup {[admitAt |-> now, epoch |-> token[w].epoch]}]
  /\ UNCHANGED <<now, off, timing, lease, pc, token, writerEpoch, opened>>

\* The cursor commit lands only if the permit is unexpired (A3), the permit
\* belongs to this incarnation, and the writer still holds the newest
\* storage epoch (A2). Committing retires that window's obligation.
CommitChunk(w) ==
  /\ pc[w] = "running"
  /\ \E window \in LiveWindows(w) :
       /\ window.epoch = token[w].epoch
       /\ opened[w] = writerEpoch
       /\ chunk' = [chunk EXCEPT ![w] = chunk[w] \ {window}]
  /\ UNCHANGED <<now, off, timing, lease, pc, token, writerEpoch, opened>>

\* Crash, detected ownership loss, fenced append, or voluntary shutdown:
\* the process stops holding anything. The storage epoch survives; the
\* chunk windows it may leave behind persist until their deadlines pass,
\* which is exactly what ChunkExclusion must tolerate.
Stop(w) ==
  /\ pc[w] # "idle"
  /\ pc' = [pc EXCEPT ![w] = "idle"]
  /\ token' = [token EXCEPT ![w] = NoToken]
  /\ opened' = [opened EXCEPT ![w] = 0]
  /\ UNCHANGED <<now, off, timing, lease, writerEpoch, chunk>>

Next ==
  \/ Tick
  \/ \E w \in Workers :
       \/ Acquire(w)
       \/ OpenWriter(w)
       \/ RevalidateOk(w)
       \/ RevalidateFail(w)
       \/ Renew(w)
       \/ AdmitChunk(w)
       \/ CommitChunk(w)
       \/ Stop(w)

Spec == Init /\ [][Next]_vars

--------------------------------------------------------------------------
(* Properties *)

TypeOK ==
  /\ now \in 0..MaxTime
  /\ off \in [Workers -> 0..ActualSkewBound]
  /\ TimingOK(timing)
  /\ pc \in [Workers -> Stages]
  /\ lease.owner \in Workers \cup {NoOwner}
  /\ lease.epoch <= lease.ver
  /\ writerEpoch <= lease.ver
  /\ \A w \in Workers : opened[w] <= writerEpoch
  /\ \A w \in Workers : Cardinality(LiveWindows(w)) <= ChunkSlots

\* The LeaseTiming theorem: while any of a worker's admitted chunks is
\* inside its send/commit window, no OTHER worker can hold the lease.
\* Self-replacement (crash + restart of the same runner id) is allowed; see
\* the header note.
ChunkExclusion ==
  \A w \in Workers : LiveWindows(w) # {} => lease.owner = w

\* NOTE absent on purpose: "commits only happen while holding the lease"
\* is NOT a property of this protocol. A stale owner may commit until the
\* successor OPENS the writer (A2 is the fence boundary, not lease
\* replacement); the successor then recovers the committed prefix. Encoding
\* that as an invariant would be a specification bug.

\* Model bound, not a protocol property.
StateBound == lease.ver <= MaxVer

==============================================================================
