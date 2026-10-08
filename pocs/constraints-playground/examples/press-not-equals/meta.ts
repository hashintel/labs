import type { ExampleMeta } from "../catalog";

export default {
  feature: "Not, or a flipped comparator",
  title: "Press with breakdowns",
  summary: "NOT (Down = 1) is Down ≠ 1; the verdict is fixed at step 1 while the run goes on.",
  question: "NOT (Down = 1) vs Down ≠ 1: any difference?",
  context: "A press breaks down and is repaired, in turns.",
  group: "comparators",
  rung: "atoms",
  order: 50,
  listed: true,
  builderFit: "partly",
  stresses: ["always", "not", "!=", "comparator flip", "decided mid-run"],
  expect: { verdict: "violated", decidedAt: 1 },
} satisfies ExampleMeta;
