import { describe, expect, it } from "vitest";

import { DEFAULT_EXAMPLE, exampleById } from "../../examples/catalog";
import { hashOf, routeOf } from "./route";

describe("routeOf", () => {
  it("opens the example a hash names", () => {
    // GIVEN the hash of an example
    // WHEN it is read
    const route = routeOf(`#${DEFAULT_EXAMPLE.id}`);
    // THEN the route names that example
    expect(route).toEqual({ example: expect.objectContaining({ id: DEFAULT_EXAMPLE.id }), mtl: false, nested: false });
  });

  it("names no example for an empty hash or one the catalog does not hold", () => {
    // GIVEN no hash, and a hash naming no example
    // THEN each leaves the open example as it is
    expect(routeOf("")).toEqual({ mtl: false, nested: false });
    expect(routeOf("#no-such-example")).toEqual({ mtl: false, nested: false });
  });
});

describe("hashOf", () => {
  it("writes the hash a route came from, so a route survives a round trip", () => {
    // GIVEN the route of an example
    const route = { example: DEFAULT_EXAMPLE, mtl: false, nested: false };
    // WHEN it is written as a hash and read back
    const back = routeOf(hashOf(route));
    // THEN the same route comes back
    expect(back).toEqual(route);
  });
});

describe("the MTL flag in the hash", () => {
  it("reads ?mtl=1 as on and no query as off", () => {
    // GIVEN the hash of a plain example, with and without the flag
    // WHEN each is read
    const on = routeOf(`#${DEFAULT_EXAMPLE.id}?mtl=1`);
    const off = routeOf(`#${DEFAULT_EXAMPLE.id}`);
    // THEN the flag follows the query and the example is the same
    expect(on).toEqual({ example: expect.objectContaining({ id: DEFAULT_EXAMPLE.id }), mtl: true, nested: false });
    expect(off.mtl).toBe(false);
  });

  it("turns MTL on for an example that needs it, and writes the flag back", () => {
    // GIVEN the hash of an MTL example with no query
    // WHEN it is read and written back
    const route = routeOf("#oven-hot-window");
    // THEN MTL is on, and the hash carries it
    expect(route.example?.id).toBe("oven-hot-window");
    expect(route.mtl).toBe(true);
    expect(hashOf(route)).toBe("#oven-hot-window?mtl=1");
    expect(routeOf(hashOf(route))).toEqual(route);
  });

  it("writes no query while MTL is off", () => {
    // GIVEN a route with MTL off
    // WHEN it is written
    // THEN the hash is the bare id
    expect(hashOf({ example: DEFAULT_EXAMPLE, mtl: false, nested: false })).toBe(`#${DEFAULT_EXAMPLE.id}`);
    expect(exampleById("oven-hot-window")?.mtl).toBe(true);
  });
});

describe("the nested flag in the hash", () => {
  it("reads ?nested=1 as on, alone and with mtl", () => {
    // GIVEN the hash of a plain example with the flag, and with both flags
    // WHEN each is read
    const alone = routeOf(`#${DEFAULT_EXAMPLE.id}?nested=1`);
    const both = routeOf(`#${DEFAULT_EXAMPLE.id}?nested=1&mtl=1`);
    // THEN the flags follow the query
    expect(alone).toEqual({ example: expect.objectContaining({ id: DEFAULT_EXAMPLE.id }), mtl: false, nested: true });
    expect(both.mtl).toBe(true);
    expect(both.nested).toBe(true);
  });

  it("turns nested on for an example that nests, and writes the flag back", () => {
    // GIVEN the hash of a nesting example with no query
    // WHEN it is read and written back
    const route = routeOf("#heater-settles");
    // THEN nested is on, MTL is off, and the hash carries the flag
    expect(route.example?.id).toBe("heater-settles");
    expect(route).toMatchObject({ mtl: false, nested: true });
    expect(hashOf(route)).toBe("#heater-settles?nested=1");
    expect(routeOf(hashOf(route))).toEqual(route);
  });

  it("turns both flags on for an example that needs both, nested first in the hash", () => {
    // GIVEN the hash of an example with a window inside a nested operator
    // WHEN it is read and written back
    const route = routeOf("#press-repair-math");
    // THEN both are on and the hash lists nested first
    expect(route).toMatchObject({ mtl: true, nested: true });
    expect(hashOf(route)).toBe("#press-repair-math?nested=1&mtl=1");
    expect(routeOf(hashOf(route))).toEqual(route);
  });
});
