# AGENTS.md

This repository is the constraint playground, a labs proof of concept for defining constraints on Petri nets. Each example is one net and one constraint. A constraint is LTL over named metrics, written as text or built in a no-code builder, and checked on a simulated run of the net. [constraints/SPEC.md](constraints/SPEC.md) is the spec. The playground builds to one HTML file.

It was forked from the Zeroth playground, a compiler from Petri nets to Zeroth reactive modules. The compiler, the Compiler view and the Semantics view are cut. The Petri net IR, its parser, the net preview, the editor, the example picker and the documentation pages stay.

| Folder | Holds |
| --- | --- |
| `compiler/` | the Petri net IR: schema, parser, accessors. Public API in `index.ts`; imports nothing outside the folder but js-yaml and zod |
| `constraints/` | the constraint library: AST, parser, printer, run simulator, evaluator. Public API in `index.ts` |
| `examples/` | one folder per example (net, constraint, page), and the catalog that collects them |
| `playground/` | the React app: the shell, the Playground view, the constraint panel, the builder, the editor, the net preview, the docs |

## Commands

```bash
pnpm install      # Node 24 or later
pnpm exec playwright install chromium   # once, for pnpm screenshot and the headless checks
pnpm dev          # http://localhost:5173, `#<example-id>` opens an example
pnpm lint:tsc     # type-check, then check compiler/ on its own
pnpm test         # unit tests (vitest)
pnpm build        # dist/index.html, one self-contained file
pnpm screenshot   # the listed examples, into screenshots/
```

## Docs

| File | Read it for |
| --- | --- |
| [constraints/SPEC.md](constraints/SPEC.md) | the grammar, the AST, what a run is, the verdict rules, the questions for the team |
| [compiler/README.md](compiler/README.md) | the IR kept from the compiler |
| [examples/README.md](examples/README.md) | the example ladder, an example's folder, adding an example and its page |
| [playground/README.md](playground/README.md) | the playground's folders, data flow and conventions, the single-file budget, the gates, the tests, checking the UI headlessly |

## Rules

- Keep the build to one HTML file that opens from `file://`. Measure the bundle before adding a dependency.
- Write React as described in [playground/README.md](playground/README.md#conventions): `React.FC` constants with no React type imports, values derived in render, effects only for systems React does not own. `pnpm build` fails on every React Compiler diagnostic.
- Write every test as GIVEN, WHEN, THEN, as [playground/README.md](playground/README.md#tests) describes.
- Run `pnpm lint:tsc`, `pnpm test` and `pnpm build` before each commit. Check visible changes headlessly, as described in [playground/README.md](playground/README.md#checking-the-ui).
- When these docs do not settle a decision, take the simplest option and say so in the commit message.
- Commit messages: an imperative summary of the visible effect, then a body with the choices made.
- A change to the structure or the example workflow updates the matching README in the same commit.

## Asking the team

The team has little time to read open questions, so each one has to earn its place. Before you add a question to the spec, an example page or a message, apply these rules.

1. **Sort it first.** Each question goes into exactly one bucket:
   - **Decide it yourself** when it is easy to reverse: syntax, wording, a builder default, a reading the code can change later. Record it under "Working assumptions" in [constraints/SPEC.md](constraints/SPEC.md), with the date and the alternative. No question.
   - **Defer it** when the build will answer it, or it only matters once something else is in scope. Record it under "Not in scope yet" with its trigger, such as "revisit when MTL is in scope". No question.
   - **Ask the team** only when it is hard to reverse: it changes many verdicts, the file format or the scope.
2. **One question per decision, and one example per question.** A page question asks how the builder should handle the case, and only when the team has not already settled it (check the 2026-10-06 call and the team's constraint definition doc first).
3. **At most 5 questions in the picker's short list** (`examples/pressing.ts`).
4. **Write a proposal, not an open question.** Use "Proposed: X, because Y. Alternative: Z.", so the reader answers yes or no.
5. **Never hide an open question.** In the playground, show every question in the short list. Only other rows may sit behind "show more".
