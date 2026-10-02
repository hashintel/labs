import type { ExampleMeta } from "../catalog";

export default {
  feature: "Rates as coins",
  title: "Birth–death",
  summary: "A rate becomes a draw tested against a threshold each step.",
  rung: "rates",
  order: 50,
  listed: true,
  options: { shape: "modular", dt: 0.5 },
} satisfies ExampleMeta;
