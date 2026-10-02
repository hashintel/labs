import type { QuestionMeta } from "../register";

export default {
  title: "A false pick under clocks",
  topic: "conflicts",
  order: 30,
  owner: "HASH",
  status: "open",
  shows: [
    {
      example: "conflict-clocked",
      options: { rates: "clock", conflicts: "nondet" },
      item: { kind: "transition", name: "TakeLeft" },
    },
  ],
} satisfies QuestionMeta;
