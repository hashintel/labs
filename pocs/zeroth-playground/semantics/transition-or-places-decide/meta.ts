import type { QuestionMeta } from "../register";

export default {
  title: "The transition decides, or the places decide",
  topic: "rates",
  order: 20,
  owner: "HASH and Zeroth",
  status: "open",
  shows: [
    {
      example: "cafe-queue",
      options: { rates: "clock" },
      item: { kind: "transition", name: "BeginService" },
    },
  ],
} satisfies QuestionMeta;
