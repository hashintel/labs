import type { ExampleMeta } from "../catalog";

export default {
  feature: "A range as two atoms",
  title: "Corner shop shelf",
  summary: "Between 2 and 4 is two atoms joined by and; both ends are inclusive.",
  question: "Shelf between 2 and 4: are 2 and 4 allowed?",
  context: "A corner shop shelf starts with 4 items. Each sale takes one.",
  group: "comparators",
  teamQuestion: false,
  rung: "atoms",
  order: 40,
  listed: true,
  builderFit: "fits",
  stresses: ["always", "range", "and", "inclusive bounds", "bound at s0"],
  expect: { verdict: "violated", decidedAt: 3 },
} satisfies ExampleMeta;
