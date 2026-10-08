import { describe, expect, it } from "vitest";

import { parseConstraint, printConstraint } from "../../constraints";
import type { Constraint, StateExpr } from "../../constraints/ast";
import {
  HOLE,
  NEGATED,
  addCondition,
  addGroup,
  addIf,
  addIff,
  addLater,
  addOtherwise,
  changeNestedOperator,
  changeOperator,
  defaultAtom,
  fillHole,
  moveInto,
  removeAt,
  rewriteNot,
  setAtom,
  setConnective,
  setWindow,
  stateAt,
  wrapInGroup,
} from "./edits";

const names = { metrics: ["Waiting"], places: ["Queue"], transitions: ["Serve"] };

const waiting: StateExpr = { kind: "atom", ref: { kind: "metric", name: "Waiting" }, op: "<=", value: 5 };
const queue: StateExpr = { kind: "atom", ref: { kind: "count", place: "Queue" }, op: ">", value: 1 };
const served: StateExpr = { kind: "atom", ref: { kind: "fired", transition: "Serve" }, op: ">=", value: 2 };
const fresh = defaultAtom(names);

describe("defaultAtom", () => {
  it("prefers a metric, then a place, then a transition", () => {
    // GIVEN name lists that shrink one by one
    // WHEN an atom is made from each
    const refs = [
      defaultAtom(names).ref,
      defaultAtom({ ...names, metrics: [] }).ref,
      defaultAtom({ metrics: [], places: [], transitions: ["Serve"] }).ref,
    ];
    // THEN each picks the first kind that has a name
    expect(refs).toEqual([
      { kind: "metric", name: "Waiting" },
      { kind: "count", place: "Queue" },
      { kind: "fired", transition: "Serve" },
    ]);
  });
});

describe("addCondition", () => {
  it("turns a lone atom into an and-group of two", () => {
    // GIVEN always with one atom
    const start: Constraint = { op: "always", body: waiting };
    // WHEN a condition is added to the body
    const next = addCondition(start, ["body"], names);
    // THEN the body is an and of the atom and the new one
    expect(next).toEqual({ op: "always", body: { kind: "and", operands: [waiting, fresh] } });
  });

  it("appends to an existing group and keeps its connective", () => {
    // GIVEN an or-group of two
    const start: Constraint = { op: "always", body: { kind: "or", operands: [waiting, queue] } };
    // WHEN a condition is added
    const next = addCondition(start, ["body"], names);
    // THEN it is a third operand of the or
    expect(next).toEqual({ op: "always", body: { kind: "or", operands: [waiting, queue, fresh] } });
  });

  it("fills an empty slot with the atom alone", () => {
    // GIVEN an until with an empty goal
    const start: Constraint = { op: "until", hold: waiting, goal: HOLE };
    // WHEN a condition is added to the goal
    const next = addCondition(start, ["goal"], names);
    // THEN the goal is the atom, with no group around it
    expect(next).toEqual({ op: "until", hold: waiting, goal: fresh });
  });

  it("adds inside a nested group", () => {
    // GIVEN an and holding an or-group
    const start: Constraint = {
      op: "always",
      body: { kind: "and", operands: [waiting, { kind: "or", operands: [queue] }] },
    };
    // WHEN a condition is added to the nested group
    const next = addCondition(start, ["body", "operands", 1], names);
    // THEN the nested or grows and the outer and does not
    expect(stateAt(next, ["body", "operands", 1])).toEqual({ kind: "or", operands: [queue, fresh] });
    expect(stateAt(next, ["body"])).toMatchObject({ kind: "and" });
  });
});

