# Questions for Zeroth

The meeting has three questions: whether all inputs must enable a clocked transition, whether rates can depend on token counts, and whether SPN and LRA compose.

Keep this list short. Add a question when it needs an answer from Zeroth for the next discussion. Compiler design details belong in [compiler/mapping.md](../compiler/mapping.md).

## Files

Each question folder holds `meta.ts` and `page.mdx`. The folder name is its id and URL hash, such as `#semantics/transition-or-places-decide`. `register.ts` collects the folders and sorts by `order`.

Metadata defines the title, order, and status: `open`, `proposed`, or `settled`. A proposal or decision goes on the page. A decision includes who made it and its date.

## Pages

Lead with the question. Give the behaviour needed in a few sentences, using an equation when useful. Embed a small net where it explains the question:

```mdx
<ExampleNet
  example="cafe-queue"
  caption="A customer is waiting, but no staff member is free."
/>
```

`ExampleNet` reads the example's YAML and uses the same SVG renderer as the playground, without cross-highlighting. Its caption links to the example. The graph shows the initial marking. Theories alone need no net drawing.

The view renders the body directly. Example links and diagrams live in the body; generated Python remains in the Examples view.

## Checks

Reference each question from an example with `<Question id="..." />` or from `compiler/mapping.md`. The register tests check folder completeness and references. Question page tests render the diagrams and check that multiple graphs have distinct SVG markers.

Run the project checks and `pnpm screenshot` after editing.
