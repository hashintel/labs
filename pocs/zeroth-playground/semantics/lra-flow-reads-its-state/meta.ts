import type { QuestionMeta } from "../register";

export default {
  title: "An LRA flow that reads its own state",
  topic: "colours",
  order: 40,
  owner: "Zeroth",
  status: "open",
  shows: [
    {
      example: "birth-death-clocked",
      options: { rates: "clock" },
      item: { kind: "transition", name: "Birth" },
    },
  ],
} satisfies QuestionMeta;
