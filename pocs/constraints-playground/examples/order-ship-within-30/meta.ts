import type { ExampleMeta } from "../catalog";

export default {
  feature: "Within 30 days, as a window",
  title: "Three orders to ship",
  summary: "eventually[0, 30] fails where plain eventually passes: the second order ships on day 34.7.",
  question: "Two orders within 30 days: from when?",
  context: "Three orders ship one by one, each after a random number of days.",
  group: "mtl",
  rung: "mtl",
  order: 310,
  mtl: true,
  listed: true,
  builderFit: "fits",
  stresses: ["eventually", "time window", "MTL", "stochastic"],
  expect: { verdict: "violated", decidedAt: 2 },
} satisfies ExampleMeta;
