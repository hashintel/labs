import type { ExampleMeta } from "../catalog";

export default {
  feature: "Conflicts under clocks",
  title: "Conflict with rates",
  summary: "A conflict as a race between clocks, with picks read at expiry.",
  rung: "clocks",
  order: 80,
  listed: true,
  options: { rates: "clock", conflicts: "nondet" },
} satisfies ExampleMeta;