describe("addGroup and addIf", () => {
  it("adds a group of two conditions with the other connective, so the brackets survive the text", () => {
    // GIVEN an and-group
    const start: Constraint = { op: "always", body: { kind: "and", operands: [waiting, queue] } };
    // WHEN a group is added
    const next = addGroup(start, ["body"], names);
    // THEN the new operand is an or of two conditions
    expect(stateAt(next, ["body", "operands", 2])).toEqual({ kind: "or", operands: [fresh, fresh] });
  });

  it("adds an and-group of two to an or-list", () => {
    // GIVEN an or-group
    const start: Constraint = { op: "always", body: { kind: "or", operands: [waiting, queue] } };
    // WHEN a group is added
    const next = addGroup(start, ["body"], names);
    // THEN the new operand is an and of two conditions
    expect(stateAt(next, ["body", "operands", 2])).toEqual({ kind: "and", operands: [fresh, fresh] });
  });

  it("adds an exactly-when block with a hole on the right", () => {
    // GIVEN a lone atom
    // WHEN an exactly-when block is added
    const next = addIff({ op: "always", body: waiting }, ["body"], names);
    // THEN the body is an and of the atom and an iff of a condition and a hole
    expect(next).toEqual({
      op: "always",
      body: { kind: "and", operands: [waiting, { kind: "iff", left: fresh, right: HOLE }] },
    });
  });

  it("adds a nested temporal block with a hole body", () => {
    // GIVEN an or-group
    const start: Constraint = { op: "always", body: { kind: "or", operands: [waiting, queue] } };
    // WHEN a later block is added
    const next = addLater(start, ["body"], names);
    // THEN the or has an eventually with a hole as third operand
    expect(stateAt(next, ["body", "operands", 2])).toEqual({ kind: "eventually", body: HOLE });
  });

  it("reaches the slots of a nested temporal block", () => {
    // GIVEN a nested until with holes
    const start: Constraint = { op: "always", body: { kind: "until", hold: HOLE, goal: HOLE } };
    // WHEN a condition is added to the hold and an if block to the goal
    const next = addIf(addCondition(start, ["body", "hold"], names), ["body", "goal"], names);
    // THEN each hole took its item
    expect(stateAt(next, ["body"])).toEqual({
      kind: "until",
      hold: fresh,
      goal: { kind: "ite", cond: fresh, then: HOLE },
    });
  });

  it("adds an if block with a hole for the then", () => {
    // GIVEN a lone atom
    const start: Constraint = { op: "always", body: waiting };
    // WHEN an if block is added
    const next = addIf(start, ["body"], names);
    // THEN the body is an and of the atom and an ite
    expect(next).toEqual({
      op: "always",
      body: { kind: "and", operands: [waiting, { kind: "ite", cond: fresh, then: HOLE }] },
    });
  });

  it("adds and removes an ELSE", () => {
    // GIVEN an ite with no else
    const start: Constraint = { op: "always", body: { kind: "ite", cond: waiting, then: queue } };
    // WHEN an ELSE is added, then its last condition is filled and removed
    const withElse = addOtherwise(start, ["body"]);
    const filled = addCondition(withElse, ["body", "else"], names);
    const removed = removeAt(filled, ["body", "else"]);
    // THEN the else appears as a hole, takes the condition, and goes with it
    expect(stateAt(withElse, ["body"])).toMatchObject({ else: HOLE });
    expect(stateAt(filled, ["body"])).toMatchObject({ else: fresh });
    expect(removed).toEqual(start);
  });
});

describe("fillHole", () => {
  it("replaces a hole with the kind of item chosen", () => {
    // GIVEN an ite whose then is a hole
    const start: Constraint = { op: "always", body: { kind: "ite", cond: waiting, then: HOLE } };
    // WHEN the hole is filled with a condition
    const next = fillHole(start, ["body", "then"], "condition", names);
    // THEN the then is that condition
    expect(next).toEqual({ op: "always", body: { kind: "ite", cond: waiting, then: fresh } });
  });

  it("leaves a node that is not a hole alone", () => {
    // GIVEN an ite with a filled then
    const start: Constraint = { op: "always", body: { kind: "ite", cond: waiting, then: queue } };
    // WHEN fillHole targets the then
    // THEN nothing changes
    expect(fillHole(start, ["body", "then"], "if", names)).toEqual(start);
  });
});

