import { describe, expect, it } from "vitest";

import { EXAMPLES, GROUPS } from "../../examples/catalog";
import { PRESSING } from "../../examples/pressing";
import { PRESSING_IDS, builderWords, collapseRows, filterRows, groupRows, highlight, rowOf, ruleOf, shownExamples } from "./example-list";

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
    const found = filterRows(rows, "  ");
    // THEN nothing is dropped
    expect(found).toHaveLength(rows.length);
  });

  it("matches the rule, the question and the title, ignoring case", () => {
    // GIVEN the rows and one example with an UNTIL rule
    const rows = rowsOf(true, true);
    const example = rows.find((row) => row.rule.includes("UNTIL"))?.example;
    // WHEN the query is a keyword, the question in capitals, and the title in capitals
    const byRule = filterRows(rows, "until");
    const byQuestion = filterRows(rows, (example?.question ?? "").toUpperCase());
    const byTitle = filterRows(rows, (example?.title ?? "").toUpperCase());
    // THEN each finds the example
    expect(byRule.some((row) => row.example.id === example?.id)).toBe(true);
    expect(byQuestion.some((row) => row.example.id === example?.id)).toBe(true);
    expect(byTitle.some((row) => row.example.id === example?.id)).toBe(true);
  });

  it("finds nothing for a query that matches no row, so no group is left", () => {
    // GIVEN the rows
    // WHEN the query matches nothing
    const found = filterRows(rowsOf(true, true), "zzzz-no-such-rule");
    // THEN no row is left, so no group is either
    expect(found).toEqual([]);
    expect(groupRows(found)).toEqual([]);
  });
});

describe("collapseRows", () => {
  const idsOf = (groups: { rows: Row[] }[]) => groups.flatMap((group) => group.rows.map((row) => row.example.id));
  const collapsedFor = (mtl: boolean, nested: boolean) =>
    collapseRows(groupRows(rowsOf(mtl, nested)), PRESSING_IDS);
  /** The ids in the full list's order, so a test checks the normal order too. */
  const inOrder = (mtl: boolean, nested: boolean, wanted: string[]) =>
    idsOf(groupRows(rowsOf(mtl, nested))).filter((id) => id === "sandbox" || wanted.includes(id));

  it("shows the sandbox and exactly the 4 pressing ids, in the normal order, in every flag state", () => {
    // GIVEN each flag state
    for (const [mtl, nested] of [[false, false], [false, true], [true, false], [true, true]] as const) {
      // WHEN the list is collapsed
      const collapsed = collapsedFor(mtl, nested);
      // THEN the sandbox comes first, then the 4 ids in the full list's order, with no empty group
      expect(idsOf(collapsed)).toEqual(inOrder(mtl, nested, [...PRESSING]));
      expect(idsOf(collapsed)[0]).toBe("sandbox");
      expect(idsOf(collapsed)).toHaveLength(5);
      expect(collapsed.every((group) => group.rows.length > 0)).toBe(true);
    }
  });

  it("is not applied to the expanded list, which keeps every group and row", () => {
    // GIVEN the grouped rows with both flags on
    const groups = groupRows(rowsOf(true, true));
    // WHEN the list is expanded, as the picker does by skipping the collapse
    // THEN it holds every row, more than the collapsed list
    expect(idsOf(groups)).toHaveLength(rowsOf(true, true).length);
    expect(idsOf(groups).length).toBeGreaterThan(idsOf(collapsedFor(true, true)).length);
  });

  it("is not applied to search results, which keep every match", () => {
    // GIVEN the rows with both flags on and a query that matches rows the collapsed list hides
    const rows = rowsOf(true, true);
    // WHEN they are searched and grouped, as the picker does while the box has text
    const found = groupRows(filterRows(rows, "always"));
    // THEN every match is there, including hidden ones
    expect(idsOf(found)).toEqual(filterRows(rows, "always").map((row) => row.example.id));
    expect(idsOf(found).some((id) => id !== "sandbox" && !PRESSING_IDS.has(id))).toBe(true);
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
