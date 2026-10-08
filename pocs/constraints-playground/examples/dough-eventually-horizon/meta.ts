import type { ExampleMeta } from "../catalog";

export default {
  feature: "Eventually, cut by the horizon",
  title: "Proofing",
  summary: "The goal comes at step 12, but the run is cut at step 10, so eventually fails.",
  question: "Run cut before the dough is done. Fail?",
  context: "12 balls of dough are proofing. One rises at each step.",
  group: "always-eventually",
  teamQuestion: true,
  rung: "temporal",
  order: 210,
  listed: true,
  builderFit: "fits",
  stresses: ["eventually", "maxSteps", "horizon"],
  expect: { verdict: "violated", decidedAt: "end" },
} satisfies ExampleMeta;
