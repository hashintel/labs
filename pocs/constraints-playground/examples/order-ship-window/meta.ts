import type { ExampleMeta } from "../catalog";

export default {
  feature: "Within 30 days",
  title: "One order to ship",
  summary: "The base has no time windows; maxTime fakes one window from time 0, for the whole run.",
  question: "Can the run's end at day 30 be a deadline?",
  context: "One order waits to ship after a random number of days. The run stops at day 30.",
  group: "mtl",
  rung: "limits",
  order: 240,
  listed: true,
  builderFit: "breaks",
  stresses: ["eventually", "time window", "MTL", "maxTime", "seed-dependent"],
} satisfies ExampleMeta;
