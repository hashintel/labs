# Constraint playground: spec v0 (2026-10-08)

An interactive playground for defining constraints on Petri nets. Each example is one net and one constraint. The constraint is written in two grammars, kept separate: **metrics** (numbers read off a state of the net) and **constraints** (LTL over those metrics). **v1 scope** follows the 2026-10-06 call: LTL only, no time windows (MTL), no colours, no quantifiers, one temporal operator wrapping the whole expression.

The playground reaches past v1 so the team can try every case that might come up. A constraint outside v1 (a nested operator, a window, no operator at the top) is parsed, run and given a verdict, and flagged with a scope note. Only quantifiers (colours) are refused.

Forked from `pocs/zeroth-playground` (labs#167). Kept: the Petri net IR, its parser, the net preview, the editor, the example picker, the documentation pages. Cut: the compiler to Reactive Modules, the Compiler view, the Semantics view.

## Layers

1. **Metric**: a number read off one state. Defined once, by name, then referenced.
2. **Atom**: `metric comparator value`. The value is a number or a metric reference (`count(P)`, `fired(T)` or a metric name); no arithmetic on either side.
3. **State constraint**: atoms joined with `and`, `or`, `not`, `implies`, `iff`, `if … then … else`, and brackets. It is true or false at one state.
4. **Constraint**: one temporal operator around the state constraint(s): `always (S)`, `eventually (S)`, `A until B`, `A weak until B`. Outside v1: operators nested anywhere, a window on any operator, and no operator at all (`now`).

## Metrics grammar

```
metrics:
  Waiting: count(Queue)
  Served: fired(BeginService)
  Load: count(Queue) + count(InService)
  Ratio: Served / (Served + 1)
```

```
expr    := term (("+" | "-") term)*
term    := factor (("*" | "/") factor)*
factor  := number | "count(" Place ")" | "fired(" Transition ")" | MetricName | "(" expr ")" | "-" factor
```

- `count(P)`: tokens in place `P` at this state.
- `fired(T)`: how many times `T` has fired from the start of the run up to this state.
- A metric may reference earlier metrics. A cycle is an error.
- Division by zero gives an error diagnostic at evaluation, not NaN. Atoms that read the metric are false at that state.
- `count(P)` and `fired(T)` may also appear directly in an atom (`count(Queue) > 3`). Token count is just a metric (team call, 2026-10-06). Either side of an atom may be one of these references (`count(A) >= count(B)`, working assumption). Arithmetic may not appear in an atom, on either side: define a metric for it (`count(A) >= count(B) + 2` is an error). This is the middle ground between "define metrics first" and inline metrics, both raised on the team call.

## Constraint grammar

The canonical form is **word style**: temporal operators and logic are words. The printer always writes it; the examples are written in it. Function style (`always(S)`, `until(A, B)`, `weak_until(A, B)`) and math notation are accepted as aliases and never printed.

```
always (Waiting <= 5)
eventually (count(Done) >= 1)
count(Waiting) > 0 until fired(Serve) >= 1
count(Shelf) >= 1 weak until fired(Restock) >= 1
(count(A) >= 1 and count(B) >= 1) until count(C) >= 1             # a side with several atoms is bracketed
eventually [0, 30] (count(Queue) <= 5)                            # window (MTL, outside v1)
(count(A) >= 1) until [0, 30] (count(B) >= 1)                     # a windowed until brackets both sides
always (count(Down) >= 1 implies eventually (count(Up) >= 1))     # nested (outside v1)
(always (A > 0)) or B > 0                                         # a prefix operator with more after it
count(Queue) <= 5                                                 # no operator: now (outside v1)
Waiting > 0 until _                                               # a hole: no verdict yet
```

**What the printer brackets.**

- A prefix operator (`always`, `eventually`) always brackets its body: `always (A)`. A bracket follows the word, so the operator cannot swallow what comes after.
- A prefix operator that has more formula after it in the same brackets is wrapped whole: `(always (A)) or B`, `(always (A)) and eventually (B)`. The last operand of an `and`, `or`, `implies`, `iff` or `not`, and the `else` branch, may stay bare: `A or always (B)`, `A implies eventually (B)`.
- `always` over an `or` keeps the `or` inside its brackets: `always (A or B)`.
- Infix `until` and `weak until` bind loosest, so they print bare only at the top of a formula or of a bracket group (`always (A until B)`); anywhere else they are wrapped: `A implies (B until C)`.
- A side of `until` is bare when it is one atom, a constant, a hole or a `not` of one; otherwise it is bracketed. With a window both sides are always bracketed.
- `and` and `or` mixed get brackets, as before.

```
formula  := state (untilOp window? state)?          # infix until: an alias, see below
state    := "if" state "then" state ("else" state)?
          | iff
iff      := implies ("iff" implies)?
implies  := or ("implies" implies)?                 # right-associative
or       := and ("or" and)*
and      := unary ("and" unary)*
unary    := "not" unary
          | temporal
          | primary
temporal := ("always" | "eventually") window? "(" formula ")"
          | ("until" | "weak_until") window? "(" formula "," formula ")"
          | ("always" | "eventually") window? formula        # old word style: takes the rest
          | ("G" | "F") window? unary                         # math: binds like not
primary  := atom | "true" | "false" | "_" | "(" formula ")"
window   := "[" number "," number "]"                         # from <= to, from >= 0
atom     := ref comparator (number | ref)
ref      := MetricName | "count(" Place ")" | "fired(" Transition ")"
comparator := "<" | "<=" | ">" | ">=" | "==" | "!="
untilOp  := "until" | "weak" "until" | "weak_until" | "U" | "W"
```

- **The top.** The formula's top node decides the constraint's `op`: `always`, `eventually`, `until` or `weak-until` (with its window, if any). Any other top node, such as an atom or an `and` of two calls, is a `now` constraint: checked at the first state, flagged (working assumption, below). `parse(print(x))` gives `x` back. A `now` whose formula is a single temporal call prints as that call and reads back as that operator, which means the same.
- **Holes.** `_` (or `□`) is an unfilled slot. It parses to `{ kind: "hole" }`, so a half-built builder state round-trips through text. A constraint with a hole gets no verdict.
- Precedence, tightest first: `not` (and `G`, `F`), `and`, `or`, `implies`, `iff`, infix `until`. `if/then/else` takes the rest of the expression in each branch, so the builder brackets its branches. A bracketed temporal call is a primary.
- **Mixed `and`/`or` without brackets** parses by precedence but gives a warning. The printer always adds brackets when `and` and `or` mix.
- **A chain of infix until** (`A until B until C`) is an error: "Bracket a chain of until". A bracketed call has no chains.
- **Quantifiers.** `forall` or `∀` is an error at its column: "for all needs coloured tokens, which the playground does not simulate yet". `exists` or `∃` likewise.
- `if A then B` means `A implies B`. `if A then B else C` means `(A implies B) and (not A implies C)`.

### Aliases (read, never printed)

| Written | Read as |
| --- | --- |
| `always(S)`, `eventually(S)`, `always[0, 30](S)` (function style) | `always (S)` and so on |
| `until(A, B)`, `weak_until(A, B)`, `until[0, 30](A, B)` | `A until B`, `A weak until B`, `A until [0, 30] B` |
| `always S` (no bracket) | `always (S)`; without a bracket, `always` takes everything to its right |
| `A weak_until B` | `A weak until B` |
| `G φ`, `F φ` | `always (φ)`, `eventually (φ)`; G and F bind like `not`: `G a ∧ b` is `(G a) ∧ b` |
| `φ U ψ`, `φ W ψ` | `φ until ψ`, `φ weak until ψ` |
| `G[0,30] φ`, `G_[0,30] φ`, `F_[0,30] φ`, `eventually_[0,2] φ`, `φ U[0,30] ψ` | the operator with that window |
| `∧ &&`, `∨ \|\|`, `¬ !`, `→ ->`, `↔ <->` | `and`, `or`, `not`, `implies`, `iff` |
| `≤ ≥ ≠`, single `=` | `<= >= !=`, `==` |
| `□` | the hole `_` |

- **Infix until binds loosest**, below `iff`, in every syntax: `A and B until C` reads `(A and B) until C`, unlike some LTL tools that bind `U` tighter than `∧`. A side of infix until that joins several atoms without one pair of brackets gives the warning "Bracket the sides of until".
- **Word style and function style meet at a bracket.** `always (A) or B` is read as `always(A) or B`: a `now` constraint, the same as `(always (A)) or B`, which is what the printer writes. It gives the warning "A temporal operator covers only its own brackets. Bracket the whole formula to cover the rest" when a space separates the word from the bracket and a connective follows.
- `G`, `F`, `U` and `W` are metric names where a comparator follows (`G >= 1`).

### Math notation

`printMath` writes the same AST as LTL is written in logic notation: `G`, `F`, `U`, `W`; windows as `F[0,30]`; `∧ ∨ ¬ → ↔`; `≤ ≥ ≠ =`; holes as `□`; metric references as written (`count(Queue)` stays). The operand of `G`, `F` and `¬`, and each side of `U` and `W`, is bracketed unless it is itself a unary operator or a constant. `if c then t else e` prints as its expansion `(c → t) ∧ (¬c → e)` and reads back as that expansion. Every other AST reads back unchanged.

```
always(count(Down) >= 1 implies eventually[0, 5](count(Up) >= 1))
G (count(Down) ≥ 1 → F[0,5] (count(Up) ≥ 1))
```

### Scope notes

`scopeNotes(constraint, states?)` lists what a constraint uses beyond v1, in reading order, each with a `path` from the constraint down (such as `["body", "right"]`):

| Kind | Message |
| --- | --- |
| `now` | Outside v1: no temporal operator at the top, so it is checked at the first state only |
| `nested` | Outside v1: a temporal operator inside another (or "inside a condition", under a `now`) |
| `window` | Outside v1: a time window (MTL) |
| `hole` | Empty slot: fill it to get a verdict |
| `window`, with the run | This run never advances time: a window from 0 covers the rest of the run, and a later window never starts |

Builder words for comparators: `<` is below, `<=` is at most, `>` is above, `>=` is at least, `==` equals, `!=` is not. For the top: `TOP_WORDS` adds "At the start" for `now` to the temporal words.

## AST

`constraints/ast.ts` is the one definition. The parser builds it, the printer prints it, the builder edits it, the evaluator reads it.

## A run

- A run is a finite sequence of states `s0 … sn`. `s0` is the initial marking. Each later state follows one firing.
- **Plain transitions** (no rate) fire first, one per step, chosen at random among the enabled ones (seeded).
- **Stochastic transitions** (numeric rate) race: Gillespie's method, each enabled one at its rate. The state carries the time.
- A rate written as code, a guard, a kernel or a coloured place: the run is refused with a diagnostic (no code parser here).
- The run stops at `maxSteps` firings (default 200, so at most `maxSteps + 1` states), at `maxTime` if set (stochastic firings only; a plain firing takes no time), or when nothing is enabled (deadlock).
- Read arcs test, inhibitor arcs test for fewer than the weight, capacities block a firing that would exceed them.
- Each state stores: step index, time, marking, cumulative firings per transition, and the transition that fired into it.

This is interleaving: one firing per state. The Zeroth compiler playground fires every enabled transition once per step. Which one Zeroth means by "a state" is not settled.

## Verdicts (online, on the run so far)

This table is for v1 constraints. Nested, windowed and `now` constraints follow "Nested operators and windows" below, which agrees with this table on v1.

At each state `k` a constraint is **Satisfied**, **Violated** or **Pending**. Once Satisfied or Violated it never changes.

| Constraint | Satisfied | Violated | Pending | At the end of the run, if still pending |
| --- | --- | --- | --- | --- |
| `always(S)` | never mid-run | first `k` where S is false | S true so far | **Satisfied** |
| `eventually(S)` | first `k` where S is true | never mid-run | S false so far | **Violated** |
| `until(A, B)` | first `k` where B is true (A true at every earlier state) | first `k` where A and B are both false | A true, B false so far | **Violated** (B never came) |
| `weak_until(A, B)` | as `until` | as `until` | as `until` | **Satisfied** (A held throughout) |

- B is checked before A at each state: if B is true at `s0`, `until(A, B)` is satisfied at once, whatever A is.
- The verdict at the end depends on where the run stopped. A run that is cut at 200 steps says nothing about step 201.

## Nested operators and windows (outside v1, provisional)

Not agreed with the team. Provisional until it is. `constraints/evaluate.ts` implements it; `constraints/temporal.test.ts` checks it on hand-computed runs.

### Finite-trace semantics, untimed (LTLf)

A run is states `s0 … sn`. Each formula has a value at every position `i`, read over `si … sn`:

- A state formula reads state `i`.
- `always(φ)` at `i`: φ at every `j` in `i … n`.
- `eventually(φ)` at `i`: φ at some `j` in `i … n`.
- `until(φ, ψ)` at `i`: ψ at some `j` in `i … n`, and φ at every `m` in `i … j-1`.
- `weak_until(φ, ψ)` at `i`: `until(φ, ψ)`, or φ at every `j` in `i … n`.

The constraint's value is its formula's value at `s0`. On a v1 constraint this gives the same verdicts as the tables above. So on a finite run `eventually(always(S))` holds exactly when S holds at the last state.

### Windows (MTL, continuous time, piecewise constant)

- **Time.** State `j` holds over `[t_j, t_{j+1})`. A state that lasts no time (`t_j = t_{j+1}`, a plain firing) is still seen at its instant `t_j`. The last state holds over `[t_n, T]`, where `T`, the end of the run, is `maxTime` when the run stopped on `max-time`, else `t_n`.
- **A state touches** the window `[t_i + a, t_i + b]` when it holds at some instant inside it. Only states `j >= i` count.
- `always[a, b](φ)` at `i`: φ at every state that touches the window.
- `eventually[a, b](φ)` at `i`: φ at some state that touches the window.
- `until[a, b](φ, ψ)` at `i`: ψ at some state `j` that touches the window, φ at every state from `i` to `j - 1`, and φ at `j` too when `j` began before `t_i + a` (φ must hold until the window opens). The state active at `t_i + a` can be the goal, though no firing falls there.
- `weak_until[a, b](φ, ψ)` at `i`: `until[a, b](φ, ψ)`, or φ at every state that touches `[t_i, t_i + b]`.
- A window inside another operator is anchored at the time of the state it is read at.
- **Past the end.** When `t_i + b > T`, part of the window is not in the run. The value at `i` is then **unknown**, unless the part the run shows already decides it (a false under `always`, a true under `eventually` or a met `until`). Unknown spreads by three-valued logic (Kleene): `false and unknown` is false, `true or unknown` is true, `not unknown` is unknown.
- **Top verdict.** True gives Satisfied, false Violated. Unknown takes the end-of-run rule of the top operator: `always` and `weak_until` Satisfied, `eventually` and `until` Violated, `now` no verdict (Pending), with an info diagnostic.
- **A run whose time never moves** (a plain net): every state sits at time 0, so a window from 0 covers the rest of the run, and a window from `a > 0` is past the end. A scope note says so.

### Online verdict

The verdict at step `k` reads the prefix `s0 … sk` three-valued: anything that depends on a state after `k`, or on when the run ends, is unknown. The verdict is decided at the first `k` where the formula's value at `s0` is true or false. This is **sound**: a value fixed on a prefix is the value on every run that extends it, so the verdict never changes and always equals the end-of-run value. It is **not always the earliest** step: it does not reason across atoms, so `eventually(B) or not eventually(B)` waits for the end. When no prefix decides, the end of the run does, by the semantics above, checked offline over the whole run.

Examples: `always(A implies eventually(B))` is never violated mid-run (a B could still come); `always(A implies always(B))` is violated at the first B that fails after an A; `eventually[0, 30](S)` is violated at the first state after time 30.

### `now`

The formula's value at `s0`. A state formula is decided at step 0. A formula with temporal calls (`always(A) and eventually(B)`) is decided by the rule above.

### Holes

A constraint with a hole has no verdict: `incomplete` is true, `verdicts` is empty, the final verdict is Pending, and an info diagnostic says "Fill every slot to get a verdict". A hole is never read as true. The margin is `null`.

### Evaluation API

`evaluate(doc, states, { stopReason })` returns, beside the v1 fields: `incomplete`, `check` (`online` for v1, `monitor` for nested, windowed and `now`, `none` for a hole), `formulaTruth` (the formula's three-valued value at every state, for `monitor`) and `endTime`. Pass the run's stop reason, so the last state of a run stopped at `maxTime` holds until `maxTime`.

## Working assumptions (not confirmed by the team)

Set on 2026-10-08. They settle the gaps listed in `examples/EDGE-CASES.md`, and the questions that are easy to reverse. The team has not confirmed them. Where an item matches the 2026-10-06 call or the team's constraint definition doc (Notion, 2026-10-07), it says so. Each carries its alternative; change one when the build shows it wrong.

- **A right side that is a metric** is read at the same state as the left. `count(A) >= count(B)` compares the two values there; the printers write it back as written.
- **A metric that cannot be computed** (such as 0/0), on either side of an atom, makes every atom that reads it false at that state, even under `not`, and gives one error diagnostic for the run. The run goes on.
- **`maxSteps` counts firings.** A run has at most `maxSteps + 1` states, `s0` to `s_maxSteps`.
- **`fired(T)` at state `k`** counts the firings up to and including the one into state `k`.
- **Plain firings take no time.** `maxTime` applies only to stochastic firings: a firing whose time would pass `maxTime` does not happen, and the run stops with `max-time`.
- **Number literals** in atoms and metrics may be decimals (`0.5`) and negative (`-1`).
- **`A and B until C`** (the word style, still read) without brackets is accepted and read as `(A and B) until C`, with the warning "Bracket the sides of until". The printer writes `(A and B) until C`.
- **Deadlock and cut** stay distinct: the stop reason is `deadlock` or `max-steps`, and the Run panel shows it. The verdict rule at the end is the same for both.
- **Dangling else** binds to the nearest `if`.
- **Chained `iff`** (`A iff B iff C`) is an error: "Bracket a chain of iff".
- **Word style is canonical** for temporal operators and logic; function style and the math notation are read as aliases. A single `=` reads as `==`, and `!` as `not`.
- **No operator at the top** is a `now` constraint, checked at `s0`, flagged outside v1 (`queue-start-only`). Alternative: an error.
- **Nesting and windows** are read, run and flagged outside v1, with the semantics in "Nested operators and windows" (working assumption: v1 is one operator at the top, below).
- **A state that lasts no time** is seen at its instant by a window. The literal half-open reading would hide it, and on a plain net it would hide every state but the last.
- **A window past the end of the run** is unknown; the top operator's end-of-run rule decides. A deadlocked run is treated the same, although its last marking would never change. Open: read a deadlock as lasting forever?
- **`weak_until[a, b](A, B)`** is `until[a, b](A, B)` or A throughout `[0, b]`.
- **IFF stays** (`crossing-iff`). Alternative: two IF rules. Matches the team's constraint definition doc (Notion, 2026-10-07), which lists IFF.
- **`if … then … else` stays** (`mixer-if-then-else`). Alternative: two implications. Matches the team's constraint definition doc (Notion, 2026-10-07), which lists IF/THEN/ELSE.
- **The builder offers no NOT** (`press-not-equals`). Matches the 2026-10-06 call and the team's constraint definition doc (Notion, 2026-10-07), which lists OR, AND, IF, IFF and IF/THEN/ELSE as combinators and has no NOT, so flipped comparators such as `≠` cover it. NOT stays in the text grammar and prints as written. Alternative: a NOT block in the builder.
- **Math notation is an alias** (`G`, `F`, `→`), and word style is canonical (`press-repair-math`). The team's constraint definition doc (Notion, 2026-10-07) writes symbols beside the words (∨ ∧ → ↔ U W), which supports it. Alternative: word style only.
- **The word UNTIL stays** (`pump-until-too-late`). Alternative: "before". Matches the team's constraint definition doc (Notion, 2026-10-07), which uses it.
- **Mixed AND and OR without brackets** reads `(A and B) or C`, with the existing warning (`press-precedence-flat`). Alternative: an error.
- **A metric with no value** makes its atoms false, with one error (`cafe-share-zero-division`). Set above.
- **In v1 the builder's UNTIL means WEAK UNTIL** (`shelf-until-strong`, `shelf-until-weak`). Matches the 2026-10-06 call and the team's constraint definition doc (Notion, 2026-10-07), which says v1 does not need strong until at first. Strong UNTIL comes later. Alternative: UNTIL stays strong, as the playground reads it today. The evaluator and parser are unchanged. **Open follow-up:** the playground's `until` keyword is strong today; the doc's UNTIL is weak. Align the builder's UNTIL with weak until: awaiting the user's go-ahead.
- **v1 is one temporal operator at the top** (`press-breakdown-repaired`). Matches the 2026-10-06 call and the team's constraint definition doc (Notion, 2026-10-07): v1 is one temporal operator over a combination of atoms. "Every X is followed by Y" (nested) waits; revisit when users ask for it. Adding a nested form later is additive. Alternative: one fixed nested form in v1.
- **"Has fired at least once"** (`fired(T) >= 1`) is enough for v1 (`shelf-restock-fired`). Alternative: add "just fired".

## Margins (stretch, provisional)

How far a constraint is from flipping. Not agreed by the team; shown as provisional if built. Not in scope until the margin is shown in the UI (see "Not in scope yet").

- Atom: `c` is the number, or the right-side reference read at that state. `x >= c` and `x > c` give `x - c`; `x <= c` and `x < c` give `c - x`; `x == c` gives `-|x - c|`; `x != c` gives `|x - c|`. Strict comparators at margin 0 are false, so the sign alone does not give the verdict there.
- `and` min, `or` max, `not` negate, `implies` max(-a, b).
- `always` min over states, `eventually` max over states, `until` max over k of min(B(k), min over j<k of A(j)), `weak_until` the larger of `until` and min over all states of A.
- `iff` is both implications, `if/then/else` its two implications.
- Nested operators: the same min and max, from each state to the end of the run. A window takes the min or max over the states it touches that the run shows; `until[a, b]` adds the hold at the goal state when that state began before the window. `now` is the margin at `s0`. A hole has no margin (`null`).

## Example folder

```
examples/<id>/
  meta.ts          ExampleMeta (below)
  net.pn.yaml      the net, in the Petri net IR, uncoloured, rates as numbers or absent
  constraint.yaml  metrics, the constraint, and the run settings
  page.mdx         what it tests, what verdict to expect and why, the question for the team
```

```yaml
# constraint.yaml
name: Queue stays short
metrics:
  Waiting: count(Queue)
constraint: always(Waiting <= 5)
run:
  seed: 1
  maxSteps: 200
  # maxTime: 50
```

```ts
// meta.ts
export default {
  feature: "Always, one atom",          // name in the picker, page heading
  title: "Café queue",                  // the net
  summary: "The queue never passes 5.", // one line
  rung: "atoms",                        // atoms | logic | temporal | limits | mtl
  order: 10,
  listed: true,
  builderFit: "fits",                   // fits | partly | breaks: can the no-code builder express it?
  stresses: ["always", "single atom"],  // tags
} satisfies ExampleMeta;
```

Rungs: `atoms` (one metric, one comparator), `logic` (and, or, not, implies, iff, brackets), `temporal` (each operator), `limits` (what v1 cannot say, or says in a surprising way, and the cases outside v1: nesting, no operator), `mtl` (a time window; the example sets `mtl: true`).

Time windows are MTL, a layer on top of LTL. The parser reads a window only with the `mtl` option (`parseConstraint(text, { mtl: true })`); without it a window is the error "Time windows need MTL. Turn on MTL at the top." at the window's column. The playground's header has the MTL checkbox, and `#<id>?mtl=1` opens with it on.

## Questions for the team

Four builder questions, each on one example page. `examples/pressing.ts` lists them for the picker's short list. "Asking the team" in [AGENTS.md](../AGENTS.md) sets what may go here.

1. **Define a metric first, or write the division in the rule?** `cafe-share-zero-division`
2. **Flag a rule that can never be true while the user edits, or only after a run?** `stock-contradiction`
3. **One condition over several places ("all of these >= 1"), or a chain of ANDs?** `stations-all-stocked`
4. **Is "has fired at least once" enough, or does the builder need a "just fired" event as a subject?** `shelf-restock-fired`

## Not in scope yet

Each waits for its trigger. None is a question for the team.

- **How time windows read**: from which point a window starts, and whether a state that begins before it counts (`order-ship-within-30`, `oven-hot-window`, `order-ship-window`). Trigger: MTL comes into scope.
- **Rules about each token** (`parcel-per-token`): the doc's colour atoms ("all tokens / some token [dimension]"), which the 2026-10-06 call put outside v1, as it did quantifiers. Trigger: colours or quantifiers come into scope.
- **Warnings while you edit** (`delivery-equals-skip`): flagging a value the net can never reach is an editor feature, not language scope. Trigger: the editor gets lint or warnings.
- **Margins**, including margins for `iff` and `if/then/else` (spec ambiguity 10 in `examples/EDGE-CASES.md`). Trigger: the margin is shown in the UI.
- **Plain and stochastic transitions in one net** (the rest of spec ambiguity 11): whether a stochastic transition may wait behind enabled plain ones. Trigger: mixed plain and stochastic nets are in scope.

Nested operators are full LTL, a second layer. The parser reads a temporal operator below the top one, or inside a condition, only with the `nested` option (`parseConstraint(text, { nested: true })`); without it the error is "Nested operators need full LTL. Turn on Nested operators at the top." at the inner operator's column. The two options combine as `{ mtl, nested }` (`ConstraintFlags`). The playground's header has the Nested operators checkbox, and `#<id>?nested=1` opens with it on; `?nested=1&mtl=1` turns both on.
