import type { ExampleMeta } from "../catalog";

export default {
  feature: "Every breakdown is repaired, nested",
  title: "Press with breakdowns",
  summary: "The response rule written with a nested eventually; it fails a run that ends on an unrepaired breakdown.",
  question: "Run ends mid-breakdown. Is the repair rule broken?",
  context: "A press breaks down and is repaired, in turns. The run stops right after a breakdown.",
  group: "nested",
  rung: "nested",
  order: 290,
  nested: true,
  listed: true,
  builderFit: "fits",
  stresses: ["always", "eventually", "nesting", "response pattern"],
  expect: { verdict: "violated", decidedAt: "end" },
} satisfies ExampleMeta;
