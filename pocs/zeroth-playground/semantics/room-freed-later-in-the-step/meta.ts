import type { QuestionMeta } from "../register";

export default {
  title: "Room freed later in the step",
  topic: "steps",
  order: 10,
  owner: "HASH",
  status: "open",
  shows: [
    { example: "capacity", options: { shape: "modular" }, item: { kind: "transition", name: "PutRight" } },
  ],
} satisfies QuestionMeta;
