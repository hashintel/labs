# Playground

The React app of the constraint playground: the net IR editor, a preview of the net, the constraint panel (builder, `constraint.yaml` editor, Run with a timeline) and a documentation page per example. `pnpm build` writes it to one HTML file, `dist/index.html`, that opens from `file://`.

## Folders

One concept per file, kebab-case names, a file's private helpers in a folder of the same name, tests beside the file they test.

The source sits in four folders at the root. `vite.config.ts` sets Vite's root to `playground/`, which imports the other three; the build still writes `dist/index.html` at the root. The playground imports `compiler/index.ts` for the IR, `constraints/index.ts` for the constraint library, and the examples through `examples/catalog.ts` and their pages.

| Folder | Holds |
| --- | --- |
| `app/` | the shell: `App`, the URL route, the open document, the header with the example picker |
| `playground-view/` | the Playground view: its grid of documentation, IR editor, net preview and constraint panel |
| `constraint-panel/` | the Constraint panel: the builder slot, the `constraint.yaml` editor with its read-only Math line, the Run panel and its timeline, `analysis.ts` (parse, check, run, evaluate), `constraint-text.ts` (a builder edit written into the YAML) |
| `constraint-builder/` | the no-code `ConstraintBuilder`, its edits, the item menu (negate, flip, wrap, remove) and the time window field |
| `ui/` | the primitives the views share: `Panel`, `Switch`, `useFolds`, the resize target, the arrow-key step of a list |
| `editor/` | Monaco setup and theme, the `petri-net-ir` and `constraint-yaml` languages, the IR completions, line decorations and diagnostic markers, the React wrapper |
| `preview/` | the net graph, its elkjs layout, the SVG |
| `docs/` | the documentation view, the page registry, and the components it passes to every page: `Figure` and `CodeBlock` |
| `pointer/` | the hover dwell |
| `theme/` | the tokens, the base and prose layers, fonts, the wordmark |
| `scripts/` | the screenshot script |

`index.html` and `main.tsx` sit at the top of the folder.

## Data flow

```
App state: Document { exampleId, irText, constraintText }, seed override, lastValid
        │ analyse(irText, constraintText, seed)
        ▼
Analysis { ir, irDiagnostics, doc, constraintDiagnostics, run: RunView | null }
        ├─► IR editor and net preview
        ├─► constraint.yaml editor (diagnostics as markers)
        └─► Run panel (seed, verdict, stop reason, timeline)

Builder onChange(constraint) ─► printConstraint ─► withConstraintLine ─► constraintText
Text edit ─► parseConstraintDocument ─► lastValid ─► builder value
```

- `App` in `app/app.tsx` holds the document and analyses it during render. `app/router.ts` keeps the route in step with the URL hash, `app/route.ts` reads a hash as a route and writes a route as a hash, and `app/document.ts` holds the document's pure transitions.
- `#<example-id>` opens an example. The Constraint builder's head has a "Blank rule" action: it keeps the net and the metrics and replaces the constraint with `always (_)`, a hole (`withBlankRule` in `app/document.ts`). `?nested=1` and `?mtl=1` turn the Nested operators and MTL flags on, and opening an example that needs a flag turns it on. The flags go to `parseConstraintDocument(text, { mtl, nested })`, `analyse` and the builder. A hash naming another example rebuilds the document from the catalog; edits do not write the hash. Reset returns to the example as it opened and drops the seed.
- The builder shows the constraint of the last text that parsed, so it holds steady while the text is mid-edit; a small "text has errors" note says so. Under the file, the Math section shows `printMath` of that constraint, editable, with the read-only metric lines right under it. Each editor is as tall as its text, up to a cap, and the builder, Code and Run panes size to their content.
- An empty slot is a `hole` node, drawn as a dashed "choose a condition" chip. A constraint with a hole has no verdict: the Run panel says "Incomplete: fill every slot" in place of the badge and the timeline.
- The builder reaches every construct of the AST: the top operator (`now`, always, eventually, until, weak until) with an optional window, and in any list a condition, a group of two, an IF … THEN, an IFF and a nested temporal operator. It uses the team's keywords (ALWAYS, EVENTUALLY, UNTIL, WEAK UNTIL, AND, OR, IF, THEN, ELSE, IFF, NOT), comparator symbols (≤ ≥ = ≠) and code names (`count(Queue)`, `fired(Serve)`). What goes beyond the base (one operator at the top, named in the header) shows the library's `scopeNotes` beside what caused it. A builder edit replaces the `constraint:` entry of the text; the rest of the file stays.
- The run needs a net that parses and a constraint without errors. Otherwise the Run panel says so.
- The seed input holds the file's `run.seed` until it is changed. Re-run draws a new random seed. A run is deterministic for a seed.
- The playground passes no code parser, so a net with code strings is refused by the run.

