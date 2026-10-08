import { COMPARATORS, COMPARATOR_MEANINGS, COMPARATOR_SYMBOLS } from "../../constraints/ast";
import type { Atom, Names } from "./edits";
import { NumberField } from "./number-field";
import { Pick } from "./pick";
import { parseRefKey, refKey, refText, subjectGroups } from "./subject-options";

type AtomChipProps = {
  atom: Atom;
  names: Names;
  onChange: (next: Atom) => void;
  onRemove: () => void;
  /** The drag handle, drawn at the left edge. */
  handle?: React.ReactNode;
  /** The chip is being dragged. */
  dragged?: boolean;
  /** A hover on the same condition in another view lit it. */
  linked?: boolean;
  /** The pointer or the focus entered (true) or left (false) the chip. */
  onLink?: (on: boolean) => void;
};

const COMPARATOR_GROUPS = [
  { options: COMPARATORS.map((op) => ({ value: op, label: COMPARATOR_SYMBOLS[op], title: COMPARATOR_MEANINGS[op] })) },
] as const;

/**
 * One condition as one chip, filter-bar style: subject, comparator symbol,
 * value, and a remove. It reads as code: "count(Queue) ≤ 5".
 */
export const AtomChip: React.FC<AtomChipProps> = ({ atom, names, onChange, onRemove, handle, dragged, linked, onLink }) => (
  <span
    className={dragged ? "chip is-dragged" : "chip"}
    role="group"
    aria-label="Condition"
    data-linked={linked}
    onPointerEnter={() => onLink?.(true)}
    onPointerLeave={() => onLink?.(false)}
    onFocus={() => onLink?.(true)}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        onLink?.(false);
      }
    }}
  >
    {handle}
    <Pick
      className="chip__seg chip__seg--subject"
      label="Subject"
      text={refText(atom.ref)}
      value={refKey(atom.ref)}
      groups={subjectGroups(names, atom.ref)}
      searchable
      onPick={(key) => onChange({ ...atom, ref: parseRefKey(key) })}
    />
    <Pick
      className="chip__seg"
      label="Comparison"
      text={COMPARATOR_SYMBOLS[atom.op]}
      title={COMPARATOR_MEANINGS[atom.op]}
      value={atom.op}
      groups={COMPARATOR_GROUPS}
      onPick={(op) => onChange({ ...atom, op: op as Atom["op"] })}
    />
    <NumberField value={atom.value} label="Value" onChange={(value) => onChange({ ...atom, value })} />
    <button type="button" className="chip__remove" aria-label="Remove condition" onClick={onRemove} />
  </span>
);
