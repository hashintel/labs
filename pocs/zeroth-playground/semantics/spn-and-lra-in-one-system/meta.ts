import type { QuestionMeta } from "../register";

export default {
  title: "SPN and LRA modules in one system",
  topic: "theories",
  order: 10,
  owner: "Zeroth",
  status: "open",
  shows: [
    { example: "cafe-queue", options: { rates: "clock" }, item: { kind: "net", name: "cafe_queue" } },
    {
      example: "birth-death",
      options: { shape: "modular", marking: "int", dt: 0.5 },
      item: { kind: "transition", name: "Birth" },
    },
  ],
} satisfies QuestionMeta;
