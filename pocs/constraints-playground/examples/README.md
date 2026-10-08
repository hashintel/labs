# Examples

One folder per example: a Petri net, a constraint on it, and a documentation page. The playground's picker lists the examples marked `listed`, and the tests parse and run every one.

## The ladder

The examples climb a ladder of rungs, from the sandbox to one atom and up. `LADDER` in `catalog.ts` lists them:

| Rung | Picker heading | Holds |
| --- | --- | --- |
| `sandbox` | Sandbox | the default example: one factory net and a blank rule (`always (_)`), with no declared verdict |
| `atoms` | One atom | one metric, one comparator |
| `logic` | Combining | `and`, `or`, `not`, `implies`, `iff`, brackets |
| `temporal` | Temporal operators | `always`, `eventually`, `until`, `weak until` |
| `limits` | Limits of the base | what the base cannot say, or says in a surprising way, and the cases beyond the base (no operator), flagged by scope notes |
| `nested` | Nested operators (full LTL) | constraints that nest a temporal operator in another; each is flagged `nested: true` and needs the Nested operators flag |
| `mtl` | MTL: time windows | constraints with a time window, in any notation; each is flagged `mtl: true` and needs the MTL flag; one that also nests declares both flags |

`order` still climbs the ladder. The picker groups the examples by `group` instead, the main construct each one tackles. `GROUPS` in `catalog.ts` lists them, in order: Sandbox, Comparators < ≤ = ≠, AND / OR, IF · IFF · NOT, ALWAYS · EVENTUALLY, UNTIL · WEAK UNTIL, Nested, MTL. [constraints/SPEC.md](../constraints/SPEC.md) has the grammar.

## One folder per example

```
queue-always/
  meta.ts          what the picker and the page header show, the rung, the order, the tags
  net.pn.yaml      the net, in the Petri net IR; uncoloured, rates as numbers or absent
  constraint.yaml  metrics, the constraint, and the run settings
  page.mdx         Context, Rule, Example (Run, Verdict, Explanation), Question
```

The folder name is the id: the picker's key, the page's key and the URL hash, `#queue-always`. `catalog.ts` collects the folders with `import.meta.glob`, so nothing else registers an example.

`meta.ts` default-exports an `ExampleMeta`, defined in `catalog.ts`:

| Field | Value |
| --- | --- |
| `feature` | what the example tackles: its name in the picker and its page heading |
| `title` | the net's name, shown above the heading |
| `summary` | one line on what it shows |
| `question` | the question the example answers, at most about 10 words, shown in the picker. Name the concrete situation so a reader who has not read the page or the spec understands it, such as "Stock comes in twos. Can it ever equal 5?". No verdict |
| `context` | the net's story in 1 or 2 plain sentences, such as "Stock arrives on pallets of 2. Nothing else changes it." The page's Context line repeats it word for word |
| `group` | the picker group of the main construct: `sandbox`, `comparators`, `and-or`, `if-iff-not`, `always-eventually`, `until`, `nested` or `mtl` |
| `rung` | `sandbox`, `atoms`, `logic`, `temporal`, `limits`, `nested` or `mtl` |
| `order` | its place up the ladder; examples sort by it, in steps of 10 |
| `mtl` | `true` when the constraint uses a time window. The picker shows the example only while MTL is on, and opening it turns MTL on. The tests parse it with `mtl: true`; every other example parses with MTL off |
| `nested` | `true` when the constraint nests a temporal operator in another or in a condition. The picker shows the example only while Nested operators is on, and opening it turns the flag on. The tests parse every example with exactly the flags it declares, and check that `nested` is set exactly when the constraint nests |
| `listed` | `false` keeps it out of the picker; its hash still opens it |
| `builderFit` | `fits`, `partly` or `breaks`: whether the no-code builder can express the constraint |
| `stresses` | tags for what the example puts under strain |
| `expect` | optional: the `verdict` the run gives and `decidedAt`, the step that decides it or `"end"`; leave it out where the seed changes the verdict |
| `expectsDiagnostic` | optional: an error message the run is meant to produce |

## Adding an example

1. Copy a folder from the same rung and rename it to the new id.
2. Edit `meta.ts`. Pick an `order` that is not taken, between the examples it builds on and the ones that build on it. Fill `question`, `context`, `group` and `expect`.
3. Replace `net.pn.yaml` and `constraint.yaml`.
4. Rewrite `page.mdx` in the page format below. Run the example to get the verdict and the step; do not work it out by hand.
5. Run `pnpm test`, open `#<id>` in `pnpm dev`, and run `pnpm screenshot`.

## Page structure

Every page follows one shape, after a LeetCode problem page, in under about 70 words:

````mdx
<Context>A bakery shelf starts with 3 loaves. Each sale takes one until the shelf is empty.</Context>

**Rule**

<Rule />

**Example**

<Example>

**Run:** `Shelf: 3 → 2 → 1 → 0`

**Verdict:** Violated at step 3.

**Explanation:** At step 3 the shelf holds 0, and `0 > 0` is false. ...

</Example>
````

- **Context**: `meta.context`, word for word, in everyday words: what the places and transitions are. It renders grey, with its label inline.
- **Rule**: `<Rule />`, which renders the example's `constraint.yaml` in the builder's words (`ALWAYS (count(Shelf) > 0)`, `≤`, `≠`) through `ruleOf`, so the page cannot drift from the file.
- **Example**: the key values as one short sequence in code, the verdict in the badge words (Violated or Satisfied, "at step N." or "at the end of the run."), and 1 or 2 sentences tied to the numbers. A seeded run names its seed.
- **Question**: only on the examples in `examples/pressing.ts`, plus the 11 pages that keep an original question and show only under "Show more". One line: a builder question only the team can answer and has not settled, such as whether the builder should offer a "between" comparison. One example per question. A reader prompt such as "Change the seed and see" is labelled **Try:**, not Question.
- Wrap each playground-specific or logic term (deadlock, horizon, interleaving, vacuous, strict bound, margin, De Morgan, ...) in `<Term>`, which underlines it and shows its line from `playground/docs/glossary.ts` on hover and on focus. Use `<Term name="deadlock">deadlocks</Term>` when the text differs from the entry. Add a missing term to the glossary first: a page that wraps an unknown term fails its render test.
- No people's names, no quotes, no internal codes. The pages will be public.
- The documentation view writes the net's name and the heading from `meta.ts`, and passes `Context`, `Example`, `Term`, `Figure` and `Rule` to every page from `playground/docs/page-components.ts`. It renders fenced code through `CodeBlock`.
- In MDX, `<` before a space or a digit starts a tag. Put comparisons in code: `` `< 3` ``.

## Tests

- `catalog.test.ts` checks that every folder holds a `meta.ts`, a `net.pn.yaml`, a `constraint.yaml` and a `page.mdx`, that the examples climb the ladder rung by rung, each at its own `order`, and that each has a short `question`, a `context` of 1 or 2 sentences and a known `group`. It also checks that `PRESSING` names at most 5 examples that exist, each once.
- `examples.test.ts` parses each example's net and constraint, checks the references, runs it and checks that no step reports an error (except the one `expectsDiagnostic` names) and the verdict is decided.
- `expected-verdicts.test.ts` runs each example that declares `expect` and checks its final verdict and the step that decides it.
- `playground/docs/example-pages.test.tsx` renders every page with the components the documentation view passes, checks that each page opens on its `meta.context`, and that every `<Term>` is in the glossary.
