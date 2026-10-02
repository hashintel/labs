import { describe, expect, it } from "vitest";

import { FIRST_EXAMPLE } from "../../examples/catalog";
import { routeOf } from "./route";

describe("routeOf", () => {
  it("opens the example a hash names in the Examples view", () => {
    // GIVEN the hash of an example
    // WHEN it is read
    const route = routeOf("#birth-death");
    // THEN the Examples view opens on that example
    expect(route.view).toBe("examples");
    expect(route.example.id).toBe("birth-death");
  });

  it("opens the Compiler view, on the example after the slash", () => {
    // GIVEN the Compiler view's hash, with and without an example
    // WHEN each is read
    const withExample = routeOf("#compiler/birth-death");
    const alone = routeOf("#compiler");
    // THEN both open the Compiler view, the bare one on the first example
    expect(withExample).toEqual({ view: "compiler", example: expect.objectContaining({ id: "birth-death" }) });
    expect(alone).toEqual({ view: "compiler", example: FIRST_EXAMPLE });
  });

  it("opens the Semantics view, on the question after the slash", () => {
    // GIVEN the Semantics view's hash, with a question, with an unknown one, and alone
    // WHEN each is read
    const withQuestion = routeOf("#semantics/ties-under-clocks");
    const unknown = routeOf("#semantics/no-such-question");
    const alone = routeOf("#semantics");
    // THEN all open the Semantics view on the first example; only the known question is selected
    expect(withQuestion).toEqual({
      view: "semantics",
      example: FIRST_EXAMPLE,
      question: expect.objectContaining({ id: "ties-under-clocks" }),
    });
    expect(unknown).toEqual({ view: "semantics", example: FIRST_EXAMPLE });
    expect(alone).toEqual({ view: "semantics", example: FIRST_EXAMPLE });
  });

  it("opens the first example for an empty hash or one the catalog does not hold", () => {
    // GIVEN no hash, and a hash naming no example
    // THEN each opens the first example in the Examples view
    expect(routeOf("")).toEqual({ view: "examples", example: FIRST_EXAMPLE });
    expect(routeOf("#no-such-example")).toEqual({ view: "examples", example: FIRST_EXAMPLE });
  });
});
