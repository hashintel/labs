import type { ExampleMeta } from "../catalog";

export default {
  feature: "Sandbox",
  title: "Factory",
  summary: "Build any rule on one factory net.",
  question: "What rule do you want to test?",
  context: "A small factory: orders arrive, a machine processes them, it breaks and gets repaired, stock gets restocked.",
  group: "sandbox",
  rung: "sandbox",
  order: 0,
  listed: true,
  builderFit: "fits",
  stresses: ["blank rule"],
} satisfies ExampleMeta;
