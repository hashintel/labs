------------------------------ MODULE LogCursor ------------------------------
(***************************************************************************)
(* Journal appends, acknowledgement discipline, ambiguity resolution, and  *)
(* prefix recovery under storage-epoch fencing, modeled against:           *)
(*                                                                         *)
(*   append dispositions  crates/durable-kernel/src/shard_log/mod.rs       *)
(*                        (AppendDisposition: DefinitelyNotCommitted,      *)
(*                        CommitUnknown, Fenced)                           *)
(*   recover_inner        crates/durable-kernel/src/shard_log/             *)
(*                        command_loop.rs (full-prefix scan, dedupe by     *)
(*                        event identity)                                  *)
(*   adopt-or-retry       the command loop's ambiguity discipline: a       *)
(*                        CommitUnknown append is resolved only by a       *)
(*                        recovery scan -- adopted (AlreadyDurable) if     *)
(*                        present, retried only once proven absent         *)
(*                                                                         *)
(* This is the log/cursor model that LeaseFencing.tla approximates from    *)
(* the outside: LeaseFencing checks that a competitor cannot hold the      *)
(* lease inside another worker's chunk window; this module checks what the *)
(* journal itself guarantees across takeover, with the fence at APPEND     *)
(* (the storage epoch), not at admission.                                  *)
(*                                                                         *)
(* Environment axioms (each must stay mapped to an executable contract):   *)
(*                                                                         *)
(*   B1  An append the log acknowledged durable is in the journal and      *)
(*       stays there; the journal never truncates. Modeled by Append       *)
(*       actions extending `journal` and no action shortening it.          *)
(*       Contract: SlateDB durable-watermark waits (shard_log/mod.rs),     *)
(*       S3 conditional-write suite, DST SimLog dispositions.              *)
(*                                                                         *)
(*   B2  Storage-epoch fencing at append: opening a writer advances a      *)
(*       monotonic epoch, and only the newest epoch's appends land.        *)
(*       Modeled by CanAppend when FenceAtAppend = TRUE; the falsification *)
(*       config sets it FALSE and TLC finds the stale-writer               *)
(*       counterexample. Contract: SlateDB fencing suite through the       *)
(*       production open path (s3_contract_test).                          *)
(*                                                                         *)
(*   B3  A recovery scan through the newest writer observes the entire     *)
(*       committed prefix. Modeled by Recover reading `journal` whole.     *)
(*       Contract: kernel recovery tests, DST snapshot-bounded recovery.   *)
(*                                                                         *)
(* Invariant statements are the property catalog's sentences               *)
(* (crates/durable-kernel/src/properties.rs); the two texts must remain    *)
(* the same sentence in two languages. The DST harness checks the same     *)
(* claims against the implementation on every schedule.                    *)
(*                                                                         *)
(* DefinitelyNotCommitted is absent as an action: it leaves the journal    *)
(* and the acknowledgement state unchanged (the caller may simply retry),  *)
(* so it is a stutter step here. CommitUnknown, which can leave a write    *)
(* durable but unacknowledged, is modeled in full.                         *)
(***************************************************************************)
EXTENDS Integers, Sequences, FiniteSets, TLC

CONSTANTS
  Writers,        \* symmetric model values, e.g. {w1, w2}
  Events,         \* event identities clients may submit, e.g. {e1, e2}
  MaxAppends,     \* model bound on journal length
  MaxEpochs,      \* model bound on writer opens
  FenceAtAppend   \* TRUE: axiom B2 holds; FALSE: falsification config

ASSUME MaxAppends >= 1 /\ MaxEpochs >= 1 /\ FenceAtAppend \in BOOLEAN

Sym == Permutations(Writers) \cup Permutations(Events)

VARIABLES
  journal,       \* sequence of event identities; every entry is durable (B1)
  storageEpoch,  \* newest storage epoch any writer ever opened
  opened,        \* writer -> its open epoch, 0 = closed
  serving,       \* writer -> recovery finished, command loop running
  folded,        \* writer -> journal prefix folded into its served projection
  acked,         \* event -> "none" / "applied" / "already" (client-visible)
  appliedCount,  \* event -> times acknowledged Applied
  ambiguous,     \* events with an unresolved CommitUnknown append
  provenAbsent   \* ambiguous events a recovery scan proved absent

vars == <<journal, storageEpoch, opened, serving, folded, acked,
          appliedCount, ambiguous, provenAbsent>>

Range(seq) == {seq[i] : i \in 1..Len(seq)}
SeenBy(w) == Range(SubSeq(journal, 1, folded[w]))

\* B2 when honest; any open writer when falsifying.
CanAppend(w) ==
  IF FenceAtAppend
  THEN opened[w] = storageEpoch /\ opened[w] > 0
  ELSE opened[w] > 0

Init ==
  /\ journal = <<>>
  /\ storageEpoch = 0
  /\ opened = [w \in Writers |-> 0]
  /\ serving = [w \in Writers |-> FALSE]
  /\ folded = [w \in Writers |-> 0]
  /\ acked = [e \in Events |-> "none"]
  /\ appliedCount = [e \in Events |-> 0]
  /\ ambiguous = {}
  /\ provenAbsent = {}

--------------------------------------------------------------------------
(* Actions *)

\* Opening a writer advances the storage epoch, fencing every earlier
\* writer at its next append (B2). Recovery has not run yet.
OpenWriter(w) ==
  /\ storageEpoch < MaxEpochs
  /\ storageEpoch' = storageEpoch + 1
  /\ opened' = [opened EXCEPT ![w] = storageEpoch + 1]
  /\ serving' = [serving EXCEPT ![w] = FALSE]
  /\ folded' = [folded EXCEPT ![w] = 0]
  /\ UNCHANGED <<journal, acked, appliedCount, ambiguous, provenAbsent>>

\* recover_inner: scan the whole committed prefix (B3), then resolve every
\* pending ambiguity by inspection -- present means adopt (the caller is
\* acknowledged AlreadyDurable), absent means the retry is now proven safe.
\* KRN-S1 is the adopt branch; KRN-S2's proof obligation is the
\* provenAbsent transfer.
Recover(w) ==
  /\ opened[w] = storageEpoch /\ opened[w] > 0
  /\ ~serving[w]
  /\ folded' = [folded EXCEPT ![w] = Len(journal)]
  /\ serving' = [serving EXCEPT ![w] = TRUE]
  /\ acked' = [e \in Events |->
                 IF e \in ambiguous /\ e \in Range(journal) /\ acked[e] = "none"
                 THEN "already"
                 ELSE acked[e]]
  /\ provenAbsent' = provenAbsent \cup {e \in ambiguous : e \notin Range(journal)}
  /\ ambiguous' = {}
  /\ UNCHANGED <<journal, storageEpoch, opened, appliedCount>>

\* A fresh append that commits and is acknowledged Applied after the
\* durable-watermark wait. The dedupe guard is the writer's own view
\* (its folded prefix), which under B2 is the whole journal; the acked
\* guard is the client's, who resubmits only while unacknowledged
\* (a byte-identical resubmission of an acknowledged event is absorbed
\* without an append -- KRN-S5 -- which is a stutter here).
AppendApplied(w, e) ==
  /\ serving[w] /\ CanAppend(w)
  /\ Len(journal) < MaxAppends
  /\ acked[e] = "none"
  /\ e \notin ambiguous /\ e \notin provenAbsent
  /\ e \notin SeenBy(w)
  /\ journal' = Append(journal, e)
  /\ folded' = [folded EXCEPT ![w] =
                  IF folded[w] = Len(journal) THEN Len(journal) + 1 ELSE folded[w]]
  /\ acked' = [acked EXCEPT ![e] = "applied"]
  /\ appliedCount' = [appliedCount EXCEPT ![e] = @ + 1]
  /\ UNCHANGED <<storageEpoch, opened, serving, ambiguous, provenAbsent>>

\* CommitUnknown: the append may be durable (the watermark wait timed out
\* after the write landed) or lost (it never committed). No caller is
\* acknowledged. Ambiguity is shard-fatal: the writer is torn down, and
\* only a fresh open (epoch bump, fencing any in-flight write -- B2) and
\* its recovery scan settle the question. KRN-S4 is the durable branch.
AppendAmbiguous(w, e) ==
  /\ serving[w] /\ CanAppend(w)
  /\ Len(journal) < MaxAppends
  /\ acked[e] = "none"
  /\ e \notin ambiguous /\ e \notin provenAbsent
  /\ e \notin SeenBy(w)
  /\ \/ journal' = Append(journal, e)   \* durable, unacknowledged
     \/ journal' = journal              \* lost, commit unknown
  /\ ambiguous' = ambiguous \cup {e}
  /\ serving' = [serving EXCEPT ![w] = FALSE]
  /\ opened' = [opened EXCEPT ![w] = 0]
  /\ folded' = [folded EXCEPT ![w] = 0]
  /\ UNCHANGED <<storageEpoch, acked, appliedCount, provenAbsent>>

\* The proven-safe retry goes through the same append machinery, so it can
\* be ambiguous again itself; the discipline loops through another
\* open-and-scan.
RetryAmbiguous(w, e) ==
  /\ serving[w] /\ CanAppend(w)
  /\ Len(journal) < MaxAppends
  /\ e \in provenAbsent
  /\ \/ journal' = Append(journal, e)
     \/ journal' = journal
  /\ ambiguous' = ambiguous \cup {e}
  /\ provenAbsent' = provenAbsent \ {e}
  /\ serving' = [serving EXCEPT ![w] = FALSE]
  /\ opened' = [opened EXCEPT ![w] = 0]
  /\ folded' = [folded EXCEPT ![w] = 0]
  /\ UNCHANGED <<storageEpoch, acked, appliedCount>>

\* The retry a recovery scan proved safe: the event was absent, so this
\* append is the identity's first commit and is acknowledged Applied
\* (KRN-S2).
RetryProvenAbsent(w, e) ==
  /\ serving[w] /\ CanAppend(w)
  /\ Len(journal) < MaxAppends
  /\ e \in provenAbsent
  /\ journal' = Append(journal, e)
  /\ folded' = [folded EXCEPT ![w] =
                  IF folded[w] = Len(journal) THEN Len(journal) + 1 ELSE folded[w]]
  /\ acked' = [acked EXCEPT ![e] = "applied"]
  /\ appliedCount' = [appliedCount EXCEPT ![e] = @ + 1]
  /\ provenAbsent' = provenAbsent \ {e}
  /\ UNCHANGED <<storageEpoch, opened, serving, ambiguous>>

\* Crash, fenced-append discovery (KRN-S3: the loop stops instead of
\* resolving), or voluntary shutdown, collapsed: safety-equivalent. The
\* storage epoch survives; the journal survives.
Stop(w) ==
  /\ opened[w] > 0
  /\ opened' = [opened EXCEPT ![w] = 0]
  /\ serving' = [serving EXCEPT ![w] = FALSE]
  /\ folded' = [folded EXCEPT ![w] = 0]
  /\ UNCHANGED <<journal, storageEpoch, acked, appliedCount, ambiguous, provenAbsent>>

Next ==
  \E w \in Writers :
    \/ OpenWriter(w)
    \/ Recover(w)
    \/ Stop(w)
    \/ \E e \in Events :
         \/ AppendApplied(w, e)
         \/ AppendAmbiguous(w, e)
         \/ RetryProvenAbsent(w, e)
         \/ RetryAmbiguous(w, e)

Spec == Init /\ [][Next]_vars

--------------------------------------------------------------------------
(* Properties *)

TypeOK ==
  /\ journal \in Seq(Events) /\ Len(journal) <= MaxAppends
  /\ storageEpoch \in 0..MaxEpochs
  /\ opened \in [Writers -> 0..MaxEpochs]
  /\ serving \in [Writers -> BOOLEAN]
  /\ folded \in [Writers -> 0..MaxAppends]
  /\ acked \in [Events -> {"none", "applied", "already"}]
  /\ appliedCount \in [Events -> 0..MaxAppends]
  /\ ambiguous \subseteq Events
  /\ provenAbsent \subseteq Events
  /\ \A w \in Writers : opened[w] <= storageEpoch
  /\ \A w \in Writers : folded[w] <= Len(journal)

\* KRN-A1: every event acknowledged Applied is in the durable prefix.
AckImpliesDurable ==
  \A e \in Events : acked[e] = "applied" => e \in Range(journal)

\* The adopt acknowledgement makes the same claim for AlreadyDurable.
AdoptionImpliesDurable ==
  \A e \in Events : acked[e] = "already" => e \in Range(journal)

\* KRN-A4: recovery never loses or changes an acknowledged event. The
\* serving newest writer's recovered-and-extended prefix contains every
\* acknowledged event; a takeover cannot drop one.
AckSurvivesRecovery ==
  \A w \in Writers :
    (serving[w] /\ opened[w] = storageEpoch) =>
      \A e \in Events : acked[e] # "none" => e \in SeenBy(w)

\* KRN-A3's image at this abstraction: the served projection equals an
\* independent fold of the durable prefix -- here, the newest serving
\* writer has folded the whole journal. (The catalog sentence's dedupe
\* clause is not exercisable in this model: under B2 the journal never
\* holds a duplicate identity, so dedupe stays DST-covered.)
ServedProjectionCurrent ==
  \A w \in Writers :
    (serving[w] /\ opened[w] = storageEpoch) => folded[w] = Len(journal)

\* KRN-A5: one event identity is acknowledged Applied at most once.
AppliedAtMostOnce ==
  \A e \in Events : appliedCount[e] <= 1

\* KRN-A2: the durable end watermark never regresses.
DurableEndNeverRegresses ==
  [][Len(journal') >= Len(journal)]_vars

\* A consequence rather than a catalog property: with the fence at append
\* and the proven-absence discipline, no duplicate identity ever reaches
\* the journal. The implementation tolerates duplicates anyway (dedupe at
\* fold, KRN-A3); this shows the discipline does not produce them.
NoDuplicateIdentity ==
  \A i, j \in 1..Len(journal) : i # j => journal[i] # journal[j]

==============================================================================
