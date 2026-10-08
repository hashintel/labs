import type { ExampleMeta } from "../catalog";

export default {
  feature: "And before or, bracketed",
  title: "Press with a spare part",
  summary: "A and (B or C): the same atoms, the same run, the opposite verdict.",
  question: "Brackets around the OR: does the verdict flip?",
  context: "A press breaks down and is repaired, in turns. One spare part is always on hand.",
  group: "and-or",
  teamQuestion: false,
  rung: "logic",
  order: 70,
  listed: true,
  builderFit: "fits",
  stresses: ["always", "precedence", "brackets", "decided mid-run"],
  expect: { verdict: "violated", decidedAt: 1 },
} satisfies ExampleMeta;
