import type { DocHandle, UrlHeads } from "@automerge/automerge-repo";
import { useSubscribe } from "@inkandswitch/patchwork-providers-react";
import {
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import type { Doc } from "./datatype";
import {
	diffNet,
	hasDiff,
	type DiffStatus,
	type Endpoint,
	type NetDiff,
	type NodeKind,
	type RemovedNode,
} from "./diff";

/**
 * Draws what the checked-out draft changed about the net on top of Petrinaut's
 * canvas: added and edited places, transitions and arcs glow, and the ones the
 * draft removed come back as ghosts.
 *
 * Petrinaut has no diff API, so nothing here goes through it. Highlights are a
 * stylesheet keyed on the ids React Flow already stamps onto its nodes and
 * edges, and the ghosts render into React Flow's viewport portal, which pans
 * and zooms with the canvas. Neither touches the net itself — a ghost place
 * must not turn up in the sidebar, the compiler or a simulation.
 */
export function NetDiffOverlay(props: {
	diff: NetDiff | null;
	element: HTMLElement;
}) {
	const scope = useDiffScope(props.element);
	const portal = useViewportPortal(props.element);

	if (!props.diff) {
		return null;
	}
	return (
		<>
			<style>{highlightRules(scope, props.diff)}</style>
			{portal &&
				createPortal(
					<RemovedElements diff={props.diff} element={props.element} />,
					portal,
				)}
		</>
	);
}

/**
 * The net's diff against the baseline Patchwork's draft overlay serves for it,
 * or `null` when there is nothing to show — no draft checked out, its diff
 * overlay off, or a draft that has not changed the net.
 */
export function useNetDiff(
	handle: DocHandle<Doc>,
	element: HTMLElement,
): NetDiff | null {
	const baseline = useSubscribe<Baseline>(
		element,
		{ type: "draft:baseline", url: handle.url },
		{ heads: null },
	);
	const version = useDocVersion(handle);

	return useMemo(() => {
		const heads = baseline?.heads;
		if (!heads) {
			return null;
		}
		const doc = handle.doc();
		if (!doc) {
			return null;
		}
		const diff = diffNet(doc, heads);
		return hasDiff(diff) ? diff : null;
		// `version` is a dependency on purpose: it is what forces the recompute
		// when the doc changes.
	}, [handle, baseline?.heads, version]);
}

/** Diff baseline (fork-point heads) served by Patchwork's draft overlay.
 *
 * `heads` is `null` rather than absent when there is no baseline, so the value
 * stays a structured-cloneable JSON object crossing the provider channel.
 */
type Baseline = { heads: UrlHeads | null };

/** Counts document changes so the diff can be recomputed against them.
 *
 * The baseline only moves when the draft forks the doc, so without watching
 * the handle the diff would freeze at whatever it was when the draft was
 * checked out. Bumps are coalesced into a microtask so the recompute never
 * runs synchronously inside Automerge's own change callback.
 */
function useDocVersion(handle: DocHandle<Doc>): number {
	const [version, setVersion] = useState(0);

	useEffect(() => {
		let scheduled = false;
		const onChange = () => {
			if (scheduled) return;
			scheduled = true;
			queueMicrotask(() => {
				scheduled = false;
				setVersion((previous) => previous + 1);
			});
		};
		handle.on("change", onChange);
		return () => {
			handle.off("change", onChange);
		};
	}, [handle]);

	return version;
}

/** Tag the host element so the generated rules only reach this tool's canvas.
 *
 * Place and transition ids are per document, not per view, so two views of one
 * net — a draft beside main, say — would otherwise light each other up.
 */
function useDiffScope(element: HTMLElement): string {
	const scope = useId();

	useEffect(() => {
		element.setAttribute(SCOPE_ATTRIBUTE, scope);
		return () => element.removeAttribute(SCOPE_ATTRIBUTE);
	}, [element, scope]);

	return scope;
}

const SCOPE_ATTRIBUTE = "data-petrinaut-diff";

/** A stylesheet glowing every node and edge the draft added or edited.
 *
 * `drop-shadow` follows the alpha channel, so the glow hugs a place's circle
 * or an arc's line instead of boxing it in.
 */
function highlightRules(scope: string, diff: NetDiff): string {
	const scoped = `[${SCOPE_ATTRIBUTE}="${cssString(scope)}"]`;
	const rules: string[] = [];
	for (const [id, status] of diff.touched) {
		const target = `[data-id="${cssString(id)}"]`;
		rules.push(
			`${scoped} .react-flow__node${target},`,
			`${scoped} .react-flow__edge${target} { filter: ${GLOW[status]}; }`,
		);
	}
	return rules.join("\n");
}

const GLOW: Record<DiffStatus, string> = {
	added: "drop-shadow(0 0 6px #22c55e) drop-shadow(0 0 3px #22c55e)",
	changed: "drop-shadow(0 0 6px #eab308) drop-shadow(0 0 3px #eab308)",
};

const REMOVED_COLOR = "#ef4444";

const cssString = (value: string) => value.replace(/["\\]/g, "\\$&");

/** React Flow's in-viewport portal target, tracked across canvas remounts.
 *
 * The canvas mounts a beat after the tool does, and goes away and comes back
 * whenever the editor tab does, taking its portal with it. Watching the whole
 * subtree is only affordable because the callback usually stops at the
 * `isConnected` check — this subtree churns on every frame of a simulation.
 */
function useViewportPortal(element: HTMLElement): HTMLElement | null {
	const [portal, setPortal] = useState<HTMLElement | null>(null);
	const current = useRef<HTMLElement | null>(null);

	useEffect(() => {
		const recheck = () => {
			if (current.current?.isConnected) return;
			const found = element.querySelector<HTMLElement>(
				".react-flow__viewport-portal",
			);
			if (found === current.current) return;
			current.current = found;
			setPortal(found);
		};

		recheck();
		const observer = new MutationObserver(recheck);
		observer.observe(element, { childList: true, subtree: true });
		return () => observer.disconnect();
	}, [element]);

	return portal;
}

/** The places, transitions and arcs the draft removed, drawn as ghosts. */
function RemovedElements(props: { diff: NetDiff; element: HTMLElement }) {
	const sizes = useNodeSizes(props.element, props.diff);
	const centre = (endpoint: Endpoint) => ({
		x: endpoint.x + sizes[endpoint.kind].width / 2,
		y: endpoint.y + sizes[endpoint.kind].height / 2,
	});

	return (
		<>
			<svg style={ghostArcLayerStyle}>
				{props.diff.removedArcs.map((arc) => {
					const from = centre(arc.from);
					const to = centre(arc.to);
					return (
						<line
							key={arc.id}
							x1={from.x}
							y1={from.y}
							x2={to.x}
							y2={to.y}
							stroke={REMOVED_COLOR}
							strokeWidth={2}
							strokeDasharray="7 5"
							opacity={0.6}
						/>
					);
				})}
			</svg>
			{props.diff.removedNodes.map((node) => (
				<GhostNode key={node.id} node={node} size={sizes[node.kind]} />
			))}
		</>
	);
}

function GhostNode(props: { node: RemovedNode; size: NodeSize }) {
	return (
		<div
			style={{
				...ghostNodeStyle,
				left: `${props.node.x}px`,
				top: `${props.node.y}px`,
				width: `${props.size.width}px`,
				height: `${props.size.height}px`,
				borderRadius: props.node.kind === "place" ? "50%" : "12px",
			}}
		>
			{props.node.name}
		</div>
	);
}

type NodeSize = { width: number; height: number };

/** How big Petrinaut is currently drawing places and transitions.
 *
 * The two sizes come from a "compact nodes" user setting the host can't read,
 * so measure a node already on the canvas and fall back to the classic sizes
 * when the draft removed the only one of its kind.
 */
function useNodeSizes(
	element: HTMLElement,
	diff: NetDiff,
): Record<NodeKind, NodeSize> {
	const [sizes, setSizes] = useState(CLASSIC_NODE_SIZES);

	useLayoutEffect(() => {
		const measured = {
			place: measureNode(element, "place") ?? CLASSIC_NODE_SIZES.place,
			transition:
				measureNode(element, "transition") ?? CLASSIC_NODE_SIZES.transition,
		};
		setSizes((previous) =>
			isSameSize(previous.place, measured.place) &&
			isSameSize(previous.transition, measured.transition)
				? previous
				: measured,
		);
	}, [element, diff]);

	return sizes;
}

function measureNode(element: HTMLElement, kind: NodeKind): NodeSize | null {
	const node = element.querySelector<HTMLElement>(`.react-flow__node-${kind}`);
	if (!node?.offsetWidth || !node.offsetHeight) {
		return null;
	}
	return { width: node.offsetWidth, height: node.offsetHeight };
}

const isSameSize = (a: NodeSize, b: NodeSize) =>
	a.width === b.width && a.height === b.height;

const CLASSIC_NODE_SIZES: Record<NodeKind, NodeSize> = {
	place: { width: 130, height: 130 },
	transition: { width: 160, height: 80 },
};

const ghostArcLayerStyle: CSSProperties = {
	position: "absolute",
	left: 0,
	top: 0,
	width: 0,
	height: 0,
	overflow: "visible",
	pointerEvents: "none",
};

const ghostNodeStyle: CSSProperties = {
	position: "absolute",
	boxSizing: "border-box",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "8px",
	border: `2px dashed ${REMOVED_COLOR}`,
	background: "rgba(239, 68, 68, 0.06)",
	color: REMOVED_COLOR,
	fontSize: "15px",
	lineHeight: 1.2,
	textAlign: "center",
	textDecoration: "line-through",
	overflow: "hidden",
	opacity: 0.75,
	pointerEvents: "none",
};