describe("setConnective and wrapInGroup", () => {
  it("switches every sibling at once by changing the group's kind", () => {
    // GIVEN an and of three
    const start: Constraint = { op: "always", body: { kind: "and", operands: [waiting, queue, served] } };
    // WHEN the connective is set to or
    const next = setConnective(start, ["body"], "or");
    // THEN the group is one or with the same operands
    expect(next).toEqual({ op: "always", body: { kind: "or", operands: [waiting, queue, served] } });
  });

  it("wraps a node in a group of two, with a hole beside it", () => {
    // GIVEN an atom in the goal of an until
    const start: Constraint = { op: "until", hold: waiting, goal: queue };
    // WHEN the goal is wrapped
    const next = wrapInGroup(start, ["goal"]);
    // THEN the goal is an and of that atom and a hole
    expect(next).toEqual({ op: "until", hold: waiting, goal: { kind: "and", operands: [queue, HOLE] } });
  });

  it("wraps a member of an and-list in an or, so the brackets mean something", () => {
    // GIVEN an and of two
    const start: Constraint = { op: "always", body: { kind: "and", operands: [waiting, queue] } };
    // WHEN the second is wrapped
    const next = wrapInGroup(start, ["body", "operands", 1]);
    // THEN it sits in an or with a hole
    expect(stateAt(next, ["body", "operands", 1])).toEqual({ kind: "or", operands: [queue, HOLE] });
  });
});

describe("setAtom", () => {
  it("replaces one atom and leaves its siblings", () => {
    // GIVEN an and of two atoms
    const start: Constraint = { op: "always", body: { kind: "and", operands: [waiting, queue] } };
    // WHEN the second is replaced
    const next = setAtom(start, ["body", "operands", 1], { ...served, value: 9 });
    // THEN only the second changed
    expect(next).toEqual({ op: "always", body: { kind: "and", operands: [waiting, { ...served, value: 9 }] } });
  });
});

describe("removeAt", () => {
  it("collapses a group of two to its remaining condition", () => {
    // GIVEN an and of two
    const start: Constraint = { op: "always", body: { kind: "and", operands: [waiting, queue] } };
    // WHEN the first is removed
    const next = removeAt(start, ["body", "operands", 0]);
    // THEN the body is the other atom, with no group
    expect(next).toEqual({ op: "always", body: queue });
  });

  it("removes a nested group when its last condition goes", () => {
    // GIVEN an and holding an or of one
    const start: Constraint = {
      op: "always",
      body: { kind: "and", operands: [waiting, { kind: "or", operands: [queue] }] },
    };
    // WHEN that condition is removed
    const next = removeAt(start, ["body", "operands", 1, "operands", 0]);
    // THEN the or is gone and the outer group collapsed to the first atom
    expect(next).toEqual({ op: "always", body: waiting });
  });

  it("leaves an empty slot when the only condition goes", () => {
    // GIVEN always with one atom
    // WHEN the atom is removed
    const next = removeAt({ op: "always", body: waiting }, ["body"]);
    // THEN the body is empty
    expect(next).toEqual({ op: "always", body: HOLE });
  });

  it("empties the then of an ite and keeps the block", () => {
    // GIVEN an ite whose then is one atom
    const start: Constraint = { op: "always", body: { kind: "ite", cond: waiting, then: queue } };
    // WHEN the then atom is removed
    const next = removeAt(start, ["body", "then"]);
    // THEN the then is empty and the cond stays
    expect(next).toEqual({ op: "always", body: { kind: "ite", cond: waiting, then: HOLE } });
  });

  it("removes a not together with its last condition", () => {
    // GIVEN an and of an atom and a not over an atom
    const start: Constraint = {
      op: "always",
      body: { kind: "and", operands: [waiting, { kind: "not", operand: queue }] },
    };
    // WHEN the atom under the not is removed
    const next = removeAt(start, ["body", "operands", 1, "operand"]);
    // THEN the not goes and one atom is left
    expect(next).toEqual({ op: "always", body: waiting });
  });
});

