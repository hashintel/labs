import { describe, expect, it } from "vitest";

import { parsePetriNetIr } from "../compiler/ir/parse";
import { checkReferences, parseConstraintDocument } from "./document";
import { FORALL_ERROR, WINDOW_NEEDS_MTL_ERROR } from "./constraint-parser";

import type { PetriNetIr } from "../compiler/ir/schema";

const GOOD = `name: Queue stays short
metrics:
  Waiting: count(Queue)
  Load: count(Queue) + count(InService)
constraint: always (Waiting <= 5)
run:
  seed: 7
  maxSteps: 50
  maxTime: 12.5
`;

const NET = (() => {
  const outcome = parsePetriNetIr(`
name: Cafe
kind: plain
places:
  Queue: null
  InService: null
transitions:
  Arrive:
    outputs:
      Queue: null
  BeginService:
    inputs:
      Queue: null
    outputs:
      InService: null
`);
  if (!outcome.ok) {
    throw new Error("bad test net");
  }
  return outcome.ir satisfies PetriNetIr;
})();

describe("parseConstraintDocument", () => {
  it("reads a full document", () => {
    // GIVEN a complete constraint.yaml
    // WHEN it is parsed
    const { doc, diagnostics, lines } = parseConstraintDocument(GOOD);

    // THEN the document has metrics in order, the constraint and the run settings
    expect(diagnostics).toEqual([]);
    expect(doc?.name).toBe("Queue stays short");
    expect(doc?.metrics.map((metric) => metric.name)).toEqual(["Waiting", "Load"]);
    expect(doc?.constraint).toMatchObject({ op: "always" });
    expect(doc?.run).toEqual({ seed: 7, maxSteps: 50, maxTime: 12.5 });
    expect(lines.metric).toEqual({ Waiting: 3, Load: 4 });
    expect(lines.constraint).toBe(5);
  });

  it("defaults the run to seed 1 and 200 steps", () => {
    // GIVEN a document with no run section
    const { doc } = parseConstraintDocument("name: X\nconstraint: eventually count(A) > 0\n");

    // WHEN it is parsed
    // THEN the defaults apply and maxTime is absent
    expect(doc?.run).toEqual({ seed: 1, maxSteps: 200 });
    expect(doc?.metrics).toEqual([]);
  });

  it("puts the line and column of an expression error in the diagnostic", () => {
    // GIVEN a constraint with a quantifier on line 3
    const text = "name: X\nmetrics: {}\nconstraint: forall Waiting <= 5\n";

    // WHEN it is parsed
    const { doc, diagnostics } = parseConstraintDocument(text);

    // THEN there is no document and the error points at the value
    expect(doc).toBeUndefined();
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: FORALL_ERROR,
        line: 3,
        column: 13,
        item: "constraint",
      },
    ]);
  });

  it("puts the line of a bad metric in the diagnostic", () => {
    // GIVEN a metric with an unclosed bracket on line 4
    const text = "name: X\nmetrics:\n  Good: 1\n  Bad: (count(A) + 1\nconstraint: always Good > 0\n";

    // WHEN it is parsed
    const { diagnostics } = parseConstraintDocument(text);

    // THEN the error is on line 4, at its column in the file
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: 'Expected ")" but found the end of the text',
        line: 4,
        column: 21,
        item: "metric Bad",
      },
    ]);
  });

  it("keeps a warning from the constraint parser with a line", () => {
    // GIVEN a mixed and/or constraint on line 2
    const text = "name: X\nconstraint: always A > 0 or B > 0 and C > 0\n";

    // WHEN it is parsed
    const { doc, diagnostics } = parseConstraintDocument(text);

    // THEN the document is kept and the warning has a line
    expect(doc).toBeDefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: "warning", line: 2 });
  });

  it("reports a YAML syntax error with its line", () => {
    // GIVEN broken YAML
    const { diagnostics, doc } = parseConstraintDocument("name: X\nconstraint: [always\n");

    // WHEN it is parsed
    // THEN one error with a line
    expect(doc).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.line).toBeGreaterThan(0);
  });

  it("reports a missing constraint and unknown keys", () => {
    // GIVEN a document with a misspelt key and no constraint
    const { diagnostics } = parseConstraintDocument("name: X\nconstraints: always A > 0\n");

    // WHEN it is parsed
    const messages = diagnostics.map((diagnostic) => diagnostic.message);

    // THEN both are reported
    expect(messages).toContain('Unknown key "constraints". Use name, metrics, constraint or run');
    expect(messages.some((message) => message.startsWith("Add a constraint"))).toBe(true);
  });

  it("reports bad run settings", () => {
    // GIVEN a fractional seed and a negative maxTime
    const text = "name: X\nconstraint: always A > 0\nrun:\n  seed: 1.5\n  maxTime: -1\n";

    // WHEN it is parsed
    const { diagnostics } = parseConstraintDocument(text);

    // THEN both are errors on the run line
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "seed is a whole number",
      "maxTime is a number above 0",
    ]);
    expect(diagnostics.every((diagnostic) => diagnostic.line === 3)).toBe(true);
  });

  it("rejects a lowercase metric name", () => {
    // GIVEN a metric called waiting
    const { diagnostics } = parseConstraintDocument(
      "name: X\nmetrics:\n  waiting: count(A)\nconstraint: always A > 0\n",
    );

    // WHEN it is parsed
    // THEN the error is on line 3
    expect(diagnostics[0]).toMatchObject({ line: 3 });
    expect(diagnostics[0]?.message).toContain("capital letter");
  });
});

