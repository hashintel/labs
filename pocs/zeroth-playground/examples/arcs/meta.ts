import type { ExampleMeta } from "../catalog";

export default {
  feature: "Weighted, read and inhibitor arcs",
  title: "Arcs",
  summary: "An arc that takes two tokens, one that reads a place, one that needs it empty.",
  rung: "steps",
  order: 40,
  listed: true,
  options: { shape: "modular" },
} satisfies ExampleMeta;