describe("setWindow", () => {
  it("sets and clears the window of the top operator", () => {
    // GIVEN eventually with no window
    const start: Constraint = { op: "eventually", body: waiting };
    // WHEN a window is set, then cleared
    const windowed = setWindow(start, [], { from: 0, to: 30 });
    const cleared = setWindow(windowed, [], undefined);
    // THEN the window appears, then the key goes
    expect(windowed).toEqual({ op: "eventually", body: waiting, window: { from: 0, to: 30 } });
    expect(cleared).toEqual(start);
    expect("window" in cleared).toBe(false);
  });

  it("sets the window of a nested block and not of the top", () => {
    // GIVEN always around a nested eventually
    const start: Constraint = { op: "always", body: { kind: "eventually", body: waiting } };
    // WHEN the nested block window is set
    const next = setWindow(start, ["body"], { from: 1, to: 5 });
    // THEN only the nested block carries it
    expect(next).toEqual({
      op: "always",
      body: { kind: "eventually", body: waiting, window: { from: 1, to: 5 } },
    });
  });

  it("gives a now constraint no window", () => {
    // GIVEN a now constraint
    const start: Constraint = { op: "now", body: waiting };
    // WHEN a window is set
    // THEN nothing changes
    expect(setWindow(start, [], { from: 0, to: 1 })).toEqual(start);
  });
});

describe("rewriteNot", () => {
  it.each([
    ["<", ">="],
    ["<=", ">"],
    [">", "<="],
    [">=", "<"],
    ["==", "!="],
    ["!=", "=="],
  ] as const)("turns not (x %s 3) into x %s 3", (op, flipped) => {
    // GIVEN a not over an atom
    const start: Constraint = { op: "always", body: { kind: "not", operand: { ...waiting, op, value: 3 } } };
    // WHEN the not is rewritten away
    const next = rewriteNot(start, ["body"]);
    // THEN the not is gone and the comparator says the opposite
    expect(next).toEqual({ op: "always", body: { ...waiting, op: flipped, value: 3 } });
  });

  it("swaps and for or over a group (De Morgan)", () => {
    // GIVEN not (Waiting <= 5 and Queue > 2)
    const start: Constraint = {
      op: "always",
      body: { kind: "not", operand: { kind: "and", operands: [waiting, queue] } },
    };
    // WHEN the not is rewritten away
    const next = rewriteNot(start, ["body"]);
    // THEN it is an or of the two flipped comparisons
    expect(next).toEqual({
      op: "always",
      body: {
        kind: "or",
        operands: [
          { ...waiting, op: NEGATED[waiting.op] },
          { ...queue, op: NEGATED[queue.op] },
        ],
      },
    });
  });

  it("leaves a not over an iff alone", () => {
    // GIVEN a not over an iff
    const start: Constraint = {
      op: "always",
      body: { kind: "not", operand: { kind: "iff", left: waiting, right: queue } },
    };
    // WHEN it is rewritten
    // THEN nothing changes
    expect(rewriteNot(start, ["body"])).toEqual(start);
  });
});

