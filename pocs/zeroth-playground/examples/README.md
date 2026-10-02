# Examples

One folder per Petri net: its IR document, the compiler options it opens with, and a documentation page. The playground's picker lists the examples marked `listed`, and the tests compile every one.

## The ladder

The examples climb a ladder of rungs, from the plainest net up. Each one adds one idea to the ones before it, and is named by that idea, then by the net it uses: "Rates as coins", using Birth–death. `LADDER` in `catalog.ts` lists the rungs:

| Rung | Holds |
| --- | --- |
| `steps` | plain nets: how one step of the net becomes modules |
| `rates` | stochastic nets: coins tested each step, or clocks in continuous time |
| `colours` | coloured tokens; refused in the playground, which has no code parser, and unlisted |

| Order | Example | Net | Opens with | What you learn |
| --- | --- | --- | --- | --- |
| 10 | One step as a module | Cycle | monolithic | A step fires every enabled transition once, in record order: it takes at once and lands at the end. The step is one `next` over an Int per place, or one module per transition and per place, read through `X(...)`. |
| 20 | Who gets the token | Conflict | modular, `conflicts: nondet` | Record order settles a shared input place through `avail_Pool`. Nondet adds a `pick_T` per contender, so every resolution is a run. A transition in no conflict gets no pick. |
| 30 | A capped place | Capacity | modular | `fill_Buffer` lets a later producer count the token an earlier one adds in the same step. Clocks refuse capacities. |
| 40 | Weighted, read and inhibitor arcs | Arcs | modular | A weight w tests `P >= w` and takes w, a read arc tests without taking, an inhibitor arc tests `P < w`. |
| 50 | Rates as coins | Birth–death | modular, `dt: 0.5` | A rate becomes an input draw `u_T` tested against e^(−λ·Δt), computed at compile time. Places become Real in LRA, or stay Int with a `Draw_T` module per transition. |
| 60 | Rates as clocks | Birth–death | `rates: clock` | A rate becomes a clock `clk_T` armed with `exp(rate)` and an event `ev_T`, places become Nat counters, and `compose` hides the clocks. A coin's rate stays below λ. |
| 70 | Two inputs under clocks | Café queue | `rates: clock` | A transition with two input places keeps both tests and pauses its clock while either is empty, where Zeroth's model lets the places decide. |
| 80 | Conflicts under clocks | Conflict with rates | `rates: clock`, `conflicts: nondet` | A conflict becomes a race between clocks. A pick is read at expiry, and a false pick stops time. |
| 90 | Code strings are refused, unlisted | Bucket | monolithic | A rate written as code is refused with `code-not-parsed` until a code parser is passed. |

The picker lists the listed examples rung by rung, sorted by `order`, and skips a rung with none. Put a new example where its idea builds on the ones before it, and only when no example already teaches that idea.

## One folder per example

```
birth-death/
  meta.ts                     what the picker and the page header show, the rung, the order, the options
  net.pn.yaml                 the IR document
  page.mdx                    the documentation page
  components/coin-draws.tsx   a drawing only this page uses (optional)
  components/coin-draws.css   its styles, imported by the component
```

The folder name is the id: the picker's key, the page's key and the URL hash, `#birth-death`. `catalog.ts` collects the folders with `import.meta.glob`, so nothing else registers an example.

`meta.ts` default-exports an `ExampleMeta`, defined in `catalog.ts`:

| Field | Value |
| --- | --- |
| `feature` | what the example tackles: its name in the picker and its page heading |
| `title` | the net's name, shown above the heading |
| `summary` | one line on what it shows, in the picker |
| `rung` | `steps`, `rates` or `colours` |
| `order` | its place up the ladder; examples sort by it, in steps of 10 |
| `listed` | `false` keeps it out of the picker; its hash still opens it |
| `options` | the compiler options it opens with |

## Options

The IR carries no options. An example's options sit in `meta.ts`, as a `CompilerOptions` object, and the playground's options panel edits them from there. Reset restores them.

- An example opens with the options that show its idea, and the page discusses each one. Cycle opens in the default monolithic shape, so the one-class step comes first. The other plain and coin examples open modular, `{ shape: "modular" }`, and the clock examples under `rates: "clock"`. Bucket, which no shape compiles here, opens with none.
- Add another option only where the page discusses it, such as `dt: 0.5` on *Rates as coins*, or `conflicts: "nondet"` on *Who gets the token*.
- Every option an example opens with applies to its net, so the panel shows it and `compile` raises no `option-not-applicable` warning. `examples.test.ts` checks it.

