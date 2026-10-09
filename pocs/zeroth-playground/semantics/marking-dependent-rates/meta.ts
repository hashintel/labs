import type { QuestionMeta } from "../register";

export default {
  title: "Marking-dependent rates under clocks",
  topic: "rates",
  order: 10,
  owner: "Zeroth",
  status: "open",
  shows: [
    {
      example: "birth-death-clocked",
      options: { rates: "clock" },
      item: { kind: "transition", name: "Death" },
    },
  ],
} satisfies QuestionMeta;
