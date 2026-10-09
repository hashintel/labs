import { useState } from "react";

import { delayFromDraw, effectiveRate, fireModifier, firesAt, threshold } from "./coin-clock-explorer/exponential";
import { fixed } from "./coin-clock-explorer/format";
import { modifierClass } from "./coin-clock-explorer/modifier-class";
import { RangeField } from "./coin-clock-explorer/range-field";
import { SurvivalPlot } from "./coin-clock-explorer/survival-plot";

import "./coin-clock-explorer.css";

/** Birth's rate. */
const LAMBDA = 2;

/** A uniform draw in (0, 1], so that its delay -ln(u)/λ is always finite. */
function uniformDraw(): number {
  return 1 - Math.random();
}

/** The parts of an equation joined by no-break spaces, so that a line never breaks inside it. */
function unbroken(...parts: string[]): string {
  return parts.join(" ");
}

/** What one draw decides, read by the coin and by the clock it stands for. */
function verdictOf(dt: number, draw: number | undefined): string {
  if (draw === undefined) {
    return "Press Draw to toss Birth's coin for one step.";
  }
  const theta = threshold(LAMBDA, dt);
  const u = fixed(draw, 3);
  const th = fixed(theta, 3);
  const tau = fixed(delayFromDraw(LAMBDA, draw), 2);
  return firesAt(draw, theta)
    ? `${unbroken("u", "=", u, "≥", "θ", "=", th)}: fires. Its clock would expire at ${unbroken("τ", "=", tau, "≤", "Δt")}.`
    : `${unbroken("u", "=", u, "<", "θ", "=", th)}: waits. Its clock would expire at ${unbroken("τ", "=", tau, ">", "Δt")}.`;
}

/**
 * Birth's coin against its clock: one draw read both ways on the survival
 * curve, and the rate the coin reaches when it fires at most once per step.
 */
export const CoinClockExplorer: React.FC = () => {
  const [dt, setDt] = useState(0.5);
  const [draw, setDraw] = useState<number | undefined>(undefined);
  const theta = threshold(LAMBDA, dt);

  return (
    <div className="explorer">
      <RangeField label="Step Δt" value={dt} valueText={fixed(dt, 2)} min={0.05} max={2} step={0.05} onChange={setDt} />
      <SurvivalPlot lambda={LAMBDA} dt={dt} draw={draw} />
      <div className="explorer__draw">
        <button type="button" className="explorer__button" onClick={() => setDraw(uniformDraw())}>
          Draw
        </button>
        <output className={modifierClass("explorer__verdict", fireModifier(draw, theta))}>{verdictOf(dt, draw)}</output>
      </div>
      <div className="explorer__rate">
        Coin rate p/Δt = <span className="explorer__value">{fixed(effectiveRate(LAMBDA, dt), 2)}</span>, below λ = {LAMBDA}
      </div>
    </div>
  );
};
