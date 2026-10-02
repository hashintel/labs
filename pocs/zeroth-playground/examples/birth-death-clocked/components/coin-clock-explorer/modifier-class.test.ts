import { describe, expect, it } from "vitest";

import { modifierClass } from "./modifier-class";

describe("modifierClass", () => {
  it("adds the modifier when there is one", () => {
    // GIVEN the block explorer__draw, with the modifier fires and with none
    // THEN a modifier is appended to the block, and no modifier leaves the block alone
    expect(modifierClass("explorer__draw", "fires")).toBe("explorer__draw explorer__draw--fires");
    expect(modifierClass("explorer__draw", undefined)).toBe("explorer__draw");
  });
});
