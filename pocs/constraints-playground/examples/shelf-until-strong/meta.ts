import type { ExampleMeta } from "../catalog";

export default {
  feature: "Strong until, goal never comes",
  title: "Shop shelf",
  summary: "The shelf never empties, but no restock comes, so strong until fails at the end.",
  question: "Restock never comes. Does UNTIL fail?",
  context: "A shelf holds 6 items and 3 customers each buy one. The restock needs a delivery that never comes.",
  group: "until",
  teamQuestion: true,
  rung: "temporal",
  order: 190,
  listed: true,
  builderFit: "fits",
  stresses: ["until", "strong", "violated only at end", "deadlock end"],
  expect: { verdict: "violated", decidedAt: "end" },
} satisfies ExampleMeta;
