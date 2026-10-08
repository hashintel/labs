import { describe, expect, it } from "vitest";

import { EXAMPLES, GROUPS } from "../../examples/catalog";
import { builderWords, filterRows, groupRows, highlight, rowOf, ruleOf, shownExamples, teamQuestionCount } from "./example-list";

import type { Row } from "./example-list";

const rowsOf = (mtl: boolean, nested: boolean): Row[] =>
  shownExamples("sandbox", mtl, nested).map(rowOf);

describe("shownExamples", () => {
  it("starts at the sandbox and leaves out the nested and MTL groups while their flags are off", () => {
    // GIVEN both flags off
    // WHEN the picker's examples are listed
    const shown = shownExamples("sandbox", false, false);
    // THEN the sandbox comes first and no nested or MTL example shows
    expect(shown[0]?.id).toBe("sandbox");
    expect(shown.some((example) => example.group === "nested" || example.group === "mtl")).toBe(false);
  });

  it("adds the nested and MTL groups when their flags are on, in group order", () => {
    // GIVEN both flags on
    // WHEN the picker's examples are listed
    const shown = shownExamples("sandbox", true, true);
    // THEN both groups show, MTL last, and the groups follow the GROUPS order
    expect(shown.some((example) => example.group === "nested")).toBe(true);
    expect(shown.at(-1)?.group).toBe("mtl");
    const order = shown.map((example) => GROUPS.findIndex((group) => group.id === example.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe("ruleOf", () => {
  it("reads every example's constraint in the builder's words", () => {
    // GIVEN every example
    // WHEN each rule is displayed
    const rules = EXAMPLES.map(ruleOf);
    // THEN none is empty and none keeps a raw comparator
    expect(rules.every((rule) => rule !== "" && !/<=|>=|==|!=/u.test(rule))).toBe(true);
  });

  it("writes keywords in capitals and comparators as symbols", () => {
    // GIVEN a canonical rule
    // WHEN it is put in the builder's words
    const words = builderWords("always (count(Up) == 1 and fired(Repair) <= 3)");
    // THEN keywords are capitals, symbols replace comparators, and names stay as they are
    expect(words).toBe("ALWAYS (count(Up) = 1 AND fired(Repair) ≤ 3)");
  });
});

describe("rowOf", () => {
  it("names the sandbox instead of showing its rule", () => {
    // GIVEN the sandbox and an ordinary example
    const sandbox = EXAMPLES.find((example) => example.group === "sandbox");
    const other = EXAMPLES.find((example) => example.group === "until");
    // WHEN their rows are made
    const rows = [sandbox, other].map((example) => (example === undefined ? undefined : rowOf(example)));
    // THEN the sandbox row is named and the other shows its rule and question
    expect(rows[0]).toMatchObject({ rule: "Custom sandbox", named: true });
    expect(rows[1]?.named).toBe(false);
    expect(rows[1]?.question).toBe(other?.question);
  });
});

describe("groupRows", () => {
  it("groups rows in GROUPS order and drops empty groups", () => {
    // GIVEN the rows with both flags off
    const rows = rowsOf(false, false);
    // WHEN they are grouped
    const groups = groupRows(rows);
    // THEN no group is empty, none is nested or MTL, and every row appears once
    expect(groups.every((group) => group.rows.length > 0)).toBe(true);
    expect(groups.some((group) => group.id === "nested" || group.id === "mtl")).toBe(false);
    expect(groups.flatMap((group) => group.rows)).toHaveLength(rows.length);
  });
});

describe("filterRows", () => {
  it("keeps every row for a blank query", () => {
    // GIVEN the rows
    const rows = rowsOf(true, true);
    // WHEN the query is blank
    const found = filterRows(rows, "  ", false);
    // THEN nothing is dropped
    expect(found).toHaveLength(rows.length);
  });

  it("matches the rule, the question and the title, ignoring case", () => {
    // GIVEN the rows and one example with an UNTIL rule
    const rows = rowsOf(true, true);
    const example = rows.find((row) => row.rule.includes("UNTIL"))?.example;
    // WHEN the query is a keyword, the question in capitals, and the title in capitals
    const byRule = filterRows(rows, "until", false);
    const byQuestion = filterRows(rows, (example?.question ?? "").toUpperCase(), false);
    const byTitle = filterRows(rows, (example?.title ?? "").toUpperCase(), false);
    // THEN each finds the example
    expect(byRule.some((row) => row.example.id === example?.id)).toBe(true);
    expect(byQuestion.some((row) => row.example.id === example?.id)).toBe(true);
    expect(byTitle.some((row) => row.example.id === example?.id)).toBe(true);
  });

  it("finds nothing for a query that matches no row, so no group is left", () => {
    // GIVEN the rows
    // WHEN the query matches nothing
    const found = filterRows(rowsOf(true, true), "zzzz-no-such-rule", false);
    // THEN no row is left, so no group is either
    expect(found).toEqual([]);
    expect(groupRows(found)).toEqual([]);
  });

  it("keeps only the team questions when the toggle is on", () => {
    // GIVEN the rows with both flags on
    const rows = rowsOf(true, true);
    // WHEN the toggle is on
    const found = filterRows(rows, "", true);
    // THEN every row left is a team question and the count agrees
    expect(found.every((row) => row.example.teamQuestion)).toBe(true);
    expect(found).toHaveLength(teamQuestionCount(rows.map((row) => row.example)));
  });
});

describe("highlight", () => {
  it("cuts the text around the first match, keeping its own case", () => {
    // GIVEN a rule and a lower-case query
    // WHEN it is highlighted
    const parts = highlight("ALWAYS (Queue ≤ 5)", "queue");
    // THEN the matched part is the original text
    expect(parts).toEqual([
      { text: "ALWAYS (", match: false },
      { text: "Queue", match: true },
      { text: " ≤ 5)", match: false },
    ]);
  });

  it("returns the whole text unmatched for an empty query or no match", () => {
    // GIVEN a text
    // WHEN the query is empty, and when it is absent from the text
    // THEN one unmatched part comes back each time
    expect(highlight("abc", "")).toEqual([{ text: "abc", match: false }]);
    expect(highlight("abc", "z")).toEqual([{ text: "abc", match: false }]);
  });
});
