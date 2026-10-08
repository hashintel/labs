import type { ExampleMeta } from "../catalog";

export default {
  feature: "A tautology",
  title: "Waiting room",
  summary: "A range written with or instead of and is true of every count.",
  question: "OR typed instead of AND. Can the rule still fail?",
  context: "A waiting room starts empty. People arrive one by one until it holds 6.",
  group: "and-or",
  rung: "logic",
  order: 130,
  listed: true,
  builderFit: "fits",
  stresses: ["always", "tautology", "or for and", "range"],
  expect: { verdict: "satisfied", decidedAt: "end" },
} satisfies ExampleMeta;
