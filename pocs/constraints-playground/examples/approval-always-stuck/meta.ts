import type { ExampleMeta } from "../catalog";

export default {
  feature: "Always on a stuck run",
  title: "Stuck approval",
  summary: "A run that deadlocks at step 1 passes any always it has not yet broken.",
  question: "Run gets stuck at once. Does ALWAYS pass?",
  context: "A request is triaged, then waits for a signer or a timer. Neither ever comes.",
  group: "always-eventually",
  teamQuestion: true,
  rung: "temporal",
  order: 160,
  listed: true,
  builderFit: "fits",
  stresses: ["always", "deadlock end", "short run"],
  expect: { verdict: "satisfied", decidedAt: "end" },
} satisfies ExampleMeta;
