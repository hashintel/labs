import type { ExampleMeta } from "../catalog";

export default {
  feature: "A metric that divides by zero",
  title: "Small cafe",
  summary: "The share of customers served is 0 over 0 at step 0, so the atom is false there and the run reports one error.",
  question: "Share needs a division. Define the metric first?",
  context: "A cafe has one seat and three customers. The first is served; the next two are turned away.",
  group: "comparators",
  rung: "limits",
  order: 270,
  listed: true,
  builderFit: "partly",
  stresses: ["always", "metric", "division by zero", "decimal value", "provisional verdict"],
  expect: { verdict: "violated", decidedAt: 0 },
  expectsDiagnostic: "Division by zero in ServedShare, first at step 0",
} satisfies ExampleMeta;
