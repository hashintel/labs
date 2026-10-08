import type { ExampleMeta } from "../catalog";

export default {
  feature: "Until, the hold drops first",
  title: "Pump and mechanic",
  summary: "The pump goes down at step 3, before its first service at step 5; the late service changes nothing.",
  question: "Service comes after the pump breaks. Pass?",
  context: "A pump works through 2 units of fuel, then breaks. A mechanic comes and services it.",
  group: "until",
  teamQuestion: true,
  rung: "temporal",
  order: 180,
  listed: true,
  builderFit: "fits",
  stresses: ["until", "decided mid-run", "goal too late", "inhibitor arcs"],
  expect: { verdict: "violated", decidedAt: 3 },
} satisfies ExampleMeta;
