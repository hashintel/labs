import type { ExampleMeta } from "../catalog";

export default {
  feature: "Until, a goal after a hold",
  title: "Machine and stock",
  summary: "count(Stock) > 0 UNTIL the first restock.",
  question: "Does stock last until the first restock?",
  context: "A machine uses items from a stock of 2. Restocks arrive at random, more slowly than it uses them.",
  group: "until",
  teamQuestion: false,
  rung: "temporal",
  order: 140,
  listed: true,
  builderFit: "fits",
  stresses: ["until", "fired"],
} satisfies ExampleMeta;
