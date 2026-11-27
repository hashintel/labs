import { describe, expect, it } from "vitest";

import { resolveOptions } from "../options";
import { birthDeathIr, birthDeathOptions, birthDeathPython } from "../testing/birth-death.fixtures";
import { pythonOf } from "../testing/compile-net";
import { forkClockedIr, forkClockedOptions } from "../testing/fork.fixtures";
import { and, assign, isZero, nonZero, ref } from "../graph/spn-graph";
import { lowerPetriNetIr } from "./lower";

import type { SpnGraph } from "../graph/spn-graph";
import type { PetriNetIr } from "../ir/schema";
import type { CompilerOptions } from "../options";

/** The SPN graph of an IR the clocks strategy accepts. */
function lowerClocks(ir: PetriNetIr, options: CompilerOptions = { rates: "clock" }) {
  const outcome = lowerPetriNetIr(ir, resolveOptions(options));
  if (!outcome.ok) {
    throw new Error(outcome.errors.map((error) => error.code).join(", "));
  }
  if (outcome.graph.language !== "spn") {
    throw new Error("expected an SPN graph");
  }
  return outcome.graph;
}

describe("the clocks lowering", () => {
  it("gives each transition a clock and an event, each place a count, and hides the clocks", () => {
    // GIVEN the birth-death net under clock rates
    // WHEN it is lowered
    const graph = lowerClocks(birthDeathIr);
    // THEN each transition drives a clock and an event, each place a count,
    // and the clocks are hidden
    expect(
      graph.variables.map((variable) => [variable.name, variable.sort, variable.role]),
    ).toEqual([
      ["t", "clock", "time"],
      ["Population", "nat", "place"],
      ["clk_Birth", "clock", "clock"],
      ["clk_Death", "clock", "clock"],
      ["ev_Birth", "event", "event"],
      ["ev_Death", "event", "event"],
    ]);
    expect(graph.hidden).toEqual(["clk_Birth", "clk_Death"]);
    expect(
      graph.modules.map((module) => [
        module.className,
        module.ctrl,
        module.extl,
        module.flow === undefined ? "no flow" : "flow",
      ]),
    ).toEqual([
      ["Transition_Birth", ["clk_Birth", "ev_Birth"], ["t"], "flow"],
      ["Transition_Death", ["clk_Death", "ev_Death"], ["Population", "t"], "flow"],
      ["Place_Population", ["Population"], ["ev_Birth", "ev_Death"], "no flow"],
    ]);
  });

  it("ignores the shape, marking, control and dt options", () => {
    // GIVEN the birth-death net with a controllable Death, with every step flag set and with none
    const controllable: PetriNetIr = {
      ...birthDeathIr,
      transitions: {
        ...birthDeathIr.transitions,
        Death: { ...birthDeathIr.transitions.Death, controllable: true },
      },
    };
    // WHEN both are lowered under clocks
    const busy = lowerClocks(controllable, {
      rates: "clock",
      shape: "monolithic",
      marking: "int",
      control: "open",
      dt: 0.25,
    });
    const plain: SpnGraph = lowerClocks(controllable);
    // THEN the graphs agree
    expect(busy).toEqual(plain);
  });

  it("gives each transition in a conflict a Bool pick it reads at the expiry, left in the interface", () => {
    // GIVEN the clocked fork, with its conflict left open
    // WHEN it is lowered, and lowered again with the conflict swept
    const open = lowerClocks(forkClockedIr, forkClockedOptions);
    const swept = lowerClocks(forkClockedIr);
    // THEN each transition in the conflict reads its own pick, and only when its clock runs out
    expect(
      open.variables
        .filter((variable) => variable.role === "pick")
        .map((variable) => [variable.name, variable.sort, variable.comment]),
    ).toEqual([
      ["pick_TakeLeft", "bool", "the environment lets TakeLeft fire when its clock expires"],
      ["pick_TakeRight", "bool", "the environment lets TakeRight fire when its clock expires"],
    ]);
    expect(open.hidden).toEqual(["clk_TakeLeft", "clk_TakeRight", "clk_Return"]);
    expect(open.modules.map((module) => [module.className, module.extl])).toEqual([
      ["Transition_TakeLeft", ["Pool", "pick_TakeLeft", "t"]],
      ["Transition_TakeRight", ["Pool", "pick_TakeRight", "t"]],
      ["Transition_Return", ["Left", "t"]],
      ["Place_Pool", ["ev_Return", "ev_TakeLeft", "ev_TakeRight"]],
      ["Place_Left", ["ev_TakeLeft", "ev_Return"]],
      ["Place_Right", ["ev_TakeRight"]],
    ]);
    expect(open.modules[0]?.next).toEqual([
      assign(
        "fires_TakeLeft",
        and(and(isZero(ref("clk_TakeLeft")), nonZero(ref("Pool"))), ref("pick_TakeLeft")),
      ),
    ]);
    // The pick is read at the expiry alone: the clock runs on the arcs.
    expect(open.modules[0]?.flow).toEqual(swept.modules[0]?.flow);
  });
});

