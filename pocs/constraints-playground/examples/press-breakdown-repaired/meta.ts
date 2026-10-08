import type { ExampleMeta } from "../catalog";

export default {
  feature: "Every breakdown is repaired",
  title: "Press with breakdowns",
  summary: "The usual rule needs a nested eventually; the closest base rule passes a run that ends on an unrepaired breakdown.",
  question: "Can a breakdown count say every breakdown is repaired?",
  context: "A press breaks down and is repaired, in turns. The run stops right after a breakdown.",
  group: "nested",
  teamQuestion: true,
  rung: "limits",
  order: 230,
  listed: true,
  builderFit: "breaks",
  stresses: ["always", "response pattern", "nesting", "metric arithmetic"],
  expect: { verdict: "satisfied", decidedAt: "end" },
} satisfies ExampleMeta;
