import type { ExampleMeta } from "../catalog";

export default {
  feature: "Strict and inclusive bounds",
  title: "Bakery shelf",
  summary: "On whole counts, `> 0` and `≥ 1` give the same verdict but not the same margin.",
  question: "Shelf > 0 vs ≥ 1: any difference?",
  context: "A bakery shelf starts with 3 loaves. Each sale takes one until the shelf is empty.",
  group: "comparators",
  rung: "atoms",
  order: 20,
  listed: true,
  builderFit: "fits",
  stresses: ["always", "strict comparator", "integer counts", "margins"],
  expect: { verdict: "violated", decidedAt: 3 },
} satisfies ExampleMeta;
