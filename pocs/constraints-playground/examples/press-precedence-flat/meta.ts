import type { ExampleMeta } from "../catalog";

export default {
  feature: "And before or, unbracketed",
  title: "Press with a spare part",
  summary: "A and B or C reads as (A and B) or C, so the spare part alone keeps it true.",
  question: "A AND B OR C, no brackets: which joins first?",
  context: "A press breaks down and is repaired, in turns. One spare part is always on hand.",
  group: "and-or",
  teamQuestion: true,
  rung: "logic",
  order: 60,
  listed: true,
  builderFit: "partly",
  stresses: ["always", "precedence", "and/or warning", "printer brackets"],
  expect: { verdict: "satisfied", decidedAt: "end" },
} satisfies ExampleMeta;
