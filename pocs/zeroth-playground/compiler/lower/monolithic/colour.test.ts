import { describe, expect, it } from "vitest";

import {
  boilerIr,
  boilerOptions,
  bucketIr,
  bucketPython,
  dronesIr,
  dronesOptions,
} from "../../testing/coloured-nets.fixtures";
import {
  array,
  dynamicsOf,
  lambdaOf,
  lit,
  local,
  op,
  record,
  text,
  token,
  tokenAttribute,
} from "../../testing/code-builders";
import { compileNet, pythonOf } from "../../testing/compile-net";
import { parseCode } from "../../testing/fixture-parser";

import type { CodeExpr, CodeFunction, CodeParser } from "../../code/code-tree";
import type { DiagnosticCode } from "../../diagnostics";
import type { PetriNetIr } from "../../ir/schema";

/** The code a hangar's Launch or its place carries, as trees. */
type HangarCode = { kernel?: CodeExpr; guard?: CodeExpr; dynamics?: CodeExpr };

/** Launch passes the hangar's token through, unless the row writes another kernel. */
const PASS_THROUGH = record({
  Airborne: { kind: "fieldAccess", target: local("input"), field: "Hangar" },
});

/**
 * A drone launched from a hangar into the air, its kernel, guard and
 * dynamics given as trees, with a parser that looks each one up by name.
 */
function hangar({ kernel = PASS_THROUGH, guard, dynamics }: HangarCode): {
  ir: PetriNetIr;
  parser: CodeParser;
} {
  const trees: Record<string, CodeFunction> = {
    kernel: lambdaOf(kernel),
    ...(guard === undefined ? {} : { guard: lambdaOf(guard) }),
    ...(dynamics === undefined ? {} : { dynamics: dynamicsOf(dynamics) }),
  };
  return {
    ir: {
      name: "hangar",
      kind: "plain",
      colours: { Drone: { battery: "real", state: { enum: ["idle", "flying"] }, id: "uuid" } },
      ...(dynamics === undefined
        ? {}
        : { dynamics: { Drain: { colour: "Drone", code: "dynamics" } } }),
      places: {
        Hangar: {
          colour: "Drone",
          capacity: 1,
          ...(dynamics === undefined ? {} : { dynamics: "Drain" }),
        },
        Airborne: { colour: "Drone", capacity: 1 },
      },
      marking: { Hangar: [{ battery: 50, state: "idle" }] },
      transitions: {
        Launch: {
          inputs: { Hangar: null },
          outputs: { Airborne: null },
          kernel: "kernel",
          ...(guard === undefined ? {} : { guard: "guard" }),
        },
      },
    },
    parser: (code) => trees[code],
  };
}

/** One coloured place of balls, without code. */
function pool(transitions: PetriNetIr["transitions"], marking?: PetriNetIr["marking"]): PetriNetIr {
  return {
    name: "pool",
    kind: "plain",
    colours: { Ball: { x: "real" } },
    places: { Pool: { colour: "Ball" } },
    ...(marking === undefined ? {} : { marking }),
    transitions,
  };
}

/** Each error's code and the name of its item. */
function refused(ir: PetriNetIr, options?: Parameters<typeof compileNet>[1], parser?: CodeParser) {
  return compileNet(ir, options, parser).errors.map((error) => [error.code, error.item.name]);
}