describe("the clocks lowering, as Python", () => {
  it("compiles the birth-death net to the modules of Zeroth's birth_death.py", () => {
    // GIVEN the birth-death net under clock rates
    // WHEN it is compiled
    const python = pythonOf(birthDeathIr, birthDeathOptions);
    // THEN it matches Zeroth's own module
    expect(python).toBe(birthDeathPython);
  });

  it("reads a Bool pick at the expiry of each transition in a conflict under conflicts nondet", () => {
    // GIVEN the clocked fork with conflicts left open, swept by default, and swept by name
    // WHEN each is compiled
    const open = pythonOf(forkClockedIr, forkClockedOptions);
    const sweep = pythonOf(forkClockedIr, { rates: "clock" });
    const named = pythonOf(forkClockedIr, { rates: "clock", conflicts: "sweep" });
    // THEN the open fork reads a pick in each transition of the conflict alone, and both swept forks have none
    expect(open).toContain(
      "        fires_TakeLeft = (clk_TakeLeft == 0) & (Pool != 0) & pick_TakeLeft\n",
    );
    expect(open).not.toContain("pick_Return");
    expect(sweep).not.toContain("pick_");
    expect(sweep).toBe(named);
  });

  it("tests read and inhibitor arcs, applies one exclusive case per mover, and leaves an untouched place alone", () => {
    // GIVEN a clocked net with read and inhibitor arcs, a place moved three ways,
    // a self-loop and a lone place
    const clocked: PetriNetIr = {
      name: "clocked",
      kind: "stochastic",
      places: { A: null, B: null, C: null, Lone: null },
      marking: { A: 3, B: 1 },
      transitions: {
        In: {
          inputs: { B: { kind: "read" }, C: { kind: "inhibitor" } },
          outputs: { A: null },
          rate: 0.5,
        },
        Out: { inputs: { A: null }, rate: 1 },
        Move: { inputs: { A: null, B: null }, outputs: { C: null }, rate: 2 },
        Loop: { inputs: { B: null }, outputs: { B: null }, rate: 3 },
      },
    };
    // WHEN it is compiled
    const python = pythonOf(clocked, { rates: "clock" });
    // THEN the arcs gate the firing and the flow, each place applies one mover at a time,
    // and the lone place keeps its count
    expect(python).toContain(
      "        fires_In = (clk_In == 0) & (B != 0) & (C == 0)\n        return ite(fires_In, exp(0.5), clk_In), ite(fires_In, ~ev_In, None)\n\n    def flow(self, clk_In, ev_In, B, C, t):\n        return ite(clk_In >= 0, ite((B != 0) & (C == 0), -1 * d(t), 0 * d(t)), None), 0\n",
    );
    expect(python).toContain("        fires_Move = (clk_Move == 0) & (A != 0) & (B != 0)\n");
    expect(python).toContain('"""Loop: B -> B, at rate 3"""');
    expect(python).toContain(
      "    def init(self, B, t):\n        return exp(3.0), False\n\n    def next(self, clk_Loop, ev_Loop, B, t):\n        fires_Loop = (clk_Loop == 0) & (B != 0)\n",
    );
    expect(python).toContain(
      '    """A: added by In, taken by Out, Move"""\n\n    def init(self, ev_In, ev_Out, ev_Move):\n        return 3\n\n    def next(self, A, ev_In, ev_Out, ev_Move):\n        fired_In = fired(ev_In)\n        fired_Out = fired(ev_Out)\n        fired_Move = fired(ev_Move)\n        return ite(fired_In & ~fired_Out & ~fired_Move, A + 1, ite(fired_Out & ~fired_In & ~fired_Move & (A != 0), A - 1, ite(fired_Move & ~fired_In & ~fired_Out & (A != 0), A - 1, A)))\n',
    );
    expect(python).toContain(
      '    """B: taken by Move"""\n\n    def init(self, ev_Move):\n        return 1\n\n    def next(self, B, ev_Move):\n        fired_Move = fired(ev_Move)\n        return ite(fired_Move & (B != 0), B - 1, B)\n',
    );
    expect(python).toContain("        return ite(fired_Move, C + 1, C)\n");
    expect(python).toContain(
      '    """Lone: no transition moves its tokens"""\n\n    def init(self):\n        return 0\n\n    def next(self, Lone):\n        return Lone\n',
    );
    expect(python).toContain("place_Lone = Place_Lone(theory=SPN, ctrl=(Lone,))\n");
    expect(python).toContain("    hide={clk_In, clk_Out, clk_Move, clk_Loop},\n");
    expect(python.match(/def flow\(/gu)).toHaveLength(4);
  });
});
