import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { scopeNotes } from "../../constraints";
import type { Constraint, StateExpr } from "../../constraints/ast";
import { ConstraintBuilder } from "./constraint-builder";
import { addGroups, holeGroups } from "./group";

const waiting: StateExpr = { kind: "atom", ref: { kind: "metric", name: "Waiting" }, op: "<=", value: 5 };
const queue: StateExpr = { kind: "atom", ref: { kind: "count", place: "Queue" }, op: ">", value: 1 };
const served: StateExpr = { kind: "atom", ref: { kind: "fired", transition: "Serve" }, op: ">=", value: 2 };
const hole: StateExpr = { kind: "hole" };

const ADDS = "+ Condition + Group + IF … THEN + IFF + Temporal operator";
const ADD = "+ Add";

/** The text a reader sees: tags dropped, menu dots dropped, escaped angle brackets restored, spaces collapsed. */
function reading(value: Constraint, mtl = true, nested = true): string {
  const html = renderToStaticMarkup(
    <ConstraintBuilder
      value={value}
      metrics={["Waiting"]}
      places={["Queue"]}
      transitions={["Serve"]}
      mtl={mtl}
      nested={nested}
      onChange={() => {}}
    />,
  );
  return html
    .replace(/<[^>]+>/gu, " ")
    .replace(/•••/gu, " ")
    .replace(/&gt;/gu, ">")
    .replace(/&lt;/gu, "<")
    .replace(/\s+/gu, " ")
    .trim();
}

