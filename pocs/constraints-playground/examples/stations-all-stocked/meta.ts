import type { ExampleMeta } from "../catalog";

export default {
  feature: "One condition for several places",
  title: "Three stations",
  summary: "Three places must all hold stock: one condition repeated three times, joined by and.",
  question: "Three stations must all have stock. Three ANDs?",
  context: "Three stations each hold parts. Each station uses one part at a time.",
  group: "and-or",
  rung: "logic",
  order: 125,
  listed: true,
  builderFit: "fits",
  stresses: ["always", "and", "repeated condition", "several places"],
  expect: { verdict: "violated", decidedAt: 3 },
} satisfies ExampleMeta;
