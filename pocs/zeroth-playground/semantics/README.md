# Semantics

One folder per open question about the semantics of the compilation: what a net means once it is modules, and what Zeroth can express. `register.ts` collects the folders, as `examples/catalog.ts` collects the examples, and the Semantics view of the playground lists them by topic. `intro.mdx` is the view's opening text.

A question lives here once. An example page references it with `<Question id="..." />`, and [compiler/mapping.md](../compiler/mapping.md) links its page. Tooling questions, such as executors, seeds and numerics, stay in mapping.md alone.

## Topics

| Topic | Holds |
| --- | --- |
| `steps` | what one step of the net means as modules |
| `conflicts` | who decides a choice the net leaves open: the sweep, a pick, a controller, a race between clocks |
| `places` | what a place and its arcs can express, under coins and under clocks |
| `rates` | how a rate becomes a firing, and what SPN's clocks can take |
| `colours` | coloured tokens and continuous dynamics |
| `theories` | modules of two theories in one system |

`TOPICS` in `register.ts` gives each topic its title and one line on what it is about.

## One folder per question

```
ties-under-clocks/
  meta.ts     the title, the topic, the owner, the status, where it shows
  page.mdx    the prose
```

The folder name is the id: the list's key and the URL hash, `#semantics/ties-under-clocks`. `meta.ts` default-exports a `QuestionMeta`:

| Field | Value |
| --- | --- |
| `title` | the question as a short noun phrase |
| `topic` | one of the topic ids above |
| `order` | its place in its topic; questions sort by it, in steps of 10 |
| `owner` | `"HASH"`, `"Zeroth"` or `"HASH and Zeroth"`: who can settle it |
| `status` | `"open"`, `"proposed"` or `"settled"` |
| `shows` | where it shows: one entry per example, with the options that bring the behaviour out and the net item whose lines quote it |

Every option in `shows` must apply to that example's net, as `optionsForNet` keeps it, and every item must be a place or transition of the net, or the net itself. `register.test.ts` checks both, and that every question is linked from mapping.md or shown on an example page.

## Status

| Status | Meaning |
| --- | --- |
| `open` | nobody has decided |
| `proposed` | one side proposes an answer, written on the page under "Proposal" |
| `settled` | decided; the decision and its date are written on the page under "Decision" |

Settling a question changes its status here and adds the decision to its page. The example pages and mapping.md only reference it, so they need no change.

## Page structure

```mdx
The question in one or two sentences, and why it matters.

### Today

What the compiler does now, quoting the Python lines that carry it:

```python
fires_TakeLeft = (clk_TakeLeft == 0) & (Pool != 0) & pick_TakeLeft
```

### Options on the table

- The possible answers, one per bullet.

### Decision

Who settled it and when, then what was decided. "Proposal" for a proposed question.
```

The view renders a page with the same components as an example page, so fenced code wraps under a hanging indent. Write **Shape** on modular for an option, in bold, and name an example by its feature in italics: *Rates as clocks*.

## Adding a question

1. Check that no question covers it. Copy a folder from the same topic and rename it to the new id.
2. Edit `meta.ts`. Pick an `order` after the questions it builds on.
3. Write `page.mdx` as above, quoting the lines from the example's snapshot in `examples/__snapshots__/`.
4. Reference it: `<Question id="..." />` under `### Open questions` on the example page where it matters most, and a bullet under the mapping's section in compiler/mapping.md.
5. Run `pnpm test`, then open `#semantics/<id>` in `pnpm dev` or the build.
