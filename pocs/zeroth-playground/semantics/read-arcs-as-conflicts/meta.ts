import type { QuestionMeta } from "../register";

export default {
  title: "Read and inhibitor arcs as conflicts",
  topic: "conflicts",
  order: 20,
  owner: "HASH",
  status: "open",
  shows: [
    { example: "arcs", options: { shape: "modular" }, item: { kind: "transition", name: "Join" } },
    {
      example: "conflict",
      options: { shape: "modular", conflicts: "nondet" },
      item: { kind: "transition", name: "TakeRight" },
    },
  ],
} satisfies QuestionMeta;
