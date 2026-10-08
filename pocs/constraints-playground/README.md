# constraints-playground

An interactive playground for defining constraints on Petri nets. Each example is one net and one constraint. The constraint is LTL over named metrics (`count(Queue)`, `fired(Serve)`), written as text or built in a no-code builder, and checked on a seeded run of the net: a verdict (Satisfied, Violated, Pending) and a timeline. [constraints/SPEC.md](constraints/SPEC.md) has the grammar and the rules.

The screen: the example's page on the left; the net IR and the net preview in the middle; the Constraint panel on the right, with the builder, the `constraint.yaml` editor and the Run. It builds to one HTML file that opens from disk.

## Running

It needs Node 24 or later and pnpm.

```bash
pnpm install
pnpm dev
```

`pnpm build` writes `dist/index.html`. A URL hash names the example to open: `index.html#queue-always`. `pnpm test` runs the unit tests, `pnpm lint:tsc` type-checks, and `pnpm screenshot` screenshots the listed examples into `screenshots/`. Install the Chromium once with `pnpm exec playwright install chromium`.

## Working on it

[AGENTS.md](AGENTS.md) is the entry point for people and agents: commands, rules, and links to the READMEs.
