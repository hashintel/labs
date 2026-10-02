import type { QuestionMeta } from "../register";

export default {
  title: "One mechanism for external choices",
  topic: "conflicts",
  order: 10,
  owner: "HASH",
  status: "open",
  shows: [
    {
      example: "conflict",
      options: { shape: "modular", conflicts: "nondet", control: "open" },
      item: { kind: "transition", name: "TakeLeft" },
    },
  ],
} satisfies QuestionMeta;
