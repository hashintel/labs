import type { ExampleMeta } from "../catalog";

export default {
  feature: "Implies with a false condition",
  title: "Oven",
  summary: "Nothing burns, so the alarm rule passes, though the net has no alarm at all.",
  question: "Alarm never needed. Does the rule pass?",
  context: "An oven bakes 3 loaves. It never overheats, so nothing burns, and it has no alarm at all.",
  group: "if-iff-not",
  rung: "logic",
  order: 80,
  listed: true,
  builderFit: "fits",
  stresses: ["always", "implies", "vacuous truth", "deadlock end"],
  expect: { verdict: "satisfied", decidedAt: "end" },
} satisfies ExampleMeta;
