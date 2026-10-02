import { describe, expect, it } from "vitest";

import { parsePetriNetIr } from "../../compiler";
import { exampleById } from "../../examples/catalog";
import { layoutFor, layoutKey, layoutNet, placeGraph } from "./layout-net";
import { netGraph } from "./net-graph";

import type { PetriNetIr } from "../../compiler";

function irOf(id: string): PetriNetIr {
  const parsed = parsePetriNetIr(exampleById(id)?.ir ?? "");
  if (!parsed.ok) {
    throw new Error(`example ${id} does not parse`);
  }
  return parsed.ir;
}

describe("netGraph", () => {
  it("reads places with their marking and transitions with their rates and arcs", () => {
    // GIVEN the queue
    // WHEN its graph is read
    const graph = netGraph(irOf("queue"));
    // THEN the places come first with their counts and capacity, then the rated transitions, then the arcs
    expect(graph.nodes).toEqual([
      { id: "place:Waiting", kind: "place", name: "Waiting", tokens: 0, capacity: 4 },
      { id: "place:Served", kind: "place", name: "Served", tokens: 0 },
      { id: "transition:Arrive", kind: "transition", name: "Arrive", rate: 2.5, guarded: false, controllable: false },
      { id: "transition:Serve", kind: "transition", name: "Serve", rate: 3, guarded: false, controllable: false },
    ]);
    expect(graph.edges.map((edge) => [edge.source, edge.target, edge.weight, edge.kind])).toEqual([
      ["transition:Arrive", "place:Waiting", 1, "standard"],
      ["place:Waiting", "transition:Serve", 1, "standard"],
      ["transition:Serve", "place:Served", 1, "standard"],
    ]);
  });

  it("keeps arc kinds and weights, coloured places and code rates", () => {
    // GIVEN the boiler, the conflict and the drones
    // WHEN their graphs are read
    const boiler = netGraph(irOf("boiler"));
    const conflict = netGraph(irOf("conflict"));
    const drones = netGraph(irOf("drones"));
    // THEN the boiler keeps its read arc, coloured tank and guard, the conflict its arc weight and
    // controllable transition, and the drones a rate written as code
    expect(boiler.edges[0]).toMatchObject({ place: "Tank", transition: "Alarm", kind: "read" });
    expect(boiler.nodes[0]).toMatchObject({ kind: "place", name: "Tank", tokens: 1, colour: "Vessel", capacity: 1 });
    expect(boiler.nodes[2]).toMatchObject({ kind: "transition", name: "Alarm", guarded: true });
    expect(conflict.edges[0]).toMatchObject({ place: "Pool", transition: "TakeLeft", weight: 2 });
    expect(conflict.nodes[3]).toMatchObject({ name: "TakeLeft", controllable: true });
    expect(drones.nodes[3]).toMatchObject({ name: "Launch", rate: "code" });
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
    // GIVEN the cycle, the cycle with another marking, and the fork
    const cycle = irOf("cycle");
    const graph = netGraph(cycle);
    const remarked = netGraph({ ...cycle, marking: { A: 3 } });
    const fork = netGraph(irOf("fork"));
    // WHEN their layouts are looked up
    // THEN the two cycles share a key and a promise, and the fork has a key of its own
    expect(layoutKey(graph)).toBe(layoutKey(remarked));
    expect(layoutFor(graph)).toBe(layoutFor(remarked));
    expect(layoutKey(fork)).not.toBe(layoutKey(graph));
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
