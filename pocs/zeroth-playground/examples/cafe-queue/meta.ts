import type { ExampleMeta } from "../catalog";

export default {
  feature: "Two inputs, one firing",
  title: "Café queue",
  summary: "A transition that takes from two places at once.",
  rung: "rates",
  order: 70,
  listed: true,
  options: { shape: "modular" },
} satisfies ExampleMeta;
