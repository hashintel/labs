import { delayFromDraw, fireModifier, survival, threshold } from "./exponential";
import { fixed } from "./format";
import { modifierClass } from "./modifier-class";
import { curvePath, niceCeil, xOf, yOf } from "./plot-frame";
import { useWidth } from "./use-width";

import type { PlotFrame } from "./plot-frame";

type SurvivalPlotProps = {
  lambda: number;
  dt: number;
  /** The last uniform draw, if any. */
  draw: number | undefined;
};

const HEIGHT = 164;

/** The horizon that shows the step and the delay until only 5% of clocks are left. */
function survivalHorizon(lambda: number, dt: number): number {
  return niceCeil(Math.max(dt * 1.25, 3 / lambda));
}

/** Where a label under the axis starts, so that it stays beside the point it names and inside the plot. */
function anchorNear(x: number, frame: PlotFrame, room: number): "start" | "middle" | "end" {
  if (x - frame.left < room) {
    return "start";
  }
  return frame.width - frame.right - x < room ? "end" : "middle";
}

/**
 * The survival S(t) = e^(-λt) with the step [0, Δt], the threshold θ = S(Δt)
 * and the band [θ, 1] of draws that fire, and the last draw read both ways:
 * u on the probability axis, τ = -ln(u)/λ on the time axis, joined through
 * the curve. It draws at one unit per pixel of its measured width, so its
 * text keeps its size whatever the panel's width.
 */
export const SurvivalPlot: React.FC<SurvivalPlotProps> = ({ lambda, dt, draw }) => {
  const [width, measure] = useWidth();
  const frame: PlotFrame = {
    width,
    height: HEIGHT,
    left: 38,
    right: 12,
    top: 24,
    bottom: 36,
    horizon: survivalHorizon(lambda, dt),
  };
  const theta = threshold(lambda, dt);
  const x0 = xOf(frame, 0);
  const xEnd = xOf(frame, frame.horizon);
  const xStep = xOf(frame, dt);
  const yBase = yOf(frame, 0);
  const yTop = yOf(frame, 1);
  const yTheta = yOf(frame, theta);
  const tickRow = yBase + 15;
  const delayRow = yBase + 30;

  const tau = draw === undefined ? undefined : delayFromDraw(lambda, draw);
  const tauInside = tau !== undefined && tau <= frame.horizon;
  const xTau = tau === undefined ? x0 : xOf(frame, tau);
  const yDraw = draw === undefined ? yBase : yOf(frame, draw);

  const description =
    `Survival S(t) = e^(−${fixed(lambda, 0)}t) up to t = ${frame.horizon}. ` +
    `The step ends at Δt = ${fixed(dt, 2)}, where S(Δt) = θ = ${fixed(theta, 3)}; draws above θ fire.` +
    (draw === undefined || tau === undefined
      ? ""
      : ` The last draw u = ${fixed(draw, 3)} meets the curve at τ = ${fixed(tau, 2)}.`);

  return (
    <div className="survival-plot" ref={measure} style={{ height: HEIGHT }}>
      {width === 0 ? null : (
        <svg width={width} height={HEIGHT} role="img" aria-label={description}>
          <text className="survival-plot__text survival-plot__text--muted" x={x0} y={12}>
            S(t) = e^(−{fixed(lambda, 0)}t)
          </text>

          <rect className="survival-plot__band" x={x0} y={yTop} width={xStep - x0} height={yTheta - yTop} />
          <line className="survival-plot__mark" x1={x0} y1={yTop} x2={x0} y2={yTheta} />
          {yTheta - yTop > 30 ? (
            <text className="survival-plot__text survival-plot__text--accent" x={x0 - 6} y={(yTop + yTheta) / 2 + 4} textAnchor="end">
              p
            </text>
          ) : null}

          <line className="survival-plot__axis" x1={x0} y1={yBase} x2={xEnd} y2={yBase} />
          <line className="survival-plot__axis" x1={x0} y1={yTop} x2={x0} y2={yBase} />
          <line className="survival-plot__mark" x1={x0} y1={yBase} x2={xStep} y2={yBase} />
          <line className="survival-plot__guide" x1={x0} y1={yTheta} x2={xStep} y2={yTheta} />
          <line className="survival-plot__guide" x1={xStep} y1={yTheta} x2={xStep} y2={yBase} />
          <path className="survival-plot__curve" d={curvePath(frame, (t) => survival(lambda, t), 0, frame.horizon)} />

          {yTheta - yTop >= 16 ? (
            <text className="survival-plot__text survival-plot__text--muted" x={x0 - 6} y={yTop + 4} textAnchor="end">
              1
            </text>
          ) : null}
          <text className="survival-plot__text survival-plot__text--accent" x={x0 - 6} y={yTheta + 4} textAnchor="end">
            {fixed(theta, 2)}
          </text>
          {yBase - yTheta >= 16 ? (
            <text className="survival-plot__text survival-plot__text--muted" x={x0 - 6} y={yBase + 4} textAnchor="end">
              0
            </text>
          ) : null}

          {xStep - x0 >= 22 ? (
            <text className="survival-plot__text survival-plot__text--muted" x={x0} y={tickRow} textAnchor="middle">
              0
            </text>
          ) : null}
          <text
            className="survival-plot__text survival-plot__text--accent"
            x={xStep}
            y={tickRow}
            textAnchor={xStep - x0 >= 22 ? "middle" : "start"}
          >
            Δt
          </text>
          {xEnd - xStep >= 60 ? (
            <text className="survival-plot__text survival-plot__text--muted" x={xEnd} y={tickRow} textAnchor="end">
              t = {frame.horizon}
            </text>
          ) : null}

          {draw === undefined || tau === undefined ? null : (
            <g className={modifierClass("survival-plot__draw", fireModifier(draw, theta))}>
              <line className="survival-plot__draw-line" x1={x0} y1={yDraw} x2={xTau} y2={yDraw} />
              {tauInside ? <line className="survival-plot__draw-line" x1={xTau} y1={yDraw} x2={xTau} y2={yBase} /> : null}
              <circle className="survival-plot__draw-dot" cx={x0} cy={yDraw} r={3.5} />
              {tauInside ? <circle className="survival-plot__draw-dot" cx={xTau} cy={yBase} r={3.5} /> : null}
              <text
                className="survival-plot__draw-label"
                x={tauInside && xTau - x0 < 24 ? xTau + 6 : x0 + 7}
                y={yDraw - yTop < 14 ? yDraw + 14 : yDraw - 5}
              >
                u
              </text>
              {tauInside ? (
                <text className="survival-plot__draw-label" x={xTau} y={delayRow} textAnchor={anchorNear(xTau, frame, 24)}>
                  τ = {fixed(tau, 2)}
                </text>
              ) : (
                <text className="survival-plot__draw-label" x={xEnd} y={delayRow} textAnchor="end">
                  τ = {fixed(tau, 2)} →
                </text>
              )}
            </g>
          )}
        </svg>
      )}
    </div>
  );
};