describe("ConstraintBuilder", () => {
  it("reads each kind of constraint in the team's keywords and code names", () => {
    // GIVEN one constraint of each kind: single atom, nested and/or, until, IF … THEN … ELSE, not
    const single: Constraint = { op: "always", body: queue };
    const nested: Constraint = {
      op: "eventually",
      body: { kind: "and", operands: [waiting, { kind: "or", operands: [queue, served] }] },
    };
    const until: Constraint = { op: "weak-until", hold: waiting, goal: served };
    const ite: Constraint = { op: "always", body: { kind: "ite", cond: queue, then: waiting, else: served } };
    const not: Constraint = { op: "always", body: { kind: "not", operand: waiting } };
    // WHEN each renders to static markup
    const sentences = [single, nested, until, ite, not].map((value) => reading(value));
    // THEN the text of each reads as keywords, symbols and code names
    expect(sentences[0]).toContain(`ALWAYS + window count(Queue) > 1 ${ADDS}`);
    expect(sentences[1]).toContain(
      "EVENTUALLY + window Waiting ≤ 5 AND count(Queue) > 1 OR fired(Serve) ≥ 2",
    );
    expect(sentences[2]).toContain(
      `Waiting ≤ 5 ${ADD} WEAK UNTIL + window fired(Serve) ≥ 2`,
    );
    expect(sentences[3]).toContain(
      "IF count(Queue) > 1 + Add THEN Waiting ≤ 5 + Add ELSE fired(Serve) ≥ 2 + Add",
    );
    expect(sentences[4]).toContain("NOT Waiting ≤ 5 + Add");
  });

  it("reads a metric on the right side as a metric chip, and a number as a plain field", () => {
    // GIVEN one condition that compares two references and one that compares with a number
    const against: StateExpr = { kind: "atom", ref: { kind: "count", place: "Queue" }, op: ">=", value: { kind: "fired", transition: "Serve" } };
    const metric = renderToStaticMarkup(
      <ConstraintBuilder value={{ op: "always", body: against }} metrics={["Waiting"]} places={["Queue"]} transitions={["Serve"]} mtl nested onChange={() => {}} />,
    );
    const number = renderToStaticMarkup(
      <ConstraintBuilder value={{ op: "always", body: queue }} metrics={["Waiting"]} places={["Queue"]} transitions={["Serve"]} mtl nested onChange={() => {}} />,
    );
    // WHEN each renders
    // THEN the reference reads as a picker chip named Value and the number as a number field
    expect(reading({ op: "always", body: against })).toContain("count(Queue) ≥ fired(Serve) + Condition");
    expect(metric).toContain('aria-label="Value: fired(Serve)"');
    expect(metric).not.toContain("chip__input");
    expect(number).toContain("chip__input");
    expect(number).toContain('aria-label="Compare with a metric: "');
  });

  it("shows a hole as a dashed chip that asks for a condition, with no add row of its own", () => {
    // GIVEN an until whose goal is a hole
    // WHEN it renders
    const text = reading({ op: "until", hold: waiting, goal: hole });
    // THEN the goal reads "choose a condition" and only the hold has an add row
    expect(text).toContain(`Waiting ≤ 5 ${ADD} UNTIL + window choose a condition`);
    expect(text.match(/\+ Add/gu)).toHaveLength(1);
  });

  it("reads an if-then inside an or list as one item of the list, after the connective", () => {
    // GIVEN an or list of a condition and an if-then with a hole for the then
    const value: Constraint = {
      op: "always",
      body: { kind: "or", operands: [waiting, { kind: "ite", cond: queue, then: hole }] },
    };
    // WHEN it renders
    const text = reading(value);
    // THEN the if-then follows "OR" on the same line of text, with its hole
    expect(text).toContain("Waiting ≤ 5 OR IF count(Queue) > 1 + Add THEN choose a condition");
  });

  it("reads an iff block as two sides around IFF", () => {
    // GIVEN an iff
    // WHEN it renders
    const text = reading({ op: "always", body: { kind: "iff", left: waiting, right: queue } });
    // THEN the sides read around "IFF"
    expect(text).toContain("Waiting ≤ 5 + Add IFF count(Queue) > 1 + Add");
  });

  it("shows a nested temporal block with its own operator, window and the scope note", () => {
    // GIVEN always whose body holds a condition and a windowed eventually
    const value: Constraint = {
      op: "always",
      body: {
        kind: "and",
        operands: [waiting, { kind: "eventually", body: queue, window: { from: 0, to: 30 } }],
      },
    };
    // WHEN it renders
    const text = reading(value);
    // THEN the block reads "EVENTUALLY [ 0 , 30 ]" and carries the library's notes
    expect(text).toContain("AND EVENTUALLY [ 0 , 30 ]");
    for (const note of scopeNotes(value)) {
      expect(text).toContain(note.message);
    }
  });

  it("shows the library's nested note whether nested operators are off or on", () => {
    // GIVEN a constraint with an eventually inside always, as it can sit in a document that parsed before the flag went off
    const value: Constraint = { op: "always", body: { kind: "eventually", body: queue } };
    // WHEN it renders with nested off and on
    const off = reading(value, true, false);
    const on = reading(value, true, true);
    // THEN both show the same beyond-the-base note
    for (const note of scopeNotes(value).filter((candidate) => candidate.kind === "nested")) {
      expect(off).toContain(note.message);
      expect(on).toContain(note.message);
    }
    expect(on).toContain("Beyond the base: an operator inside another");
  });

  it("offers Temporal operator only while nested operators are on", () => {
    // GIVEN an always over one condition
    const value: Constraint = { op: "always", body: queue };
    // WHEN it renders with nested off and on
    const off = reading(value, true, false);
    const on = reading(value, true, true);
    // THEN the add row has Temporal operator only when on
    expect(off).toContain("+ Condition + Group + IF … THEN + IFF");
    expect(off).not.toContain("Temporal operator");
    expect(on).toContain(ADDS);
  });

  it("reads a now constraint with its scope note, and a top window as [ a , b ]", () => {
    // GIVEN a now constraint and an eventually with a window
    const now: Constraint = { op: "now", body: waiting };
    const windowed: Constraint = { op: "eventually", body: waiting, window: { from: 5, to: 20 } };
    // WHEN each renders
    const nowText = reading(now);
    const windowText = reading(windowed);
    // THEN now reads "(no operator)" and the window reads [ 5 , 20 ]
    expect(nowText).toContain("(no operator) Waiting ≤ 5");
    for (const note of scopeNotes(now)) {
      expect(nowText).toContain(note.message);
    }
    expect(windowText).toContain("EVENTUALLY [ 5 , 20 ] Waiting ≤ 5");
  });

  it("shows a negated group as a box headed NOT", () => {
    // GIVEN a not over an and of two conditions
    const value: Constraint = { op: "always", body: { kind: "not", operand: { kind: "and", operands: [waiting, queue] } } };
    // WHEN it renders
    const text = reading(value);
    // THEN the group sits after the keyword NOT
    expect(text).toContain("NOT Waiting ≤ 5 AND count(Queue) > 1 + Add");
  });

  it("offers + window only while MTL is on", () => {
    // GIVEN an always with a nested eventually, neither windowed
    const value: Constraint = { op: "always", body: { kind: "and", operands: [waiting, { kind: "eventually", body: queue }] } };
    // WHEN it renders with MTL off and on
    const off = reading(value, false);
    const on = reading(value, true);
    // THEN "+ window" shows for the top operator and the nested block only with MTL on
    expect(off).not.toContain("+ window");
    expect(on.match(/\+ window/gu)).toHaveLength(2);
  });

  it("shows the library's window note whether MTL is on or off", () => {
    // GIVEN an eventually with a window
    const windowed: Constraint = { op: "eventually", body: waiting, window: { from: 5, to: 20 } };
    // WHEN it renders with MTL on and off
    const on = reading(windowed, true);
    const off = reading(windowed, false);
    // THEN both say "Beyond the base: a time window (MTL)"
    expect(on).toContain("Beyond the base: a time window (MTL)");
    expect(off).toContain("Beyond the base: a time window (MTL)");
  });
});