describe("checkReferences", () => {
  function check(text: string) {
    const { doc, lines } = parseConstraintDocument(text);
    if (!doc) {
      throw new Error("document did not parse");
    }
    return checkReferences(doc, NET, lines);
  }

  it("accepts a document that names real places, transitions and metrics", () => {
    // GIVEN a document that uses its metrics and names real parts
    // WHEN it is checked
    const diagnostics = check(
      "name: X\nmetrics:\n  Waiting: count(Queue)\n  Served: fired(BeginService)\nconstraint: always Waiting <= 5 and Served >= 0\n",
    );

    // THEN there are no diagnostics
    expect(diagnostics).toEqual([]);
  });

  it("reports an unknown place, transition and metric on the right side as it does on the left", () => {
    // GIVEN comparisons whose right sides name a missing place, transition and metric
    const rule = (text: string) => check(["name: X", `constraint: always ${text}`, ""].join("\n"));
    const place = rule("count(Queue) >= count(Nowhere)");
    const transition = rule("count(Queue) >= fired(Nowhere)");
    const metric = rule("count(Queue) >= Nowhere");
    const left = rule("count(Nowhere) >= 0");

    // WHEN they are checked
    // THEN each gets one error naming the missing part, and the place one matches the left side's
    expect(place.map((diagnostic) => diagnostic.message)).toEqual(left.map((diagnostic) => diagnostic.message));
    expect(transition.map((diagnostic) => diagnostic.message)).toEqual([expect.stringContaining("Nowhere")]);
    expect(metric.map((diagnostic) => diagnostic.message)).toEqual([expect.stringContaining("Nowhere")]);
  });

  it("reports an unknown place in a metric, with the metric's line", () => {
    // GIVEN a metric that counts a place the net lacks
    const diagnostics = check(
      "name: X\nmetrics:\n  Waiting: count(Line)\nconstraint: always Waiting <= 5\n",
    );

    // WHEN it is checked
    // THEN one error on line 3
    expect(diagnostics).toEqual([
      {
        severity: "error",
        message: "Unknown place Line in count(Line)",
        item: "metric Waiting",
        line: 3,
      },
    ]);
  });

  it("reports an unknown place and transition in the constraint", () => {
    // GIVEN atoms on a missing place and a missing transition
    const diagnostics = check(
      "name: X\nconstraint: always count(Nowhere) > 0 and fired(Nothing) > 0\n",
    );

    // WHEN it is checked
    // THEN both are errors on the constraint line
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "Unknown place Nowhere in count(Nowhere)",
      "Unknown transition Nothing in fired(Nothing)",
    ]);
    expect(diagnostics.every((diagnostic) => diagnostic.line === 2)).toBe(true);
  });

  it("reports an unknown metric", () => {
    // GIVEN an atom on a metric nobody defined
    const diagnostics = check("name: X\nconstraint: always Ghost > 0\n");

    // WHEN it is checked
    // THEN it is an error
    expect(diagnostics).toEqual([
      { severity: "error", message: "Unknown metric Ghost", item: "constraint", line: 2 },
    ]);
  });

  it("reports a metric cycle", () => {
    // GIVEN two metrics that depend on each other
    const diagnostics = check(
      "name: X\nmetrics:\n  One: Two + 1\n  Two: One + 1\nconstraint: always One > 0\n",
    );

    // WHEN it is checked
    const cycle = diagnostics.filter((diagnostic) => diagnostic.message.startsWith("Metrics depend"));

    // THEN there is one cycle error naming the path
    expect(cycle).toHaveLength(1);
    expect(cycle[0]?.message).toBe("Metrics depend on each other: One -> Two -> One");
  });

  it("reports a metric that refers to itself", () => {
    // GIVEN a self-reference
    const diagnostics = check("name: X\nmetrics:\n  Loop: Loop + 1\nconstraint: always Loop > 0\n");

    // WHEN it is checked
    // THEN the cycle is Loop -> Loop
    expect(diagnostics[0]?.message).toBe("Metrics depend on each other: Loop -> Loop");
  });

  it("warns about a metric that is defined but not used", () => {
    // GIVEN a metric the constraint never reaches, and one it reaches through another
    const diagnostics = check(
      "name: X\nmetrics:\n  Used: Inner + 1\n  Inner: count(Queue)\n  Spare: count(InService)\nconstraint: always Used > 0\n",
    );

    // WHEN it is checked
    // THEN only Spare gets a warning, on its line
    expect(diagnostics).toEqual([
      {
        severity: "warning",
        message: "Metric Spare is defined but not used",
        item: "metric Spare",
        line: 5,
      },
    ]);
  });
});

describe("parseConstraintDocument: the MTL flag", () => {
  const WINDOWED = "name: Window\nconstraint: eventually[0, 30](count(Queue) >= 1)\n";

  it("puts the window error on the constraint line with MTL off, and reads it with MTL on", () => {
    // GIVEN a file whose constraint has a time window
    // WHEN it is parsed with the flag off, by default, and on
    const off = parseConstraintDocument(WINDOWED, { mtl: false });
    const byDefault = parseConstraintDocument(WINDOWED);
    const on = parseConstraintDocument(WINDOWED, { mtl: true });

    // THEN off and default give the error at line 2 and no doc; on gives the doc
    const error = { severity: "error", message: WINDOW_NEEDS_MTL_ERROR, line: 2, column: 23, item: "constraint" };
    expect(off.doc).toBeUndefined();
    expect(off.diagnostics).toEqual([error]);
    expect(byDefault.diagnostics).toEqual([error]);
    expect(on.diagnostics).toEqual([]);
    expect(on.doc?.constraint).toMatchObject({ window: { from: 0, to: 30 } });
  });
});
