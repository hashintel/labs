import { describe, expect, it } from "vitest";

import { boilerIr, bucketIr, dronesIr } from "../testing/coloured-nets.fixtures";
import { compileNet } from "../testing/compile-net";
import { parseCode } from "../testing/fixture-parser";
import { codeStrings } from "./code-strings";

import type { CodeParser } from "./code-tree";

describe("codeStrings", () => {
  it("lists exactly the strings the lowering hands the parser", () => {
    // GIVEN the coloured nets, whose dynamics, guards, rates and kernels are code
    for (const ir of [bucketIr, boilerIr, dronesIr]) {
      const asked = new Set<string>();
      const recording: CodeParser = (code, surface) => {
        asked.add(`${surface}: ${code}`);
        return parseCode(code, surface);
      };
      // WHEN each is compiled with a parser that records what it is asked
      compileNet(ir, {}, recording);
      // THEN codeStrings lists the same strings, each with its surface
      const listed = new Set(codeStrings(ir).map(({ surface, code }) => `${surface}: ${code}`));
      expect(listed).toEqual(asked);
    }
  });

  it("names each string's item and field, the dynamics first", () => {
    // GIVEN the boiler: dynamics on the tank, and a guard on Alarm
    // WHEN its code strings are listed
    const listed = codeStrings(boilerIr).map(({ item, field, surface }) => [
      item.kind,
      item.name,
      field,
      surface,
    ]);
    // THEN each names where it stands and how it is read
    expect(listed).toEqual([
      ["dynamics", "Heat", "code", "dynamics"],
      ["transition", "Alarm", "guard", "lambda"],
    ]);
  });
});
