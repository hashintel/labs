import type { ExampleMeta } from "../catalog";

export default {
  feature: "Eventually, failed by a deadlock",
  title: "Stuck approval",
  summary: "Eventually never decides mid-run; a deadlock at step 1 ends the run and fails it.",
  question: "Run stops before approval. Fail?",
  context: "A request is triaged, then waits for a signer or a timer. Neither ever comes.",
  group: "always-eventually",
  rung: "temporal",
  order: 150,
  listed: true,
  builderFit: "fits",
  stresses: ["eventually", "violated only at end", "deadlock end"],
  expect: { verdict: "violated", decidedAt: "end" },
} satisfies ExampleMeta;
