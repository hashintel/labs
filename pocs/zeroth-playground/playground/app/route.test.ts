import { describe, expect, it } from "vitest";

import { exampleById } from "../../examples/catalog";
import { questionById } from "../../semantics/register";
import { type Route, hashOf, routeOf } from "./route";

describe("routeOf", () => {
  it("opens the example a hash names in the Examples view, under the options its query names", () => {
    // GIVEN the hash of an example, alone and with a query
    // WHEN each is read
    const alone = routeOf("#birth-death");
    const withOptions = routeOf("#birth-death?rates=clock&dt=0.5");
    // THEN both open the Examples view on that example, the second under those options
    expect(alone).toEqual({ view: "playground", example: expect.objectContaining({ id: "birth-death" }) });
    expect(withOptions).toEqual({
      view: "playground",
      example: expect.objectContaining({ id: "birth-death" }),
      options: { rates: "clock", dt: 0.5 },
    });
  });

  it("opens an old compiler link as an example", () => {
    // GIVEN old compiler links
    // WHEN each is read
    const withExample = routeOf("#compiler/birth-death");
    const alone = routeOf("#compiler");
    // THEN they open Examples and preserve a known example
    expect(withExample).toEqual({ view: "playground", example: expect.objectContaining({ id: "birth-death" }) });
    expect(alone).toEqual({ view: "playground" });
  });

  it("opens the Questions view, on the question after the slash", () => {
    // GIVEN the Questions view's hash, with a question, with an unknown one, and alone
    // WHEN each is read
    const withQuestion = routeOf("#semantics/transition-or-places-decide");
    const unknown = routeOf("#semantics/no-such-question");
    const alone = routeOf("#semantics");
    // THEN all open the Questions view; only the known question is selected
    expect(withQuestion).toEqual({ view: "semantics", question: expect.objectContaining({ id: "transition-or-places-decide" }) });
    expect(unknown).toEqual({ view: "semantics" });
    expect(alone).toEqual({ view: "semantics" });
  });

  it("names no example for an empty hash or one the catalog does not hold", () => {
    // GIVEN no hash, and a hash naming no example
    // THEN each opens the Examples view and leaves the open example as it is
    expect(routeOf("")).toEqual({ view: "playground" });
    expect(routeOf("#no-such-example")).toEqual({ view: "playground" });
  });

  it("drops a query value the options table does not allow", () => {
    // GIVEN a query with a value off the table, a step length that is not positive, and an unknown key
    // WHEN it is read
    const route = routeOf("#cycle?shape=round&dt=-1&colour=red&conflicts=nondet");
    // THEN only the allowed option stays
    expect(route).toEqual({
      view: "playground",
      example: expect.objectContaining({ id: "cycle" }),
      options: { conflicts: "nondet" },
    });
  });
});

describe("hashOf", () => {
  const cycle = exampleById("cycle");
  const inputs = questionById("transition-or-places-decide");
  if (cycle === undefined || inputs === undefined) {
    throw new Error("the catalog or the register lost an entry the test relies on");
  }
  const routes: Route[] = [
    { view: "playground", example: cycle },
    { view: "playground", example: cycle, options: { shape: "modular", dt: 0.5 } },
    { view: "playground", example: cycle, options: { rates: "clock" } },
    { view: "semantics" },
    { view: "semantics", question: inputs },
  ];

  it("writes the hash a route came from, so a route survives a round trip", () => {
    for (const route of routes) {
      // GIVEN a route
      // WHEN it is written as a hash and read back
      const back = routeOf(hashOf(route));
      // THEN the same route comes back
      expect(back).toEqual(route);
    }
  });

  it("writes the options as a query in the table's order, and no query for none", () => {
    // GIVEN an example under two options, given out of the table's order, and one under none
    // THEN the hash carries them in the table's order, and the other has no query
    expect(hashOf({ view: "playground", example: cycle, options: { dt: 0.5, shape: "modular" } })).toBe(
      "#cycle?shape=modular&dt=0.5",
    );
    expect(hashOf({ view: "playground", example: cycle, options: {} })).toBe("#cycle");
  });
});
