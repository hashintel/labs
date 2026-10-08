import { HOLE_INFO } from "../../constraints";
import { Timeline } from "./timeline";

import type { Verdict } from "../../constraints/ast";
import type { RunView } from "./analysis";

import "./run-panel.css";

type RunPanelProps = {
  run: RunView | null;
  /** Why there is no run. */
  blocked: string | null;
  seed: number;
  onSeed: (seed: number) => void;
  onRerun: () => void;
  /** The conditions a hover has lit, by canonical text. */
  linked?: readonly string[];
  /** A hover on a timeline row reports the conditions it stands for. */
  onLink?: (keys: string[] | null) => void;
  /** Called with the height the panel's content needs, each time it changes. */
  onFit?: (height: number) => void;
};

const VERDICT_WORDS: Record<Verdict, string> = {
  satisfied: "Satisfied",
  violated: "Violated",
  pending: "Pending",
};

/** The Run panel: the seed and Re-run, the verdict, a sentence on the result, why the run stopped, the timeline. */
export const RunPanel: React.FC<RunPanelProps> = ({ run, blocked, seed, onSeed, onRerun, linked, onLink, onFit }) => {
  // The observer reports the content's own height, which the pane's size does not change.
  const observe = (content: HTMLDivElement | null) => {
    if (content === null || onFit === undefined) {
      return;
    }
    const observer = new ResizeObserver(() => onFit(content.offsetHeight));
    observer.observe(content);
    return () => observer.disconnect();
  };
  // The badge of an incomplete run already says what the hole info says.
  const diagnostics = run?.diagnostics.filter((diagnostic) => diagnostic.message !== HOLE_INFO) ?? [];
  return (
    <div className="run">
      <div className="run__content" ref={observe}>
        <div className="run__bar">
          <label className="run__seed">
            <span className="caps">Seed</span>
            <input
              className="run__seed-input"
              type="number"
              step={1}
              value={seed}
              onChange={(event) => {
                const next = event.currentTarget.valueAsNumber;
                if (Number.isInteger(next)) {
                  onSeed(next);
                }
              }}
            />
          </label>
          <button type="button" className="run__rerun" onClick={onRerun}>
            Re-run
          </button>
          {run === null ? null : run.incomplete ? (
            <span className="run__verdict" data-verdict="incomplete">
              Incomplete: fill every slot
            </span>
          ) : (
            <span className="run__verdict" data-verdict={run.verdict}>
              {VERDICT_WORDS[run.verdict]}
            </span>
          )}
          {run === null || run.incomplete ? null : (
            <span className="run__stop">
              <span className="caps">Stopped</span> {run.stopReason}
            </span>
          )}
        </div>
        {run === null ? (
          <p className="note">{blocked}</p>
        ) : (
          <>
            {run.incomplete || run.summary === null ? null : <p className="run__summary">{run.summary}</p>}
            {run.incomplete || run.check !== "monitor" ? null : (
              <p className="run__check">Checked as the run goes, may only decide at the end</p>
            )}
            {diagnostics.length === 0 ? null : (
              <ul className="run__diagnostics">
                {diagnostics.map((diagnostic, index) => (
                  <li key={index} data-severity={diagnostic.severity}>
                    {diagnostic.message}
                  </li>
                ))}
              </ul>
            )}
            {run.incomplete ? null : <Timeline timeline={run.timeline} decidedAt={run.decidedAt} final={run.verdict !== "pending"} pass={run.pass} linked={linked} onLink={onLink} />}
          </>
        )}
      </div>
    </div>
  );
};
