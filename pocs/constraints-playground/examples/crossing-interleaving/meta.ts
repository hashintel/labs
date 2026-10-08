import type { ExampleMeta } from "../catalog";

export default {
  feature: "Interleaving and steps",
  title: "Split pedestrian crossing",
  summary: "One firing per state breaks the rule at step 2 for every seed; firing both signals in one step never breaks it.",
  question: "Two signals land one at a time. Does IFF break?",
  context: "At a crossing, one switch sends two signals: stop the cars, light the walk sign. Each signal lands on its own.",
  group: "if-iff-not",
  rung: "limits",
  order: 260,
  listed: true,
  builderFit: "partly",
  stresses: ["always", "iff", "interleaving", "step semantics"],
  expect: { verdict: "violated", decidedAt: 2 },
} satisfies ExampleMeta;
