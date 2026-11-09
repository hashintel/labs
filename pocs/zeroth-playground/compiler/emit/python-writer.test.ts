import { describe, expect, it } from "vitest";

import { block, traced, written } from "./python-writer";

describe("written", () => {
  it("joins the lines with a newline at the end, and traces each traced line alone", () => {
    // GIVEN a traced line between two plain ones
    const lines = ["from zrth import Var", traced("A = Var(INT)", { what: "The tokens in A" }), ""];
    // WHEN they are written
    const { text, trace } = written(lines);
    // THEN the text holds every line, and only the traced one has a range
    expect(text).toBe("from zrth import Var\nA = Var(INT)\n\n");
    expect(trace).toEqual([{ startLine: 2, endLine: 2, provenance: { what: "The tokens in A" } }]);
  });

  it("spans a block from its first non-blank line to its last, before the ranges inside it", () => {
    // GIVEN a class block holding a method block, with blank lines inside and after
    const lines = [
      block({ what: "The class" }, [
        "class A(Module):",
        "",
        block({ what: "The method" }, [
          "    def init(self):",
          traced("        return 1", { what: "The return" }),
          "",
        ]),
        "",
      ]),
      "",
      traced("net = A()", { what: "The system" }),
    ];
    // WHEN they are written
    const { trace } = written(lines);
    // THEN each block stops at its last non-blank line, and the outer range comes first
    expect(trace).toEqual([
      { startLine: 1, endLine: 4, provenance: { what: "The class" } },
      { startLine: 3, endLine: 4, provenance: { what: "The method" } },
      { startLine: 4, endLine: 4, provenance: { what: "The return" } },
      { startLine: 8, endLine: 8, provenance: { what: "The system" } },
    ]);
  });

  it("gives a block of blank lines no range", () => {
    // GIVEN a block that holds only a blank line
    const lines = ["x = 1", block({ what: "Nothing" }, [""])];
    // WHEN they are written
    const { text, trace } = written(lines);
    // THEN the blank line is written, and nothing is traced
    expect(text).toBe("x = 1\n\n");
    expect(trace).toEqual([]);
  });
});
