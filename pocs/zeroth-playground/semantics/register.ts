import { folderOf } from "../examples/catalog";

import type { CompilerOptions, NetItem } from "../compiler";

/**
 * The register of questions about the semantics of the compilation: what a
 * net means once it is modules, and what Zeroth can express. One folder per
 * question, collected here as the example catalog collects the examples. The
 * example pages and compiler/mapping.md reference a question; its text lives
 * here once.
 */

export type TopicId = "steps" | "conflicts" | "places" | "rates" | "colours" | "theories";

export type Topic = {
  id: TopicId;
  /** The topic's heading in the list. */
  title: string;
  /** One line on what its questions are about. */
  about: string;
};

/** The topics, in the order the list shows them. */
export const TOPICS: readonly Topic[] = [
  {
    id: "steps",
    title: "One step",
    about: "What one step of the net means as modules: what a transition sees of the marking, and whether two firings share a step.",
  },
  {
    id: "conflicts",
    title: "Conflicts and choices",
    about: "Who decides a choice the net leaves open: the sweep, a pick, a controller, or a race between clocks.",
  },
  {
    id: "places",
    title: "Places and arcs",
    about: "What a place and its arcs can express: a capacity, a weight above one, a read or inhibitor arc, under coins and under clocks.",
  },
  {
    id: "rates",
    title: "Rates and clocks",
    about: "How a rate becomes a firing: a coin per step, or a clock in continuous time, and what SPN's clocks can take.",
  },
  {
    id: "colours",
    title: "Colours and dynamics",
    about: "Coloured tokens and continuous dynamics: how they split into modules, and what SPN has no sort for.",
  },
  {
    id: "theories",
    title: "Composing theories",
    about: "How modules of two theories meet in one system.",
  },
];

/** Who can settle a question. */
export type Owner = "HASH" | "Zeroth" | "HASH and Zeroth";

/**
 * `open`: nobody has decided. `proposed`: one side proposes an answer, written
 * on the page under "Proposal". `settled`: decided, the decision and its date
 * written under "Decision".
 */
export type Status = "open" | "proposed" | "settled";

/**
 * Where a question shows: an example compiled at the options that bring the
 * behaviour out, and the net item whose lines quote it. Without an item the
 * first lines of the file are quoted.
 */
export type Showing = {
  example: string;
  options?: CompilerOptions;
  item?: NetItem;
};

/** What a question's `meta.ts` declares. */
export type QuestionMeta = {
  title: string;
  topic: TopicId;
  /** Its place in its topic: questions sort by it, lowest first. */
  order: number;
  owner: Owner;
  status: Status;
  shows: readonly Showing[];
};

/** A question as the app reads it: its folder's metadata, and the folder's name as its id. */
export type Question = QuestionMeta & { id: string };

// One folder per question: `meta.ts` and `page.mdx`.
const METAS = import.meta.glob<QuestionMeta>("./*/meta.ts", { eager: true, import: "default" });

const TOPIC_RANK = new Map(TOPICS.map((topic, index) => [topic.id, index]));

/** Every question, by topic in the topics' order, then by `order`. */
export const QUESTIONS: readonly Question[] = Object.entries(METAS)
  .map(([path, meta]): Question => ({ ...meta, id: folderOf(path) }))
  .toSorted(
    (a, b) =>
      (TOPIC_RANK.get(a.topic) ?? 0) - (TOPIC_RANK.get(b.topic) ?? 0) || a.order - b.order,
  );

export function questionById(id: string): Question | undefined {
  return QUESTIONS.find((question) => question.id === id);
}

export function questionsOf(topic: TopicId): Question[] {
  return QUESTIONS.filter((question) => question.topic === topic);
}

export function topicById(id: TopicId): Topic {
  const topic = TOPICS.find((candidate) => candidate.id === id);
  if (topic === undefined) {
    throw new Error(`no topic ${id}`);
  }
  return topic;
}
