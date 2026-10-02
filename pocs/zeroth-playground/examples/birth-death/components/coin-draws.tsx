import "./coin-draws.css";

/** Birth's threshold at rate 2 over a step of 0.5: e^(-1). */
const THRESHOLD = Math.exp(-2 * 0.5);

/** Four draws of u_Birth, one per step: three reach the threshold, close to the chance 0.63. */
const DRAWS = [0.1, 0.71, 0.52, 0.88];

/** Where a value in [0, 1] sits along the axis, as a share of the drawing's width. */
function across(value: number): string {
  return `${8 + value * 84}%`;
}

function verdict(u: number): "fires" | "waits" {
  return u >= THRESHOLD ? "fires" : "waits";
}

/**
 * Birth's coin over four steps: each step one draw lands on [0, 1], and the
 * transition fires when it reaches the threshold. Without motion, the four
 * draws show at once.
 */
export const CoinDraws: React.FC = () => {
  const fired = DRAWS.filter((u) => verdict(u) === "fires").length;
  return (
    <div className="coin-draws" aria-hidden="true">
      <div className="coin-draws__readout">
        {DRAWS.map((u, step) => (
          <span
            key={step}
            className={`coin-draws__step coin-draws__step--${verdict(u)}`}
            style={{ "--step": step } as React.CSSProperties}
          >
            step {step + 1}: u = {u.toFixed(2)}, {verdict(u)}
          </span>
        ))}
        <span className="coin-draws__summary">
          {fired} of {DRAWS.length} draws fire
        </span>
      </div>
      <svg className="coin-draws__axis" width="100%" height={58}>
        <text className="coin-draws__region" x={across(THRESHOLD / 2)} y={13} textAnchor="middle">
          waits
        </text>
        <text className="coin-draws__region coin-draws__region--fires" x={across((1 + THRESHOLD) / 2)} y={13} textAnchor="middle">
          fires
        </text>
        <rect className="coin-draws__band" x={across(THRESHOLD)} y={22} width={`${(1 - THRESHOLD) * 84}%`} height={12} />
        <line className="coin-draws__line" x1={across(0)} y1={28} x2={across(1)} y2={28} />
        <line className="coin-draws__threshold" x1={across(THRESHOLD)} y1={18} x2={across(THRESHOLD)} y2={38} />
        <text className="coin-draws__tick" x={across(0)} y={52} textAnchor="middle">
          0
        </text>
        <text className="coin-draws__tick coin-draws__tick--threshold" x={across(THRESHOLD)} y={52} textAnchor="middle">
          θ = {THRESHOLD.toFixed(2)}
        </text>
        <text className="coin-draws__tick" x={across(1)} y={52} textAnchor="middle">
          1
        </text>
        {DRAWS.map((u, step) => (
          <circle
            key={step}
            className={`coin-draws__draw coin-draws__draw--${verdict(u)}`}
            style={{ "--step": step } as React.CSSProperties}
            cx={across(u)}
            cy={28}
            r={5}
          />
        ))}
      </svg>
    </div>
  );
};
