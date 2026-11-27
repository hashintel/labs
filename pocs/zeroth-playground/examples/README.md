# Examples

Five small nets form the meeting demonstration. Each adds one idea.

| Order | Example | Opens with |
| --- | --- | --- |
| 10 | One step | One module |
| 20 | One shared token | Separate modules, transition order |
| 50 | Rates as coins | Separate modules, Δt = 0.5 |
| 60 | Rates as clocks | Clocked modules |
| 70 | Two inputs | Clocked modules, one input empty |

## Files

Each folder holds `meta.ts`, `net.pn.yaml`, and `page.mdx`. Its name is the example id and URL hash. `catalog.ts` collects the folders and sorts by `order`.

`meta.ts` defines the feature heading, net title, order, and compiler options. The picker lists every example. Compiler options stay outside the YAML. Reset restores the text and options.

## Pages

Use a few sentences, one equation or short Python excerpt, and one thing to change. Explain the behaviour before naming implementation details. Write maths as `$...$` or `$$...$$`; it renders to SVG at build time.

A page can link a meeting question with `<Question id="marking-dependent-rates" />`. Keep questions in [semantics/](../semantics/README.md).

The shared MDX components include `ExampleNet`, `Question`, and fenced code. `<ExampleNet example="cafe-queue" caption="Both inputs are needed." />` embeds the existing net renderer and a link to that example.

## Adding an example

1. Add a folder with the three files above.
2. Keep the net small and give it one purpose.
3. Add its expected outcome in `examples.test.ts`.
4. Run `pnpm test -u` and read the generated Python snapshot.
5. Run the project checks and `pnpm screenshot`.

The tests check folder completeness, distinct orders, successful compilation, applicable defaults, and generated Python snapshots. The page render test checks MDX component and question references.
