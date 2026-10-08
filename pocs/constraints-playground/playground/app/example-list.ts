import { EXAMPLES, GROUPS } from "../../examples/catalog";
import { parseConstraintDocument, printConstraint } from "../../constraints";

import type { Example, Group } from "../../examples/catalog";

/** A picker row: an example with the rule it shows. */
export type Row = {
  example: Example;
  /** The rule in the builder's words: caps keywords and comparator symbols. */
  rule: string;
  /** The question under the rule. */
  question: string;
  /** Set for the sandbox, whose line 1 is a name in the UI font, not a rule. */
  named: boolean;
};

/** A group heading and the rows under it. */
export type RowGroup = {
  id: Group["id"];
  title: string;
  rows: Row[];
};

/** A run of a text, and whether it is the part a search matched. */
export type Part = { text: string; match: boolean };

const SYMBOLS: Readonly<Record<string, string>> = { "<=": "≤", ">=": "≥", "==": "=", "!=": "≠" };

/** Canonical text in the builder's vocabulary: `always (Waiting <= 5)` reads `ALWAYS (Waiting ≤ 5)`. */
export function builderWords(canonical: string): string {
  return canonical
    .replace(/<=|>=|==|!=/gu, (symbol) => SYMBOLS[symbol] ?? symbol)
    .replace(/\b(?:weak until|until|always|eventually|implies|iff|and|or|not|if|then|else)\b/gu, (word) =>
      word.toUpperCase(),
    );
}

/** The sandbox shows a name and a line about it in place of a rule and its question. */
export const SANDBOX_NAME = "Custom sandbox";
const SANDBOX_QUESTION = "Build your own rule on a factory net.";

/** A picker row for the example. */
export function rowOf(example: Example): Row {
  return example.group === "sandbox"
    ? { example, rule: SANDBOX_NAME, question: SANDBOX_QUESTION, named: true }
    : { example, rule: ruleOf(example), question: example.question, named: false };
}

/** The example's constraint, parsed with every flag on and printed in the builder's words; empty when the file does not parse. */
export function ruleOf(example: Example): string {
  const parsed = parseConstraintDocument(example.constraint, { mtl: true, nested: true });
  return parsed.doc === undefined ? "" : builderWords(printConstraint(parsed.doc.constraint));
}

/**
 * The examples the picker shows, group by group in picker order: the listed
 * ones and the open one, minus the groups whose flag is off.
 */
export function shownExamples(exampleId: string, mtl: boolean, nested: boolean): Example[] {
  return GROUPS.flatMap((group) =>
    EXAMPLES.filter(
      (example) =>
        example.group === group.id &&
        (example.listed || example.id === exampleId) &&
        (mtl || example.group !== "mtl") &&
        (nested || example.group !== "nested"),
    ),
  );
}

/** The footer's story: the example's context, else its summary while no context field exists. */
export function contextOf(example: Example): string {
  return (example as { context?: string }).context ?? example.summary;
}

/** How many of the examples ask the team a question. */
export function teamQuestionCount(examples: readonly Example[]): number {
  return examples.filter((example) => example.teamQuestion).length;
}

/** The rows grouped in picker order: a group with no rows is left out. */
export function groupRows(rows: readonly Row[]): RowGroup[] {
  return GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    rows: rows.filter((row) => row.example.group === group.id),
  })).filter((group) => group.rows.length > 0);
}

/**
 * The rows a search and the team toggle leave. A row matches when its rule,
 * its question or its title holds the query, ignoring case; an empty query
 * matches every row. The toggle keeps only the examples with a team question.
 */
export function filterRows(rows: readonly Row[], query: string, teamOnly: boolean): Row[] {
  const needle = query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (!teamOnly || row.example.teamQuestion) &&
      (needle === "" ||
        [row.rule, row.question, row.example.title].some((text) => text.toLowerCase().includes(needle))),
  );
}

/** The text cut around the first match of the query, ignoring case; one unmatched part when nothing matches. */
export function highlight(text: string, query: string): Part[] {
  const needle = query.trim().toLowerCase();
  const at = needle === "" ? -1 : text.toLowerCase().indexOf(needle);
  if (at === -1) {
    return [{ text, match: false }];
  }
  const end = at + needle.length;
  return [
    { text: text.slice(0, at), match: false },
    { text: text.slice(at, end), match: true },
    { text: text.slice(end), match: false },
  ].filter((part) => part.text !== "");
}
