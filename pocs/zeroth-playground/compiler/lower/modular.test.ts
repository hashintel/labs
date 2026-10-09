import { describe, expect, it } from "vitest";

import { bucketIr } from "../testing/coloured-nets.fixtures";
import { compileNet, pythonOf } from "../testing/compile-net";
import { parseCode } from "../testing/fixture-parser";
import { capacity, conflict, cycle, queue } from "../testing/small-nets.fixtures";
import { modular } from "./modular";

import type { PetriNetIr } from "../ir/schema";

describe("the modular lowering", () => {
  it("composes one module per transition and per place in the modular shape", () => {
    // GIVEN the cycle in the modular shape
    // WHEN it is compiled
    const python = pythonOf(cycle, { shape: "modular" });
    // THEN each transition and each place has its class, and compose joins them
    for (const className of ["Transition_Go", "Transition_Back", "Place_A", "Place_B"]) {
      expect(python).toContain(`class ${className}(Module):`);
    }
    expect(python).toContain("net = compose(transition_Go, transition_Back, place_A, place_B)\n");
  });

  it("has a later producer of a capped place await the earlier transitions that move its tokens", () => {
    // GIVEN the capped buffer in the modular shape
    // WHEN it is compiled
    const python = pythonOf(capacity, { shape: "modular" });
    // THEN PutRight awaits PutLeft's firing to count the buffer's fill
    expect(python).toContain(
      `        fill_Buffer = ite(X(fire_PutLeft), fill_Buffer + 1, fill_Buffer)  # PutLeft added 1
        return (RightSource >= 1) & (fill_Buffer + 1 <= 2)
`,
    );
    expect(python).toContain(
      "transition_PutRight = Transition_PutRight(theory=LIA, ctrl=(fire_PutRight,), extl=(RightSource, Buffer, fire_PutLeft))",
    );
  });

  it("keeps Int places under marking int by moving each draw test into an LRA module", () => {
    // GIVEN the queue, modular with an integer marking
    // WHEN it is compiled
    const python = pythonOf(queue, { shape: "modular", marking: "int", dt: 0.5 });
    // THEN each draw is tested in its own LRA module and the rest stays in LIA
    expect(python).toBe(
      `from zrth import LIA, LRA, Bool, Int, Real, Var
from zrth import Module as compose
from zrth.sugar import Module, X, ite

INT = Int([1, 1])
REAL = Real([1, 1])
BOOL = Bool([1, 1])

Waiting = Var(INT)
Served = Var(INT)

u_Arrive = Var(REAL)  # uniform draw for Arrive, each step
u_Serve = Var(REAL)  # uniform draw for Serve, each step

hit_Arrive = Var(BOOL)  # Arrive's draw passed its threshold
hit_Serve = Var(BOOL)  # Serve's draw passed its threshold
fire_Arrive = Var(BOOL)  # Arrive fires this step
fire_Serve = Var(BOOL)  # Serve fires this step


class Draw_Arrive(Module):
    """Arrive at rate 2.5 fires within a step of dt = 0.5 when its draw is at least e^(-2.5 * 0.5)"""

    def init(self, u_Arrive):
        return False

    def next(self, hit_Arrive, u_Arrive):
        return X(u_Arrive) >= 0.2865047968601901


class Draw_Serve(Module):
    """Serve at rate 3 fires within a step of dt = 0.5 when its draw is at least e^(-3 * 0.5)"""

    def init(self, u_Serve):
        return False

    def next(self, hit_Serve, u_Serve):
        return X(u_Serve) >= 0.22313016014842982


class Transition_Arrive(Module):
    """Arrive: nothing -> Waiting, at rate 2.5"""

    def init(self, Waiting, hit_Arrive):
        return False

    def next(self, fire_Arrive, Waiting, hit_Arrive):
        return (Waiting + 1 <= 4) & X(hit_Arrive)


class Transition_Serve(Module):
    """Serve: Waiting -> Served, at rate 3"""

    def init(self, Waiting, hit_Serve):
        return False

    def next(self, fire_Serve, Waiting, hit_Serve):
        return (Waiting >= 1) & X(hit_Serve)


class Place_Waiting(Module):
    """Waiting: taken by Serve, added by Arrive"""

    def init(self, fire_Arrive, fire_Serve):
        return 0

    def next(self, Waiting, fire_Arrive, fire_Serve):
        Waiting = ite(X(fire_Arrive), Waiting + 1, Waiting)  # Arrive adds 1
        Waiting = ite(X(fire_Serve), Waiting - 1, Waiting)  # Serve takes 1
        return Waiting


class Place_Served(Module):
    """Served: added by Serve"""

    def init(self, fire_Serve):
        return 0

    def next(self, Served, fire_Serve):
        Served = ite(X(fire_Serve), Served + 1, Served)  # Serve adds 1
        return Served


draw_Arrive = Draw_Arrive(theory=LRA, ctrl=(hit_Arrive,), extl=(u_Arrive,))
draw_Serve = Draw_Serve(theory=LRA, ctrl=(hit_Serve,), extl=(u_Serve,))
transition_Arrive = Transition_Arrive(theory=LIA, ctrl=(fire_Arrive,), extl=(Waiting, hit_Arrive))
transition_Serve = Transition_Serve(theory=LIA, ctrl=(fire_Serve,), extl=(Waiting, hit_Serve))
place_Waiting = Place_Waiting(theory=LIA, ctrl=(Waiting,), extl=(fire_Arrive, fire_Serve))
place_Served = Place_Served(theory=LIA, ctrl=(Served,), extl=(fire_Serve,))
net = compose(
    draw_Arrive,
    draw_Serve,
    transition_Arrive,
    transition_Serve,
    place_Waiting,
    place_Served,
)
`,
    );
  });

  it("has a later taker from a shared place await the earlier one in the modular shape", () => {
    // GIVEN the conflict in the modular shape
    // WHEN it is compiled
    const python = pythonOf(conflict, { shape: "modular" });
    // THEN TakeRight counts Pool after TakeLeft's take
    expect(python).toContain(
      `    def next(self, fire_TakeRight, Pool, fire_TakeLeft):
        avail_Pool = Pool
        avail_Pool = ite(X(fire_TakeLeft), avail_Pool - 2, avail_Pool)  # TakeLeft took 2
        return avail_Pool >= 1
`,
    );
  });

  it("tests read and inhibitor arcs on the count the earlier takers left", () => {
    // GIVEN a taker from A, then a transition that reads A and is inhibited by B
    const guarded: PetriNetIr = {
      name: "guarded",
      kind: "plain",
      places: { A: null, B: null, C: null },
      marking: { A: 1 },
      transitions: {
        Take: { inputs: { A: null }, outputs: { C: null } },
        Check: { inputs: { A: { kind: "read" }, B: { kind: "inhibitor" } }, outputs: { C: null } },
      },
    };
    // WHEN it is compiled in the modular shape
    const python = pythonOf(guarded, { shape: "modular" });
    // THEN Check reads both places and tests A after Take's take
    expect(python).toContain(
      `        avail_A = ite(X(fire_Take), avail_A - 1, avail_A)  # Take took 1
        return (avail_A >= 1) & (B < 1)
`,
    );
    expect(python).toContain(
      "transition_Check = Transition_Check(theory=LIA, ctrl=(fire_Check,), extl=(A, fire_Take, B))",
    );
  });

  it("refuses a coloured net and a net with dynamics", () => {
    // GIVEN the cycle with a coloured place, and the cycle with a place that has dynamics
    const coloured: PetriNetIr = {
      ...cycle,
      colours: { Drop: { size: "real" } },
      places: { A: { colour: "Drop" }, B: null },
    };
    const dynamic: PetriNetIr = {
      ...cycle,
      colours: { Drop: { size: "real" } },
      dynamics: { Evaporate: { colour: "Drop", code: "return tokens;" } },
      places: { A: { dynamics: "Evaporate" }, B: null },
    };
    // WHEN the modular lowering checks each net, and the plain cycle
    const found = [coloured, dynamic, cycle].map((ir) =>
      modular.refusals(ir).map((error) => error.code),
    );
    // THEN both are refused on the net, and the plain cycle is not
    expect(found).toEqual([["modular-coloured-not-lowered"], ["modular-coloured-not-lowered"], []]);
  });

  it("refuses a coloured net with code by name alone, parser or not", () => {
    // GIVEN the bucket, whose transitions carry code, in the modular shape
    // WHEN it is compiled without and with a parser
    const outcomes = [
      compileNet(bucketIr, { shape: "modular" }),
      compileNet(bucketIr, { shape: "modular" }, parseCode),
    ];
    // THEN the shape is refused before any code is read
    for (const { graph, errors } of outcomes) {
      expect(graph).toBeNull();
      expect(errors.map((error) => error.code)).toEqual(["modular-coloured-not-lowered"]);
    }
  });
});
