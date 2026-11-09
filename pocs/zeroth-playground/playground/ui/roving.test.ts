import { describe, expect, it } from "vitest";

import { stepIndex } from "./roving";

describe("stepIndex", () => {
  it("steps down and up, and stays within the list", () => {
    // GIVEN a list of four options with the focus on the second
    // WHEN the arrow keys are pressed
    // THEN the focus moves one step, and a step past an end stays at it
    expect(stepIndex("ArrowDown", 1, 4)).toBe(2);
    expect(stepIndex("ArrowUp", 1, 4)).toBe(0);
    expect(stepIndex("ArrowUp", 0, 4)).toBe(0);
    expect(stepIndex("ArrowDown", 3, 4)).toBe(3);
  });

  it("jumps to the ends on Home and End, and ignores other keys", () => {
    // GIVEN a list of four options with the focus on the second
    // THEN Home and End reach the ends, and a letter moves nothing
    expect(stepIndex("Home", 1, 4)).toBe(0);
    expect(stepIndex("End", 1, 4)).toBe(3);
    expect(stepIndex("a", 1, 4)).toBeNull();
  });

  it("steps into the list from no focus", () => {
    // GIVEN no option focused, read as index -1
    // WHEN ArrowDown is pressed
    // THEN the first option takes the focus
    expect(stepIndex("ArrowDown", -1, 4)).toBe(0);
  });
});
