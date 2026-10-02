import "./clock-race.css";

/** The racers, in the order they are drawn: each bar's animation is in the CSS, keyed by its id. */
const CLOCKS = ["TakeLeft", "TakeRight"] as const;

/** Pool's tokens, each taken at the firing its modifier names in the CSS. */
const TOKENS = 3;

/**
 * TakeLeft and TakeRight race for Pool's tokens. Both clocks run down at the
 * same speed toward 0; the first to reach 0 fires, takes a token and re-arms,
 * while the other keeps its time. With Pool empty, both clocks wait.
 */
export const ClockRace: React.FC = () => {
  return (
    <div className="clock-race" aria-hidden="true">
      {CLOCKS.map((clock) => (
        <div key={clock} className={`clock-race__clock clock-race__clock--${clock}`}>
          <div className="clock-race__head">
            <span className="clock-race__name">clk_{clock}</span>
            <span className="clock-race__fires">fires</span>
          </div>
          <div className="clock-race__track">
            <span className="clock-race__zero">0</span>
            <span className="clock-race__rail">
              <span className="clock-race__bar" />
            </span>
          </div>
        </div>
      ))}
      <div className="clock-race__pool">
        <span className="clock-race__name">Pool</span>
        <span className="clock-race__contents">
          <span className="clock-race__tokens">
            {Array.from({ length: TOKENS }, (_, index) => (
              <span key={index} className={`clock-race__token clock-race__token--${index + 1}`} />
            ))}
          </span>
          <span className="clock-race__wait">empty: both clocks wait</span>
        </span>
      </div>
    </div>
  );
};
