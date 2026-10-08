import { Suspense, useDeferredValue } from "react";

import { netGraph } from "./net-graph";
import { Drawing } from "./net-preview/drawing";

import type { NetItem, PetriNetIr } from "../../compiler";

import "./net-preview.css";

type NetPreviewProps = {
  ir: PetriNetIr;
  /** The net item lit by a hover in any view. */
  lit: NetItem | null;
  onHover: (source: NetItem | null) => void;
  /** The places and transitions a hovered condition reads, lit as the same pointer would light one. */
  linked?: readonly NetItem[];
};

const NO_ITEMS: readonly NetItem[] = [];

/**
 * The net as a plain SVG: places as circles with their marking as dots,
 * transitions as squares, arcs as arrows with their weights, laid out by
 * elkjs. Hovering a place or transition lights it and reports it, so the
 * editors light its lines; a lit item from either editor shows here. The one
 * component that takes a `PetriNetIr`, so a canvas can replace it later.
 */
export const NetPreview: React.FC<NetPreviewProps> = ({ ir, lit, onHover, linked = NO_ITEMS }) => {
  const graph = netGraph(ir);
  // A structural change lays out in the background while the last drawing stays up.
  const shown = useDeferredValue(graph);
  return (
    <div className="net-frame">
      <Suspense fallback={<p className="note">Laying out the net…</p>}>
        <Drawing graph={shown} lit={lit} onHover={onHover} linked={linked} />
      </Suspense>
    </div>
  );
};
