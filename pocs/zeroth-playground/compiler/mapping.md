# Mapping the Petri net IR to reactive modules

The design shared by HASH and Zeroth: how each part of a net maps to zrth, the options, the open questions and who can settle each. Update a question here when it is settled. Every mapping under coins reproduces one step of the net, as [README.md](README.md#one-step-of-the-net) defines it.

## 1. Scope

The Petri net IR is the YAML document `ir/schema.ts` defines; `lower/lower.ts` turns it into a module graph, and the two emitters, `emit/linear.ts` and `emit/spn.ts`, print Python over `zrth.sugar`: classes with `init`, `next` and `flow` blocks over variables, composed by awaits, over one theory. The target is Zeroth's `spn` branch at 5bd3bf9 (2026-09-28), with the theories LIA, LRA and SPN. `pnpm check:zrth` checks the output against that commit (see (i)).

Each strategy is an option passed beside the IR, not written in it (the `OPTIONS` table in `options.ts`, which also says when each option applies), so the same IR compiles differently under different options. An option that does not apply to the net is dropped with an `option-not-applicable` warning, whose message is the reason the playground's panel shows; the net compiles as if it had not been asked for. So `rates: clock` on a coloured net warns and compiles under coins. Whether a net is stochastic is read off its rates, not its `kind`. The playground keeps only the options that apply to the net and differ from the default.

Two rate strategies recur below. Coins test each rated transition once per step of `dt` against a uniform draw, in LIA or LRA. Clocks arm an exponential clock per transition over continuous time, in SPN.

[README.md](README.md#options) lists the options, their values and the nets each applies to.

## 2. The mappings

### (a) The net

**IR.** `name` (lower_snake from the title), `kind: plain`, `stochastic` or `mixed`, and the sections `colours`, `dynamics`, `places`, `marking` and `transitions`. The IR carries no options. The parser checks that `kind` agrees with the rates: none, one on every transition, or one on some (`kind-mismatch`), and that every place an arc or the marking names is declared (`unknown-place`). The record order of `transitions` is the sweep order: the order in which one step tries the transitions, each firing consuming its inputs at once.

**Theory.** The theory follows the marking sort in (b): LIA for `Int`, LRA for `Real`, both under `marking: int` (an LIA step module, one LRA `Draw_T` per rated transition), SPN under clocks.

| Option | Produces | Status | Chosen by |
| --- | --- | --- | --- |
| Monolithic | one class per net; `next` is one step of the net; `net = Cycle(theory=LIA, ctrl=(A, B))` | shipped | `shape: monolithic` |
| Modular | `Transition_T` drives `fire_T: Bool`, `Place_P` drives `P`; `compose(...)` | shipped; a coloured or dynamic net is refused (`modular-coloured-not-lowered`), before its code is read | `shape: modular` |
| Clocks | `Transition_T` drives `(clk_T, ev_T)`, `Place_P` drives `P`; `next` and `flow`; `compose(..., hide={clk_*})` | shipped | `rates: clock`; `shape` is ignored |
| One module per transition, places written by several | several drivers of one place | rejected: a variable has one driver in Zeroth | not offered |
| A `hide` option | hidden internals under coins | rejected: a hidden variable cannot be coupled again | not offered |

**Awaits.** The linear graph is the LIA or LRA module graph (`graph/linear-graph.ts`); the SPN graph is the clocked one (`graph/spn-graph.ts`). In the linear graph an await is `X(name)`, and the await graph must be a DAG. The monolithic module awaits only its inputs. A modular transition awaits `fire_` of every earlier transition that takes from its input places, and of every earlier mover of a capped place it fills. A place awaits `fire_` of its movers. In the SPN graph the awaits are `fired(ev)` and `d(t)`.

**Files.** `layout: per-module` writes `net.py` (variables, imports, `compose`) plus one file per class, `transition_birth.py` for `Transition_Birth`. Every file opens on its imports: the compiler writes no header naming the net or where it came from. Every module's step method is `next`; there is no option for `update`. At the spn tip `next` and `flow` alias `update` and `delay` for every theory (`_method` in `sugar.py`, `test_next_and_flow_are_aliases_for_update_and_delay`), and `origin/main` accepts `update` only.

The cycle as IR (`examples/cycle/net.pn.yaml`) and as the monolithic step (golden "lowers a plain net to an LIA module with one step of the net per next", `lower/monolithic.test.ts`):

```yaml
transitions:
  Go:
    inputs:
      A:
    outputs:
      B:
```

```python
    def next(self, A, B):
        # sweep in order; a firing consumes its input tokens at once
        fire_Go = A >= 1  # Go: A -> B
        A = ite(fire_Go, A - 1, A)
        fire_Back = B >= 1  # Back: B -> A
        B = ite(fire_Back, B - 1, B)
        # end of step: produced tokens land
        A = ite(fire_Back, A + 1, A)
        B = ite(fire_Go, B + 1, B)
        return A, B
```

The modular composition (`examples/__snapshots__/cycle/net.py`) and the clocked one (`birthDeathPython`, `testing/birth-death.fixtures.ts`):

```python
transition_Go = Transition_Go(theory=LIA, ctrl=(fire_Go,), extl=(A,))
place_A = Place_A(theory=LIA, ctrl=(A,), extl=(fire_Go, fire_Back))
net = compose(transition_Go, transition_Back, place_A, place_B)
```

```python
net = compose(
    transition_Birth,
    transition_Death,
    place_Population,
    hide={clk_Birth, clk_Death},
)
```

Open questions:

- The modular shape for coloured and dynamic nets. (HASH)
- When the spn line merges to `main`, so the `next` the compiler writes stops depending on the branch. (Zeroth)
- Whether SPN and LRA modules compose in one system. (Zeroth)

### (b) Places

**IR.** `places.<Name>: null` or `{ capacity?, colour?, dynamics? }`. `marking.<Name>` is a count for a plain place and a list of token records for a coloured one; an absent entry starts empty.

| Place | Sort | Status | Chosen by |
| --- | --- | --- | --- |
| Plain net | `Int` (LIA) | shipped | default |
| Stochastic, coins | `Real` (LRA) | shipped | `marking: real` |
| Stochastic, coins | `Int`, with `Draw_T` modules in LRA | shipped | `marking: int` |
| Coloured or dynamic | `Real` per attribute per position | shipped; `marking: int` does not apply (`option-not-applicable`) | colour or dynamics |
| Clocks | `Nat` (SPN) | shipped; SPN tests a count against zero only | `rates: clock` |

**Initial marking.** `init` returns one literal per ctrl in ctrl order. The parser refuses a count on a plain place that is not whole or is negative, a count on a coloured place or a token list on a plain one (`marking-invalid`), and a marking over the capacity (`marking-over-capacity`). So a Nat counter under clocks always starts at a whole count.

**Capacity.**

| Shape | Capacity |
| --- | --- |
| Monolithic | `fill_P = P` before the sweep; a producer's guard adds `fill_P + delta <= cap`; every mover updates `fill_P`; the place returns it |
| Modular | the producer rebuilds `fill_P` from `X(fire_)` of the earlier movers |
| Clocks | refused (`clocks-capacity`) |

A complement counter of free room was rejected (an interface variable per capped place, a Nat that may be empty).

**Coloured places.** A coloured place is a row of positions, as many as its `capacity` or the `slots` option. Each position has `P_i_present: Bool` and one variable per attribute: real and integer as `Real`, boolean as `Bool`, a closed string as a `Real` code (`# code: 0 idle, 1 flying`). A `uuid` or an open string gets no variable (`attribute-not-lowerable` where read). Present positions form a dense prefix, so `input.P[k]` is position k. At the end of the step `rank_P_j` and `kept_P` close the survivors up, and produced tokens land after them. An uncapped place with producers gets a sticky `overflow_P`. Rejected: vectors (`Ite` needs a scalar condition) and first-free landing.

A capped place under coins (golden "tests a stochastic transition against an external draw over dt", `lower/monolithic.test.ts`):

```python
        fill_Waiting = Waiting
        # sweep in order; a firing consumes its input tokens at once
        fire_Arrive = (fill_Waiting + 1.0 <= 4.0) & (X(u_Arrive) >= 0.2865047968601901)  # Arrive: nothing -> Waiting
        fill_Waiting = ite(fire_Arrive, fill_Waiting + 1.0, fill_Waiting)
```

Positions and compaction (`bucketPython` in `testing/coloured-nets.fixtures.ts`, `Pool: { colour: "Ball", capacity: 2 }`):

```python
Pool_0_present = Var(BOOL)  # Pool slot 0 holds a token
Pool_0_x = Var(REAL)
```

```python
        rank_Pool_1 = ite(Pool_0_present, expr(1.0, theory=LRA, sort=REAL), 0.0)
        kept_Pool = rank_Pool_1 + ite(Pool_1_present, expr(1.0, theory=LRA, sort=REAL), 0.0)
        next_Pool_0_x = ite(Pool_1_present & (rank_Pool_1 == 0.0), Pool_1_x, Pool_0_x)
        Pool_0_present = kept_Pool >= 1.0
```

Open questions:

- Capacities under SPN: an ordering on `Nat`, or a complement place? (Zeroth)
- Coloured tokens under SPN: a `Real` sort, or an LRA module beside SPN ones? (Zeroth)

### (c) Transitions, enabling

**IR.** `inputs.<Place>: null` or `{ weight?, kind?: read | inhibitor }` in binding order, `guard` as code when the condition reads tokens, and `controllable: true`.

| Arc | Linear, plain place | Linear, coloured place | Clocks |
| --- | --- | --- | --- |
| Standard, weight w | `P >= w`, then `P - w` at once | presence terms per binding, `take_T_P_s` | `P != 0`; w > 1 is refused (`clocks-arc-weight`) |
| Read | `P >= w`, no consumption | presence terms, no `take_` | `P != 0` |
| Inhibitor | `P < w` | `count < w` | `P == 0` |

**Guards.** A code string reaches the compiler as a code tree from the parser hook, and `linear-code.ts` translates the linear subset; [README.md](README.md#the-code-parser-hook) lists both. Bindings try the token combinations in binding order, the last arc advancing fastest: `bind_T_i` per combination, `sel_T_i` for the first match, `fire_T = seen_T`. More than 4096 combinations are refused (`binding-explosion`). Clocks refuse a guard (`clocks-guard`).

**Controllable.** `control: open` adds the input `go_T: Bool` and `& X(go_T)` to the guard. Under clocks the option does not apply (`option-not-applicable`): the sugar has no helper for SPN's `Nondet(s)` and `simulate.py` gives it no semantics.

An open choice (golden "opens a controllable transition to an external choice under control open", `lower/monolithic.test.ts`) and a read arc over a coloured token (golden `boiler`, `lower/monolithic/colour.test.ts`):

```python
        fire_TakeLeft = (Pool >= 2) & X(go_TakeLeft)  # TakeLeft: 2 Pool -> Left
```

```python
        fire_Alarm = Tank_0_present & (Tank_0_level >= 8.0)  # Alarm: read Tank -> Alarms
```

Read and inhibitor arcs under clocks (golden "tests read and inhibitor arcs, applies one exclusive case per mover, and leaves an untouched place alone", `lower/clocks.test.ts`):

```python
        fires_In = (clk_In == 0) & (B != 0) & (C == 0)
```

Open questions:

- Weighted arcs and output weights under SPN: `(n + 1) + 1` (an `Inc` of `Inc`, inferred from `check_nat_ops`, untested), or a count on `Inc` and `Dec`? (Zeroth)
- How an open SPN module is driven. (Zeroth)

### (d) Transitions, firing and stochastic rates

**IR.** `rate` is a number when the code reads no tokens (parameters baked in) and code otherwise. No `rate` means a plain transition. An infinite rate does not fit the schema (`schema`). A rate of zero or less never passes its coin test, whose threshold is then at least 1, and is refused under clocks (`clocks-rate-not-positive`).

| Option | Produces | Status | Chosen by |
| --- | --- | --- | --- |
| Coin, constant rate | input `u_T: Real`; term `X(u_T) >= e^(-rate·dt)`, threshold computed at compile time | shipped | `rates: coin` |
| Coin, `marking: int` | `Draw_T` (LRA) drives `hit_T: Bool`; the LIA guard reads `X(hit_T)` | shipped | `marking: int` |
| Coin, rate reads tokens | input `e_T: Real`, the draw `-ln(u) / dt`; `rate >= X(e_T)` per binding | shipped | rate code |
| Plain transition (predicate or immediate) | fires every step it is enabled | shipped under coins; refused under clocks (`clocks-plain-transition`) | no `rate` |
| Clock | `clk_T = Var(Clock())` armed with `exp(rate)`, `ev_T = Var(Event())` toggled at expiry, flow `-1 * d(t)`, clocks hidden | shipped for a constant positive rate; rate code refused (`clocks-rate-code`); matches `two_place_net()` in `test_spn.py` | `rates: clock` |
| HAVOC coin per transition | a free Bool | not built | not offered |
| Fluid mean-field delay block | an LRA flow | not built; the LRA flow limits in (g) apply | not offered |

Under clocks the compiler's transition keeps the arc terms in `fires_T` and pauses the clock while disabled. Zeroth's `birth_death.py` at 5bd3bf9 lets the clock run, and the place ignores a death on an empty place. For one input place the two agree by memorylessness. They differ for two: with `fires_Move = (clk_Move == 0) & (A != 0) & (B != 0)` (golden), the place-decides rule would let `B` consume while `A` does not, and `C` produce regardless.

A draw module under `marking: int` (golden "keeps Int places under marking int by moving each draw test into an LRA module", `lower/modular.test.ts`):

```python
class Draw_Arrive(Module):
    """Arrive at rate 2.5 fires within a step of dt = 0.5 when its draw is at least e^(-2.5 * 0.5)"""

    def init(self, u_Arrive):
        return False

    def next(self, hit_Arrive, u_Arrive):
        return X(u_Arrive) >= 0.2865047968601901
```

The compiler's `Transition_Death` (`testing/birth-death.fixtures.ts`) beside Zeroth's `Death` (`birth_death.py` at 5bd3bf9):

```python
    def next(self, clk_Death, ev_Death, Population, t):
        fires_Death = (clk_Death == 0) & (Population != 0)
        return ite(fires_Death, exp(1.0), clk_Death), ite(fires_Death, ~ev_Death, None)

    def flow(self, clk_Death, ev_Death, Population, t):
        return ite(clk_Death >= 0, ite(Population != 0, -1 * d(t), 0 * d(t)), None), 0
```

```python
    def next(self, clk, dth, n, t):
        fires = (clk == 0)
        return ite(fires, exp(1.0), clk), ite(fires, ~dth, dth)

    def flow(self, clk, dth, n, t):
        return ite(clk >= 0, -1 * d(t), None), 0
```

Both write the partial if-then as `ite(cond, x, None)` and an event's flow as `0`. The compiler toggles the event with the partial `ite(fires, ~ev, None)`, where the event stutters when the transition does not fire; Zeroth writes the total `ite(fires, ~e, e)`. zrth accepts both.

Open questions:

- Guard in the transition with a paused clock, or place decides, for several input places? (HASH; Zeroth on the intent)
- Marking-dependent rates under SPN, where `Exp` takes a constant. (Zeroth)
- Immediate transitions under SPN: a zero-delay construct with priorities? (Zeroth)

### (e) Conflicts and non-determinism

**IR.** `conflicts` is written when two transitions share an input place, whatever the arc kinds (`conflictingTransitions`); a transition outside every conflict gets no pick.

| Option | Produces | Status | Chosen by |
| --- | --- | --- | --- |
| Sweep | coins: the sweep order (monolithic) or `avail_P` awaits (modular); clocks: the earliest expiry ends the step | shipped; byte-equal to the output without the option | `conflicts: sweep` |
| Nondet | input `pick_T: Bool` per conflicting transition; coins `& X(pick_T)`, clocks `& pick_T` in `fires_T`; picks stay in the interface | shipped | `conflicts: nondet` |
| Free sweep: every enabled transition fires on the latched marking | several firings on one token | rejected: two transitions competing for one token both fire | not offered |

`simulate.py` takes no external but `t` (see (i)), so the clocked nondet output does not run there. Under a driver, a false pick at expiry holds the flow horizon (`hi` in `simulate.py`) at 0. A round that then changes nothing raises `NoFlow` (`stuck at {now}: time cannot pass and the round changes nothing`). Two alternatives: pause the clock in `flow` on the pick, or re-arm it at expiry whatever the pick. `GuardSkipped` names a `next` that would change state before `hi` and not at `hi`. Every `fires_T` the compiler writes needs `clk_T == 0`, which holds only where `clk_T >= 0` stops time, so its output cannot raise it.

Coins (golden "has each transition in a conflict wait for an undriven pick under conflicts nondet", `lower/monolithic.test.ts`) and clocks (`examples/__snapshots__/fork-clocked/net.py`):

```python
        fire_TakeLeft = (Pool >= 2) & X(pick_TakeLeft)  # TakeLeft: 2 Pool -> Left
```

```python
        fires_TakeLeft = (clk_TakeLeft == 0) & (Pool != 0) & pick_TakeLeft
```

```python
        return ite(fired_Return & ~fired_TakeLeft & ~fired_TakeRight, Pool + 1, ite(fired_TakeLeft & ~fired_Return & ~fired_TakeRight & (Pool != 0), Pool - 1, ite(fired_TakeRight & ~fired_Return & ~fired_TakeLeft & (Pool != 0), Pool - 1, Pool)))
```

The interpreter reads an undriven pick as true, so the nondet trace equals the sweep trace. On a plain two-transition fork under coins (`lower/lower.test.ts`, "holds a transition whose pick is false and refuses another input left without a value"), holding `pick_TakeLeft` false for three steps ends at `{ Pool: 0, Left: 0, Right: 3 }`.

Open questions:

- A false pick that holds time, or a pause of the clock? (HASH)
- Ties: two consumers of one place expiring together produce without consuming (`nextCount` in `lower/clocks.ts`); Zeroth's `test_birth_death_over_a_long_run` covers only a producer and a consumer. Under exponential clocks equal remainders have chance zero: `_breakpoint` in `simulate.py` pins only the expiring clock. Intended? (HASH, Zeroth)
- Should a coin step allow ties? Two transitions can both fire in one step, and both apply, where clocks fire one at a time. Where one firing disables another, as through an inhibitor arc, the two differ. (HASH, Zeroth)
- Should read and inhibitor arcs count as conflicts? Today they do, so two readers of one place get picks that hold them without competing. (HASH)
- How picks are driven under SPN. (Zeroth)

### (f) Kernels and outputs

**IR.** `outputs.<Place>: null` or `{ weight? }`. `kernel` is code, required when an output place is coloured.

| Output | Coins, monolithic | Coins, modular | Clocks |
| --- | --- | --- | --- |
| Plain token, weight w | `P = ite(fire_T, P + w, P)` at the end of the step | `P = ite(X(fire_T), P + w, P)` in the place module | `P + 1` per event |
| Coloured token | `out_T_P_i_attr` locals, landed by compaction | refused, as in (a) | refused (`clocks-kernel`) |
| Draw in a kernel or rate | `Distribution.Gaussian(mean, c)` as `mean + c * X(z_T_k)`; `Uniform(a, b)` as `a + (b - a) * X(v_T_k)`; others refused (`distribution-unsupported`) | as monolithic | refused |

A kernel returns a record keyed by output place, each value a list of records, bound tokens or an input place passed through. Anything else is refused with a `kernel-*` code (`kernel-missing`, `kernel-output-shape`, `kernel-output-missing`, `kernel-output-count`, `kernel-attribute-missing`) or `sort-mismatch`.

Example (golden `drones`, `lower/monolithic/colour.test.ts`, kernel `const d = input.Hangar[0]; return { Airborne: [{ battery: d.battery, state: "flying" }] };`):

```python
        out_Launch_Airborne_0_battery = ite(sel_Launch_0, Hangar_0_battery, ite(sel_Launch_1, Hangar_1_battery, Hangar_2_battery))
        out_Launch_Airborne_0_state = 1.0
```

```python
        Airborne_0_battery = ite(fire_Launch & (landed_Airborne == 0.0), out_Launch_Airborne_0_battery, Airborne_0_battery)
```

A Gaussian draw in a rate, `Distribution.Gaussian(input.Hangar[0].battery, 4).map((v) => v + 1)`, lowers to `Hangar_0_battery + 4 * z_0 + 1` (`code/linear-code.test.ts`).

Open questions:

- Kernels under SPN, which has no sort for attributes. (Zeroth)

### (g) Continuous dynamics and time

**IR.** `dynamics.<Name>: { colour, code }` with `return tokens.map((t) => ({ attr: derivative }));`, and `places.<P>.dynamics: Name`.

| Option | Produces | Status | Chosen by |
| --- | --- | --- | --- |
| Euler in `next` | one step per position before the sweep, `P_i_x = ite(P_i_present, P_i_x + dt * f, P_i_x)`, real attributes only | shipped; from `Tank_0_level = 0` the emitted step yields `1.25, 2.34375, 3.30078125` | coins, `dt` |
| LRA `delay` block | a flow `k * d(t)` | rejected: a Real cannot write a tangent, `x * A` raises `NonLinearError`, `eval.py` runs no delay block | not offered |
| Clocks | `t = Var(Clock())` external and driven by nothing; each clock flows `-1 * d(t)` against it; no `dt` | shipped; `rates: clock` does not apply to a net with dynamics (`option-not-applicable`) | `rates: clock` |

Under coins `dt` is the round: the step length, which rates are tested over and dynamics stepped by. Under clocks a step flows until the earliest flow condition fails, then takes one round. `first(gap)` adds a round every `gap` (`test_first_takes_a_round_every_gap_and_at_the_expiry`). `simulate.py` calls `rng.expovariate` once per `Exp` term per round, fired or not, and `uniform(gap)` shares the stream. HASH's own simulator, which is not in this repository, draws from one stream, for enabled transitions only.

The Euler step (golden `boiler`, `lower/monolithic/colour.test.ts`, `dt: 0.25`) and a clock's flow (`birthDeathPython`):

```python
        Tank_0_level = ite(Tank_0_present, Tank_0_level + 0.125 * (10.0 - Tank_0_level), Tank_0_level)  # Tank: one Euler step of dt = 0.25
```

```python
    def flow(self, clk_Birth, ev_Birth, t):
        return ite(clk_Birth >= 0, -1 * d(t), None), 0
```

Open questions:

- Will Zeroth's `Drift` generator land, so an LRA flow can read its own state? (Zeroth)
- Seed and `dt` equivalence between HASH's own simulator and `simulate.py`: one stream per transition, or a lazy driver on HASH's side? (HASH, Zeroth)

### (h) Names, provenance and diagnostics

**IR.** Keys are UpperCamelCase (`PlaceA`, `P3rd`). The parser refuses a reserved name in the document, and a net name whose module class would be one (`reserved-name`). `RESERVED_MODULE_NAMES` in `ir/reserved-names.ts` lists the sugar's names, the theories and sorts, `t`, `d`, `exp`, `fired`, `self` and the capitalised keywords `None`, `True`, `False`; only capitalised entries can collide, the rest are listed for the reader. Every coined identifier carries an underscore or is lowercase (`fire_T`, `clk_T`, `t`), so it cannot collide with an IR name. `lower/names.ts` holds each prefix beside its reading, and `describeName` reads a coined name back by looking its prefix up; a coin function cannot use a prefix without a reading.

**Provenance.** `traceIr` ranges over the YAML, and the emitter writes each line of Python with its own range, so the Python trace cannot disagree with the text; each range has a what, a why and its source, and the texts follow the strategy. A module carries the net item it stands for (`source`), so no class name is read back. The simulator snapshots `module.ctrl`, hidden clocks included (`_snapshot` in `simulate.py`; `test_birth_death_over_a_long_run` runs the system composed with `hide={bclk, dclk}`); `intf` and `prvt` separate them for a reader.

**Diagnostics.** Two channels, `errors` and `warnings`, each `{ code, message, item }`; [README.md](README.md#diagnostics) lists every code. Each lowering's `refusals` reject what it cannot express before the step is planned, so a net they reject gets no refusals from code: the modular shape on a coloured net with code reports `modular-coloured-not-lowered` alone. A refusal raised while the step is planned, such as `marking-exceeds-slots`, can come with `code-not-parsed`.

Example, one document with five faults: `unknown-place@Go` (an output to an undeclared `Dangling`), `reserved-name@Event` (a place named `Event`), `marking-over-capacity@A` (2 tokens, capacity 1), `marking-invalid@B` (a count of 1.5) and `kind-mismatch` on the net (`kind: stochastic` with a transition that has no rate).

### (i) Verification and execution

**IR.** Nothing new; this level runs the emitted modules and checks them against one step of the net (`testing/reference-step.ts`).

| Tool | Runs | Covers | Status |
| --- | --- | --- | --- |
| TypeScript interpreter (`testing/run-linear-graph.ts`) | a linear graph, one `next` per module per round in Kahn order; an undriven pick is true | the differential test: 150 random nets, plain and stochastic, 6 targets, 25 steps against `referenceStep` | shipped; refuses an SPN graph |
| `zrth.eval` | `init` and `update` blocks in LIA, LRA and BV | no delay block, no SPN, no HAVOC | Zeroth |
| `pnpm check:zrth` (`scripts/check-zrth.ts`) | every example's Python imported into a zrth checkout, under its opening options and each option changed alone | every module and the composed system construct | shipped; outside the gates, since CI has no zrth |
| `zrth.simulate` | hybrid SPN modules whose only external is `t` | the compiler's clocks output under `conflicts: sweep`, which constructs since the event flow is `0` | Zeroth; no run of the compiler's output is kept in the repository |
| `zrth.smt.z3` | LIA and LRA terms as Z3 expressions; HAVOC as fresh constants | no SPN, no BV | Zeroth |

```ts
const TARGETS: CompilerOptions[] = [
  {},
  { shape: "modular" },
  { marking: "int" },
  { shape: "modular", marking: "int" },
  { control: "open" },
  { shape: "modular", control: "open", marking: "int", dt: 0.25 },
];
```

The simulator's call is `simulate(module, t=t, horizon=100.0, seed=1)`.

Open questions:

- What Z3 proves per strategy (Int places under `marking: int`, picks under nondet, nothing over SPN), and whether zrth gets an obligation library. (HASH, Zeroth)
- An executor for LIA and LRA modules with picks; `zrth.eval` takes them as state before `execute_update`. (HASH)
- float32 in `zrth.eval` against f64 in HASH's own simulator: feed the Bool outcome instead of the draw? (HASH)
- A run of the compiler's clocks output under `simulate.py`. (HASH)
