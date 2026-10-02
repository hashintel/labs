import type { QuestionMeta } from "../register";

export default {
  title: "Read and inhibitor arcs in the modular shape",
  topic: "places",
  order: 30,
  owner: "HASH",
  status: "settled",
  shows: [
    { example: "arcs", options: { shape: "modular" }, item: { kind: "transition", name: "Join" } },
  ],
} satisfies QuestionMeta;
