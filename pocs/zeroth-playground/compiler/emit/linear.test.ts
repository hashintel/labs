import { describe, expect, it } from "vitest";

import { binary, bool, ite, not, num, ref, relu, scale } from "../graph/linear-graph";
import { emitPython } from "./emit";
import { moduleFileStem } from "./python";

import type { LinearGraph } from "../graph/linear-graph";
import type { PetriNetIr } from "../ir/schema";

/** The document the graph stands for; the emitter reads only its name and places. */
const ir: PetriNetIr = { name: "ops", kind: "plain", places: {}, transitions: {} };

/** One module whose two returns use every operator the linear graph has. */
const graph: LinearGraph = {
  language: "linear",
  variables: [
    { name: "Level", sort: "real", role: "place" },
    { name: "Full", sort: "bool", role: "flag" },
  ],
  modules: [
    {
      className: "Ops",
      instance: "ops",
      source: { kind: "net", name: "ops" },
      docstring: "Every operator the graph has.",
      theory: "LRA",
      ctrl: ["Level", "Full"],
      extl: [],
      init: [num(0), bool(false)],
      next: [],
      returns: [
        // 0.5 * (Level - 1) + relu(2 - Level), the max form
        binary(
          "+",
          scale(0.5, binary("-", ref("Level"), num(1))),
          relu(binary("-", num(2), ref("Level"))),
        ),
        // ~(Level < 3) | ((ite(Full, 4, 0) == 4) & Full), a literal-only ite inside
        binary(
          "|",
          not(binary("<", ref("Level"), num(3))),
          binary("&", binary("==", ite(ref("Full"), num(4), num(0)), num(4)), ref("Full")),
        ),
      ],
    },
  ],
  root: { kind: "single", module: "ops" },
};

describe("the linear emitter in one file", () => {
  it("renders comparisons, logic, scaling, relu and literal branches under Python's precedence", () => {
    // GIVEN the graph that uses every operator
    // WHEN it is emitted as one file
    const python = emitPython(graph, "single", ir)[0]?.text;
    // THEN each operator prints with only the brackets Python needs
    expect(python).toBe(
      `from zrth import LRA, Bool, Real, Var, expr
from zrth.expr import relu
from zrth.sugar import Module, ite

REAL = Real([1, 1])
BOOL = Bool([1, 1])

Level = Var(REAL)

Full = Var(BOOL)


class Ops(Module):
    """Every operator the graph has."""

    def init(self):
        return 0.0, False

    def next(self, Level, Full):
        return 0.5 * (Level - 1.0) + relu(2.0 - Level), ~(Level < 3.0) | ((ite(Full, expr(4.0, theory=LRA, sort=REAL), 0.0) == 4.0) & Full)


net = Ops(theory=LRA, ctrl=(Level, Full))
`,
    );
  });
});

describe("the linear emitter, one module per file", () => {
  it("names a module's file after its class", () => {
    // GIVEN class names in UpperCamelCase, with digits and with an acronym
    const classNames = ["Transition_Infection", "Place_FooBar2", "Draw_ABTest"];
    // WHEN each is turned into a file stem
    const stems = classNames.map((className) => moduleFileStem(className));
    // THEN each is in snake case
    expect(stems[0]).toBe("transition_infection");
    expect(stems[1]).toBe("place_foo_bar2");
    expect(stems[2]).toBe("draw_ab_test");
  });

  it("numbers the stem of a module whose class name folds onto an earlier one", () => {
    // GIVEN three modules whose class names differ by case alone
    function twin(className: string, instance: string) {
      return { ...graph.modules[0]!, className, instance };
    }
    const twins: LinearGraph = {
      ...graph,
      modules: [twin("Place_Ab", "a"), twin("Place_AB", "b"), twin("Place_ab", "c")],
      root: { kind: "compose", modules: ["a", "b", "c"] },
    };
    // WHEN they are emitted one module per file
    const files = emitPython(twins, "per-module", ir);
    // THEN the later files are numbered, and net.py imports each class from its own file
    expect(files.map((file) => file.path)).toEqual([
      "net.py",
      "place_ab.py",
      "place_ab_2.py",
      "place_ab_3.py",
    ]);
    expect(files[0]?.text).toContain("from place_ab_2 import Place_AB");
    expect(files[2]?.text).toContain("class Place_AB(Module):");
  });

  it("writes net.py first and gives a module the imports and sorts its own body needs", () => {
    // GIVEN the graph
    // WHEN it is emitted one module per file
    const files = emitPython(graph, "per-module", ir);
    // THEN net.py declares the variables and instantiates the module,
    // and the module's file imports only what its body uses
    expect(files.map((file) => file.path)).toEqual(["net.py", "ops.py"]);
    expect(files[0]?.text).toBe(
      `from zrth import LRA, Bool, Real, Var

from ops import Ops

REAL = Real([1, 1])
BOOL = Bool([1, 1])

Level = Var(REAL)

Full = Var(BOOL)


net = Ops(theory=LRA, ctrl=(Level, Full))
`,
    );
    const [, ops] = files;
    expect(
      ops?.text.startsWith(`from zrth import LRA, Real, expr
from zrth.expr import relu
from zrth.sugar import Module, ite

REAL = Real([1, 1])


class Ops(Module):
`),
    ).toBe(true);
    expect(ops?.text).toContain("expr(4.0, theory=LRA, sort=REAL)");
  });
});
