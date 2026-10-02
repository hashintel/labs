import type { ExampleMeta } from "../catalog";

export default {
  feature: "Who gets the token",
  title: "Conflict",
  summary: "Record order settles a shared input place, or a pick per contender leaves it open.",
  rung: "steps",
  order: 20,
  listed: true,
  options: { shape: "modular", conflicts: "nondet" },
} satisfies ExampleMeta;
