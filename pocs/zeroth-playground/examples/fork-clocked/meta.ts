import type { ExampleMeta } from "../catalog";

export default {
  feature: "Conflicts under clocks",
  title: "Fork under clocks",
  summary: "A conflict as a race between clocks, with picks read at expiry.",
  rung: "rates",
  order: 90,
  listed: true,
  options: { rates: "clock", conflicts: "nondet" },
} satisfies ExampleMeta;
