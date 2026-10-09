import type { QuestionMeta } from "../register";

export default {
  title: "Capacity under clocks",
  topic: "places",
  order: 10,
  owner: "Zeroth",
  status: "open",
  shows: [
    { example: "capacity", options: { shape: "modular" }, item: { kind: "place", name: "Buffer" } },
  ],
} satisfies QuestionMeta;
