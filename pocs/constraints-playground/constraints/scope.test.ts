import { describe, expect, it } from "vitest";

import { TOP_WORDS } from "./ast";
import { parseConstraint } from "./constraint-parser";
import {
  FROZEN_TIME_NOTE,
  HOLE_NOTE,
  NESTED_IN_CONDITION_NOTE,
  NESTED_NOTE,
  NOW_NOTE,
  WINDOW_NOTE,
  isV1,
  scopeNotes,
} from "./scope";

import type { Constraint } from "./ast";
import type { RunState } from "./simulate";

function parsed(text: string): Constraint {
  const { constraint } = parseConstraint(text, { mtl: true, nested: true });
  if (constraint === undefined) {
    throw new Error(`did not parse "${text}"`);
  }
  return constraint;
}

describe("scopeNotes", () => {
  it("has nothing to say about a base constraint", () => {
    // GIVEN one constraint per base operator
    const texts = ["always(A > 0 and B > 0)", "eventually(A > 0)", "until(A > 0, B > 0)", "weak_until(A > 0, B > 0)"];

    // WHEN their notes are read
    const notes = texts.map((text) => scopeNotes(parsed(text)));

    // THEN there are none, and each is in the base
    expect(notes).toEqual([[], [], [], []]);
    expect(texts.every((text) => isV1(parsed(text)))).toBe(true);
  });

  it("flags a temporal operator inside another, at its path", () => {
    // GIVEN the response rule
    const notes = scopeNotes(parsed("always(A > 0 implies eventually(B > 0))"));

    // THEN there is one nested note, at the right side of implies
    expect(notes).toEqual([{ kind: "nested", message: NESTED_NOTE, path: ["body", "right"] }]);
    expect(NESTED_NOTE).toBe("Beyond the base: an operator inside another");
  });

  it("flags every window, on the top and inside", () => {
    // GIVEN a windowed always holding a windowed eventually
    const notes = scopeNotes(parsed("always[0, 30](A > 0 implies eventually[0, 5](B > 0))"));

    // THEN the top window, the nested operator and its window are flagged
    expect(notes).toEqual([
      { kind: "window", message: WINDOW_NOTE, path: [] },
      { kind: "nested", message: NESTED_NOTE, path: ["body", "right"] },
      { kind: "window", message: WINDOW_NOTE, path: ["body", "right"] },
    ]);
  });

  it("flags now, and temporal operators inside its condition", () => {
    // GIVEN a bare atom and two calls joined by and
    const bare = scopeNotes(parsed("count(Queue) <= 5"));
    const joined = scopeNotes(parsed("always(A > 0) and eventually(B > 0)"));

    // THEN each has the now note; the calls are flagged as inside a condition
    expect(bare).toEqual([{ kind: "now", message: NOW_NOTE }]);
    expect(joined).toEqual([
      { kind: "now", message: NOW_NOTE },
      { kind: "nested", message: NESTED_IN_CONDITION_NOTE, path: ["body", "operands", 0] },
      { kind: "nested", message: NESTED_IN_CONDITION_NOTE, path: ["body", "operands", 1] },
    ]);
  });

  it("flags each hole at its path", () => {
    // GIVEN holes on both sides of until, one inside an and
    const notes = scopeNotes(parsed("until(_, A > 0 and _)"));

    // THEN both holes are flagged
    expect(notes).toEqual([
      { kind: "hole", message: HOLE_NOTE, path: ["hold"] },
      { kind: "hole", message: HOLE_NOTE, path: ["goal", "operands", 1] },
    ]);
  });

  it("adds a note when a window meets a run whose time never moves", () => {
    // GIVEN a plain run at time 0 and a timed run
    const frozen: RunState[] = [0, 1].map((step) => ({ step, time: 0, marking: {}, fired: {} }));
    const timed: RunState[] = [0, 1].map((step) => ({ step, time: step * 2, marking: {}, fired: {} }));
    const windowed = parsed("eventually[0, 5](A > 0)");

    // WHEN the notes are read with each run
    const onFrozen = scopeNotes(windowed, frozen);
    const onTimed = scopeNotes(windowed, timed);
    const unwindowed = scopeNotes(parsed("eventually(A > 0)"), frozen);

    // THEN only the windowed constraint on the frozen run gets the extra note
    expect(onFrozen.at(-1)).toEqual({ kind: "window", message: FROZEN_TIME_NOTE });
    expect(onTimed).toEqual([{ kind: "window", message: WINDOW_NOTE, path: [] }]);
    expect(unwindowed).toEqual([]);
  });
});

describe("TOP_WORDS", () => {
  it("names now as the builder shows it", () => {
    // THEN now reads "(no operator)", and the temporal words are the team's keywords
    expect(TOP_WORDS.now).toBe("(no operator)");
    expect(TOP_WORDS.always).toBe("ALWAYS");
    expect(TOP_WORDS["weak-until"]).toBe("WEAK UNTIL");
  });
});
