# AGENTS.md

This repository holds a compiler from Petri nets to Zeroth reactive modules, the examples it is shown on, and a playground for both. The input is a Petri net written in YAML as the Petri net IR. The output is Python that builds the modules with `zrth.sugar`, the Python DSL of Zeroth's reactive-modules library. The playground shows the IR, the Python, a preview of the net and a documentation page per example, and builds to one HTML file.

| Folder | Holds |
| --- | --- |
| `compiler/` | the compiler, with its public API in `index.ts`. It imports nothing outside the folder but js-yaml and zod |
| `examples/` | one folder per example net, and the catalog that collects them |
| `playground/` | the React app, which imports only `compiler/index.ts` and the examples |

The compiler was copied from the HASH monorepo (hashintel/hash), and this copy is the one to change. The target DSL is `python/zrth/sugar.py` in [zeroth-research/reactive-modules](https://github.com/zeroth-research/reactive-modules), on its `spn` branch. That branch names the step method `next`; its `main` branch accepts only `update`.

## Commands

```bash
pnpm install      # Node 24 or later
pnpm exec playwright install chromium   # once, for pnpm screenshot and the headless checks
pnpm dev          # http://localhost:5173, `#<example-id>` opens an example
pnpm lint:tsc     # type-check, then check compiler/ on its own
pnpm test         # unit tests (vitest)
pnpm build        # dist/index.html, one self-contained file
pnpm screenshot   # the listed examples and the Compiler view, into screenshots/
ZRTH_PATH=/path/to/zrth pnpm check:zrth   # import every example's Python into zrth; not a gate
```

## Docs

| File | Read it for |
| --- | --- |
| [compiler/README.md](compiler/README.md) | what the compiler reads and writes, one step of the net, the pipeline, the options and diagnostics, the code-parser hook, extending it |
| [compiler/mapping.md](compiler/mapping.md) | the design shared by HASH and Zeroth: each mapping, its options, the open questions |
| [examples/README.md](examples/README.md) | the example ladder, an example's folder and options, adding an example and its page |
| [playground/README.md](playground/README.md) | the playground's folders, data flow and conventions, the single-file budget, the gates, the tests, checking the UI headlessly |

## Rules

- Settling a question in [compiler/mapping.md](compiler/mapping.md), on either side, updates it there in the same change.
- Keep the build to one HTML file that opens from `file://`. Measure the bundle before adding a dependency.
- Write React as described in [playground/README.md](playground/README.md#conventions): `React.FC` constants with no React type imports, values derived in render, effects only for systems React does not own. `pnpm build` fails on every React Compiler diagnostic.
- Write every test as GIVEN, WHEN, THEN, as [playground/README.md](playground/README.md#tests) describes.
- Run `pnpm lint:tsc`, `pnpm test` and `pnpm build` before each commit. Check visible changes headlessly, as described in [playground/README.md](playground/README.md#checking-the-ui).
- When these docs do not settle a decision, take the simplest option and say so in the commit message.
- Commit messages: an imperative summary of the visible effect, then a body with the choices made.
- A change to the structure, the pipeline or the example workflow updates the matching README in the same commit.
