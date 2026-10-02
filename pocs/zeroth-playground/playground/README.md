# Playground

The React app that shows the compiler at work: the IR editor, the Python it compiles to, a preview of the net, a documentation page per example, the Compiler view, and the Semantics view with the open questions. `pnpm build` writes it to one HTML file, `dist/index.html`, that opens from `file://`.

## Folders

One concept per file, kebab-case names, a file's private helpers in a folder of the same name, tests beside the file they test.

The source sits in four folders at the root. `vite.config.ts` sets Vite's root to `playground/`, which imports the other three; the build still writes `dist/index.html` at the root. The playground imports only `compiler/index.ts` from the compiler, the examples through `examples/catalog.ts` and their pages, and the questions through `semantics/register.ts` and their pages.

| Folder | Holds |
| --- | --- |
| `app/` | the shell: `App`, the URL route, the open document and its edits, the header with the view switch and the example picker |
| `playground-view/` | the Playground view: its grid, the module view with its file list and diagnostics, the compiler options panel, hover state, module edits |
| `compiler-view/` | the Compiler view: the guide, the pipeline graph, the stage list, the stage cards and their live samples, the options table |
| `semantics-view/` | the Semantics view: the question list by topic, the question card with its page and where it shows, the evidence compiled off the catalog |
| `options/` | how the compiler options read and change in the playground, shared by both views |
| `ui/` | the primitives the views share: `Panel`, `Switch`, `useFolds`, the resize target, `BackLink`, `CodeExcerpt` over `excerpt.ts`, the arrow-key step of a list |
| `editor/` | Monaco setup and theme, the `petri-net-ir` language and its completions, the provenance hover, line decorations, the React wrapper |
| `preview/` | the net graph, its elkjs layout, the SVG |
| `docs/` | the documentation view, the page registry, and the components it passes to every page: the `Figure` frame, the `Question` reference card, and `CodeBlock` for fenced code |
| `pointer/` | the hover dwell shared by both views |
| `theme/` | the tokens, the base and prose layers, fonts, the wordmark |
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

App state: selectedQuestion ─► Semantics view
        │ per showing: compile(example.ir, { options }) off the catalog
        ▼
Evidence { lines of the net item } or { the first diagnostic }

NavigationContext { openQuestion, openExample }
        ├─► a page's Question card opens the question in the Semantics view
        └─► a showing's "Open in Playground" opens the example with its options
```

- `App` in `app/app.tsx` holds the document and compiles it during render. `app/route.ts` reads the URL hash it opens on, and `app/document.ts` holds the document's pure transitions.
- `PlaygroundView` takes the document and hands back the next one, built with those transitions. `CompilerView` only reads it.
- The IR carries no options: the options panel holds them.
- A new IR text or new options drop the module edits. Reset and switching examples rebuild the document from the catalog. `#<example-id>` opens the Playground view on that example.
- All three views stay mounted under React's `Activity`, so each keeps its panel sizes, collapsed panels and pins.
- The Semantics view reads the register and the catalog alone, never the document. `App` holds the selected question, so a page's `Question` card can open it there through `app/navigation.ts`.
- The playground passes no code parser, so the nets with code strings are refused with `code-not-parsed`.

## Layout

- The Playground view is a `react-resizable-panels` grid: the documentation as a full-height first column, the IR and the module side by side, the net preview under them. Dragging a gridline resizes a row or a column, and dragging the point where two cross resizes both. A hovered or dragged gridline shows a blue overlay with a deep-blue line.
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

## The Semantics view

`semantics/register.ts` lists the questions by topic; [semantics/README.md](../semantics/README.md) says how to add one. The view's left panel is the list, grouped by `TOPICS`, with a status dot per row. The right panel shows the intro and the topics with their counts, or the selected question's card: its page, rendered with the same components as an example page, then "Shows in". Each showing compiles its example at its options with `compile`, independent of the open document, and `semantics-view/evidence.ts` quotes the lines `linesOfItem` gives for the net item, up to 14, or the first diagnostic when the compile refuses. "Open in Playground" opens the example in the Playground view with those options. `#semantics` opens the view, `#semantics/<id>` a question.

## Conventions

- Components are `export const Name: React.FC<Props> = (...) => ...`, and a component private to its file is the same `const` without `export`. Name the props type unless it is one short field, such as `{ text: string }`. Hooks and helpers are `function` declarations.
- React types need no import: write `React.FC`, `React.ReactNode`, `React.KeyboardEvent`. TypeScript reads `React` from the namespace `@types/react` declares, in type positions only. Keep `allowUmdGlobalAccess` off, so a React value used without an import stays an error. Import hooks and other values from `react` as usual.
- The React Compiler memoizes, through `@vitejs/plugin-react`'s `compiler` option with `oxc-transform-react`. Derive values in render and do not add `useMemo` or `useCallback`.
- Every React Compiler diagnostic fails `pnpm build`, the dev server's module and the tests that import it: a ref read in render, `setState` in render, an effect that only derives state, a construct the compiler cannot memoize. `vite.config.ts` sets `panicThreshold: "all_errors"` and the stricter checks. Restructure the component rather than opting out. `"use no memo"` still compiles the function, and a diagnostic inside it is only logged.
- Effects only synchronize systems React does not own. Today that is Monaco, in `editor/monaco-editor.tsx`.
- State is plain data with pure transition functions beside it, tested without the DOM. `app/document.ts`, `playground-view/module-edits.ts` and `pointer/pointer-motion.ts` are examples.
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
- All three views stay mounted, so filter selectors with `:visible`.
- Monaco renders spaces as non-breaking spaces in `innerText`; normalize before comparing text.
- `pnpm screenshot` captures the examples the picker lists, the Compiler view and the Semantics view, with and without a question, at 1440×900 into `screenshots/`.