describe("the monolithic lowering on coloured places", () => {
  it("refuses a document whose code it cannot read, one diagnostic per item", () => {
    // GIVEN a coloured net with dynamics, a rate and a guard as code, and a plain net with a guard
    const coloured: PetriNetIr = {
      name: "coloured",
      kind: "mixed",
      colours: { Drone: { battery: "real" } },
      dynamics: {
        Drain: {
          colour: "Drone",
          code: "return tokens.map(() => ({ battery: -1 }));",
        },
      },
      places: { Hangar: { colour: "Drone", dynamics: "Drain" }, Count: null },
      transitions: {
        Launch: {
          inputs: { Hangar: null },
          outputs: { Count: null },
          rate: "return input.Hangar[0].battery;",
        },
        Reset: { inputs: { Count: null }, guard: "return true;" },
      },
    };
    const guarded: PetriNetIr = {
      name: "guarded",
      kind: "plain",
      places: { A: null },
      transitions: { Go: { inputs: { A: null }, guard: "return true;" } },
    };
    // WHEN each is compiled without a parser
    const { files, errors } = compileNet(coloured);
    // THEN each item with code is refused, and the plain net's guard alone stops it
    expect(files).toEqual([]);
    expect(errors.map((error) => [error.code, error.item.name])).toEqual([
      ["code-not-parsed", "Hangar"],
      ["code-not-parsed", "Launch"],
      ["code-not-parsed", "Reset"],
    ]);
    expect(() => pythonOf(guarded)).toThrow(
      "transition Go: no code parser was given to read the guard",
    );
  });

  it("lowers a coloured place to slots with bindings in step order and end-of-step compaction", () => {
    // GIVEN the bucket, whose rate reads each ball
    // WHEN it is compiled with a parser
    const python = pythonOf(bucketIr, {}, parseCode);
    // THEN the pool is slots, bound in order and closed up at the end of the step
    expect(python).toBe(bucketPython);
  });

  it("takes one Euler step per present token before the sweep and reads a place through a read arc", () => {
    // GIVEN the boiler, whose tank level rises by dynamics
    // WHEN it is compiled with a parser
    const python = pythonOf(boilerIr, boilerOptions, parseCode);
    // THEN the level steps first, and the alarm reads the tank without taking its token
    expect(python).toContain(
      "        # dynamics first: one Euler step on every present token\n        Tank_0_level = ite(Tank_0_present, Tank_0_level + 0.125 * (10.0 - Tank_0_level), Tank_0_level)  # Tank: one Euler step of dt = 0.25\n",
    );
    expect(python).toContain(
      "        fire_Alarm = Tank_0_present & (Tank_0_level >= 8.0)  # Alarm: read Tank -> Alarms\n",
    );
    expect(python).not.toContain("take_Alarm");
    expect(python).toContain("        Alarms = ite(fire_Alarm, Alarms + 1.0, Alarms)\n");
  });

  it("writes kernels as per-token attributes with string codes, landing after the survivors", () => {
    // GIVEN the drones, with kernels and a two-valued state
    // WHEN they are compiled with a parser
    const python = pythonOf(dronesIr, dronesOptions, parseCode);
    // THEN states are codes, kernels write per-token attributes,
    // and produced tokens land after the survivors
    expect(python).toContain("Hangar_0_state = Var(REAL)  # code: 0 idle, 1 flying\n");
    expect(python).toContain(
      "        out_Launch_Airborne_0_battery = ite(sel_Launch_0, Hangar_0_battery, ite(sel_Launch_1, Hangar_1_battery, Hangar_2_battery))\n        out_Launch_Airborne_0_state = 1.0\n",
    );
    expect(python).toContain(
      "        bind_Land_0 = ok_Land & Airborne_0_present & ((Airborne_0_battery < 20.0) | (Airborne_0_state != 1.0))  # Airborne[0]\n",
    );
    expect(python).toContain("landed_Airborne = kept_Airborne\n");
    expect(python).toContain(
      "        Airborne_0_battery = ite(fire_Launch & (landed_Airborne == 0.0), out_Launch_Airborne_0_battery, Airborne_0_battery)\n",
    );
    // Both coloured places are capped, so no produced token can overflow.
    expect(python).not.toContain("overflow_");
    expect(python).toContain(
      "e_Launch = Var(REAL)  # exponential draw for Launch, each step: -ln(u) / dt",
    );
  });

  it("refuses only the code its parser returns no tree for", () => {
    // GIVEN the drones, and a parser that reads every code string but the Land guard
    const landGuard = dronesIr.transitions.Land?.guard;
    const partial: CodeParser = (code, surface) =>
      code === landGuard ? undefined : parseCode(code, surface);
    // WHEN they are compiled with it
    const { files, errors } = compileNet(dronesIr, dronesOptions, partial);
    // THEN the guard alone is refused, saying the parser gave no tree
    expect(files).toEqual([]);
    expect(errors.map((error) => [error.code, error.item.name, error.message])).toEqual([
      ["code-not-parsed", "Land", "the code parser returned no tree for the guard"],
    ]);
  });

  it.each<[DiagnosticCode, string, HangarCode]>([
    ["kernel-output-shape", "Launch", { kernel: lit(1) }],
    ["kernel-output-missing", "Launch", { kernel: record({}) }],
    [
      "kernel-output-count",
      "Launch",
      { kernel: record({ Airborne: array(token("Hangar", 0), token("Hangar", 0)) }) },
    ],
    [
      "kernel-attribute-missing",
      "Launch",
      { kernel: record({ Airborne: array(record({ battery: lit(1) })) }) },
    ],
    [
      "string-code-unknown",
      "Launch",
      { kernel: record({ Airborne: array(record({ battery: lit(1), state: text("lost") })) }) },
    ],
    [
      "attribute-not-lowerable",
      "Launch",
      { guard: op(tokenAttribute("Hangar", 0, "id"), "==", text("a")) },
    ],
    ["dynamics-shape", "Hangar", { dynamics: lit(1) }],
  ])(
    "refuses with %s on %s a kernel, guard or dynamics the step cannot write",
    (code, item, trees) => {
      // GIVEN the hangar with one faulty kernel, guard or dynamics
      const { ir, parser } = hangar(trees);
      // WHEN it is compiled with a parser that reads the trees
      const errors = refused(ir, {}, parser);
      // THEN the item is refused with the code
      expect(errors).toEqual([[code, item]]);
    },
  );

  it("refuses more tokens than slots, a coloured output without a kernel and too many combinations", () => {
    // GIVEN three balls in two slots, a transition that makes balls with no kernel,
    // and one that takes 8 of 16 slots, 12870 combinations
    const crowded = pool(
      { Drain: { inputs: { Pool: null } } },
      { Pool: [{ x: 1 }, { x: 2 }, { x: 3 }] },
    );
    const unwritten = pool({ Make: { outputs: { Pool: null } } });
    const greedy = pool({ Drain: { inputs: { Pool: { weight: 8 } } } });
    // WHEN each is compiled
    const found = [
      refused(crowded, { slots: 2 }),
      refused(unwritten),
      refused(greedy, { slots: 16 }),
    ];
    // THEN each is refused on its place or transition
    expect(found).toEqual([
      [["marking-exceeds-slots", "Pool"]],
      [["kernel-missing", "Make"]],
      [["binding-explosion", "Drain"]],
    ]);
  });
});
