import type { ExampleMeta } from "../catalog";

export default {
  feature: "Not over a group",
  title: "Counter queue",
  summary: "NOT (A OR B) is (NOT A) AND (NOT B); flipping the comparators but keeping or gives the opposite verdict.",
  question: "NOT (long queue OR no staff): same as flipping each part?",
  context: "A counter has 2 staff. Customers arrive one by one until 6 are waiting.",
  group: "if-iff-not",
  rung: "logic",
  order: 110,
  listed: true,
  builderFit: "partly",
  stresses: ["always", "not", "De Morgan", "comparator flip", "capacity"],
  expect: { verdict: "violated", decidedAt: 5 },
} satisfies ExampleMeta;
