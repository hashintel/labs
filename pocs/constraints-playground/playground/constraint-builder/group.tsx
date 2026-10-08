import { useId, useState } from "react";

import { atomText } from "../../constraints/walk";
import { TEMPORAL_WORDS } from "../../constraints/ast";
import type { Constraint, StateExpr, TemporalOp } from "../../constraints/ast";
import type { ScopeNote } from "../../constraints";
import { AtomChip } from "./atom-chip";
import {
  addCondition,
  addGroup,
  addIf,
  addIff,
  addItem,
  addLater,
  addOtherwise,
  canMoveInto,
  changeNestedOperator,
  fillHole,
  isHole,
  moveInto,
  rewriteNot,
  withoutNot,
  removeAt,
  setAtom,
  setConnective,
  setWindow,
  stateAt,
  wrapInGroup,
} from "./edits";
import type { Connective, ItemKind, Names, Path } from "./edits";
import { HintPopover, useHint } from "./hint";
import { OPERATOR_HINTS, WORD_HINTS } from "./hints";
import { ItemShell } from "./item-menu";
import type { ItemAction } from "./item-menu";
import { Pick } from "./pick";
import { WindowField } from "./window-field";

import "./constraint-builder.css";

/** What every part of the tree needs: the constraint, the names to offer, the scope notes, and where an edit goes. */
export type BuilderContext = {
  value: Constraint;
  names: Names;
  notes: readonly ScopeNote[];
  /** MTL is on: windows can be added. */
  mtl: boolean;
  /** Nested operators are on: a temporal operator can be added inside. */
  nested: boolean;
  edit: (next: Constraint) => void;
  /** The path of the item being dragged, or null. */
  dragging: Path | null;
  setDragging: (path: Path | null) => void;
  /** The conditions lit by a hover elsewhere, by canonical text. */
  linked: readonly string[];
  /** A hover or focus on a condition reports its canonical text; leaving reports `null`. */
  onLink: (keys: string[] | null) => void;
};

type SlotProps = {
  ctx: BuilderContext;
  path: Path;
  /** Drawn as a bracketed box. */
  nested?: boolean;
  /** The add row is one "+ Add" menu, for the parts of a block. */
  compact?: boolean;
  /** Draws the add row under the items; a caller that places it elsewhere turns this off. */
  actions?: boolean;
  /** The ••• button of the item this group is, placed in its add row. */
  menu?: React.ReactNode;
  /** The drag handle of the item this group is, at its top-left. */
  handle?: React.ReactNode;
};

type AddActionsProps = {
  ctx: BuilderContext;
  path: Path;
  compact?: boolean;
  menu?: React.ReactNode;
};

const CONNECTIVES = [
  {
    options: [
      { value: "and", label: "AND" },
      { value: "or", label: "OR" },
    ],
  },
] as const;

/** The hover title of the IFF add button; the IFF word has a hint. */
const IFF_TITLE = "if and only if: both sides true, or both false";

const LATER_OPTION = { value: "later", label: "Temporal operator" } as const;

/** The options of the "+ Add" menu of a list. "Temporal operator" shows only while nested operators are on. */
export function addGroups(nested: boolean) {
  return [
    {
      options: [
        { value: "condition", label: "Condition" },
        { value: "group", label: "Group" },
        { value: "if", label: "IF … THEN" },
        { value: "iff", label: "IFF" },
        ...(nested ? [LATER_OPTION] : []),
      ],
    },
  ];
}

/** The options of an empty slot's menu. */
export function holeGroups(nested: boolean) {
  return [
    {
      options: [
        { value: "condition", label: "Condition" },
        { value: "if", label: "IF … THEN" },
        { value: "iff", label: "IFF" },
        ...(nested ? [LATER_OPTION] : []),
      ],
    },
  ];
}

const NESTED_OPERATORS: TemporalOp[] = ["always", "eventually", "until", "weak-until"];

const NESTED_OPERATOR_GROUPS = [
  { options: NESTED_OPERATORS.map((op) => ({ value: op, label: TEMPORAL_WORDS[op] })) },
] as const;

/** The message of the scope note of a kind about the node at a path; no path is the whole constraint. */
export function noteOf(ctx: BuilderContext, kind: ScopeNote["kind"], path?: Path): string | undefined {
  const note = ctx.notes.find(
    (candidate) =>
      candidate.kind === kind &&
      (path === undefined ? candidate.path === undefined : candidate.path?.join() === path.join()),
  );
  return note?.message;
}

