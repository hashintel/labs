# Edge cases

35 examples: the sandbox and 34 that test the propositional layer and the LTL layer of `constraints/SPEC.md`, one net and one constraint each. Each net is small. Most plain nets have at most one enabled transition at each state, so their run is the same for every seed. Exceptions: `crossing-interleaving`, where the choice does not change the verdict, `stations-all-stocked`, where the verdict is the same and the step depends on the seed, and `order-ship-window`, `queue-always` and `machine-until`, whose verdict depends on the seed. The stochastic ones state the verdict for their fixed seed. The last eleven reach past the base: six in the limits rung (no operator, and cases the base says in a surprising way), two in the nested rung, which nest a temporal operator and need the Nested operators flag, and three in the mtl rung, which use a time window and need the MTL flag.

Constraints are written in the canonical word style, such as `always (Waiting <= 5)` and `A until B`. `press-repair-math` is written in math notation on purpose, and `press-precedence-flat` and `press-not-equals` in function style.

Steps count firings: state `s0` is the initial marking and `sN` follows the Nth firing. "At the end" means the verdict was pending until the run stopped, by deadlock or by `maxSteps` / `maxTime`.

The three `mtl` examples set `mtl: true` in `meta.ts`, and the examples that nest an operator set `nested: true` (`press-repair-math` sets both); the tests parse each example with exactly the flags it declares. Each example has a unique `order` in `meta.ts`, climbing rung by rung. The expected verdicts below are declared in each `meta.ts` as `expect`, and `expected-verdicts.test.ts` checks them against the evaluator.

Each `meta.ts` also declares a `group`, the picker group of its main construct, and a `question`, the short line the picker shows. The 4 examples in `examples/pressing.ts` are the team's short list. 11 more keep their original `**Question:**` line and show only under "Show more".

## Examples

### Questions for the team

Four builder questions, one per example, listed first in the picker. `constraints/SPEC.md`, "Questions for the team", has them in short form.

| Id | Group | Rung | Constraint | Expected | Decided | Question for the team |
| --- | --- | --- | --- | --- | --- || --- |
| `cafe-share-zero-division` | `comparators` | limits | `always (ServedShare >= 0.5)`, `ServedShare: fired(Serve) / (fired(Serve) + fired(TurnAway))` | Violated (the atom is false where the metric errors, decided 2026-10-08) | step 0 | `ServedShare` needs a division, so it is defined as a <Term>metric</Term> first. Should the builder only pick named metrics, or let you write the division inside the rule? |
| `stock-contradiction` | `and-or` | logic | `eventually (count(Stock) > 5 and count(Stock) < 3)` | Violated | end, step 8 (deadlock) | This rule can never be true, and that is clear before any run. Should Petrinaut flag it while you edit, or only after a run? |
| `stations-all-stocked` | `and-or` | logic | `always (count(StationA) >= 1 and count(StationB) >= 1 and count(StationC) >= 1)`, seed 1 | Violated | step 3, seed 1 (the first empty station ends it; the seed picks which) | The rule says the same thing three times, once per station. Should the builder offer one condition over several places, like "all of these ≥ 1", instead of a chain of ANDs? |
| `shelf-restock-fired` | `always-eventually` | temporal | `eventually (fired(Restock) >= 1)` | Satisfied | step 3, run goes on to 10 | `fired(Restock) >= 1` stays true from step 3 to the end. Is "has fired at least once" enough for the builder, or does it need a "just fired" event as a subject? |

### Other questions (under Show more)

Each page keeps its original `**Question:**` line. These rows are not in `examples/pressing.ts`, so the picker shows them only under "Show more".

