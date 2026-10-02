import type { ExampleMeta } from "../catalog";

export default {
  feature: "Weighted arcs",
  title: "SIR model",
  summary: "An output arc of weight 2: coins compile it, clocks refuse it.",
  rung: "rates",
  order: 80,
  listed: true,
  options: { shape: "modular" },
} satisfies ExampleMeta;
