import { ConstraintBuilder } from "../constraint-builder/constraint-builder";

import type { Constraint } from "../../constraints/ast";

import "./builder-slot.css";

type BuilderSlotProps = {
  /** The constraint of the last text that parsed, or `null` before any did. */
  value: Constraint | null;
  metrics: string[];
  places: string[];
  transitions: string[];
  mtl: boolean;
  nested: boolean;
  /** The text does not parse, so the builder shows the last text that did. */
  textHasErrors: boolean;
  onChange: (constraint: Constraint) => void;
  /** The conditions lit by a hover elsewhere, by canonical text. */
  linked?: readonly string[];
  /** A hover or focus on a condition reports its canonical text; leaving reports `null`. */
  onLink?: (keys: string[] | null) => void;
  /** Called with the height the builder needs, its padding included, each time its content changes size. */
  onFit?: (height: number) => void;
};

/** Where the no-code builder sits: the builder once a text has parsed, a note before. */
export const BuilderSlot: React.FC<BuilderSlotProps> = ({
  value,
  metrics,
  places,
  transitions,
  mtl,
  nested,
  textHasErrors,
  onChange,
  linked,
  onLink,
  onFit,
}) => {
  // The observer reports the content's own height, which the pane's size does not change.
  const observe = (content: HTMLDivElement | null) => {
    const slot = content?.parentElement;
    if (content === null || slot === null || slot === undefined || onFit === undefined) {
      return;
    }
    const report = () => {
      const style = getComputedStyle(slot);
      onFit(content.offsetHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom));
    };
    const observer = new ResizeObserver(report);
    observer.observe(content);
    return () => observer.disconnect();
  };
  return value === null ? (
    <p className="note">The builder shows the constraint once constraint.yaml parses.</p>
  ) : (
    <div className="builder-slot">
      <div ref={observe}>
        {textHasErrors && <p className="builder-slot__errors">text has errors</p>}
        <ConstraintBuilder
          value={value}
          metrics={metrics}
          places={places}
          transitions={transitions}
          mtl={mtl}
          nested={nested}
          onChange={onChange}
          linked={linked}
          onLink={onLink}
        />
      </div>
    </div>
  );
};
