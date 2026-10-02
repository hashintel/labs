import type { ExampleMeta } from "../catalog";

export default {
  feature: "Capacity within a step",
  title: "Capacity",
  summary: "A later producer sees the token an earlier one added.",
  rung: "steps",
  order: 20,
  listed: true,
  options: { shape: "modular" },
} satisfies ExampleMeta;
