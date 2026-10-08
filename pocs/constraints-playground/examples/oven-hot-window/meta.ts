import type { ExampleMeta } from "../catalog";

export default {
  feature: "Always, between two times",
  title: "Oven that trips",
  summary: "always[10, 20] reads only the states active between time 10 and 20, including one that began before 10.",
  question: "Oven hot from 9.2. Does it count from 10?",
  context: "An oven heats up and trips off at random times. The run stops at time 40.",
  group: "mtl",
  rung: "mtl",
  order: 320,
  mtl: true,
  listed: true,
  builderFit: "fits",
  stresses: ["always", "time window", "MTL", "stochastic", "maxTime"],
  expect: { verdict: "satisfied", decidedAt: 4 },
} satisfies ExampleMeta;
