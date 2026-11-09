# Playground

The app has two views: Examples and Questions. The build is one HTML file that opens from disk.

## Folders

| Folder | Holds |
| --- | --- |
| `app/` | The header, native example picker, routes, and document state. |
| `playground-view/` | Editable YAML, read-only Python, applicable options, and diagnostics. |
| `semantics-view/` | The question list and MDX bodies. |
| `options/` | The three presentation settings and option edits. |
| `docs/` | Example pages, fenced code, question links, and embedded nets. |
| `preview/` | The shared net graph, elkjs layout, and SVG renderer. |
| `editor/` | Monaco, YAML completion, and source highlighting. |
| `pointer/` | Hover timing. |
| `ui/` | Panels and resize controls. |
| `theme/` | Tokens, fonts, and shared styles. |
| `scripts/` | Screenshot capture. |
| `build/` | The single-file HTML build hook. |

## Data flow

`App` owns `{ exampleId, irText, options }` and compiles it during render. The result feeds the input trace, Python, diagnostics, and net preview. Hovering a line or node highlights the same net item in the other panels.

Both views stay mounted under React's `Activity` to preserve panel sizes. Hashes select examples and questions. `#cycle?shape=modular` opens an example with different options. Old `#compiler/<example>` links open Examples. Reset restores the text and options named by the route.

## Presentation

The example explanation occupies the left column. YAML and Python are side by side, with the net below. Options is a native disclosure, closed initially. It offers module shape, coin time step, and conflict choice only when applicable. Other compiler options remain available through the compiler API and URL queries.

Questions have a short list and one body, with the first question selected initially. `ExampleNet` embeds the shared net preview at 180 px high and links to the example. Each SVG owns its arrow and inhibitor markers, so multiple nets can appear on one page. The renderer accepts optional hover props; embedded nets need no hover state.

## Conventions

- Components are `export const Name: React.FC<Props> = (...) => ...`, and a component private to its file is the same `const` without `export`. Name the props type unless it is one short field, such as `{ text: string }`. Hooks and helpers are `function` declarations.
- React types need no import: write `React.FC`, `React.ReactNode`, `React.KeyboardEvent`. TypeScript reads `React` from the namespace `@types/react` declares, in type positions only. Keep `allowUmdGlobalAccess` off, so a React value used without an import stays an error. Import hooks and other values from `react` as usual.
- The React Compiler memoizes, through `@vitejs/plugin-react`'s `compiler` option with `oxc-transform-react`. Derive values in render and do not add `useMemo` or `useCallback`.
- Every React Compiler diagnostic fails `pnpm build`, the dev server's module and the tests that import it: a ref read in render, `setState` in render, an effect that only derives state, a construct the compiler cannot memoize. `vite.config.ts` sets `panicThreshold: "all_errors"` and the stricter checks. Restructure the component rather than opting out. `"use no memo"` still compiles the function, and a diagnostic inside it is only logged.
- Effects only synchronize systems React does not own. Today that is Monaco, in `editor/monaco-editor.tsx`.
- State is plain data with pure transition functions beside it, tested without the DOM. `app/document.ts` and `pointer/pointer-motion.ts` are examples.
- Comments say what the code does and why. Prose follows the house style: plain words, short sentences, no em dashes.

## Styles

Styles are plain CSS. A component imports its own file, placed beside it, and nests its rules with native CSS nesting. The views that lay out resizable groups import `ui/resizable.css`, which holds the classes those groups share.

| File | Holds |
| --- | --- |
| `theme/tokens.css` | the cascade layers, and the tokens: colours, type sizes, spacing, radii, shadows, durations |
| `theme/base.css` | the reset and the page, one focus ring, a button reset with no specificity, `.caps` for mono capitals, `.note` |
| `theme/prose.css` | `.docs` and `.prose`, the typography shared by examples and questions |

