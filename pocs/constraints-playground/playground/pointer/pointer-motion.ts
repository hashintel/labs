/**
 * Whether the pointer is sweeping or resting, read off its moves. A hand
 * resting on a mouse or a trackpad still drifts a little, so the pointer
 * counts as resting below a speed close to zero rather than at zero.
 */

/** The speed, in pixels per millisecond, below which the pointer rests: 50 px a second. */
const RESTING_SPEED = 0.05;

/**
 * How long the pointer rests on a target before a hover takes effect. The
 * Compiler view's texts quote it, so it lives here, away from the page
 * listener in `use-dwell.ts`.
 */
export const DWELL_MS = 60;

/** Where the pointer was at a time, in the page's milliseconds. */
export type PointerSample = { x: number; y: number; t: number };

/** The pointer's last position, and when it last moved faster than resting. */
export type PointerMotion = { last: PointerSample | null; movedAt: number };

/** Before any move, the pointer has always rested. */
export const NO_MOTION: PointerMotion = { last: null, movedAt: Number.NEGATIVE_INFINITY };

/** The motion after one more move. Two moves at one timestamp count as a millisecond apart. */
export function sampleMotion(motion: PointerMotion, sample: PointerSample): PointerMotion {
  const { last } = motion;
  const moving =
    last !== null &&
    Math.hypot(sample.x - last.x, sample.y - last.y) > RESTING_SPEED * Math.max(sample.t - last.t, 1);
  return { last: sample, movedAt: moving ? sample.t : motion.movedAt };
}

/** How long the pointer must still rest, at `now`, to have rested for `ms`. */
export function restLeft(motion: PointerMotion, now: number, ms: number): number {
  return Math.max(0, motion.movedAt + ms - now);
}
