import { describe, expect, it } from "vitest";

import {
  and,
  assign,
  bool,
  dec,
  exp,
  fired,
  ifThen,
  inc,
  isZero,
  ite,
  nat,
  nonNegative,
  nonZero,
  not,
  rate,
  ref,
  zeroFlow,
} from "../graph/spn-graph";
import { emitPython } from "./emit";

import type { SpnGraph } from "../graph/spn-graph";
import type { PetriNetIr } from "../ir/schema";

/** The document the graph stands for; the emitter reads only its name and places. */
const ir: PetriNetIr = { name: "spn", kind: "stochastic", places: {}, transitions: {} };

/** A transition with a clock and an event, and a place that uses every operator of its side. */
const graph: SpnGraph = {
  language: "spn",
  variables: [
    { name: "P", sort: "nat", role: "place" },
    { name: "t", sort: "clock", role: "time", comment: "the time reference" },
    {
      name: "clk_T",
      sort: "clock",
      role: "clock",
      comment: "time left until T fires",
    },
    {
      name: "ev_T",
      sort: "event",
      role: "event",
      comment: "toggles when T fires",
    },
  ],
  modules: [
    {
      className: "Transition_T",
      instance: "transition_T",
      source: { kind: "transition", name: "T" },
      docstring: "T: P -> P, at rate 0.5",
      ctrl: ["clk_T", "ev_T"],
      extl: ["P", "t"],
      init: [exp(0.5), bool(false)],
      next: [assign("fires_T", and(isZero(ref("clk_T")), nonZero(ref("P"))))],
      returns: [
        ite(ref("fires_T"), exp(0.5), ref("clk_T")),
        ifThen(ref("fires_T"), not(ref("ev_T"))),
      ],
      flow: [
        ifThen(nonNegative("clk_T"), ite(nonZero(ref("P")), rate(-1, "t"), rate(0, "t"))),
        zeroFlow(),
      ],
    },
    {
      className: "Place_P",
      instance: "place_P",
      source: { kind: "place", name: "P" },
      docstring: "P: every operator the place side has",
      ctrl: ["P"],
      extl: ["ev_T"],
      init: [nat(3)],
      next: [assign("fired_T", fired("ev_T"))],
      returns: [
        // ~(a & b) & (P != 0) parenthesised, a step inside a test, a test inside a not
        ite(
          and(not(and(ref("fired_T"), not(isZero(ref("P"))))), nonZero(ref("P"))),
          dec(ref("P")),
          ite(isZero(inc(ref("P"))), inc(ref("P")), ref("P")),
        ),
      ],
    },
  ],
  hidden: ["clk_T"],
};

