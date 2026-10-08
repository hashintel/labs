import { useState } from "react";

import { scopeNotes } from "../../constraints";
import { TOP_WORDS } from "../../constraints/ast";
import type { Constraint } from "../../constraints/ast";
import { changeOperator, setWindow, stateAt } from "./edits";
import type { Path, TopOp } from "./edits";
import { Slot, noteOf } from "./group";
import type { BuilderContext } from "./group";
import { OPERATOR_HINTS } from "./hints";
import { Pick } from "./pick";
import { WindowField } from "./window-field";

import "./constraint-builder.css";

type ConstraintBuilderProps = {
  value: Constraint;
  /** Names of the defined metrics, the places and the transitions of the net. */
  metrics: string[];
  places: string[];
  transitions: string[];
  /** MTL is on: the builder offers "+ window". */
  mtl: boolean;
  /** Nested operators are on: the builder offers "+ Temporal operator". */
  nested: boolean;
  onChange: (next: Constraint) => void;
  /** The conditions lit by a hover elsewhere, by canonical text. */
  linked?: readonly string[];
  /** A hover or focus on a condition reports its canonical text; leaving reports `null`. */
  onLink?: (keys: string[] | null) => void;
};

const NO_KEYS: readonly string[] = [];

const OPERATORS: TopOp[] = ["now", "always", "eventually", "until", "weak-until"];

const OPERATOR_GROUPS = [
  { options: OPERATORS.map((op) => ({ value: op, label: TOP_WORDS[op] })) },
] as const;

/**
 * The no-code constraint builder. It reads as the team's keywords: "[ALWAYS]
 * …", or "[…] [UNTIL] […]". The temporal operator is a chip you change in
 * place; the conditions, groups and IF … THEN blocks follow it.
 * Every edit hands the whole next constraint to `onChange`.
 */
export const ConstraintBuilder: React.FC<ConstraintBuilderProps> = ({
  value,
  metrics,
  places,
  transitions,
  mtl,
  nested,
  onChange,
  linked = NO_KEYS,
  onLink = () => {},
}) => {
  const [dragging, setDragging] = useState<Path | null>(null);
  const ctx: BuilderContext = {
    value,
    names: { metrics, places, transitions },
    notes: scopeNotes(value),
    mtl,
    nested,
    edit: onChange,
    dragging,
    setDragging,
    linked,
    onLink,
  };
  const operator = (text: string) => (
    <Pick
      className="operator"
      label="Temporal operator"
      text={text}
      hint={value.op === "now" ? undefined : OPERATOR_HINTS[value.op]}
      value={value.op}
      groups={OPERATOR_GROUPS}
      onPick={(op) => onChange(changeOperator(value, op as TopOp))}
    />
  );
  const window =
    value.op === "now" ? null : (
      <WindowField
        window={value.window}
        mtl={mtl}
        onChange={(next) => onChange(setWindow(value, [], next))}
      />
    );
  const body = value.op === "until" || value.op === "weak-until" ? null : stateAt(value, ["body"]);
  const windowNote =
    value.op !== "now" && value.window !== undefined ? (
      <span className="scope-note">{noteOf(ctx, "window", [])}</span>
    ) : null;
  return (
    <div className="builder">
      {value.op === "until" || value.op === "weak-until" ? (
        <>
          <div className="builder__head">
            <div className="builder__line builder__line--flow">
              <Slot ctx={ctx} path={["hold"]} compact />
              {operator(TOP_WORDS[value.op])}
              {window}
              <Slot ctx={ctx} path={["goal"]} compact />
            </div>
            {windowNote}
          </div>
        </>
      ) : (
        <div className="builder__head">
          <div className="builder__line builder__line--flow builder__line--body">
            {operator(TOP_WORDS[value.op])}
            {window}
            <Slot ctx={ctx} path={["body"]} nested={body?.kind === "and" || body?.kind === "or"} />
          </div>
          {value.op === "now" ? <span className="scope-note">{noteOf(ctx, "now")}</span> : windowNote}
        </div>
      )}
    </div>
  );
};
