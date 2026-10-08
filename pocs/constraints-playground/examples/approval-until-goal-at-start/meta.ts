import type { ExampleMeta } from "../catalog";

export default {
  feature: "Until, goal met at the start",
  title: "Pre-approved request",
  summary: "The goal holds at step 0, so until is satisfied at once, though the hold side is false.",
  question: "Goal already true at step 0. Pass?",
  context: "A request starts out already approved. Then it is archived.",
  group: "until",
  rung: "temporal",
  order: 170,
  listed: true,
  builderFit: "fits",
  stresses: ["until", "goal at s0", "hold never checked"],
  expect: { verdict: "satisfied", decidedAt: 0 },
} satisfies ExampleMeta;