[compiler/README.md](../compiler/README.md#options) lists the options and the nets each applies to.

## Adding an example

1. Check that no example already teaches the idea. Copy a folder from the same rung and rename it to the new id.
2. Edit `meta.ts`. Pick an `order` between the examples it builds on and the ones that build on it.
3. Replace `net.pn.yaml`. Write it in the block format the other examples use, one key per line and code as `|` blocks.
4. Rewrite `page.mdx`. Put a figure it alone uses in its `components/` folder.
5. Add the id to the expected outcomes in `examples.test.ts`.
6. Run `pnpm test` once. If the example compiles, this writes its Python to `__snapshots__/<id>/net.py`; read it.
7. Open `#<id>` in `pnpm dev` or the build, and run `pnpm screenshot`.

## Page structure

````mdx
import { CoinDraws } from "./components/coin-draws";

The problem the example shows, in the first two sentences. Then what the
compiler writes for it, quoting the few Python lines that matter:

```python
return X(u_Birth) >= 0.36787944117144233
```

<Figure caption="What the picture shows, in one or two sentences.">
  <CoinDraws />
</Figure>

### Options

- **Marking** on Int keeps the places Int and ...

### Open questions

<Question id="ties-under-clocks" />
````

- The documentation view writes the net's name and the heading from `meta.ts`; the page starts with its first paragraph.
- The documentation view passes `Figure` and `Question` to every page as MDX components, from `playground/docs/page-components.ts`. A page uses them without importing them, and imports only its own `./components/`. It also renders fenced code through `CodeBlock`, which wraps a long line under a hanging indent, so quote a line of Python in a fenced block when it is longer than about 25 characters: inline code does not wrap.
- Open with the problem, not with the net or the options. Name the IR items and the Python names the reader will see. Say once, on the page that needs it, what a later page builds on. Name another example by its feature, in italics: *Rates as clocks*.
- **Options** lists only the options that change this net's output, never one the panel greys out, and not the shape the example opens with. Leave the section out when the body already covers them.
- Only the first page, Cycle, has a **Hover** section: one bullet on what pointing at a line or a node does.
- An open question lives in [semantics/](../semantics/README.md), one folder per question, and a page only references it: `<Question id="..." />` renders a card with its owner, its status and a way into the Semantics view. An id the register does not hold fails the page render test. Each question sits on the one page where it matters most.
- A refused example says why under `### Refused here`, and what the compiler would write with a code parser.
- Maths is written as `$...$` or `$$...$$` and rendered to SVG at build time. Keep it short.
- A figure helps where a picture explains the mapping. Put the drawing in the example's `components/` folder, and wrap it in `<Figure caption="...">` on the page. `Figure` draws the frame and the caption; the frame's CSS is in `playground/docs/figures/figure.css`.

## Figures

Every React component of an example sits in its `components/` folder, with its CSS beside it, and imports nothing from `playground/`. Its CSS uses the playground's tokens, such as `var(--accent)` or `var(--fs-xs)`, from `playground/theme/tokens.css`. A drawing is small, minimal and correct about the step it shows.

- Text keeps a fixed size whatever the panel's width: the docs panel is about 200 px wide in a 1000 px window and 300 px in a 1440 px one. Lay a drawing out in HTML and CSS, or in an SVG without a `viewBox`, placed in percentages or drawn at the width a `ResizeObserver` measures. Never scale text with a `viewBox`.
- `Figure` is a size container, so a drawing can change its layout with `@container` queries.
- Animate with CSS alone. Under `prefers-reduced-motion: reduce`, stop every animation and show one frame that still makes the point.
- Mark a state in text as well as in colour, such as "fires" or "waits".
- Check a figure headlessly at 1440×900 and 1000×800, at several animation times and with reduced motion, as [playground/README.md](../playground/README.md#checking-the-ui) describes.

## Tests

- `catalog.test.ts` checks that every folder holds a `meta.ts`, a `net.pn.yaml` and a `page.mdx`, and that the examples climb the ladder rung by rung, each at its own `order`.
- `playground/docs/example-pages.test.tsx` renders every page with the components the documentation view passes. MDX is not type-checked, so this test catches a component a page uses but neither imports nor is passed, and a `Question` whose id the register does not hold.
- `examples.test.ts` compiles each example under the options it opens with. It checks the outcome table (compiles, or the codes it is refused with), that no option is dropped, and each Python file against its snapshot in `__snapshots__/<id>/`, one folder per example that compiles. A change that alters the output updates the snapshots with `pnpm test -u` and lists the diff in its commit.
