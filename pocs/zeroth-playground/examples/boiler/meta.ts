import type { ExampleMeta } from "../catalog";

export default {
  feature: "Continuous dynamics",
  title: "Boiler",
  summary: "An Euler step per token, and a read arc.",
  rung: "colours",
  order: 100,
  listed: false,
  options: { dt: 0.25 },
} satisfies ExampleMeta;