## Layout

- The Playground view is a `react-resizable-panels` grid: the documentation as a full-height first column; the net IR editor over the net preview; the Constraint panel as a full-height third column. Dragging a gridline resizes a row or a column. A hovered or dragged gridline shows a blue overlay with a deep-blue line.
- The Constraint panel is a vertical group: the builder, the `constraint.yaml` editor, the Run.
- Every view is the same `Panel`. The documentation and the preview collapse from the chevron in their head.
- The example picker is a popover anchored to its button. It holds a search field, an "Examples with pending questions (N)" toggle and the examples grouped by `group` in `GROUPS` order; a row is the rule in the builder's words over the question it answers. Search and grouping are pure functions in `app/example-list.ts`. Arrow keys walk from the field down the rows. An unlisted example appears while it is open.
- `NetPreview` is the one component that takes a `PetriNetIr`, the boundary a canvas can replace.
- The timeline draws one SVG strip per row: a cell per state for an atom (true green, false red) and for the verdict (satisfied green, violated red, pending amber), a line for a metric. The pointer over the strips reads one state: step, time, fired transition and each row's value.

## Conventions

- Components are `export const Name: React.FC<Props> = (...) => ...`, and a component private to its file is the same `const` without `export`. Name the props type unless it is one short field, such as `{ text: string }`. Hooks and helpers are `function` declarations.
- React types need no import: write `React.FC`, `React.ReactNode`, `React.KeyboardEvent`. TypeScript reads `React` from the namespace `@types/react` declares, in type positions only. Keep `allowUmdGlobalAccess` off, so a React value used without an import stays an error. Import hooks and other values from `react` as usual.
- The React Compiler memoizes, through `@vitejs/plugin-react`'s `compiler` option with `oxc-transform-react`. Derive values in render and do not add `useMemo` or `useCallback`.
- Every React Compiler diagnostic fails `pnpm build`, the dev server's module and the tests that import it: a ref read in render, `setState` in render, an effect that only derives state, a construct the compiler cannot memoize. `vite.config.ts` sets `panicThreshold: "all_errors"` and the stricter checks. Restructure the component rather than opting out. `"use no memo"` still compiles the function, and a diagnostic inside it is only logged.
- Effects only synchronize systems React does not own. Today that is Monaco, in `editor/monaco-editor.tsx`.
- State is plain data with pure transition functions beside it, tested without the DOM. `app/document.ts`, `constraint-panel/constraint-text.ts` and `pointer/pointer-motion.ts` are examples.
- Comments say what the code does and why. Prose follows the house style: plain words, short sentences, no em dashes.

## Styles

Styles are plain CSS. A component imports its own file, placed beside it, and nests its rules with native CSS nesting. The views that lay out resizable groups import `ui/resizable.css`, which holds the classes those groups share.

| File | Holds |
| --- | --- |
| `theme/tokens.css` | the cascade layers, and the tokens: colours, type sizes, spacing, radii, shadows, durations |
| `theme/base.css` | the reset and the page, one focus ring, a button reset with no specificity, `.caps` for mono capitals, `.note` |
| `theme/prose.css` | `.docs`, the reading column of the pages and the guide, and `.prose`, the typography the stage card shares with them |

