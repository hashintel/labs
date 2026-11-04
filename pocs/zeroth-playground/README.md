# Zeroth compiler playground

Compile a Petri net written in YAML into Zeroth Python. Five examples show one step, a shared token, rates as coins, rates as clocks, and a transition with two inputs. The Questions view holds three questions for Zeroth.

## Running

Use Node 24 or later and pnpm.

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173`. A hash selects an example, such as `#birth-death`.

## Presenting

The Examples view shows a short explanation, editable YAML, read-only Python, and the net. Point at a line or node to highlight its matching source and output. Options starts closed and shows only the module shape, coin time step, and conflict choice when they apply. Reset restores the example.

Questions use short explanations and small embedded nets where useful. Their example links open the same net in the playground. `#semantics` opens the first question.

`pnpm build` writes one self-contained `dist/index.html` that opens from `file://`. It includes scripts, styles, fonts, and the editor worker, with package licences in a comment at the top.

## Checks

```bash
pnpm lint:tsc
pnpm test
pnpm build
pnpm screenshot
```

Install screenshot Chromium once with `pnpm exec playwright install chromium`. Screenshots cover all examples and questions at 1440×900.

[AGENTS.md](AGENTS.md) links the compiler, example, question, and app documentation.
