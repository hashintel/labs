import { describe, expect, it } from "vitest";

import { parseConstraintDocument, printMath } from "../../constraints";
import { conditionReads, conditionRanges, conditionsOnMetric, resolveLink } from "./condition-links";

import type { AtomExpr } from "../../constraints/walk";

const waiting: AtomExpr = { kind: "atom", ref: { kind: "metric", name: "Waiting" }, op: "<=", value: 5 };

function documentOf(text: string) {
  const parsed = parseConstraintDocument(text, { mtl: false, nested: false });
  if (parsed.doc === undefined) {
    throw new Error("the test file should parse");
  }
  return parsed.doc;
}

describe("conditionReads", () => {
  it("reads the place of a count and the transition of fired", () => {
    // GIVEN a count and a fired condition
    const count: AtomExpr = { kind: "atom", ref: { kind: "count", place: "Queue" }, op: ">", value: 0 };
    const fired: AtomExpr = { kind: "atom", ref: { kind: "fired", transition: "Serve" }, op: ">=", value: 1 };
    // WHEN reading them
    const reads = conditionReads([count, fired], []);
    // THEN the place and the transition come back
    expect(reads).toEqual({ places: ["Queue"], transitions: ["Serve"] });
  });

  it("resolves a metric through its definition, and through metrics it names", () => {
    // GIVEN a metric defined from another metric, a count and a fired
    const doc = documentOf(
      "name: A\nmetrics:\n  Backlog: Waiting + count(Held)\n  Waiting: count(Queue) - fired(Serve)\nconstraint: always (Backlog <= 5)\n",
    );
    const backlog: AtomExpr = { kind: "atom", ref: { kind: "metric", name: "Backlog" }, op: "<=", value: 5 };
    // WHEN reading the condition on Backlog
    const reads = conditionReads([backlog], doc.metrics);
    // THEN it reads every place and transition underneath, once each
    expect(reads.places.toSorted()).toEqual(["Held", "Queue"]);
    expect(reads.transitions).toEqual(["Serve"]);
  });

  it("stops at a metric that names itself and at one with no definition", () => {
    // GIVEN a metric that refers to itself and a name nobody defined
    const doc = documentOf("name: A\nmetrics:\n  Loop: Loop + count(Queue)\nconstraint: always (Loop <= 5)\n");
    const loop: AtomExpr = { kind: "atom", ref: { kind: "metric", name: "Loop" }, op: "<=", value: 5 };
    const unknown: AtomExpr = { kind: "atom", ref: { kind: "metric", name: "Nowhere" }, op: "<=", value: 5 };
    // WHEN reading both
    const reads = conditionReads([loop, unknown], doc.metrics);
    // THEN the self-reference ends and the unknown reads nothing
    expect(reads).toEqual({ places: ["Queue"], transitions: [] });
  });
});

describe("conditionsOnMetric and resolveLink", () => {
  const doc = documentOf(
    "name: A\nmetrics:\n  Waiting: count(Queue)\nconstraint: always (Waiting <= 5 and Waiting >= 1 and Waiting <= 5 and count(Done) > 0)\n",
  );

  it("lists the conditions that compare a metric, once each", () => {
    // GIVEN a constraint that repeats one condition on Waiting
    // WHEN asking for the conditions on Waiting
    const keys = conditionsOnMetric(doc.constraint, "Waiting");
    // THEN both distinct conditions come back once
    expect(keys).toEqual(["Waiting <= 5", "Waiting >= 1"]);
  });

  it("resolves a key to its condition and what it reads", () => {
    // GIVEN the key of the condition on Waiting
    // WHEN resolving it
    const link = resolveLink(doc.constraint, ["Waiting <= 5"], doc.metrics);
    // THEN it holds that one condition and the place under the metric
    expect(link.keys).toEqual(["Waiting <= 5"]);
    expect(link.places).toEqual(["Queue"]);
    expect(link.transitions).toEqual([]);
  });

  it("resolves a key the constraint does not hold to nothing", () => {
    // GIVEN a key of a condition that was edited away
    // WHEN resolving it
    const link = resolveLink(doc.constraint, ["Waiting <= 9"], doc.metrics);
    // THEN nothing is linked
    expect(link.atoms).toEqual([]);
    expect(link.places).toEqual([]);
  });
});

describe("conditionRanges", () => {
  it("finds the condition in the file and gives 1-based columns", () => {
    // GIVEN a file that writes the condition once
    const text = "name: A\nconstraint: always (Waiting <= 5)\n";
    // WHEN looking for it
    const ranges = conditionRanges(text, waiting);
    // THEN the range covers exactly its text
    expect(ranges).toEqual([{ line: 2, start: 21, end: 33 }]);
    expect(text.split("\n")[1]?.slice(20, 32)).toBe("Waiting <= 5");
  });

  it("finds the same condition in the math view, written with a symbol", () => {
    // GIVEN the math text of a constraint
    const doc = documentOf("name: A\nmetrics:\n  Waiting: count(Queue)\nconstraint: always (Waiting <= 5)\n");
    const math = printMath(doc.constraint);
    // WHEN looking for the condition
    const ranges = conditionRanges(math, waiting);
    // THEN it is found under the symbol
    expect(math).toBe("G (Waiting ≤ 5)");
    expect(ranges).toEqual([{ line: 1, start: 4, end: 15 }]);
  });

  it("finds every place the condition appears, on any line, and ignores near misses", () => {
    // GIVEN text with the condition twice, a different bound, and a longer number
    const text = "a: Waiting <= 5\nb: Waiting<=5 and Waiting <= 50\nc: Waiting < 5 or xWaiting <= 5 or Waiting <= 5.5\n";
    // WHEN looking for the condition
    const ranges = conditionRanges(text, waiting);
    // THEN only the two exact ones are found, spacing aside
    expect(ranges.map((range) => range.line)).toEqual([1, 2]);
  });

  it("matches count and fired conditions with free spacing", () => {
    // GIVEN a count and a fired condition
    const count: AtomExpr = { kind: "atom", ref: { kind: "count", place: "Queue" }, op: "==", value: 0 };
    const fired: AtomExpr = { kind: "atom", ref: { kind: "fired", transition: "Serve" }, op: "!=", value: 1 };
    // WHEN looking for them in the file's and the math view's words
    const inFile = conditionRanges("constraint: count( Queue ) == 0 and fired(Serve) != 1", count);
    const inMath = conditionRanges("count(Queue) = 0 ∧ fired(Serve) ≠ 1", fired);
    // THEN each is found
    expect(inFile).toHaveLength(1);
    expect(inMath).toHaveLength(1);
  });
});