- `main.tsx` imports the three before anything else, because `tokens.css` names the layers before any rule uses one.
- The layers, lowest first, are `base`, `prose` and `vendor`. A plugin in `vite.config.ts` puts Monaco's own CSS in `vendor`. A component's rules sit in no layer, so they win over all three without a longer selector.
- Use a token where the value is one. A value only one rule uses stays a literal in that rule. `editor/swiss-theme.ts` repeats the colours as hex, because Monaco's theme API takes literals.
- `!important` only overrides a style Monaco writes inline. Monaco's list also writes rules at run time, outside any layer, and those win over Monaco's layered ones. `editor/monaco-editor.css` restores the one that showed.
- Reduced motion zeroes the duration tokens. A figure that runs its own keyframes shows a still frame instead.
- Use current CSS where it removes code: anchor positioning, `@starting-style`, `:has`, the Popover API.

## Bundle

`pnpm build` inlines everything into `dist/index.html`: scripts, CSS, fonts and the Monaco editor worker. MDX maths is rendered to SVG at build time. Monaco and elkjs are most of the file. Measure the file before adding a dependency.

A code parser for the IR's code strings would need the TypeScript compiler, which does not fit this budget. That is why nets with code strings are refused here.

`package.json` overrides two transitive packages, each scoped to the parent that pins it:

- `speech-rule-engine>@xmldom/xmldom` is lifted to 0.9.12, which fixes the advisories against 0.9.10. The chain is `rehype-mathjax`, then `mathjax-full` 3, then `speech-rule-engine` 4, which pins `@xmldom/xmldom` at exactly 0.9.10, and it runs only at build time. Drop the override once `rehype-mathjax` moves to MathJax 4 (remarkjs/remark-math#118 and #119), whose `speech-rule-engine` allows the fixed version.
- `monaco-editor>dompurify` is lifted to 3.4.16, which fixes the advisory against 3.4.15. Monaco 0.57 pins `dompurify` at exactly 3.4.15 for its hover widget. Drop the override once a Monaco release depends on 3.4.16 or later.

## Gates

Run all three before each commit:

```bash
pnpm lint:tsc
pnpm test
pnpm build
```

`pnpm lint:tsc` type-checks the project, then `compiler/` on its own, which fails on an import that leaves the folder. `pnpm build` also fails on any React Compiler diagnostic, as [Conventions](#conventions) says.

## Tests

- Tests sit beside their files as `*.test.ts`, and vitest runs the ones under `compiler/`, `constraints/`, `examples/` and `playground/`. The examples' tests are described in [examples/README.md](../examples/README.md#tests).
- Every test, in every folder, reads as GIVEN, WHEN, THEN: a `// GIVEN` comment on the setup, `// WHEN` on the action, `// THEN` on the expectations. A test with no action goes from GIVEN to THEN. One THEN line sums up a group of `expect` calls. The test's name says the behaviour, such as "drops the texts on a new compilation and keeps the toggle".
- The playground's pure cores have their own tests: the route and the document, the constraint text edit, the timeline model, the IR completions, the net graph, pointer motion.
- `docs/example-pages.test.tsx` renders every example page with the components the documentation view passes, and `docs/code-block.test.tsx` checks that a fenced block renders one row per line.
- A test changed to make it pass is a changed contract. Say why in the commit message.

## Checking the UI

Check visible changes in a headless browser against the build:

1. `pnpm build`.
2. Write a throwaway Playwright script as `playground/scripts/<name>.tmp.ts` that opens `file://.../dist/index.html#<id>`, acts, and screenshots.
3. Run it with `node playground/scripts/<name>.tmp.ts`, read the screenshots, then delete the script. Node 24 runs TypeScript as is, as `pnpm screenshot` does.

Notes:

- Playwright 1.63 drives its own Chromium 153. Run `pnpm exec playwright install chromium` once after `pnpm install`, and again after a Playwright upgrade; it downloads about 170 MB.
- Monaco renders spaces as non-breaking spaces in `innerText`; normalize before comparing text.
- `pnpm screenshot` captures the examples the picker lists, the Compiler view and the Semantics view, with and without a question, at 1440×900 into `screenshots/`.
