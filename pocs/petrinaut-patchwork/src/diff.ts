import { view } from "@automerge/automerge";
import { decodeHeads, type UrlHeads } from "@automerge/automerge-repo";
import type { SDCPN, Transition } from "@hashintel/petrinaut";
import { generateArcId } from "@hashintel/petrinaut-core";
import type { Doc } from "./datatype";

export type NodeKind = "place" | "transition";

/** A graph element the draft added, or edited in any way (including a drag). */
export type DiffStatus = "added" | "changed";

/** A place or transition that the baseline had and the live net no longer does. */
export type RemovedNode = {
	id: string;
	kind: NodeKind;
	name: string;
	x: number;
	y: number;
};

/** An arc the baseline had and the live net no longer does.
 *
 * Endpoints are resolved against the live net where the node survives, so a
 * removed arc still tracks a place that has since been dragged elsewhere, and
 * falls back to the baseline position for endpoints that went away with it.
 */
export type RemovedArc = {
	id: string;
	from: Endpoint;
	to: Endpoint;
};

export type Endpoint = { kind: NodeKind; x: number; y: number };

/** What a draft changed about a net's graph, relative to its baseline. */
export type NetDiff = {
	/** Live places, transitions and arcs, keyed by the id React Flow renders them under. */
	touched: Map<string, DiffStatus>;
	removedNodes: RemovedNode[];
	removedArcs: RemovedArc[];
};

/** Diff the net against the version at `heads`, the draft's fork point.
 *
 * Returns `null` when the heads aren't part of this document's history — the
 * baseline can name a fork point the doc in hand never had, e.g. right after a
 * draft is checked out and before its clone resolves.
 */
export function diffNet(doc: Doc, heads: UrlHeads): NetDiff | null {
	let before: SDCPN;
	try {
		before = plainNet(view(doc, decodeHeads(heads)));
	} catch (error) {
		console.warn("[petrinaut/diff] no net at the baseline heads", error);
		return null;
	}
	const after = plainNet(doc);

	const touched = new Map<string, DiffStatus>();
	diffNodes(before.places, after.places, touched);
	diffNodes(
		before.transitions.map(withoutArcs),
		after.transitions.map(withoutArcs),
		touched,
	);
	diffArcs(before, after, touched);

	return {
		touched,
		removedNodes: removedNodes(before, after),
		removedArcs: removedArcs(before, after),
	};
}

export const hasDiff = (diff: NetDiff | null): diff is NetDiff =>
	!!diff &&
	(diff.touched.size > 0 ||
		diff.removedNodes.length > 0 ||
		diff.removedArcs.length > 0);

/** Mark every node that is new in `after`, or that differs in any field. */
function diffNodes(
	before: { id: string }[],
	after: { id: string }[],
	touched: Map<string, DiffStatus>,
) {
	const byId = new Map(before.map((node) => [node.id, node]));
	for (const node of after) {
		const previous = byId.get(node.id);
		if (!previous) {
			touched.set(node.id, "added");
		} else if (!isEqual(previous, node)) {
			touched.set(node.id, "changed");
		}
	}
}

/** A transition minus its arcs, which the canvas draws as edges of their own
 * and which are therefore diffed as edges rather than folded into the
 * transition that happens to store them. */
function withoutArcs(transition: Transition) {
	const { inputArcs, outputArcs, ...rest } = transition;
	return rest;
}

/** Mark every arc that is new in `after`, or whose weight or type differs.
 *
 * Arcs live inside their transition rather than as records of their own, so
 * they are keyed the way the canvas keys them: by the id React Flow gives the
 * edge between the two endpoints.
 */
function diffArcs(
	before: SDCPN,
	after: SDCPN,
	touched: Map<string, DiffStatus>,
) {
	const previous = arcsById(before);
	for (const [id, arc] of arcsById(after)) {
		const wasThere = previous.get(id);
		if (!wasThere) {
			touched.set(id, "added");
		} else if (!isEqual(wasThere, arc)) {
			touched.set(id, "changed");
		}
	}
}

function removedNodes(before: SDCPN, after: SDCPN): RemovedNode[] {
	const removed: RemovedNode[] = [];
	const livePlaces = new Set(after.places.map((place) => place.id));
	for (const { id, name, x, y } of before.places) {
		if (!livePlaces.has(id)) {
			removed.push({ id, kind: "place", name, x, y });
		}
	}
	const liveTransitions = new Set(
		after.transitions.map((transition) => transition.id),
	);
	for (const { id, name, x, y } of before.transitions) {
		if (!liveTransitions.has(id)) {
			removed.push({ id, kind: "transition", name, x, y });
		}
	}
	return removed;
}

function removedArcs(before: SDCPN, after: SDCPN): RemovedArc[] {
	const live = arcsById(after);
	const endpoint = endpointResolver(before, after);
	const removed: RemovedArc[] = [];
	for (const [id, arc] of arcsById(before)) {
		if (live.has(id)) continue;
		const from = endpoint(arc.from);
		const to = endpoint(arc.to);
		if (from && to) {
			removed.push({ id, from, to });
		}
	}
	return removed;
}

type Arc = {
	from: string;
	to: string;
	weight: number;
	type: "standard" | "inhibitor";
};

/** Every arc in the net, keyed by the edge id the canvas draws it under. */
function arcsById(net: SDCPN): Map<string, Arc> {
	const arcs = new Map<string, Arc>();
	for (const transition of net.transitions) {
		for (const input of transition.inputArcs) {
			const id = generateArcId({
				inputId: input.placeId,
				outputId: transition.id,
			});
			arcs.set(id, {
				from: input.placeId,
				to: transition.id,
				weight: input.weight,
				type: input.type,
			});
		}
		for (const output of transition.outputArcs) {
			const id = generateArcId({
				inputId: transition.id,
				outputId: output.placeId,
			});
			arcs.set(id, {
				from: transition.id,
				to: output.placeId,
				weight: output.weight,
				type: "standard",
			});
		}
	}
	return arcs;
}

/** Look an arc endpoint up by id, preferring where the node is now. */
function endpointResolver(before: SDCPN, after: SDCPN) {
	const positions = new Map<string, Endpoint>();
	for (const net of [before, after]) {
		for (const place of net.places) {
			positions.set(place.id, { kind: "place", x: place.x, y: place.y });
		}
		for (const transition of net.transitions) {
			positions.set(transition.id, {
				kind: "transition",
				x: transition.x,
				y: transition.y,
			});
		}
	}
	return (id: string) => positions.get(id);
}

/** Deep-copy the net to plain JS, shedding Automerge proxies. */
function plainNet(doc: Doc): SDCPN {
	return JSON.parse(
		JSON.stringify(doc.petriNetDefinition ?? EMPTY_NET),
	) as SDCPN;
}

const EMPTY_NET: SDCPN = {
	places: [],
	transitions: [],
	types: [],
	differentialEquations: [],
	parameters: [],
};

/** Structural equality over the plain JSON the net decodes to. */
function isEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left);
	if (keys.length !== Object.keys(right).length) return false;
	return keys.every((key) => isEqual(left[key], right[key]));
}
