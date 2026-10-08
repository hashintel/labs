import type { ExampleMeta } from "../catalog";

export default {
  feature: "No operator: the first state only",
  title: "Queue at the door",
  summary: "A rule with no temporal operator is checked at the first state; the queue grows past 5 later.",
  question: "No ALWAYS in the rule. Which steps count?",
  context: "3 people queue at a door. 4 more come in, one by one.",
  group: "always-eventually",
  rung: "limits",
  order: 280,
  listed: true,
  builderFit: "fits",
  stresses: ["now", "no temporal operator"],
  expect: { verdict: "satisfied", decidedAt: 0 },
} satisfies ExampleMeta;
