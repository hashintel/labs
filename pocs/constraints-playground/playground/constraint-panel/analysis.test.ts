import { describe, expect, it } from "vitest";

import { exampleById } from "../../examples/catalog";
import { analyse } from "./analysis";

function runOf(id: string) {
  const example = exampleById(id);
  if (example === undefined) {
    throw new Error(`no example ${id}`);
  }
  return analyse(example.ir, example.constraint, null, example.mtl === true, example.nested === true).run;
}

describe("analyse", () => {
  it("paints the last state's verdict with the final one when the end of the run decides", () => {
    // GIVEN an example whose verdict is decided only at the end
    // WHEN it runs
    const run = runOf("press-breakdown-response");
    // THEN no step decided it, and the verdict row is pending until its last cell, which holds the verdict
    const verdicts = run?.timeline.rows.find((row) => row.kind === "verdict")?.values;
    expect(run?.decidedAt).toBeUndefined();
    expect(verdicts?.slice(0, -1).every((verdict) => verdict === "pending")).toBe(true);
    expect(verdicts?.at(-1)).toBe("violated");
  });

  it("hands the top operator's window to the timeline", () => {
    // GIVEN an example with a window on its top operator
    // WHEN it runs
    const run = runOf("oven-hot-window");
    // THEN the timeline carries the window
    expect(run?.timeline.window).toEqual({ from: 10, to: 20 });
  });
});
