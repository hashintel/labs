# zeroth-playground

This repository compiles a Petri net into Zeroth reactive modules, so that [zrth](https://github.com/zeroth-research/reactive-modules), Zeroth's reactive-modules library, can run and check it. The input is a net written in YAML as the Petri net IR; the output is Python that builds the modules with `zrth.sugar`.

The playground shows the compiler at work on one screen: an example's documentation on the left, its IR in the middle, the Python module on the right and a preview of the net under them. It builds to one HTML file that opens from disk.

## Running

It needs Node 24 or later and pnpm.

```bash
pnpm install
pnpm dev
```

`pnpm build` writes `dist/index.html`, one file with the JavaScript, the CSS, the fonts (Inter and JetBrains Mono) and the editor worker inlined, about 6.6 MB. It opens from `file://` and can be sent as an attachment. A comment at its top names every package and font it bundles, with the licence and the source of each. A URL hash names the example to open: `index.html#birth-death`.

`pnpm test` runs the unit tests, `pnpm lint:tsc` type-checks, and `pnpm screenshot` opens the built file in Playwright's Chromium and screenshots the examples the picker lists, then the Compiler view, at 1440×900 into `screenshots/`. Install that Chromium once with `pnpm exec playwright install chromium`.

## What it does

- **Views.** The IR editor has highlighting, completion of the IR's keys and places, and a hover that reads the IR trace. The module view lists the Python files and the diagnostics, each at the IR line of its item. The preview draws the net as an SVG laid out with elkjs.
- **Options beside the IR.** The Compiler options panel under the IR editor holds the compiler options; the IR carries none. An option that does not apply to the net is greyed, with the reason. Each example opens with its own options, and Reset restores them with the text.
- **Cross-highlighting.** Hovering a line in either editor lights the lines on the other side that name the same net item, and the item in the preview. Hovering a place or a transition in the preview lights its lines on both sides.
- **The example ladder.** The examples climb from plain nets (Steps) to stochastic ones (Rates), each adding one idea and named by it. The picker in the header lists them. Each has a page; most end with open questions, each naming who can settle it: HASH, Zeroth or both. Two pages carry a CSS animation, and *Rates as clocks* has an explorer with a Δt slider, a draw and the coin's rate.
- **The Compiler view.** A switch in the header opens a guide, a graph of the pipeline's stages and a card per stage with a live sample from the open example. `#compiler`, or `#compiler/capacity`, opens it.

The coloured example, Bucket, carries a code string and is refused with `code-not-parsed`: reading the code back needs a parser built on the TypeScript compiler, far past the single-file budget. The picker leaves it out; `#bucket` opens it, with the refusal and the page.

## Working on it

[AGENTS.md](AGENTS.md) is the entry point for people and agents: commands, rules, and links to the READMEs of [compiler/](compiler/README.md), [examples/](examples/README.md) and [playground/](playground/README.md), and to [compiler/mapping.md](compiler/mapping.md), the design shared with Zeroth.
