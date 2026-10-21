import { folderOf } from "../examples/catalog";

export type Status = "open" | "proposed" | "settled";
export type QuestionMeta = { title: string; order: number; status: Status };
export type Question = QuestionMeta & { id: string };

const METAS = import.meta.glob<QuestionMeta>("./*/meta.ts", { eager: true, import: "default" });

export const QUESTIONS: readonly Question[] = Object.entries(METAS)
  .map(([path, meta]) => ({ ...meta, id: folderOf(path) }))
  .toSorted((a, b) => a.order - b.order);

export function questionById(id: string): Question | undefined {
  return QUESTIONS.find((question) => question.id === id);
}
