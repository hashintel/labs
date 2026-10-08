import type { ExampleMeta } from "../catalog";

export default {
  feature: "Math notation",
  title: "Press with timed repairs",
  summary: "The constraint is written as G, F[0,5] and the math symbols; the playground reads it as function style.",
  question: "Can the rule be written as G and F?",
  context: "A press breaks down and is repaired at random times, measured in hours.",
  group: "mtl",
  teamQuestion: true,
  rung: "mtl",
  order: 330,
  mtl: true,
  nested: true,
  listed: true,
  builderFit: "fits",
  stresses: ["math notation", "aliases", "always", "eventually", "nesting", "time window", "stochastic"],
  expect: { verdict: "violated", decidedAt: 6 },
} satisfies ExampleMeta;
