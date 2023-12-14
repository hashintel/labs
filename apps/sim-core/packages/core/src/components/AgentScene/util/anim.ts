import { AgentState, Vec3 } from "@hashintel/engine-web";

export interface AnimValue<A> {
  current: A;
  to: A;
}
export interface AgentTransition {
  position: AnimValue<Vec3>;
  direction: AnimValue<Vec3>;
  color: AnimValue<Vec3>;
  scale: AnimValue<Vec3>;
  useHeight: boolean;
  remove: boolean;
  original: AgentState;
  shape: string;
  hidden: boolean;
  // we check network_neighbor_* fields and only use them if they are string[]
  network_neighbor_ids?: unknown;
  network_neighbor_in_ids: unknown;
  network_neighbor_out_ids: unknown;
}

export type RenderSummary = Record<string, AgentTransition>;

// Mutably advances "cur" to "to" based on the lerpval
export function lerpAnimValue<A extends Vec3>(
  { current, to }: AnimValue<A>,
  lerpVal: number,
): [number, number, number] {
  if (current) {
    return [
      lerp(current[0], to[0], lerpVal),
      lerp(current[1], to[1], lerpVal),
      lerp(current[2], to[2], lerpVal),
    ];
  } else {
    return to;
  }
}

/**
 * Lerp - Linear Interpolation creates a smooth transiton between two points, x and y
 * The lerpval determines the increment left to transition from x to y
 */
export const lerp = (x: number, y: number, lerpVal: number) =>
  y * lerpVal + x * (1 - lerpVal);
