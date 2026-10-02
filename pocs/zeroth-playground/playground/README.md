# Playground

The React app that shows the compiler at work: the IR editor, the Python it compiles to, a preview of the net, a documentation page per example, and the Compiler view. `pnpm build` writes it to one HTML file, `dist/index.html`, that opens from `file://`.

## Folders

One concept per file, kebab-case names, a file's private helpers in a folder of the same name, tests beside the file they test.

The source sits in three folders at the root. `vite.config.ts` sets Vite's root to `playground/`, which imports the other two; the build still writes `dist/index.html` at the root. The playground imports only `compiler/index.ts` from the compiler, and the examples through `examples/catalog.ts` and their pages.

| Folder | Holds |
| --- | --- |
| `app/` | the shell: `App`, the URL route, the open document and its edits, the header with the view switch and the example picker |
| `examples-view/` | the Examples view: its grid, the module view with its file list and diagnostics, the compiler options panel, hover state, module edits |
| `compiler-view/` | the Compiler view: the guide, the pipeline graph, the stage list, the stage cards and their live samples, the options table |
| `options/` | how the compiler options read and change in the playground, shared by both views |
| `ui/` | the primitives both views use: `Panel`, `Switch`, `useFolds`, the resize target |
| `editor/` | Monaco setup and theme, the `petri-net-ir` language and its completions, the provenance hover, line decorations, the React wrapper |
| `preview/` | the net graph, its elkjs layout, the SVG |
| `docs/` | the documentation view, the page registry, and the components it passes to every page: the `Figure` frame, `OpenQuestion`, and `CodeBlock` for fenced code |
| `pointer/` | the hover dwell shared by both views |
| `theme/` | the swiss variables and styles, fonts, the wordmark |
| `scripts/` | the screenshot script |

`index.html` and `main.tsx` sit at the top of the folder.

## Data flow

```
App state: Document { exampleId, irText, options, module edits }
        │ compile(irText, { options })
        ▼
Compilation { ir, options, irTrace, graph, files, errors, warnings }
        ├─► IR editor and module editor (Monaco)
        ├─► Compiler options panel (optionStates; withOption on a change)
        ├─► Net preview (elkjs, SVG)
        └─► Compiler view (one live sample per stage)

Pointer over a line or node ─► useDwell ─► Hover { provenance }
        ─► lit lines in both editors and the lit node in the preview
```

- `App` in `app/app.tsx` holds the document and compiles it during render. `app/route.ts` reads the URL hash it opens on, and `app/document.ts` holds the document's pure transitions.
- `ExamplesView` takes the document and hands back the next one, built with those transitions. `CompilerView` only reads it.
- The IR carries no options: the options panel holds them.
- A new IR text or new options drop the module edits. Reset and switching examples rebuild the document from the catalog.
- Both views stay mounted under React's `Activity`, so each keeps its panel sizes, collapsed panels and pins.
- The playground passes no code parser, so the nets with code strings are refused with `code-not-parsed`.

## Layout

- The Examples view is a `react-resizable-panels` grid: the documentation as a full-height first column, the IR and the module side by side, the net preview under them. Dragging a gridline resizes a row or a column, and dragging the point where two cross resizes both. A hovered or dragged gridline shows a blue overlay with a deep-blue line.
- Every view is the same `Panel`. The documentation, the compiler options, the preview and the files collapse from the chevron in their head; collapsed against a side, a panel becomes a strip with its title written upright.
- The example picker is a popover anchored to its button and walked with the arrow keys. It lists the listed examples rung by rung and skips an empty rung; an unlisted example appears while it is open.
- `NetPreview` is the one component that takes a `PetriNetIr`, the boundary a canvas can replace.

## The compiler options panel

`optionStates` and `OPTIONS` from the compiler decide the values, the defaults and why an option does not apply. Two files sit on top:

| File | Decides |
| --- | --- |
| `options/option-labels.ts` | labels, one-line hints, value labels, sections, which option nests under which |
| `options/option-edits.ts` | `withOption`, which turns a control's text into the options the panel stores, and `sameOptions` |

The panel stores only what `optionsForNet` keeps: the options that apply to the net and differ from the default. An option that does not apply is greyed, its control reads "not used", and the reason replaces its hint. Its default has no effect on the net, so the control does not show it. The Compiler view's option table in `compiler-view/strategy-table.tsx` reads the defaults and what each option applies to from `OPTIONS`.

## The Compiler view

`compiler-view/stages.ts` describes each stage of the compiler's pipeline to readers: its call, what goes in and comes out, and the facts worth knowing. Keep it in step with the pipeline in [compiler/README.md](../compiler/README.md#pipeline). To add a stage:

