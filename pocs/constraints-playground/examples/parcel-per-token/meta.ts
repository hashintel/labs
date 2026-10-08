import type { ExampleMeta } from "../catalog";

export default {
  feature: "Every parcel is scanned",
  title: "Parcel depot",
  summary: "A rule about each token; counts agree while one parcel goes in the van unscanned.",
  question: "Totals match, one parcel unscanned. Does the rule catch it?",
  context: "A depot has 2 parcels. One is scanned; the other goes to the van without a scan.",
  group: "always-eventually",
  rung: "limits",
  order: 250,
  listed: true,
  builderFit: "breaks",
  stresses: ["always", "per-token", "quantifier", "colour", "count proxy"],
  expect: { verdict: "satisfied", decidedAt: "end" },
} satisfies ExampleMeta;
