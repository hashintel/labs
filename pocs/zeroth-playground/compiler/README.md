# Compiler

Compiles a Petri net, written in YAML as the Petri net IR, into Python that builds Zeroth reactive modules with `zrth.sugar`. Each module is a `Module` subclass with an `init` and a `next` method, plus a `flow` method under clock rates, and the modules compose into one system. The compiler is synchronous, has no React, and imports only js-yaml and zod.

`index.ts` is the public API: the playground and the examples import nothing else from this folder. [mapping.md](mapping.md) is the design shared by HASH and Zeroth: each mapping, the options considered for it, and the open questions.

## Use

```ts
import { compile } from "./compiler";

const { files, errors, warnings } = compile(irText, { options: { shape: "modular" } });
```

`compile(text, { options, parseCode })` runs the whole pipeline. `options` are the compiler options asked for; the document carries none. `parseCode` reads code strings into code trees (see [The code-parser hook](#the-code-parser-hook)). It returns a `Compilation`:

| Field | Holds |
| --- | --- |
| `ir` | the parsed document, or `null` when the text is not an IR |
| `options` | the options in force: those asked for that apply to the net, the defaults for the rest |
| `irTrace` | line ranges over the IR text, each naming its net item; empty without a document |
| `graph` | the module graph, or `null` when parsing or lowering refuses |
| `files` | the Python files, `net.py` first, each with its trace; empty when refused |
| `errors` | why the text is not an IR, or why the net cannot be lowered, each with its IR line when one is found |
| `warnings` | one `option-not-applicable` per option asked for that does not apply to the net |

## Input and output

The cycle example: one token moving between two places.

```yaml
name: cycle
kind: plain

places:
  A:
  B:

transitions:
  Go:
    inputs:
      A:
    outputs:
      B:
  Back:
    inputs:
      B:
    outputs:
      A:

marking:
  A: 1
```

Under the default options it compiles to one module whose `next` is one step of the net:

```python
from zrth import LIA, Int, Var
from zrth.sugar import Module, ite

INT = Int([1, 1])

A = Var(INT)
B = Var(INT)


class Cycle(Module):
    """Plain Petri net with 2 places and 2 transitions. One next is one step of the net."""

    def init(self):
        return 1, 0

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


net = Cycle(theory=LIA, ctrl=(A, B))
```

With `shape: "modular"` the same net becomes four modules joined by `compose`: `Transition_Go` and `Transition_Back` drive the Bools `fire_Go` and `fire_Back`, and `Place_A` and `Place_B` read them through `X(...)`.

| Term | Meaning |
| --- | --- |
| Petri net IR | the YAML document the compiler reads; `PetriNetIr`, inferred from the schema in `ir/schema.ts` |
| reactive module | a Zeroth component with variables, an `init` and a `next` method |
| lowering | IR to module graph, in `lowerPetriNetIr`; refusals of a net happen here |
| module graph | the compiler's intermediate form: linear (LIA or LRA) or SPN |
| coins | rates tested each step against a uniform draw, over the step length `dt` |
| clocks | rates as exponential clocks in continuous time, in Zeroth's SPN theory |
| shape | monolithic: one module; modular: one module per transition and per place, composed |
| trace, provenance | line ranges of the IR or the Python, each naming the net item it comes from |
| code strings | guards, rates, kernels and dynamics written as code, read through the code-parser hook |
| LIA, LRA | Zeroth's linear integer and linear real arithmetic theories |
| SPN | Zeroth's stochastic Petri net theory: clocks, events and `Nat` counters |
| `ite`, `X` | if-then-else, and the value a variable takes this step |

## One step of the net

Under coin rates, the default, each call of `next` is one step of the net. Every lowering under coins writes this step, and `testing/reference-step.ts` states it as the oracle the tests compare against.

1. **Dynamics first.** Every real attribute of every token in a place with dynamics takes one Euler step of `dt`.
2. **Sweep in record order.** The transitions are tried once each, in the order of the `transitions` record.
3. **Enabling.** A transition fires when:
   - each place of a standard or read arc holds at least the arc's weight, and each place of an inhibitor arc holds fewer;
   - its guard holds;
   - each capped place it adds to has room for the net change (below);
   - for a transition with a rate, its draw passes the coin test (below);
   - under `control: open`, a controllable transition's external choice `go_T` is true;
   - under `conflicts: nondet`, a transition that shares an input place with another has its pick `pick_T` true.
4. **Consumption is immediate.** A firing takes its input tokens at once, so a later transition in the sweep sees what is left. A read arc takes nothing.
5. **Production lands at the end of the step.** A token produced in a step cannot be taken in the same step.
6. **Capped places track their fill.** `fill_P` starts at the place's count, and every firing that moves tokens in the place updates it. A producer fires only if `fill_P` plus its net change stays within the capacity, so it sees the tokens an earlier producer will land.
7. **Coins.** A transition with the constant rate r reads a uniform draw `u_T`, an input of the module, and passes when the draw is at least e^(-r·dt): it fires within the step with the probability that an exponential delay at rate r ends within `dt`. A rate written as code is tested against an exponential draw instead, `rate >= X(e_T)`.

A coloured place is a row of positions, as many as its `capacity` or the `slots` option. Its tokens fill a prefix of the row, so `input.P[k]` is the k-th token. A transition tries the combinations of the tokens its arcs bind in binding order: token indices ascending per arc, the combinations in lexicographic order with the last arc advancing fastest. The first combination whose guard holds fires, and its kernel writes the produced tokens. At the end of the step the surviving tokens close up in position order, and the produced tokens land after them in sweep order. A token that finds no free position sets the place's sticky `overflow_P` flag and is dropped.

The modular shape writes the same step as one module per transition and one per place. A transition module awaits the firing flags of the earlier transitions that take from its input places, or move tokens in a capped place it adds to, so it sees the marking the sweep would show it. `lower/lower.test.ts` runs both shapes, under six option sets, on 150 random plain and stochastic nets with weighted, read and inhibitor arcs, for 25 steps each, and compares every step with the reference step.

Under clock rates (`rates: "clock"`) the net runs in continuous time in Zeroth's SPN theory, and there is no step length. Each transition owns a clock armed with an exponential delay at its rate. The clock runs down against the time reference `t` while the transition's input arcs allow a firing. Time flows until the first clock reaches zero; that transition fires, toggles its event and re-arms its clock, and each place it touches moves one token. Under `conflicts: nondet` a transition in a conflict also needs its pick at the expiry; with the pick false, its clock stays at zero.

## Pipeline

```
IR text
  │ ir/parse.ts: YAML, the schema, the checks across sections
  ▼
PetriNetIr ──► trace/trace-ir.ts ──► IR trace ──► a line for each diagnostic
  │ options.ts: keep the options that apply, warn about the rest
  ▼
lower/lower.ts: refuse, plan the step, lower it ◄── parseCode, through code/
  │
  ▼
ModuleGraph ──► emit/emit.ts ──► Python files, each with its trace
```

| Stage | Where |
| --- | --- |
| Parse YAML, check the schema | `parsePetriNetIr` in `ir/parse.ts`, over the zod schema in `ir/schema.ts`, its checks across sections in `ir/references.ts`, and the key lines from `ir/yaml-keys.ts` |
| Keep and resolve the options | `optionsForNet` in `options.ts` keeps the options that apply, `droppedOptions` warns about the rest with `option-not-applicable`, and `resolveOptions` fills in the defaults |
| Trace the IR | `traceIr(ir, irText, options)` in `trace/trace-ir.ts`, over `yamlKeys`; the words for a place, a transition and an arc, shared with the Python's trace, are in `trace/describe-item.ts` |
| Lower to a module graph | `lowerPetriNetIr(ir, options, parseCode)` in `lower/lower.ts`: the chosen lowering refuses what it cannot express, then the step is planned (`planStep` in `lower/step-plan.ts`) and lowered. Refusals come back as errors; the lowering raises no warnings |
| Emit Python | `emitPython(graph, layout, ir)` in `emit/emit.ts`. The graph's dialect, `emit/linear.ts` (LIA, LRA) or `emit/spn.ts` (clocks), prints the expressions, imports and sort constants as a `PythonProgram`. `pythonFiles` in `emit/python.ts` writes the rest the same way for both: declarations, classes, instances, the composition, and one file or one per module as the layout says. Each line is written with its provenance through `emit/python-writer.ts`, in the words of `emit/describe.ts`, so each file comes with its trace |
| Locate diagnostics | `compile` gives each error and warning the line `firstLineOf` finds in the IR trace (`trace/provenance.ts`) |

## Folders

| Folder | Holds |
| --- | --- |
| `ir/` | the schema and the types inferred from it; the checks across sections (`references.ts`); the names the Python claims and the net's class name (`reserved-names.ts`); the accessors for bare keys; `NetItem`, the item a diagnostic or a traced line names; the parser; and the YAML key scan the parser and the IR trace share |
| `code/` | the parser hook's contract (`code-tree.ts`); `codeStrings`, every code string of a document with its item and surface; and `linear-code.ts`, which reads a code tree as a linear expression, computing constant arithmetic, or throws a `Refusal` |
| `lower/` | `lower.ts`, which picks a lowering, lets it refuse, plans the step and lowers it. Each lowering is a `Lowering` (`lowering.ts`): `monolithic.ts` with its parts in `monolithic/`, `modular.ts`, and `clocks.ts` with its refusals in `clocks/refusals.ts`. `names.ts` coins every identifier the lowerings write, each prefix beside its reading, and reads them back with `describeName` for the traces |
| `graph/` | the module graphs the lowerings build: linear (LIA, LRA) and SPN |
| `emit/` | `python.ts`, the Python both graphs print to; one dialect per graph, `linear.ts` and `spn.ts`; `python-writer.ts`, which writes lines and blocks with their provenance and reads the trace off them; and `describe.ts`, the words for each kind of line |
| `trace/` | the trace over the IR text, the words for an item that both traces use, and the queries over a trace: `provenanceAt`, `matchingLines`, `linesOfItem`, `firstLineOf` |
| `testing/` | test support, never imported by the compiler: fixtures, the fixture code parser, `compileNet` and `yaml` to compile an IR object, a graph interpreter, random nets and the reference step |
| `scripts/` | tooling that runs under Node, never imported by the compiler: the zrth check (`check-zrth.ts`), the option sets it compiles under (`option-variants.ts`), the Python that imports a compiled net (`construct_net.py`), and the hook that lets Node resolve the compiler's imports (`resolve-ts.ts`) |

At the root, `compile.ts` runs the pipeline, `options.ts` holds the options table, and `diagnostics.ts` holds `DIAGNOSTIC_CODES`, the `Refusal` that code and lowering helpers throw, and `within`, which says which code string a refusal comes from.

`compiler/tsconfig.json` sets `rootDir` to this folder, so `tsc -p compiler`, run by `pnpm lint:tsc`, fails on an import that leaves it. It leaves `scripts/` to the root tsconfig, which has Node's types. `boundary.test.ts` checks the rest of the boundary: no package but js-yaml and zod (and vitest in the tests, Node's built-in modules in `scripts/`), no import of `testing/` or `scripts/` from the code the compiler runs, and no file that names the application the compiler was copied from.

## Options

The options are passed beside the IR, never written in it, so the same document compiles differently under different options. `OPTIONS` in `options.ts` is the one table: per option, its values (the default first, or `null` for a positive number), its default, what it decides, the nets it applies to, and `notApplicable(net, options)`, the reason it has no effect on a net. `CompilerOptions` and `ResolvedOptions` are derived from it.

An option asked for that does not apply to the net is dropped with an `option-not-applicable` warning, and the net compiles as if it had not been asked for. Clock rates turn off the options that need a step; `layout` also reads `shape`. Whether a net is stochastic is read off its rates, not its `kind`, and the schema checks that the two agree.

`pnpm test` checks this table against `OPTIONS`, in order.

<!-- prose-check: off -->

| Option | Values, default first | Applies to | Decides |
| --- | --- | --- | --- |
| `shape` | `monolithic`, `modular` | every net under coins | Monolithic: one module holds the whole step. Modular: one module per transition drives a firing flag, one module per place awaits the flags of its transitions, and the modules are composed. |
| `rates` | `coin`, `clock` | a stochastic net without colours or dynamics | Coin: a rate is tested against a uniform draw each step of dt, in a linear theory. Clock: in the SPN theory, each transition owns a clock armed with exp(rate) and an event it toggles when it fires, each place is a Nat counter, and time is continuous. |
| `conflicts` | `sweep`, `nondet` | a net where two transitions share an input place | Sweep: transitions that share an input place fire in record order, and a later one reads the marking the earlier ones left. Nondet: each transition in a conflict also waits for a Bool pick that nothing drives, so a proof ranges over every way the conflict resolves. |
| `marking` | `real`, `int` | a stochastic uncoloured net under coins | Real: every place is a Real and each guard tests its own draw. Int: places are Int, and one LRA module per transition turns its draw into a Bool flag the guard reads. |
| `control` | `closed`, `open` | a net with a controllable transition, under coins | Closed: a controllable transition fires whenever it is enabled. Open: it also waits for a Bool choice from outside, so the module is open to a controller. |
| `dt` | `1`, or any positive number | a net with rates or dynamics, under coins | The step length: a rate is tested over it, and dynamics take one Euler step of it. |
| `slots` | `8`, or any positive number | a coloured net | The slots a coloured place without a capacity gets. A produced token that finds no free slot sets the place's overflow flag. |
| `layout` | `single`, `per-module` | a net under the modular shape or clock rates | Single: one Python file holds the variables, the modules and the system. Per-module: each module class has a file of its own, and net.py declares the variables, imports the modules and composes them. |

<!-- prose-check: on -->

| Function | Gives |
| --- | --- |
| `resolveOptions(options)` | every option: the value given, or the default |
| `optionStates(ir, options)` | each option's value in force, its values, and why it does not apply: the playground panel's rows |
| `optionsForNet(options, ir)` | the options that apply and are off their default: what the panel stores and what `compile` keeps |
| `droppedOptions(options, ir)` | one `option-not-applicable` warning per option asked for that `optionsForNet` drops; internal, called by `compile` |

## Diagnostics

A diagnostic is `{ code, message, item, line? }`. `item` is the net item it concerns, a kind and an IR name. `line` is the 1-based IR line of that item, which `compile` adds from the IR trace. `errors` and `warnings` are the two channels. `Diagnostic.code` is typed by `DIAGNOSTIC_CODES` in `diagnostics.ts`, so a misspelt code fails `pnpm lint:tsc`.

`pnpm test` checks these tables against `DIAGNOSTIC_CODES`, in order and word for word.

<!-- prose-check: off -->

### The text is not an IR

Errors from `parsePetriNetIr`, at parse time. The compilation has no document and no IR trace.

| Code | Meaning |
| --- | --- |
| `yaml-syntax` | The text is not YAML. |
| `schema` | The document does not fit the IR's shape. |
| `unknown-place` | An arc or the marking names a place that is not declared. |
| `unknown-colour` | A place or a dynamics entry names a colour that is not declared. |
| `unknown-dynamics` | A place names dynamics that are not declared. |
| `reserved-name` | An IR name, or the net's class name, is one the generated Python uses. |
| `marking-invalid` | A plain place starts with something other than a whole count, or a coloured one without a token list. |
| `marking-over-capacity` | A place starts with more tokens than its capacity. |
| `kind-mismatch` | The net's kind disagrees with its rates. |

### An option is dropped

The one warning, from `droppedOptions`, on the net.

| Code | Meaning |
| --- | --- |
| `option-not-applicable` | An option asked for does not apply to the net and is ignored. |

### A lowering cannot express the net

Errors on the item a lowering cannot express. `modular-coloured-not-lowered` and the `clocks-*` codes come from a lowering's `refusals`, before the step is planned, so a net refused by them has no code read and none of the code refusals below. The others are raised as the step is planned or lowered.

| Code | Meaning |
| --- | --- |
| `modular-coloured-not-lowered` | The modular shape is not lowered for coloured places or dynamics. |
| `clocks-capacity` | Clock rates cannot test a capacity. |
| `clocks-plain-transition` | Clock rates need a rate on every transition. |
| `clocks-rate-code` | Clock rates need a constant rate. |
| `clocks-rate-not-positive` | Clock rates need a positive rate. |
| `clocks-guard` | Clock rates cannot test a guard. |
| `clocks-kernel` | Clock rates move plain tokens and run no kernel. |
| `clocks-arc-weight` | Clock rates move one token per arc. |
| `code-not-parsed` | A code string could not be read into a tree; no parser was given, or it returned none. |
| `marking-exceeds-slots` | A coloured place starts with more tokens than it has slots. |
| `kernel-missing` | A transition produces coloured tokens without a kernel. |
| `binding-explosion` | A transition has too many token combinations to try. |

### Code outside the linear theories

Errors from reading a code tree, in `code/linear-code.ts` and `lower/monolithic/`, on the transition or place the code belongs to. The message says which code it comes from: "In the guard, ...".

| Code | Meaning |
| --- | --- |
| `nonlinear-product` | Two values the tokens decide are multiplied. |
| `nonlinear-division` | A value is divided by one that is not a non-zero constant. |
| `nonlinear-power` | A value is raised to a power or taken modulo another. |
| `nonlinear-math` | A Math function has no linear form. |
| `math-random` | Math.random cannot run in a module. |
| `non-finite-constant` | Infinity or NaN has no value in the linear theories. |
| `distribution-unsupported` | A draw cannot become an input the harness draws. |
| `sort-mismatch` | A number, boolean or string is used where another sort is needed. |
| `string-as-value` | A string literal is used other than in a comparison with a string attribute. |
| `string-codes-differ` | Two string attributes with different values are compared. |
| `string-code-unknown` | A kernel writes a string the attribute does not take. |
| `token-as-value` | A whole token is used as a value. |
| `unbound-local` | The code reads a name it does not define. |
| `unknown-field` | A field is read from a value that is not a token. |
| `unknown-attribute` | The token's colour has no such attribute. |
| `unknown-length` | A length is read from something other than an input place. |
| `attribute-not-lowerable` | The code reads an attribute the theories cannot hold: a uuid or an open string. |
| `array-in-expression` | An array or a record is used as a value. |
| `kernel-output-shape` | A kernel's result is not a record of token lists keyed by output place. |
| `kernel-output-missing` | A kernel writes nothing into a coloured output place. |
| `kernel-output-count` | A kernel writes a different number of tokens than the arc carries. |
| `kernel-attribute-missing` | A produced token lacks an attribute of its colour. |
| `dynamics-shape` | Dynamics are not a map of the tokens to a record of derivatives. |

<!-- prose-check: on -->

## The code-parser hook

Guards, rates, kernels and dynamics can be written as code in the IR. The compiler does not parse TypeScript: `CompileSettings.parseCode`, a `CodeParser`, reads each code string into a code tree. The contract, in `code/code-tree.ts`:

- **Input.** One code string and its surface: `lambda` for a guard or a rate, `kernel`, or `dynamics`. The string is a bare body of TypeScript ending in `return`, with `input` (or `tokens` for dynamics) ambient and every constant already inlined.
- **Output.** A `CodeFunction` built from 18 node kinds: `numberLit`, `boolLit`, `stringLit`, `constant`, `localRef`, `fieldAccess`, `indexAccess`, `length`, `unary`, `binary`, `cond`, `let`, `mathCall`, `recordLit`, `arrayLit`, `arrayMap`, `distribution` and `distributionMap`. The tree carries no ids, spans or types.
- **Refusal.** `undefined` refuses the item with `code-not-parsed`. A construct outside the 18 kinds is the parser's to refuse, by returning `undefined`.
- **No constants to compute.** `code/linear-code.ts` computes constant `+`, `-`, `*` and `/` itself, so `(1 + 1) * x` is a scaling of `x`.
- **Pure and synchronous.** The playground compiles during render. A parser does not throw; a throw is a bug, not a refusal.

Without a parser, a net with code strings is refused with `code-not-parsed`, one error per code string. `codeStrings(ir)` lists a document's code strings with their item, field and surface: the dynamics first, then each transition's guard, rate and kernel. They are the strings the lowering hands the parser.

`linear-code.ts` translates the linear subset: `+`, `-`, scaling and division by a constant, comparisons, boolean operators, `?:`, `Math.max`, `Math.min` and `Math.abs`, string equality by code, `input.P.length`, and Gaussian and uniform draws as inputs. Anything else is refused with one of the codes above.

## Traces

A trace is a list of line ranges, each with a `Provenance`: `what` the lines are, `why` they are there, the `ir` path they come from, and the `source` net item. Ranges nest, so a line's record is the innermost range holding it. The emitter writes each Python line with its provenance, so the Python trace matches the text by construction.

| Function | Gives |
| --- | --- |
| `provenanceAt(trace, line)` | the record of the innermost range holding the line |
| `matchingLines(trace, provenance)` | the ranges with the same source item, or, where neither has one, whose IR paths share a prefix: what a hover on one side lights on the other |
| `linesOfItem(trace, item)` | the ranges whose source is the item |

## Tests

Tests sit beside the files they test, and every case reads as GIVEN, WHEN, THEN. `testing/` holds what they share:

| File | Holds |
| --- | --- |
| `compile-net.ts` | `compileNet`, `pythonOf` and `yaml`, which compile an IR object through its YAML text |
| `fixture-parser.ts` | a `CodeParser` that looks each code string up in `code-trees.json` instead of parsing it. The trees were captured once from a TypeScript parser; a test with a new code string adds its tree by hand, or builds a tree with `code-builders.ts` |
| `line-containing.ts` | `lineContaining`, the number of the first line of a text that contains a substring, for the trace tests |
| `run-linear-graph.ts`, `reference-step.ts`, `random-net.ts` | the interpreter, the oracle and the seeded nets behind the differential test in `lower/lower.test.ts` |
| `*.fixtures.ts` | nets: small nets, birth-death, fork, and the coloured Bucket, Boiler and Drones; and the expected Python of birth-death and the Bucket |

`readme.test.ts` checks the options and diagnostics tables of this file, and `boundary.test.ts` the folder's imports and names. The examples in `../examples/` are compiled by their own tests.

## Checking the output against zrth

`pnpm check:zrth` checks that the Python constructs under [zrth](https://github.com/zeroth-research/reactive-modules), Zeroth's reactive-modules library. It needs a zrth checkout with its Python package built. Install a Rust toolchain, [uv](https://github.com/astral-sh/uv) and [just](https://just.systems/); the package needs Python 3.12 or 3.13. Then:

```bash
git clone https://github.com/zeroth-research/reactive-modules
cd reactive-modules
git checkout spn     # 5bd3bf9 is the commit checked here
just py-rebuild      # builds the Rust core and the Python package
cd -
ZRTH_PATH=/path/to/reactive-modules pnpm check:zrth
```

For every example it compiles the IR through `index.ts` under the options the example opens with. Then it changes one option at a time to each of its values: `rates`, `shape`, `conflicts`, `marking`, `control` and `layout`. It also tries clock rates with `conflicts: nondet`. A set is kept when the options it changes apply to the net, and two sets that compile alike are tried once (`scripts/option-variants.ts`). Each compiled net is written to a temporary folder and imported by `scripts/construct_net.py`, through `uv run --no-sync python` in the checkout. Importing `net.py` builds every module and the system, so a construction zrth refuses raises there.

It prints one row per example and option set: `constructs`, `raises`, or `refused` with the compiler's codes. The check passes no code parser, so a net with code strings is refused with `code-not-parsed`. Each raise follows, with the error, the generated lines it passed through and the folder that keeps the files. It exits with 1 when anything raises, and with 2 when `ZRTH_PATH` is unset or zrth does not import from it.

It is not one of the gates, since CI has no zrth. Run it after a change to the output, and when zrth's `spn` branch moves. At 5bd3bf9 every example the compiler accepts constructs under every set: 38 construct, 9 are refused. Node runs the compiler's TypeScript through `scripts/resolve-ts.ts`, which resolves its imports written without an extension.

## Extending it

After any change, run `pnpm lint:tsc`, `pnpm test` and `pnpm build`, and `pnpm check:zrth` when the output changes and a zrth checkout is at hand. A change to the output shows in the tests' goldens and in the examples' Python snapshots in `examples/__snapshots__/`: read the diff, update the snapshots with `pnpm test -u`, and list the change in the commit. Then update what quotes the output: the example pages, the stage text in `playground/compiler-view/stages.ts` and the samples in `playground/compiler-view/stage-sample/`.

The TypeScript in this folder is formatted as Prettier formats it at a width of 100 columns. Keep new code to that width, and write a short object literal on one line.

**A compiler option, or a new value for one.**

1. Add the entry, or the value, to `OPTIONS` in `options.ts`, with `choice` or `positiveNumber`: its values, summary, what it applies to and `notApplicable`. Add a fact to `netFacts` if the rule needs one; the lowerings read the same facts as `plan.facts`. `CompilerOptions`, the panel's rows and the warning follow.
2. Read it where it is lowered: `lower/guard-inputs.ts` for the guard terms under coins, `lower/clocks.ts` under clocks. A lowering that cannot express it adds a refusal and a code.
3. Cover it in `options.test.ts` and the lowering's tests, and add it to the option sets of the differential test if it runs in steps.
4. Update the options table here and the matching section of [mapping.md](mapping.md). In the playground, add a label, a hint and value labels in `playground/options/option-labels.ts`; its test fails until they are there.

**A lowering.**

1. Write it in `lower/` as a `Lowering`: `refusals(ir)` lists what it cannot express, by item, and `lower(plan, errors)` builds the graph from the step plan.
2. Pick it in `loweringFor` in `lower/lower.ts`, from the option that asks for it.
3. A module takes its class, its instance and its `source`, the net item its trace names, from a `*ModuleNames` function in `lower/names.ts`.
4. Cover its refusals and its output in tests beside it.

**A coined identifier.** Add one entry to `PREFIXES` in `lower/names.ts`, with its reading, and a coin function that calls `coin` with that prefix. `names.test.ts` fails until every name of the fixture graphs reads back.

**A diagnostic.**

1. Add the code to `DIAGNOSTIC_CODES` in `diagnostics.ts`, with one line of meaning, and a row to the table here.
2. Raise it where it belongs: a malformed document is an issue in `ir/references.ts` with the code in `params.code`; a construct a lowering cannot express goes in that lowering's `refusals`; code outside the linear subset is `refuse(code, message)` in `code/linear-code.ts` or `lower/monolithic/`.
3. `compile` places it at its IR line. Test it beside the file that raises it.

**An emitted construct**, as `zeroFlow` was added to the SPN graph.

1. Add the node and its builder to `graph/spn-graph.ts` (or `graph/linear-graph.ts`).
2. Build it in the lowering.
3. Print it in the dialect's expression printer, `expr` in `emit/spn.ts` or `emit/linear.ts`. The exhaustive `switch` fails `pnpm lint:tsc` until the case exists. The case writes each sugar or zrth name it prints through `named(used, name)`, so the file's imports list it. A new sugar name also goes into the dialect's `SUGAR_NAMES`, which orders the import line.
4. The trace needs nothing: the writer traces each line whatever it holds.


## Known gaps

[mapping.md](mapping.md) tracks these with the other open questions.

- The playground passes no `parseCode`, so the nets with code strings (Boiler, Drones, Bucket) are refused with `code-not-parsed`. A TypeScript parser does not fit the playground's one-file budget.
- Clock rates refuse a capacity (`clocks-capacity`) and an arc weight above one (`clocks-arc-weight`): SPN tests a count against zero only and moves one token at a time. So Queue and the SIR model have no clocked output. Sections (b) and (c) of [mapping.md](mapping.md) hold the questions.
- `pnpm check:zrth` checks that the output constructs, not that it runs. `zrth.simulate` takes no external but `t`, so the clocked output under `conflicts: nondet`, whose picks are externals, cannot run there. No run of the clocked output under `conflicts: sweep` is kept in the repository.
