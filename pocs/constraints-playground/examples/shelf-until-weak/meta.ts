import type { ExampleMeta } from "../catalog";

export default {
  feature: "Weak until, goal never comes",
  title: "Shop shelf",
  summary: "Same run as the strong form: the shelf never empties, so weak until passes at the end.",
  question: "Restock never comes. Does WEAK UNTIL pass?",
  context: "A shelf holds 6 items and 3 customers each buy one. The restock needs a delivery that never comes.",
  group: "until",
  rung: "temporal",
  order: 200,
  listed: true,
  builderFit: "fits",
  stresses: ["weak until", "satisfied only at end", "deadlock end"],
  expect: { verdict: "satisfied", decidedAt: "end" },
} satisfies ExampleMeta;