describe("changeOperator", () => {
  it("puts the body in hold with an empty goal going from always to until", () => {
    // GIVEN always with a body
    // WHEN the operator becomes until
    const next = changeOperator({ op: "always", body: waiting }, "until");
    // THEN the body is the hold and the goal is empty
    expect(next).toEqual({ op: "until", hold: waiting, goal: HOLE });
  });

  it("keeps the hold going from until to always", () => {
    // GIVEN a weak until
    // WHEN the operator becomes always, and eventually
    const start: Constraint = { op: "weak-until", hold: waiting, goal: queue };
    // THEN the body is the hold both times
    expect(changeOperator(start, "always")).toEqual({ op: "always", body: waiting });
    expect(changeOperator(start, "eventually")).toEqual({ op: "eventually", body: waiting });
  });

  it("keeps both sides going between until and weak until", () => {
    // GIVEN an until
    // WHEN it becomes weak
    const next = changeOperator({ op: "until", hold: waiting, goal: queue }, "weak-until");
    // THEN hold and goal are unchanged
    expect(next).toEqual({ op: "weak-until", hold: waiting, goal: queue });
  });

  it("moves between now and the other operators and drops the window going to now", () => {
    // GIVEN an always with a window
    const start: Constraint = { op: "always", body: waiting, window: { from: 0, to: 9 } };
    // WHEN it becomes now, and now becomes until
    const now = changeOperator(start, "now");
    const until = changeOperator(now, "until");
    // THEN the window is gone at now, the body is the hold and the goal is a hole
    expect(now).toEqual({ op: "now", body: waiting });
    expect(until).toEqual({ op: "until", hold: waiting, goal: HOLE });
  });

  it("keeps the window going between operators that take one", () => {
    // GIVEN an eventually with a window
    const start: Constraint = { op: "eventually", body: waiting, window: { from: 0, to: 9 } };
    // WHEN it becomes weak until
    const next = changeOperator(start, "weak-until");
    // THEN the window stays
    expect(next).toEqual({ op: "weak-until", hold: waiting, goal: HOLE, window: { from: 0, to: 9 } });
  });

  it("changes the operator of a nested block and keeps its body", () => {
    // GIVEN always around a nested eventually
    const start: Constraint = { op: "always", body: { kind: "eventually", body: waiting } };
    // WHEN the nested block becomes until
    const next = changeNestedOperator(start, ["body"], "until");
    // THEN its body is the hold and the goal is a hole
    expect(next).toEqual({ op: "always", body: { kind: "until", hold: waiting, goal: HOLE } });
  });

  it("keeps the body between always and eventually", () => {
    // GIVEN always with a group
    const body: StateExpr = { kind: "or", operands: [waiting, queue] };
    // WHEN it becomes eventually
    // THEN the body is untouched
    expect(changeOperator({ op: "always", body }, "eventually")).toEqual({ op: "eventually", body });
  });
});

describe("builder edits through the text", () => {
  const roundTrip = (constraint: Constraint) => parseConstraint(printConstraint(constraint), { mtl: true, nested: true }).constraint;

  it("keeps an and-group added to an or-list as it prints and parses back", () => {
    // GIVEN an or-list at the top level
    const start: Constraint = { op: "always", body: { kind: "or", operands: [waiting, queue] } };
    // WHEN a group is added and the result goes through the text
    const next = addGroup(start, ["body"], names);
    // THEN the group is an and, and the text parses back to the same tree
    expect(stateAt(next, ["body", "operands", 2]).kind).toBe("and");
    expect(roundTrip(next)).toEqual(next);
  });

  it("joins a nested group to its parent when the parent's connective flips to match it", () => {
    // GIVEN an and-list holding an or-group, as "+ Group" makes it
    const start: Constraint = {
      op: "always",
      body: { kind: "and", operands: [waiting, { kind: "or", operands: [queue, served] }] },
    };
    // WHEN the top connective is set to or and a group is added
    const flipped = setConnective(start, ["body"], "or");
    const next = addGroup(flipped, ["body"], names);
    // THEN no or sits directly in the or, the new group is an and, and the text parses back to the same tree
    expect(stateAt(next, ["body"])).toEqual({
      kind: "or",
      operands: [waiting, queue, served, { kind: "and", operands: [fresh, fresh] }],
    });
    expect(roundTrip(next)).toEqual(next);
  });
});

