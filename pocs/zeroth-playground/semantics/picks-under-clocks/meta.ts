import type { QuestionMeta } from "../register";

export default {
  title: "Picks and choices under clocks",
  topic: "conflicts",
  order: 50,
  owner: "Zeroth",
  status: "open",
  shows: [
    {
      example: "conflict-clocked",
      options: { rates: "clock", conflicts: "nondet" },
      item: { kind: "transition", name: "TakeRight" },
    },
  ],
} satisfies QuestionMeta;