- `main.tsx` imports the three before anything else, because `tokens.css` names the layers before any rule uses one.
- The layers, lowest first, are `base`, `prose` and `vendor`. A plugin in `vite.config.ts` puts Monaco's own CSS in `vendor`. A component's rules sit in no layer, so they win over all three without a longer selector.
- Use a token where the value is one. A value only one rule uses stays a literal in that rule. `editor/swiss-theme.ts` repeats the colours as hex, because Monaco's theme API takes literals.
- `!important` only overrides a style Monaco writes inline. Monaco's list also writes rules at run time, outside any layer, and those win over Monaco's layered ones. `editor/monaco-editor.css` restores the one that showed.
- Reduced motion zeroes the duration tokens. A figure that runs its own keyframes shows a still frame instead.
- Use current CSS where it removes code: anchor positioning, `@starting-style`, `:has`, the Popover API.

## Bundle

`pnpm build` inlines everything into `dist/index.html`: scripts, CSS, fonts and the Monaco editor worker. MDX maths is rendered to SVG at build time. Monaco and elkjs are most of the file. Measure the file before adding a dependency.

`build/single-file.ts` uses Vite's asset inlining and one output chunk, then embeds the JavaScript and CSS in the HTML. It rejects leftover external assets. The local hook replaces `vite-plugin-singlefile`, whose `micromatch` dependency pulls in `braces` affected by [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). All resources are inlined, so the build needs no glob matching.

A code parser for the IR's code strings would need the TypeScript compiler, which does not fit this budget. That is why nets with code strings are refused here.

`package.json` overrides three transitive packages, each scoped to the parent that pins it:

- `speech-rule-engine>@xmldom/xmldom` is lifted to 0.9.12, which fixes the advisories against 0.9.10. The chain is `rehype-mathjax`, then `mathjax-full` 3, then `speech-rule-engine` 4, which pins `@xmldom/xmldom` at exactly 0.9.10, and it runs only at build time. Drop the override once `rehype-mathjax` moves to MathJax 4 (remarkjs/remark-math#118 and #119), whose `speech-rule-engine` allows the fixed version.
- `monaco-editor>dompurify` is lifted to 3.4.16, which fixes the advisory against 3.4.15. Monaco 0.57 pins `dompurify` at exactly 3.4.15 for its hover widget. Drop the override once a Monaco release depends on 3.4.16 or later.
- `micromark-extension-math>katex` is lifted to 0.18.2, which fixes [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7). The chain is `remark-math` 6, then `micromark-extension-math` 3.1, which allows only KaTeX 0.16. The playground uses its math parser and renders with MathJax. An [upstream upgrade](https://github.com/micromark/micromark-extension-math/pull/14) is pending; drop the override once a release allows KaTeX 0.18.2 or later.

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
- The playground's pure cores have their own tests: the route and the document, the option labels and edits, the IR completions, the net graph, and pointer motion.
- `docs/example-pages.test.tsx` renders every example page with the components the documentation view passes, and `docs/code-block.test.tsx` checks that a fenced block renders one row per line.
- A test changed to make it pass is a changed contract. Say why in the commit message.

## Checking the UI

Check visible changes in a headless browser against the build:

1. `pnpm build`.
2. Write a throwaway Playwright script as `playground/scripts/<name>.tmp.ts` that opens `file://.../dist/index.html#<id>`, acts, and screenshots. `#semantics/transition-or-places-decide` opens a question with an embedded net.
3. Run it with `node playground/scripts/<name>.tmp.ts`, read the screenshots, then delete the script. Node 24 runs TypeScript as is, as `pnpm screenshot` does.

Notes:

- Playwright 1.63 drives its own Chromium 153. Run `pnpm exec playwright install chromium` once after `pnpm install`, and again after a Playwright upgrade; it downloads about 170 MB.
- Both views stay mounted, so filter selectors with `:visible`.
- Monaco renders spaces as non-breaking spaces in `innerText`; normalize before comparing text.
- `pnpm screenshot` captures all examples and questions, at 1440×900 into `screenshots/`.