1. Add the stage to `STAGES` in `compiler-view/stages.ts`.
2. Place it and its edges in `compiler-view/pipeline-layout.ts`.
3. Write its live sample in `compiler-view/stage-sample/` and route it from `stage-sample.ts`.
4. Cover it in `stage-sample.test.ts` and `pipeline-layout.test.ts`.

## Conventions

- Components are `export const Name: React.FC<Props> = (...) => ...`, and a component private to its file is the same `const` without `export`. Name the props type unless it is one short field, such as `{ text: string }`. Hooks and helpers are `function` declarations.
- React types need no import: write `React.FC`, `React.ReactNode`, `React.KeyboardEvent`. TypeScript reads `React` from the namespace `@types/react` declares, in type positions only. Keep `allowUmdGlobalAccess` off, so a React value used without an import stays an error. Import hooks and other values from `react` as usual.
- The React Compiler memoizes, through `@vitejs/plugin-react`'s `compiler` option with `oxc-transform-react`. Derive values in render and do not add `useMemo` or `useCallback`.
- Every React Compiler diagnostic fails `pnpm build`, the dev server's module and the tests that import it: a ref read in render, `setState` in render, an effect that only derives state, a construct the compiler cannot memoize. `vite.config.ts` sets `panicThreshold: "all_errors"` and the stricter checks. Restructure the component rather than opting out. `"use no memo"` still compiles the function, and a diagnostic inside it is only logged.
- Effects only synchronize systems React does not own. Today that is Monaco, in `editor/monaco-editor.tsx`.
- State is plain data with pure transition functions beside it, tested without the DOM. `app/document.ts`, `examples-view/module-edits.ts` and `pointer/pointer-motion.ts` are examples.
- Styles are plain CSS with the swiss variables in `theme/theme.css`. Use current CSS where it removes code: anchor positioning, `@starting-style`, `:has`, the Popover API.
- Comments say what the code does and why. Prose follows the house style: plain words, short sentences, no em dashes.

## Bundle

`pnpm build` inlines everything into `dist/index.html`: scripts, CSS, fonts and the Monaco editor worker. MDX maths is rendered to SVG at build time. Monaco and elkjs are most of the file. Measure the file before adding a dependency.

A code parser for the IR's code strings would need the TypeScript compiler, which does not fit this budget. That is why nets with code strings are refused here.

## Gates

Run all three before each commit:

```bash
pnpm lint:tsc
pnpm test
pnpm build
```

`pnpm lint:tsc` type-checks the project, then `compiler/` on its own, which fails on an import that leaves the folder. `pnpm build` also fails on any React Compiler diagnostic, as [Conventions](#conventions) says.

## Tests

- Tests sit beside their files as `*.test.ts`, and vitest runs the ones under `compiler/`, `examples/` and `playground/`. The compiler's tests are described in [compiler/README.md](../compiler/README.md#tests), the examples' in [examples/README.md](../examples/README.md#tests).
- Every test, in all three folders, reads as GIVEN, WHEN, THEN: a `// GIVEN` comment on the setup, `// WHEN` on the action, `// THEN` on the expectations. A test with no action goes from GIVEN to THEN. One THEN line sums up a group of `expect` calls. The test's name says the behaviour, such as "drops the texts on a new compilation and keeps the toggle".
- The playground's pure cores have their own tests: the route and the document, the option labels and edits, the IR completions, the net graph, the pipeline layout, the stage samples, module edits, pointer motion.
- `docs/example-pages.test.tsx` renders every example page with the components the documentation view passes, and `docs/code-block.test.tsx` checks that a fenced block renders one row per line.
- A test changed to make it pass is a changed contract. Say why in the commit message.

## Checking the UI

Check visible changes in a headless browser against the build:

1. `pnpm build`.
2. Write a throwaway Playwright script as `playground/scripts/<name>.tmp.ts` that opens `file://.../dist/index.html#<id>`, acts, and screenshots. `#compiler`, or `#compiler/capacity`, opens the Compiler view.
3. Run it with `node playground/scripts/<name>.tmp.ts`, read the screenshots, then delete the script. Node 24 runs TypeScript as is, as `pnpm screenshot` does.

Notes:

- Playwright 1.63 drives its own Chromium 153. Run `pnpm exec playwright install chromium` once after `pnpm install`, and again after a Playwright upgrade; it downloads about 170 MB.
- Both views stay mounted, so filter selectors with `:visible`.
- Monaco renders spaces as non-breaking spaces in `innerText`; normalize before comparing text.
- `pnpm screenshot` captures the examples the picker lists and the Compiler view at 1440×900 into `screenshots/`.