| Id | Group | Rung | Constraint | Expected | Decided | Question |
| --- | --- | --- | --- | --- | --- || --- |
| `crossing-interleaving` | `if-iff-not` | limits | `always (count(CarsStop) == 1 iff count(Walk) == 1)` | Violated here; Satisfied under step semantics | step 2, every seed | Should a step be one firing, or every enabled transition at once? |
| `approval-eventually-stuck` | `always-eventually` | temporal | `eventually (count(Approved) >= 1)` | Violated | end, step 1 (deadlock) | Should EVENTUALLY be Violated when the run ends in a <Term>deadlock</Term> or is cut by the <Term>horizon</Term> before the goal? |
| `approval-always-stuck` | `always-eventually` | temporal | `always (count(Overdue) == 0)` | Satisfied | end, step 1 (deadlock) | Should an ALWAYS pass on a run that deadlocks at step 1, or only on a full-length run? |
| `dough-eventually-horizon` | `always-eventually` | temporal | `eventually (count(Dough) == 0)` | Violated | end, step 10 (cut) | Should a run cut by the horizon read "not decided" instead of Violated? |
| `press-breakdown-response` | `nested` | nested | `always (count(Down) >= 1 implies eventually (count(Up) >= 1))` | Violated | end, step 9 (cut) | Should a run cut mid-repair read Violated, or "not decided"? |
| `heater-settles` | `nested` | nested | `eventually (always (count(Warm) == 1))` | Satisfied | end, step 5 (deadlock) | Is "warm at the last state" what "settles" means, or does it need a minimum time warm? |
| `queue-start-only` | `always-eventually` | limits | `count(Queue) <= 5` (no operator: `now`) | Satisfied | step 0 | Should a rule with no operator mean "first step only", or be an error? |
| `order-ship-window` | `mtl` | limits | `eventually (fired(Ship) >= 1)` with `maxTime: 30` | Seed-dependent: Satisfied (about 78%) or Violated | step 1, or end at step 0 | Is `maxTime` a useful stand-in, or should time rules wait for <Term>MTL</Term>? |
| `order-ship-within-30` | `mtl` | mtl | `eventually [0, 30] (count(Shipped) >= 2)`, seed 1 | Violated | step 2 | Should the window start at the first state, as here, or at the event that opens it, like an order placed? |
| `oven-hot-window` | `mtl` | mtl | `always [10, 20] (count(Hot) == 1)` with `maxTime: 40`, seed 5 | Satisfied | step 4 | A state that begins before the window counts here. Is that the reading you expect? |
| `parcel-per-token` | `always-eventually` | limits | `always (count(Van) <= fired(Scan))` | Satisfied (intended rule: Violated at step 2) | end, step 2 (deadlock) | Should the language express per-token rules, like one parcel skipping the scanner? |

### Edge cases with no question for the team

These describe a rule and its run. The page has no question line, except the sandbox's prompt and the two `**Try:**` prompts that tell a reader to change the seed.

| Id | Group | Rung | Constraint | Expected | Decided |
| --- | --- | --- | --- | --- | --- |
| `shelf-range` | `comparators` | atoms | `always (count(Shelf) >= 2 and count(Shelf) <= 4)` | Violated | step 3 |
| `queue-always` | `always-eventually` | atoms | `always (Waiting <= 5)`, `Waiting: count(Queue)`, seed 1 | Seed-dependent; seed 1: Violated | step 24, seed 1 |
| `shelf-strict-bound` | `comparators` | atoms | `always (count(Shelf) > 0)` | Violated | step 3 |
| `delivery-equals-skip` | `comparators` | atoms | `eventually (count(Stock) == 5)` | Violated | end, step 10 (cut) |
| `press-not-equals` | `comparators` | atoms | `always(not (count(Down) == 1))` | Violated | step 1, run goes on to 10 |
| `press-precedence-flat` | `and-or` | logic | `always(count(Up) == 1 and fired(Repair) < 3 or count(Spares) >= 1)` | Satisfied | end, step 10 (cut) |
| `press-precedence-bracketed` | `and-or` | logic | `always (count(Up) == 1 and (fired(Repair) < 3 or count(Spares) >= 1))` | Violated | step 1 |
| `oven-vacuous-implies` | `if-iff-not` | logic | `always (count(Burnt) >= 1 implies count(Alarm) >= 1)` | Satisfied | end, step 3 (deadlock) |
| `crossing-iff` | `if-iff-not` | logic | `always (count(CarsStop) == 1 iff count(Walk) == 1)` | Satisfied | end, step 10 (cut) |
| `mixer-if-then-else` | `if-iff-not` | logic | `always (if count(Up) == 1 then count(Queue) <= 2 else count(Queue) <= 4)` | Violated | step 2 |
| `queue-de-morgan` | `if-iff-not` | logic | `always (not (count(Queue) > 4 or count(Staff) == 0))` | Violated | step 5 |
| `queue-tautology` | `and-or` | logic | `always (count(Waiting) >= 2 or count(Waiting) <= 4)` | Satisfied | end, step 6 (deadlock) |
| `machine-until` | `until` | temporal | `count(Stock) > 0 until fired(Restock) >= 1`, seed 1 | Seed-dependent; seed 1: Satisfied | step 2, seed 1 |
| `approval-until-goal-at-start` | `until` | temporal | `count(Draft) >= 1 until count(Approved) >= 1` | Satisfied | step 0 |
| `pump-until-too-late` | `until` | temporal | `count(Up) == 1 until fired(Service) >= 1` | Violated | step 3 |
| `shelf-until-strong` | `until` | temporal | `count(Shelf) >= 1 until fired(Restock) >= 1` | Violated | end, step 3 (deadlock) |
| `shelf-until-weak` | `until` | temporal | `count(Shelf) >= 1 weak until fired(Restock) >= 1` | Satisfied | end, step 3 (deadlock) |
| `press-breakdown-repaired` | `nested` | limits | `always (OpenBreakdowns <= 1)`, `OpenBreakdowns: fired(Break) - fired(Repair)` | Satisfied (intended rule: Violated or undecided) | end, step 9 (cut) |
| `press-repair-math` | `mtl` | mtl | `G (count(Down) = 1 → F[0,5] (count(Up) = 1))` with `maxTime: 100`, seed 2 | Violated | step 6 |

