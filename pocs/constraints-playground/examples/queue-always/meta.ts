import type { ExampleMeta } from "../catalog";

export default {
  feature: "Always, one atom",
  title: "Café queue",
  summary: "The queue never passes 5.",
  question: "Does the queue ever pass 5?",
  context: "Customers join a café queue at random. One server takes them out a little faster than they arrive.",
  group: "always-eventually",
  teamQuestion: false,
  rung: "atoms",
  order: 10,
  listed: true,
  builderFit: "fits",
  stresses: ["always", "single atom"],
} satisfies ExampleMeta;