/**
 * The ••• menu of an item: wrap, remove. The builder never adds a `NOT`; a
 * `not` typed in the text gets one more item that removes it with the same
 * meaning.
 */
function actionsFor(expr: StateExpr): ItemAction[] {
  return [
    ...(expr.kind === "not" && withoutNot(expr.operand) !== null
      ? [{ value: "rewrite", label: "Remove NOT (same meaning)" }]
      : []),
    { value: "wrap", label: "Wrap in group" },
    { value: "remove", label: "Remove" },
  ];
}

type EntryProps = {
  ctx: BuilderContext;
  path: Path;
  expr: StateExpr;
  label: string;
  children: (menu: React.ReactNode, handle: React.ReactNode) => React.ReactNode;
};

type DragHandleProps = { ctx: BuilderContext; path: Path };

/**
 * The grip an item is dragged by. Only the grip is draggable, so the chip's
 * selects and fields keep working; the drag image is the whole item.
 */
export const DragHandle: React.FC<DragHandleProps> = ({ ctx, path }) => (
  <span
    className="grip"
    draggable
    title="Drag into an empty slot"
    onDragStart={(event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/json", JSON.stringify(path));
      const item = event.currentTarget.closest(".chip, .box, .group--nested");
      if (item) {
        event.dataTransfer.setDragImage(item, 0, 0);
      }
      ctx.setDragging(path);
    }}
    onDragEnd={() => ctx.setDragging(null)}
  >
    <svg className="grip__dots" width="6" height="10" viewBox="0 0 6 10" aria-hidden="true">
      {[1, 5, 9].map((y) => (
        <g key={y}>
          <circle cx="1" cy={y} r="1" />
          <circle cx="5" cy={y} r="1" />
        </g>
      ))}
    </svg>
  </span>
);

/** An item with its ••• menu, wired to the edits. */
const Entry: React.FC<EntryProps> = ({ ctx, path, expr, label, children }) => (
  <ItemShell
    label={label}
    actions={actionsFor(expr)}
    onAction={(action) => {
      switch (action) {
        case "rewrite":
          return ctx.edit(rewriteNot(ctx.value, path));
        case "wrap":
          return ctx.edit(wrapInGroup(ctx.value, path));
        default:
          return ctx.edit(removeAt(ctx.value, path));
      }
    }}
  >
    {(menu) => children(menu, <DragHandle ctx={ctx} path={path} />)}
  </ItemShell>
);

/** The keyword between two parts of a block: "THEN", "ELSE", "IFF". Its hover says what it means. */
const Word: React.FC<{ text: string }> = ({ text }) => {
  const id = `word${useId().replace(/[^a-zA-Z0-9_-]/gu, "")}`;
  const hint = WORD_HINTS[text];
  const hinted = useHint();
  return (
    <>
      <span
        className="word"
        aria-describedby={hint !== undefined && hinted.open ? `${id}-hint` : undefined}
        style={{ anchorName: `--${id}` } as React.CSSProperties}
        {...(hint === undefined ? {} : hinted.triggers)}
      >
        {text}
      </span>
      {hint !== undefined && hinted.open ? <HintPopover hint={hint} id={`${id}-hint`} anchor={`--${id}`} /> : null}
    </>
  );
};

/** A word with the part after it, which stay on one line together: "then [ … ]". */
const Clause: React.FC<{ word: string; children: React.ReactNode }> = ({ word, children }) => (
  <span className="clause">
    <Word text={word} />
    {children}
  </span>
);

type HoleChipProps = { ctx: BuilderContext; path: Path; onRemove?: () => void };

