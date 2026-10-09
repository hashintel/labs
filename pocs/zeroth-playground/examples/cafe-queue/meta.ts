import type { ExampleMeta } from "../catalog";

export default {
  feature: "Two inputs under clocks",
  title: "Café queue",
  summary: "A clock that runs only while both input places hold a token.",
  rung: "clocks",
  order: 70,
  listed: true,
  options: { rates: "clock" },
} satisfies ExampleMeta;
