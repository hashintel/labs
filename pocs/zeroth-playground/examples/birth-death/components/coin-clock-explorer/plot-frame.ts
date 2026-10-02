/**
 * The coordinate space of a small time plot: t from 0 to a horizon across,
 * a probability from 0 to 1 up, drawn in an SVG viewBox.
 */
export type PlotFrame = {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** The last time on the axis. */
  horizon: number;
};

const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** The smallest round number at or above `x`: 1, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 times a power of ten. */
export function niceCeil(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) {
    return 1;
  }
  const power = 10 ** Math.floor(Math.log10(x));
  const step = NICE_STEPS.find((candidate) => candidate * power >= x * (1 - 1e-9)) ?? 10;
  return step * power;
}

/** How far across the plot sits time `t`. */
export function xOf(frame: PlotFrame, t: number): number {
  const span = frame.width - frame.left - frame.right;
  return frame.left + (Math.min(Math.max(t, 0), frame.horizon) / frame.horizon) * span;
}

/** How far down the plot sits probability `v`. */
export function yOf(frame: PlotFrame, v: number): number {
  const span = frame.height - frame.top - frame.bottom;
  return frame.top + (1 - Math.min(Math.max(v, 0), 1)) * span;
}

/** An SVG path through `curve(t)` for t from `from` to `to`, cut at the horizon. */
export function curvePath(
  frame: PlotFrame,
  curve: (t: number) => number,
  from: number,
  to: number,
  samples = 96,
): string {
  const end = Math.min(to, frame.horizon);
  if (end <= from) {
    return "";
  }
  const points: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = from + ((end - from) * i) / samples;
    points.push(`${round(xOf(frame, t))},${round(yOf(frame, curve(t)))}`);
  }
  return `M${points.join("L")}`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
