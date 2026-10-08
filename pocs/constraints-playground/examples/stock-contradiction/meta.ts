import type { ExampleMeta } from "../catalog";

export default {
  feature: "A contradiction",
  title: "Storeroom",
  summary: "No count is both > 5 and < 3, so eventually waits for the end and fails.",
  question: "Stock above 5 and below 3: what happens?",
  context: "A storeroom starts empty. Items arrive one by one until it holds 8.",
  group: "and-or",
  rung: "logic",
  order: 120,
  listed: true,
  builderFit: "fits",
  stresses: ["eventually", "contradiction", "violated only at end"],
  expect: { verdict: "violated", decidedAt: "end" },
} satisfies ExampleMeta;