/** An empty slot: a dashed chip whose menu fills it. It takes the item dragged over it, when that item fits. */
const HoleChip: React.FC<HoleChipProps> = ({ ctx, path, onRemove }) => {
  const [over, setOver] = useState(false);
  const accepts = ctx.dragging !== null && canMoveInto(ctx.value, ctx.dragging, path);
  return (
    <span
      className={over && accepts ? "chip chip--hole chip--target" : "chip chip--hole"}
      onDragOver={(event) => {
        if (accepts) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setOver(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOver(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        ctx.setDragging(null);
        const from = readPath(event.dataTransfer.getData("application/json"));
        if (from) {
          ctx.edit(moveInto(ctx.value, from, path));
        }
      }}
    >
      <Pick
        className="chip__seg"
        label="Empty slot"
        text="choose a condition"
        value=""
        groups={holeGroups(ctx.nested)}
        onPick={(kind) => ctx.edit(fillHole(ctx.value, path, kind as ItemKind, ctx.names))}
      />
      {onRemove && <button type="button" className="chip__remove" aria-label="Remove empty slot" onClick={onRemove} />}
    </span>
  );
};

/** The path a drag carries, or null when the data is not one. */
function readPath(data: string): Path | null {
  try {
    const parsed: unknown = JSON.parse(data);
    return Array.isArray(parsed) && parsed.every((key) => typeof key === "string" || typeof key === "number")
      ? (parsed as Path)
      : null;
  } catch {
    return null;
  }
}

type ItemProps = { ctx: BuilderContext; path: Path; expr: StateExpr; inGroup: boolean };

/** One entry of a list: a condition chip, a hole, or a bracketed block that carries its own lists. */
const Item: React.FC<ItemProps> = ({ ctx, path, expr, inGroup }) => {
  const remove = () => ctx.edit(removeAt(ctx.value, path));
  const dragged = ctx.dragging?.join() === path.join();
  const box = (modifier?: string) => ["box", modifier, dragged ? "is-dragged" : undefined].filter(Boolean).join(" ");
  switch (expr.kind) {
    case "hole":
      return <HoleChip ctx={ctx} path={path} onRemove={inGroup ? remove : undefined} />;
    case "atom":
      return (
        <Entry ctx={ctx} path={path} expr={expr} label="Condition">
          {(menu, handle) => (
            <span className="atom-row">
              <AtomChip
                atom={expr}
                linked={ctx.linked.includes(atomText(expr))}
                onLink={(on) => ctx.onLink(on ? [atomText(expr)] : null)}
                handle={handle}
                dragged={dragged}
                names={ctx.names}
                onChange={(next) => ctx.edit(setAtom(ctx.value, path, next))}
                onRemove={remove}
              />
              {menu}
            </span>
          )}
        </Entry>
      );
    case "bool":
      return (
        <Entry ctx={ctx} path={path} expr={expr} label="Condition">
          {(menu, handle) => (
            <span className="atom-row">
              <span className={dragged ? "chip is-dragged" : "chip"}>
                {handle}
                <span className="chip__seg chip__word">{String(expr.value)}</span>
                <button type="button" className="chip__remove" aria-label="Remove condition" onClick={remove} />
              </span>
              {menu}
            </span>
          )}
        </Entry>
      );
    case "and":
    case "or":
      return (
        <Entry ctx={ctx} path={path} expr={expr} label="Group">
          {(menu, handle) => <Slot ctx={ctx} path={path} nested compact menu={menu} handle={handle} />}
        </Entry>
      );
    case "not":
      return (
        <Entry ctx={ctx} path={path} expr={expr} label="Negation">
          {(menu, handle) => (
            <div className={box("box--not")}>
              {handle}
              <Clause word="NOT">
                <Slot ctx={ctx} path={[...path, "operand"]} nested compact />
              </Clause>
              {menu}
            </div>
          )}
        </Entry>
      );
    case "ite":
    case "implies": {
      const [cond, then] = expr.kind === "ite" ? (["cond", "then"] as const) : (["left", "right"] as const);
      return (
        <Entry ctx={ctx} path={path} expr={expr} label="IF … THEN block">
          {(menu, handle) => (
            <div className={box("box--if")}>
              {handle}
              <Clause word="IF">
                <Slot ctx={ctx} path={[...path, cond]} nested compact />
              </Clause>
              <Clause word="THEN">
                <Slot ctx={ctx} path={[...path, then]} nested compact />
              </Clause>
              {expr.kind === "ite" &&
                (expr.else ? (
                  <Clause word="ELSE">
                    <Slot ctx={ctx} path={[...path, "else"]} nested compact />
                  </Clause>
                ) : (
                  <button type="button" className="action" onClick={() => ctx.edit(addOtherwise(ctx.value, path))}>
                    + ELSE
                  </button>
                ))}
              {menu}
            </div>
          )}
        </Entry>
      );
    }
    case "iff":
      return (
        <Entry ctx={ctx} path={path} expr={expr} label="IFF block">
          {(menu, handle) => (
            <div className={box()}>
              {handle}
              <Slot ctx={ctx} path={[...path, "left"]} nested compact />
              <Clause word="IFF">
                <Slot ctx={ctx} path={[...path, "right"]} nested compact />
              </Clause>
              {menu}
            </div>
          )}
        </Entry>
      );
    case "always":
    case "eventually":
    case "until":
    case "weak-until": {
      const operator = (
        <Pick
          className="operator"
          label="Nested temporal operator"
          text={TEMPORAL_WORDS[expr.kind]}
          hint={OPERATOR_HINTS[expr.kind]}
          value={expr.kind}
          groups={NESTED_OPERATOR_GROUPS}
          onPick={(op) => ctx.edit(changeNestedOperator(ctx.value, path, op as TemporalOp))}
        />
      );
      const window = (
        <WindowField
          window={expr.window}
          mtl={ctx.mtl}
          onChange={(next) => ctx.edit(setWindow(ctx.value, path, next))}
        />
      );
      return (
        <Entry ctx={ctx} path={path} expr={expr} label="Temporal block">
          {(menu, handle) => (
            <div className={box("box--temporal")}>
              {handle}
              {expr.kind === "always" || expr.kind === "eventually" ? (
                <>
                  {operator}
                  {window}
                  <Slot ctx={ctx} path={[...path, "body"]} nested compact />
                </>
              ) : (
                <>
                  <Slot ctx={ctx} path={[...path, "hold"]} nested compact />
                  {operator}
                  {window}
                  <Slot ctx={ctx} path={[...path, "goal"]} nested compact />
                </>
              )}
              {menu}
              <span className="scope-notes">
                <span className="scope-note">{noteOf(ctx, "window", path)}</span>
                <span className="scope-note">{noteOf(ctx, "nested", path)}</span>
              </span>
            </div>
          )}
        </Entry>
      );
    }
  }
};

/** The add row of a list: a condition, a group, an IF … THEN, an IFF and a nested temporal operator. */
export const AddActions: React.FC<AddActionsProps> = ({ ctx, path, compact, menu }) =>
  compact ? (
    <div className="group__actions">
      <Pick
        className="action"
        label="Add"
        text="+ Add"
        value=""
        groups={addGroups(ctx.nested)}
        onPick={(kind) => ctx.edit(addItem(ctx.value, path, kind as ItemKind, ctx.names))}
      />
      {menu}
    </div>
  ) : (
  <div className="group__actions">
    <button type="button" className="action" onClick={() => ctx.edit(addCondition(ctx.value, path, ctx.names))}>
      + Condition
    </button>
    <button type="button" className="action" onClick={() => ctx.edit(addGroup(ctx.value, path, ctx.names))}>
      + Group
    </button>
    <button type="button" className="action" onClick={() => ctx.edit(addIf(ctx.value, path, ctx.names))}>
      + IF … THEN
    </button>
    <button type="button" className="action" title={IFF_TITLE} onClick={() => ctx.edit(addIff(ctx.value, path, ctx.names))}>
      + IFF
    </button>
    {ctx.nested && (
      <button type="button" className="action" onClick={() => ctx.edit(addLater(ctx.value, path, ctx.names))}>
        + Temporal operator
      </button>
    )}
    {menu}
  </div>
  );

/**
 * A list: the conditions of one `and`/`or`, or a lone item, or a hole.
 * Between items sits one connective chip that every sibling shares. Mixing
 * and with or takes a nested group, drawn as a bracketed box. A hole is a
 * dashed chip whose menu fills it, so it has no add row.
 */
export const Slot: React.FC<SlotProps> = ({ ctx, path, nested, compact, actions = true, menu, handle }) => {
  const expr = stateAt(ctx.value, path);
  const isGroup = expr.kind === "and" || expr.kind === "or";
  const items = isGroup ? expr.operands : [expr];
  const alone = !isGroup && isHole(expr);
  const dragged = nested && ctx.dragging?.join() === path.join();
  return (
    <div
      className={["group", nested ? "group--nested" : undefined, dragged ? "is-dragged" : undefined].filter(Boolean).join(" ")}
      role="group"
      aria-label="Conditions"
    >
      {handle}
      <div className="group__items">
        {items.map((item, at) => (
          <span key={at} className={at > 0 && isGroup ? "pair" : "pair pair--first"}>
            {at > 0 && isGroup && (
              <span className="connective">
                <Pick
                  className="connective__pick"
                  label="Connective"
                  text={expr.kind.toUpperCase()}
                  value={expr.kind}
                  groups={CONNECTIVES}
                  onPick={(kind) => ctx.edit(setConnective(ctx.value, path, kind as Connective))}
                />
              </span>
            )}
            <Item ctx={ctx} path={isGroup ? [...path, "operands", at] : path} expr={item} inGroup={isGroup} />
          </span>
        ))}
      </div>
      {actions && !alone ? <AddActions ctx={ctx} path={path} compact={compact} menu={menu} /> : alone ? menu : null}
    </div>
  );
};