Count per rung (the 34 above): atoms 5, logic 9, temporal 9, limits 6, nested 2, mtl 3. Count per group: comparators 5, and-or 5, if-iff-not 5, always-eventually 7, until 5, nested 3, mtl 4. Questions for the team 4, other questions 11, no question 19.

## Working assumptions

Each was set provisionally on 2026-10-08; the team has not confirmed them. `constraints/SPEC.md`, "Working assumptions (not confirmed by the team)", has the rules. The assumption is shown after each gap. Item 10 is not in scope yet, and item 11 is assumed for time and not in scope for the rest (below).

1. **A metric that errors at a state.** The SPEC says division by zero gives an error diagnostic, not NaN. It does not say what the verdict is at that state: false, skipped, or no verdict for the run. See `cafe-share-zero-division`. Assumed: every atom that reads it is false at that state, with one error diagnostic.
2. **What `maxSteps` counts.** The examples assume it counts firings, so `maxSteps: 10` gives states `s0` to `s10`. If it counts states, every "end, step N (cut)" above moves one step earlier, and `dough-eventually-horizon` needs `maxSteps: 13` to pass. Assumed: `maxSteps` counts firings, so a run has at most `maxSteps + 1` states.
3. **`fired(T)` at the state T fires into.** "Up to this state" is read as including the firing into it, so `fired(Restock)` is 1 at step 3. If it excludes it, every `fired` verdict moves one step later. Assumed: `fired(T)` counts the firing into the state.
4. **`maxTime`.** Is the firing that would land past `maxTime` dropped? Is the last state stamped at its own time or at `maxTime`? Does `maxTime` apply to a plain net, where no time passes? `order-ship-window` assumes the firing is dropped. Assumed: plain firings take no time, `maxTime` applies only to stochastic firings, and a firing that would pass it does not happen (stop reason `max-time`).
5. **Number literals in atoms.** The grammar says `number` without a definition. The examples use `0.5`. Are decimals allowed? Is `-1` a number, or a parse error in an atom (unary minus exists only in the metrics grammar)? Assumed: decimals and negatives are allowed.
6. **Bracket rule for `until` sides.** The prose says brackets are needed when a side has more than one atom. The grammar `state "until" state` does not need them. Is `A or B until C` an error, a warning, or `(A or B) until C`? Does `not A until B` count as one atom? Assumed: `A and B until C` (the word style, still read) is accepted as `(A and B) until C`, with the warning "Bracket the sides of until". The printer brackets such a side: `(A and B) until C`.
7. **Dangling else.** In `if A then if B then C else D`, the grammar gives the `else` to the inner `if`. The SPEC does not say. Also, `if` is not a `primary`, so `A and if B then C` is a parse error unless bracketed. Worth a message. Assumed: the `else` binds to the nearest `if`.
8. **Chained `iff`.** `iff := implies ("iff" implies)?` allows one `iff`. `A iff B iff C` is then an error, but no message is given, unlike the mixed and/or warning. Assumed: `A iff B iff C` is an error, "Bracket a chain of iff".
9. **Deadlock vs cut.** The verdict table treats both ends alike. `approval-always-stuck` passes on a run that stops at step 1. The table gives no way to tell that pass from one on a full 200-step run. An extension of the question where a run ends. Assumed: the stop reason stays distinct (`deadlock` or `max-steps`), and the Run panel shows it.
10. **Margins for `iff` and `if then else`.** The margin formula defines `and`, `or`, `not` and `implies`, not these two, and not a margin at a state where a metric errors. Not in scope until the margin is shown in the UI.
11. **Plain transitions fire first in a mixed net.** A stochastic transition then never fires while any plain one is enabled. Does time pass on a plain firing? Not used here, but it changes every `always` on a mixed net. Assumed: a plain firing takes no time. The rest is not in scope until mixed plain and stochastic nets are in scope.
12. **Atoms cannot compare two references.** `count(Van) <= fired(Scan)` had to become a metric and `<= 0`, and the builder would meet that often, since many rules compare two counts. Assumed (2026-10-08): the right side of an atom may be a metric reference, `count(P)`, `fired(T)` or a named metric. Arithmetic still needs a named metric: `count(A) >= count(B) + 2` is an error. A margin reads the right reference as the bound at that state.
