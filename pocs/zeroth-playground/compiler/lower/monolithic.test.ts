import { describe, expect, it } from "vitest";

import { pythonOf } from "../testing/compile-net";
import { forkIr } from "../testing/fork.fixtures";
import { capacity, conflict, cycle, queue } from "../testing/small-nets.fixtures";

import type { PetriNetIr } from "../ir/schema";

describe("the monolithic lowering", () => {
  it("lowers a plain net to an LIA module with one step of the net per next", () => {
    // GIVEN the plain cycle
    // WHEN it is compiled
    const python = pythonOf(cycle);
    // THEN one LIA module sweeps the transitions and lands the produced tokens at the end
    expect(python).toBe(
      `from zrth import LIA, Int, Var
from zrth.sugar import Module, ite

INT = Int([1, 1])

A = Var(INT)
B = Var(INT)


class Cycle(Module):
    """Plain Petri net with 2 places and 2 transitions. One next is one step of the net."""

    def init(self):
        return 1, 0

    def next(self, A, B):
        # sweep in order; a firing consumes its input tokens at once
        fire_Go = A >= 1  # Go: A -> B
        A = ite(fire_Go, A - 1, A)
        fire_Back = B >= 1  # Back: B -> A
        B = ite(fire_Back, B - 1, B)
        # end of step: produced tokens land
        A = ite(fire_Back, A + 1, A)
        B = ite(fire_Go, B + 1, B)
        return A, B


net = Cycle(theory=LIA, ctrl=(A, B))
`,
    );
  });

  it("tracks a capped place's pending fill so a later producer sees an earlier one", () => {
    // GIVEN two producers into a buffer capped at 2
    // WHEN the net is compiled
    const python = pythonOf(capacity);
    // THEN the buffer's fill counts what earlier producers added this step
    expect(python).toBe(
      `from zrth import LIA, Int, Var
from zrth.sugar import Module, ite

INT = Int([1, 1])

LeftSource = Var(INT)
RightSource = Var(INT)
Buffer = Var(INT)
Sink = Var(INT)


class Capacity(Module):
    """Plain Petri net with 4 places and 3 transitions. One next is one step of the net."""

    def init(self):
        return 5, 5, 0, 0

    def next(self, LeftSource, RightSource, Buffer, Sink):
        # tokens a capped place would hold if the step ended now
        fill_Buffer = Buffer
        # sweep in order; a firing consumes its input tokens at once
        fire_PutLeft = (LeftSource >= 1) & (fill_Buffer + 1 <= 2)  # PutLeft: LeftSource -> Buffer
        LeftSource = ite(fire_PutLeft, LeftSource - 1, LeftSource)
        fill_Buffer = ite(fire_PutLeft, fill_Buffer + 1, fill_Buffer)
        fire_PutRight = (RightSource >= 1) & (fill_Buffer + 1 <= 2)  # PutRight: RightSource -> Buffer
        RightSource = ite(fire_PutRight, RightSource - 1, RightSource)
        fill_Buffer = ite(fire_PutRight, fill_Buffer + 1, fill_Buffer)
        fire_Take = Buffer >= 1  # Take: Buffer -> Sink
        Buffer = ite(fire_Take, Buffer - 1, Buffer)
        fill_Buffer = ite(fire_Take, fill_Buffer - 1, fill_Buffer)
        # end of step: produced tokens land
        Sink = ite(fire_Take, Sink + 1, Sink)
        return LeftSource, RightSource, fill_Buffer, Sink


net = Capacity(theory=LIA, ctrl=(LeftSource, RightSource, Buffer, Sink))
`,
    );
  });

  it("tests a stochastic transition against an external draw over dt", () => {
    // GIVEN the queue, with rates 2.5 and 3 over a step of 0.5
    const arrive = Math.exp(-2.5 * 0.5);
    const serve = Math.exp(-3 * 0.5);
    // WHEN it is compiled
    const python = pythonOf(queue, { dt: 0.5 });
    // THEN each transition fires when its draw is at least e^(-rate * dt)
    expect(python).toBe(
      `from zrth import LRA, Real, Var
from zrth.sugar import Module, X, ite

REAL = Real([1, 1])

Waiting = Var(REAL)
Served = Var(REAL)

u_Arrive = Var(REAL)  # uniform draw for Arrive, each step
u_Serve = Var(REAL)  # uniform draw for Serve, each step


class Queue(Module):
    """Stochastic Petri net with 2 places and 2 transitions, dt = 0.5. One next is one step of the net."""

    def init(self, u_Arrive, u_Serve):
        return 0.0, 0.0

    def next(self, Waiting, Served, u_Arrive, u_Serve):
        # tokens a capped place would hold if the step ended now
        fill_Waiting = Waiting
        # sweep in order; a firing consumes its input tokens at once
        fire_Arrive = (fill_Waiting + 1.0 <= 4.0) & (X(u_Arrive) >= ${arrive})  # Arrive: nothing -> Waiting
        fill_Waiting = ite(fire_Arrive, fill_Waiting + 1.0, fill_Waiting)
        fire_Serve = (Waiting >= 1.0) & (X(u_Serve) >= ${serve})  # Serve: Waiting -> Served
        Waiting = ite(fire_Serve, Waiting - 1.0, Waiting)
        fill_Waiting = ite(fire_Serve, fill_Waiting - 1.0, fill_Waiting)
        # end of step: produced tokens land
        Served = ite(fire_Serve, Served + 1.0, Served)
        return fill_Waiting, Served


net = Queue(theory=LRA, ctrl=(Waiting, Served), extl=(u_Arrive, u_Serve))
`,
    );
  });

  it("composes the monolithic step module with the draw modules under marking int", () => {
    // GIVEN the queue, monolithic with an integer marking
    // WHEN it is compiled
    const python = pythonOf(queue, { marking: "int", dt: 0.5 });
    // THEN the one step module reads the draw modules' hits and compose joins them
    expect(python).toContain("Waiting = Var(INT)\n");
    expect(python).toContain(
      'class Draw_Arrive(Module):\n    """Arrive at rate 2.5 fires within a step of dt = 0.5 when its draw is at least e^(-2.5 * 0.5)"""',
    );
    expect(python).toContain(
      "        fire_Arrive = (fill_Waiting + 1 <= 4) & X(hit_Arrive)  # Arrive: nothing -> Waiting\n",
    );
    expect(python).toContain(
      "marking = Queue(theory=LIA, ctrl=(Waiting, Served), extl=(hit_Arrive, hit_Serve))\nnet = compose(draw_Arrive, draw_Serve, marking)\n",
    );
  });

  it("opens a controllable transition to an external choice under control open", () => {
    // GIVEN the conflict with control open, monolithic and modular
    // WHEN each is compiled
    const python = pythonOf(conflict, { control: "open" });
    const modular = pythonOf(conflict, { shape: "modular", control: "open" });
    // THEN the controllable transition also waits for its choice
    expect(python).toBe(
      `from zrth import LIA, Bool, Int, Var
from zrth.sugar import Module, X, ite

INT = Int([1, 1])
BOOL = Bool([1, 1])

Pool = Var(INT)
Left = Var(INT)
Right = Var(INT)

go_TakeLeft = Var(BOOL)  # choice for TakeLeft, each step: it fires only when chosen


class Conflict(Module):
    """Plain Petri net with 3 places and 2 transitions. One next is one step of the net."""

    def init(self, go_TakeLeft):
        return 3, 0, 0

    def next(self, Pool, Left, Right, go_TakeLeft):
        # sweep in order; a firing consumes its input tokens at once
        fire_TakeLeft = (Pool >= 2) & X(go_TakeLeft)  # TakeLeft: 2 Pool -> Left
        Pool = ite(fire_TakeLeft, Pool - 2, Pool)
        fire_TakeRight = Pool >= 1  # TakeRight: Pool -> Right
        Pool = ite(fire_TakeRight, Pool - 1, Pool)
        # end of step: produced tokens land
        Left = ite(fire_TakeLeft, Left + 1, Left)
        Right = ite(fire_TakeRight, Right + 1, Right)
        return Pool, Left, Right


net = Conflict(theory=LIA, ctrl=(Pool, Left, Right), extl=(go_TakeLeft,))
`,
    );
    expect(modular).toContain(
      "    def next(self, fire_TakeLeft, Pool, go_TakeLeft):\n        return (Pool >= 2) & X(go_TakeLeft)\n",
    );
  });

  it("fires a controllable transition whenever enabled under control closed", () => {
    // GIVEN the conflict with control closed
    // WHEN it is compiled
    const python = pythonOf(conflict);
    // THEN there is no choice, and the controllable transition fires when enabled
    expect(python).not.toContain("go_TakeLeft");
    expect(python).toContain("        fire_TakeLeft = Pool >= 2  # TakeLeft: 2 Pool -> Left\n");
  });

  it("has each transition in a conflict wait for an undriven pick under conflicts nondet", () => {
    // GIVEN the conflict with conflicts left open, monolithic, then modular with control open too
    // WHEN each is compiled
    const python = pythonOf(conflict, { conflicts: "nondet" });
    const modular = pythonOf(conflict, {
      shape: "modular",
      control: "open",
      conflicts: "nondet",
    });
    // THEN each transition in the conflict also waits for its own pick
    expect(python).toBe(
      `from zrth import LIA, Bool, Int, Var
from zrth.sugar import Module, X, ite

INT = Int([1, 1])
BOOL = Bool([1, 1])

Pool = Var(INT)
Left = Var(INT)
Right = Var(INT)

pick_TakeLeft = Var(BOOL)  # the environment lets TakeLeft fire this step
pick_TakeRight = Var(BOOL)  # the environment lets TakeRight fire this step


class Conflict(Module):
    """Plain Petri net with 3 places and 2 transitions. One next is one step of the net."""

    def init(self, pick_TakeLeft, pick_TakeRight):
        return 3, 0, 0

    def next(self, Pool, Left, Right, pick_TakeLeft, pick_TakeRight):
        # sweep in order; a firing consumes its input tokens at once
        fire_TakeLeft = (Pool >= 2) & X(pick_TakeLeft)  # TakeLeft: 2 Pool -> Left
        Pool = ite(fire_TakeLeft, Pool - 2, Pool)
        fire_TakeRight = (Pool >= 1) & X(pick_TakeRight)  # TakeRight: Pool -> Right
        Pool = ite(fire_TakeRight, Pool - 1, Pool)
        # end of step: produced tokens land
        Left = ite(fire_TakeLeft, Left + 1, Left)
        Right = ite(fire_TakeRight, Right + 1, Right)
        return Pool, Left, Right


net = Conflict(theory=LIA, ctrl=(Pool, Left, Right), extl=(pick_TakeLeft, pick_TakeRight))
`,
    );
    expect(modular).toContain(
      "go_TakeLeft = Var(BOOL)  # choice for TakeLeft, each step: it fires only when chosen\npick_TakeLeft = Var(BOOL)  # the environment lets TakeLeft fire this step\npick_TakeRight = Var(BOOL)  # the environment lets TakeRight fire this step\n",
    );
    expect(modular).toContain(
      "    def next(self, fire_TakeLeft, Pool, go_TakeLeft, pick_TakeLeft):\n        return (Pool >= 2) & X(go_TakeLeft) & X(pick_TakeLeft)\n",
    );
    expect(modular).toContain(
      `    def next(self, fire_TakeRight, Pool, fire_TakeLeft, pick_TakeRight):
        avail_Pool = Pool
        avail_Pool = ite(X(fire_TakeLeft), avail_Pool - 2, avail_Pool)  # TakeLeft took 2
        return (avail_Pool >= 1) & X(pick_TakeRight)
`,
    );
    expect(modular).toContain(
      "transition_TakeRight = Transition_TakeRight(theory=LIA, ctrl=(fire_TakeRight,), extl=(Pool, fire_TakeLeft, pick_TakeRight))\n",
    );
  });

  it("gives a pick to the transitions in a conflict alone, and none under conflicts sweep", () => {
    // GIVEN the fork with conflicts left open, and four nets with conflicts swept
    const swept = [conflict, forkIr, cycle, capacity];
    // WHEN each is compiled
    const python = pythonOf(forkIr, { conflicts: "nondet" });
    // THEN only the fork's two takers get a pick, and sweeping is the default
    expect(python).toContain("pick_TakeLeft = Var(BOOL)");
    expect(python).toContain("pick_TakeRight = Var(BOOL)");
    expect(python).not.toContain("pick_Return");
    expect(python).toContain("        fire_Return = Left >= 1  # Return: Left -> Pool\n");
    for (const ir of swept) {
      expect(pythonOf(ir, { conflicts: "sweep" })).toBe(pythonOf(ir));
    }
  });

  it("mixes predicate and stochastic transitions, drawing only for the rated ones", () => {
    // GIVEN a mixed net with one rated and one plain transition
    const mixed: PetriNetIr = {
      name: "mixed",
      kind: "mixed",
      places: { A: null, B: null },
      marking: { A: 3 },
      transitions: {
        Go: { inputs: { A: null }, outputs: { B: null }, rate: 2 },
        Back: { inputs: { B: null }, outputs: { A: null } },
      },
    };
    // WHEN it is compiled
    const python = pythonOf(mixed);
    // THEN only the rated transition draws
    expect(python).toContain(
      '    """Mixed Petri net with 2 places and 2 transitions, dt = 1.0. One next is one step of the net."""',
    );
    expect(python).toContain("u_Go = Var(REAL)  # uniform draw for Go, each step\n\n");
    expect(python).not.toContain("u_Back");
    expect(python).toContain(
      `        fire_Go = (A >= 1.0) & (X(u_Go) >= ${Math.exp(-2)})  # Go: A -> B\n`,
    );
    expect(python).toContain("        fire_Back = B >= 1.0  # Back: B -> A\n");
    expect(python).toContain("net = Mixed(theory=LRA, ctrl=(A, B), extl=(u_Go,))");
  });

  it("writes a plain transition with no inputs as always enabled", () => {
    // GIVEN a source transition with no inputs
    const source: PetriNetIr = {
      name: "source",
      kind: "plain",
      places: { Out: null },
      transitions: { Emit: { outputs: { Out: { weight: 2 } } } },
    };
    // WHEN it is compiled
    const python = pythonOf(source);
    // THEN it fires every step
    expect(python).toContain("        # Emit: nothing -> 2 Out: always enabled\n");
    expect(python).toContain("        Out = Out + 2\n");
    expect(python).toContain("net = Source(theory=LIA, ctrl=(Out,))");
  });
});
