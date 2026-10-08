import { describe, expect, it } from "vitest";

import { parsePetriNetIr } from "../../compiler";
import { layoutFor, layoutKey, layoutNet, placeGraph } from "./layout-net";
import { netGraph } from "./net-graph";

import type { PetriNetIr } from "../../compiler";

const NETS: Record<string, string> = {
  "birth-death": `
name: birth_death
kind: stochastic
places:
  Population:
transitions:
  Birth:
    outputs:
      Population:
    rate: 2
  Death:
    inputs:
      Population:
    rate: 1
`,
  cycle: `
name: cycle
kind: plain
places:
  A:
  B:
marking:
  A: 1
transitions:
  Go:
    inputs:
      A:
    outputs:
      B:
  Back:
    inputs:
      B:
    outputs:
      A:
`,
  conflict: `
name: conflict
kind: plain
places:
  Pool:
  Left:
  Right:
marking:
  Pool: 1
transitions:
  TakeLeft:
    inputs:
      Pool:
    outputs:
      Left:
    controllable: true
  TakeRight:
    inputs:
      Pool:
    outputs:
      Right:
`,
  arcs: `
name: arcs
kind: plain
places:
  Parts:
  Power:
  Jam:
  Products:
transitions:
  Make:
    inputs:
      Parts:
        weight: 2
      Power:
        kind: read
      Jam:
        kind: inhibitor
    outputs:
      Products:
`,
  bucket: `
name: bucket
kind: stochastic
colours:
  Ball:
    size: real
places:
  Pool:
    colour: Ball
    capacity: 2
  Out:
    colour: Ball
marking:
  Pool:
    - size: 1
    - size: 2
transitions:
  Take:
    inputs:
      Pool:
    outputs:
      Out:
    rate: return 1;
    kernel: return {};
`,
};

/** The named net of this test, parsed. */
function irOf(id: string): PetriNetIr {
  const parsed = parsePetriNetIr(NETS[id] ?? "");
  if (!parsed.ok) {
    throw new Error(`net ${id} does not parse: ${parsed.errors.map((error) => error.message).join("; ")}`);
  }
  return parsed.ir;
}

describe("netGraph", () => {
  it("reads places with their marking and transitions with their rates and arcs", () => {
    // GIVEN Birth–death
    // WHEN its graph is read
    const graph = netGraph(irOf("birth-death"));
    // THEN the place comes first with its count, then the rated transitions, then the arcs
    expect(graph.nodes).toEqual([
      { id: "place:Population", kind: "place", name: "Population", tokens: 0 },
      { id: "transition:Birth", kind: "transition", name: "Birth", rate: 2, guarded: false, controllable: false },
      { id: "transition:Death", kind: "transition", name: "Death", rate: 1, guarded: false, controllable: false },
    ]);
    expect(graph.edges.map((edge) => [edge.source, edge.target, edge.weight, edge.kind])).toEqual([
      ["transition:Birth", "place:Population", 1, "standard"],
      ["place:Population", "transition:Death", 1, "standard"],
    ]);
  });

  it("keeps arc kinds and weights, capacities, colours, guards and code rates", () => {
    // GIVEN the arcs, the conflict, the bucket and a transition with a guard
    const guardedIr: PetriNetIr = {
      name: "guarded",
      kind: "plain",
      places: { A: null },
      transitions: { Go: { inputs: { A: null }, guard: "return true;" } },
    };
    // WHEN their graphs are read
    const arcs = netGraph(irOf("arcs"));
    const conflict = netGraph(irOf("conflict"));
    const bucket = netGraph(irOf("bucket"));
    const guarded = netGraph(guardedIr);
    // THEN the arcs keep their weight and kinds, the conflict its controllable transition, the
    // bucket its capped coloured place and its rate written as code, and the guard is marked
    expect(arcs.edges.map((edge) => [edge.place, edge.weight, edge.kind])).toEqual([
      ["Parts", 2, "standard"],
      ["Power", 1, "read"],
      ["Jam", 1, "inhibitor"],
      ["Products", 1, "standard"],
    ]);
    expect(conflict.nodes[3]).toMatchObject({ name: "TakeLeft", controllable: true });
    expect(bucket.nodes[0]).toMatchObject({ kind: "place", name: "Pool", tokens: 2, colour: "Ball", capacity: 2 });
    expect(bucket.nodes[2]).toMatchObject({ name: "Take", rate: "code" });
    expect(guarded.nodes[1]).toMatchObject({ name: "Go", guarded: true });
  });

  it("drops an arc to a place the IR does not declare", () => {
    // GIVEN a transition with an output arc to an undeclared place
    const ir: PetriNetIr = {
      name: "dangling",
      kind: "plain",
      places: { A: null },
      transitions: { Go: { inputs: { A: null }, outputs: { Nowhere: null } } },
    };
    // WHEN its graph is read
    const graph = netGraph(ir);
    // THEN only the arc from the declared place is drawn
    expect(graph.edges).toHaveLength(1);
  });
});

describe("layoutNet", () => {
  it("places every node and routes every arc, left to right", async () => {
    // GIVEN the cycle's graph
    const graph = netGraph(irOf("cycle"));
    // WHEN it is laid out and placed
    const layout = placeGraph(graph, await layoutNet(graph));
    // THEN every node sits in the drawing, every arc has a route, and A comes before Go
    expect(layout.nodes).toHaveLength(4);
    expect(layout.edges).toHaveLength(4);
    expect(layout.width).toBeGreaterThan(0);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
    }
    for (const edge of layout.edges) {
      expect(edge.points.length).toBeGreaterThanOrEqual(2);
    }
    const a = layout.nodes.find((node) => node.name === "A");
    const go = layout.nodes.find((node) => node.name === "Go");
    expect((a?.x ?? 0) < (go?.x ?? 0)).toBe(true);
  });

  it("keys the cache on structure alone and reuses one promise per structure", () => {
    // GIVEN the cycle, the cycle with another marking, and the conflict
    const cycle = irOf("cycle");
    const graph = netGraph(cycle);
    const remarked = netGraph({ ...cycle, marking: { A: 3 } });
    const conflict = netGraph(irOf("conflict"));
    // WHEN their layouts are looked up
    // THEN the two cycles share a key and a promise, and the conflict has a key of its own
    expect(layoutKey(graph)).toBe(layoutKey(remarked));
    expect(layoutFor(graph)).toBe(layoutFor(remarked));
    expect(layoutKey(conflict)).not.toBe(layoutKey(graph));
  });

  it("places a graph at a cached geometry with the graph's own marking", async () => {
    // GIVEN the cycle laid out first
    const cycle = irOf("cycle");
    const geometry = layoutFor(netGraph(cycle));
    await geometry;
    // WHEN the cycle with A: 3 is placed through the same cache
    const remarked = netGraph({ ...cycle, marking: { A: 3 } });
    const layout = placeGraph(remarked, await layoutFor(remarked));
    // THEN its A has 3 tokens, and the promise is still the shared one
    expect(layout.nodes.find((node) => node.name === "A")).toMatchObject({ tokens: 3 });
    expect(layoutFor(remarked)).toBe(geometry);
  });
});
