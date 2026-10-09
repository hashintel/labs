import type { ExampleMeta } from "../catalog";

export default {
  feature: "Rates as clocks",
  title: "Birth–death",
  summary: "A rate becomes a clock that runs down in continuous time.",
  rung: "clocks",
  order: 60,
  listed: true,
  options: { rates: "clock" },
} satisfies ExampleMeta;
