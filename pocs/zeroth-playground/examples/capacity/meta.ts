import type { ExampleMeta } from "../catalog";

export default {
  feature: "A capped place",
  title: "Capacity",
  summary: "A later producer counts the token an earlier one adds in the same step.",
  rung: "steps",
  order: 30,
  listed: true,
  options: { shape: "modular" },
} satisfies ExampleMeta;
