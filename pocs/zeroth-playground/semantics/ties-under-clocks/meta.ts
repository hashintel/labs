import type { QuestionMeta } from "../register";

export default {
  title: "Ties under clocks",
  topic: "conflicts",
  order: 40,
  owner: "HASH and Zeroth",
  status: "open",
  shows: [
    {
      example: "conflict-clocked",
      options: { rates: "clock", conflicts: "nondet" },
      item: { kind: "place", name: "Pool" },
    },
  ],
} satisfies QuestionMeta;
