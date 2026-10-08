import type { ExampleMeta } from "../catalog";

export default {
  feature: "If, then, else",
  title: "Dough mixer",
  summary: "A stricter limit while the mixer is up fails right after the repair.",
  question: "Queue limit tightens after repair. Does it break?",
  context: "A dough mixer has 1 order waiting. It breaks, 2 more orders arrive, then it is repaired and works through the queue.",
  group: "if-iff-not",
  rung: "logic",
  order: 100,
  listed: true,
  builderFit: "partly",
  stresses: ["always", "if-then-else", "branch switch", "read arcs"],
  expect: { verdict: "violated", decidedAt: 2 },
} satisfies ExampleMeta;
