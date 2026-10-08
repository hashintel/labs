import type { ExampleMeta } from "../catalog";

export default {
  feature: "An event through fired",
  title: "Self-restocking shelf",
  summary: "fired(Restock) ≥ 1 says the event has happened, decided at step 3 while the run goes on.",
  question: "How do you say “a restock happened”?",
  context: "A shelf starts with 2 items. Each sale takes one; when it is empty, a restock refills it to 3.",
  group: "always-eventually",
  teamQuestion: true,
  rung: "temporal",
  order: 220,
  listed: true,
  builderFit: "fits",
  stresses: ["eventually", "fired", "event surrogate", "decided mid-run"],
  expect: { verdict: "satisfied", decidedAt: 3 },
} satisfies ExampleMeta;
