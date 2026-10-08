import type { ExampleMeta } from "../catalog";

export default {
  feature: "Equals on a value the count skips",
  title: "Pallet delivery",
  summary: "Stock moves in twos, so it is never exactly 5.",
  question: "Stock comes in twos. Can it ever equal 5?",
  context: "Stock arrives on pallets of 2. Nothing else changes it.",
  group: "comparators",
  teamQuestion: true,
  rung: "atoms",
  order: 30,
  listed: true,
  builderFit: "fits",
  stresses: ["eventually", "==", "weighted arc", "unreachable value"],
  expect: { verdict: "violated", decidedAt: "end" },
} satisfies ExampleMeta;
