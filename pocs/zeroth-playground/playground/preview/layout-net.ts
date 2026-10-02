import ELK from "elkjs/lib/elk.bundled.js";

import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import type { NetEdge, NetGraph, NetNode } from "./net-graph";

/**
 * Positions for the net through elkjs's layered algorithm, left to right,
 * on the main thread: the nets are small and the bundled ELK needs no
 * worker file beside the single HTML. Only the geometry is cached, by the
 * graph's structure, and the drawing reads everything else from the graph,
 * so an IR edit that keeps every node and arc redraws at once.
 */

export type Point = { x: number; y: number };

export type LaidOutNode = NetNode & {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LaidOutEdge = NetEdge & {
  /** From the source's boundary to the target's, bends included. */
  points: Point[];
};

export type NetLayout = {
  width: number;
  height: number;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
};

type Box = { x: number; y: number; width: number; height: number };

/** Where elkjs put each node and how it routed each arc, by id: nothing else from the graph. */
export type NetGeometry = {
  width: number;
  height: number;
  positions: Map<string, Box>;
  routes: Map<string, Point[]>;
};

const PLACE_SIZE = 44;
const TRANSITION_SIZE = 36;

function nodeSize(node: NetNode): number {
  return node.kind === "place" ? PLACE_SIZE : TRANSITION_SIZE;
}

const LAYOUT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "POLYLINE",
  "elk.spacing.nodeNode": "44",
  "elk.layered.spacing.nodeNodeBetweenLayers": "64",
  "elk.layered.spacing.edgeNodeBetweenLayers": "24",
  "elk.spacing.edgeNode": "24",
  "elk.padding": "[top=16,left=16,bottom=28,right=16]",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.crossingMinimization.semiInteractive": "true",
};

let elk: InstanceType<typeof ELK> | null = null;

export async function layoutNet(graph: NetGraph): Promise<NetGeometry> {
  elk ??= new ELK();
  const root: ElkNode = {
    id: "net",
    layoutOptions: LAYOUT_OPTIONS,
    children: graph.nodes.map(
      (node): ElkNode => ({
        id: node.id,
        width: nodeSize(node),
        height: nodeSize(node),
      }),
    ),
    edges: graph.edges.map(
      (edge): ElkExtendedEdge => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      }),
    ),
  };
  const laidOut = await elk.layout(root);
  return {
    width: laidOut.width ?? 0,
    height: laidOut.height ?? 0,
    positions: new Map(
      (laidOut.children ?? []).map((child) => [
        child.id,
        { x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? 0, height: child.height ?? 0 },
      ]),
    ),
    routes: new Map(
      (laidOut.edges ?? []).flatMap((edge) => {
        const section = edge.sections?.[0];
        return section === undefined
          ? []
          : [[edge.id, [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]]];
      }),
    ),
  };
}

/** The graph drawn at a geometry: the nodes and arcs come from the graph, their places from the geometry. */
export function placeGraph(graph: NetGraph, geometry: NetGeometry): NetLayout {
  return {
    width: geometry.width,
    height: geometry.height,
    nodes: graph.nodes.map((node) => ({
      ...node,
      ...(geometry.positions.get(node.id) ?? {
        x: 0,
        y: 0,
        width: nodeSize(node),
        height: nodeSize(node),
      }),
    })),
    edges: graph.edges.map((edge) => ({ ...edge, points: geometry.routes.get(edge.id) ?? [] })),
  };
}

/** What a layout depends on: the nodes' ids and sizes and the edges' ends, in order. */
export function layoutKey(graph: NetGraph): string {
  return JSON.stringify([
    graph.nodes.map((node) => [node.id, nodeSize(node)]),
    graph.edges.map((edge) => [edge.id, edge.source, edge.target]),
  ]);
}

const CACHE_LIMIT = 64;
const cache = new Map<string, Promise<NetGeometry>>();

/** The geometry for a graph's structure, one promise per structure so `use` can await it across renders. */
export function layoutFor(graph: NetGraph): Promise<NetGeometry> {
  const key = layoutKey(graph);
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const promise = layoutNet(graph);
  cache.set(key, promise);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  return promise;
}