describe("the SPN emitter in one file", () => {
  it("writes the SPN sorts, the sugar it uses, next and flow, and the hidden clocks", () => {
    // GIVEN the transition and place graph
    // WHEN it is emitted as one file
    const python = emitPython(graph, "single", ir)[0]?.text;
    // THEN it declares the sorts, writes next and flow, and hides the clock in compose
    expect(python).toBe(
      `from zrth import SPN, Clock, Event, Nat, Var
from zrth import Module as compose
from zrth.sugar import Module, d, ite, fired, exp

t = Var(Clock())  # the time reference

P = Var(Nat())

clk_T = Var(Clock())  # time left until T fires

ev_T = Var(Event())  # toggles when T fires


class Transition_T(Module):
    """T: P -> P, at rate 0.5"""

    def init(self, P, t):
        return exp(0.5), False

    def next(self, clk_T, ev_T, P, t):
        fires_T = (clk_T == 0) & (P != 0)
        return ite(fires_T, exp(0.5), clk_T), ite(fires_T, ~ev_T, None)

    def flow(self, clk_T, ev_T, P, t):
        return ite(clk_T >= 0, ite(P != 0, -1 * d(t), 0 * d(t)), None), 0


class Place_P(Module):
    """P: every operator the place side has"""

    def init(self, ev_T):
        return 3

    def next(self, P, ev_T):
        fired_T = fired(ev_T)
        return ite(~(fired_T & ~(P == 0)) & (P != 0), P - 1, ite((P + 1) == 0, P + 1, P))


transition_T = Transition_T(theory=SPN, ctrl=(clk_T, ev_T), extl=(P, t))
place_P = Place_P(theory=SPN, ctrl=(P,), extl=(ev_T,))
net = compose(transition_T, place_P, hide={clk_T})
`,
    );
  });

  it("declares a pick as a Bool of one value, imported beside the SPN sorts", () => {
    // GIVEN the graph with a pick for T
    const picked: SpnGraph = {
      ...graph,
      variables: [
        ...graph.variables,
        {
          name: "pick_T",
          sort: "bool",
          role: "pick",
          comment: "the environment lets T fire this step",
        },
      ],
    };
    // WHEN it is emitted
    const python = emitPython(picked, "single", ir)[0]?.text;
    // THEN Bool is imported and the pick is declared after the events
    expect(python).toContain("from zrth import SPN, Bool, Clock, Event, Nat, Var\n");
    expect(python).toContain(
      "ev_T = Var(Event())  # toggles when T fires\n\npick_T = Var(Bool([1, 1]))  # the environment lets T fire this step\n\n\nclass Transition_T(Module):",
    );
  });

  it("imports only the sorts and sugar names a graph uses, and writes an integer rate as a float", () => {
    // GIVEN a place no transition moves, then the same place armed with an integer rate
    const counter: SpnGraph = {
      language: "spn",
      variables: [{ name: "N", sort: "nat", role: "place" }],
      modules: [
        {
          className: "Place_N",
          instance: "place_N",
          source: { kind: "place", name: "N" },
          docstring: "N: no transition moves its tokens",
          ctrl: ["N"],
          extl: [],
          init: [nat(0)],
          next: [],
          returns: [ref("N")],
        },
      ],
      hidden: [],
    };
    const armed: SpnGraph = {
      ...counter,
      modules: [{ ...counter.modules[0]!, init: [exp(2)] }],
    };
    // WHEN each is emitted
    const python = emitPython(counter, "single", ir)[0]?.text;
    const armedPython = emitPython(armed, "single", ir)[0]?.text;
    // THEN the imports name only what is used, there is no flow, and the rate is a float
    expect(python).toContain("from zrth import SPN, Nat, Var\n");
    expect(python).toContain("from zrth.sugar import Module\n");
    expect(python).toContain("net = compose(place_N)\n");
    expect(python).not.toContain("def flow(");
    expect(armedPython).toContain("        return exp(2.0)\n");
  });
});

describe("the SPN emitter, one module per file", () => {
  it("writes net.py with the imports and the composition, and a class file with its own sugar", () => {
    // GIVEN the transition and place graph
    // WHEN it is emitted one module per file
    const files = emitPython(graph, "per-module", ir);
    // THEN net.py declares and composes, and each class file imports only its own sugar
    expect(files.map((file) => file.path)).toEqual(["net.py", "transition_t.py", "place_p.py"]);
    expect(files[0]?.text).toBe(
      `from zrth import SPN, Clock, Event, Nat, Var
from zrth import Module as compose

from transition_t import Transition_T
from place_p import Place_P

t = Var(Clock())  # the time reference

P = Var(Nat())

clk_T = Var(Clock())  # time left until T fires

ev_T = Var(Event())  # toggles when T fires


transition_T = Transition_T(theory=SPN, ctrl=(clk_T, ev_T), extl=(P, t))
place_P = Place_P(theory=SPN, ctrl=(P,), extl=(ev_T,))
net = compose(transition_T, place_P, hide={clk_T})
`,
    );
    expect(
      files[2]?.text.startsWith(`from zrth.sugar import Module, ite, fired


class Place_P(Module):
`),
    ).toBe(true);
    expect(files[1]?.text).toContain("from zrth.sugar import Module, d, ite, exp\n");
    expect(files[1]?.text).not.toContain("from zrth import");
  });
});
