import type { QuestionMeta } from "../register";

export default {
  title: "Ties under coins",
  topic: "steps",
  order: 20,
  owner: "HASH and Zeroth",
  status: "open",
  shows: [
    {
      example: "birth-death",
      options: { shape: "modular", dt: 0.5 },
      item: { kind: "place", name: "Population" },
    },
    {
      example: "birth-death-clocked",
      options: { rates: "clock" },
      item: { kind: "place", name: "Population" },
    },
  ],
} satisfies QuestionMeta;
