import type { ExampleMeta } from "../catalog";

export default {
  feature: "Settles for good",
  title: "Heater in a draft",
  summary: "eventually(always(...)) on a finite run only reads the last state.",
  question: "Heater warm at the end. Has it settled?",
  context: "A heater warms a room. A draft cools it twice, then dies down.",
  group: "nested",
  teamQuestion: true,
  rung: "nested",
  order: 300,
  nested: true,
  listed: true,
  builderFit: "fits",
  stresses: ["eventually", "always", "nesting", "stabilisation"],
  expect: { verdict: "satisfied", decidedAt: "end" },
} satisfies ExampleMeta;