describe("moveInto", () => {
  const roundTrip = (constraint: Constraint) =>
    parseConstraint(printConstraint(constraint), { mtl: true, nested: true }).constraint;

  it("moves an atom into a hole of a nested group", () => {
    // GIVEN always(waiting and (queue or _))
    const start: Constraint = {
      op: "always",
      body: { kind: "and", operands: [waiting, { kind: "or", operands: [queue, HOLE] }] },
    };
    // WHEN the first atom is dropped on the hole
    const next = moveInto(start, ["body", "operands", 0], ["body", "operands", 1, "operands", 1]);
    // THEN the outer group collapses to the inner group, which now holds the atom
    expect(next).toEqual({ op: "always", body: { kind: "or", operands: [queue, waiting] } });
  });

  it("collapses a source group left with one item", () => {
    // GIVEN waiting and queue, then a hole in an if-then
    const start: Constraint = {
      op: "always",
      body: {
        kind: "and",
        operands: [
          { kind: "and", operands: [waiting, queue] } as StateExpr,
          { kind: "ite", cond: served, then: HOLE },
        ],
      },
    };
    // WHEN the waiting atom moves into the hole
    const next = moveInto(start, ["body", "operands", 0, "operands", 0], ["body", "operands", 1, "then"]);
    // THEN the source group is just queue
    expect(stateAt(next, ["body", "operands", 0])).toEqual(queue);
    expect(stateAt(next, ["body", "operands", 1, "then"])).toEqual(waiting);
  });

  it("finds the hole after a sibling before it is removed", () => {
    // GIVEN a list of [waiting, queue, hole] with the hole after the source
    const start: Constraint = { op: "always", body: { kind: "and", operands: [waiting, queue, HOLE] } };
    // WHEN the first atom moves into the hole
    const next = moveInto(start, ["body", "operands", 0], ["body", "operands", 2]);
    // THEN the list is [queue, waiting]
    expect(next).toEqual({ op: "always", body: { kind: "and", operands: [queue, waiting] } });
  });

  it("moves a group into a hole", () => {
    // GIVEN a group of two beside an ite whose then is a hole
    const group: StateExpr = { kind: "or", operands: [waiting, queue] };
    const start: Constraint = {
      op: "always",
      body: { kind: "and", operands: [group, { kind: "ite", cond: served, then: HOLE }] },
    };
    // WHEN the group moves into the hole
    const next = moveInto(start, ["body", "operands", 0], ["body", "operands", 1, "then"]);
    // THEN the ite is what is left, holding the group
    expect(next).toEqual({ op: "always", body: { kind: "ite", cond: served, then: group } });
  });

  it("refuses a drop into the node's own descendant", () => {
    // GIVEN a group that holds a hole
    const start: Constraint = {
      op: "always",
      body: { kind: "and", operands: [waiting, { kind: "or", operands: [queue, HOLE] }] },
    };
    // WHEN the inner group is dropped on its own hole
    const next = moveInto(start, ["body", "operands", 1], ["body", "operands", 1, "operands", 1]);
    // THEN nothing changes
    expect(next).toBe(start);
  });

  it("refuses a drop onto a node that is not a hole", () => {
    // GIVEN two atoms
    const start: Constraint = { op: "always", body: { kind: "and", operands: [waiting, queue] } };
    // WHEN one is dropped on the other
    const next = moveInto(start, ["body", "operands", 0], ["body", "operands", 1]);
    // THEN nothing changes
    expect(next).toBe(start);
  });

  it("keeps the result through the text", () => {
    // GIVEN always(waiting and (queue or _))
    const start: Constraint = {
      op: "always",
      body: { kind: "and", operands: [waiting, { kind: "or", operands: [queue, HOLE] }] },
    };
    // WHEN the first atom moves into the hole and the result goes through the text
    const next = moveInto(start, ["body", "operands", 0], ["body", "operands", 1, "operands", 1]);
    // THEN it parses back to the same tree
    expect(roundTrip(next)).toEqual(next);
  });
});