describe("the flags in every menu", () => {
  const labels = (groups: ReturnType<typeof addGroups>) => groups.flatMap((group) => group.options.map((option) => option.label));

  it("hides Temporal operator in the compact add menu and the empty slot menu while nested is off, and keeps the base items", () => {
    // GIVEN the option lists of the "+ Add" menu and of an empty slot
    // WHEN they are built with nested off and on
    const off = [labels(addGroups(false)), labels(holeGroups(false))];
    const on = [labels(addGroups(true)), labels(holeGroups(true))];
    // THEN Temporal operator is only in the on lists, and Group, IF … THEN and IFF stay in the add menu
    for (const list of off) {
      expect(list).not.toContain("Temporal operator");
    }
    for (const list of on) {
      expect(list).toContain("Temporal operator");
    }
    expect(off[0]).toEqual(["Condition", "Group", "IF … THEN", "IFF"]);
  });

  it("shows no Temporal operator and no + window anywhere while both flags are off", () => {
    // GIVEN IF … THEN … ELSE, IFF, NOT and a hole, under always
    const value: Constraint = {
      op: "always",
      body: {
        kind: "and",
        operands: [
          { kind: "ite", cond: queue, then: waiting, else: served },
          { kind: "iff", left: waiting, right: queue },
          { kind: "not", operand: { kind: "and", operands: [waiting, queue] } },
          hole,
        ],
      },
    };
    // WHEN it renders with both flags off
    const text = reading(value, false, false);
    // THEN neither add appears
    expect(text).not.toContain("Temporal operator");
    expect(text).not.toContain("+ window");
  });
});

describe("the builder's words", () => {
  const OLD_WORDS = ["is at most", "is at least", "is below", "is above", "exactly when", "otherwise", "Then later", "Outside v1", "if ever"];

  it("uses none of the old coined phrases in any builder state", () => {
    // GIVEN constraints that show every kind of block, the menus, and the notes, with both flags on and off
    const blocks: StateExpr = {
      kind: "and",
      operands: [
        { kind: "ite", cond: queue, then: waiting, else: served },
        { kind: "iff", left: waiting, right: queue },
        { kind: "not", operand: { kind: "and", operands: [waiting, queue] } },
        { kind: "eventually", body: queue, window: { from: 0, to: 30 } },
        hole,
      ],
    };
    const values: Constraint[] = [
      { op: "always", body: blocks },
      { op: "now", body: waiting },
      { op: "weak-until", hold: waiting, goal: served, window: { from: 0, to: 5 } },
    ];
    // WHEN every rendering, add menu, empty slot menu and scope note is joined into one text
    const texts = values.flatMap((value) => [reading(value, true, true), reading(value, false, false)]);
    const menus = [addGroups(true), holeGroups(true)].flatMap((groups) => groups.flatMap((group) => group.options.map((option) => option.label)));
    const notes = values.flatMap((value) => scopeNotes(value).map((note) => note.message));
    const all = [...texts, ...menus, ...notes].join("\n").toLowerCase();
    // THEN none of the old words appears
    for (const word of OLD_WORDS) {
      expect(all).not.toContain(word.toLowerCase());
    }
  });
});
