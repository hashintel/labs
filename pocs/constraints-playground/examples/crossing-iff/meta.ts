import type { ExampleMeta } from "../catalog";

export default {
  feature: "Iff, true when both sides are false",
  title: "Pedestrian crossing",
  summary: "Walk IFF cars are stopped; at step 0 neither holds, and that counts as true.",
  question: "No cars stopped, no walk sign. Does IFF pass?",
  context: "At a crossing, one switch stops the cars and lights the walk sign together. Another switch undoes both.",
  group: "if-iff-not",
  teamQuestion: true,
  rung: "logic",
  order: 90,
  listed: true,
  builderFit: "fits",
  stresses: ["always", "iff", "both sides false"],
  expect: { verdict: "satisfied", decidedAt: "end" },
} satisfies ExampleMeta;
