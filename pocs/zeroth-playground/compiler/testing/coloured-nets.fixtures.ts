import type { PetriNetIr } from "../ir/schema";
import type { CompilerOptions } from "../options";

/** The bucket as one module: slots, bindings in arc order and compaction at the end of the step. */
export const bucketPython = `from zrth import LRA, Bool, Real, Var, expr
from zrth.sugar import Module, X, ite

REAL = Real([1, 1])
BOOL = Bool([1, 1])

Pool_0_present = Var(BOOL)  # Pool slot 0 holds a token
Pool_0_x = Var(REAL)
Pool_1_present = Var(BOOL)  # Pool slot 1 holds a token
Pool_1_x = Var(REAL)
Done = Var(REAL)

e_Take = Var(REAL)  # exponential draw for Take, each step: -ln(u) / dt


class Bucket(Module):
    """Stochastic coloured Petri net with 2 places (1 coloured) and 1 transition, dt = 1.0. One next is one step of the net."""

    def init(self, e_Take):
        return True, 2.0, True, 0.5, 0.0

    def next(self, Pool_0_present, Pool_0_x, Pool_1_present, Pool_1_x, Done, e_Take):
        # sweep in order; a firing consumes its input tokens at once
        bind_Take_0 = Pool_0_present & (0.006 * Pool_0_x >= X(e_Take))  # Pool[0]
        sel_Take_0 = bind_Take_0
        seen_Take = bind_Take_0
        bind_Take_1 = Pool_1_present & (0.006 * Pool_1_x >= X(e_Take))  # Pool[1]
        sel_Take_1 = bind_Take_1 & ~seen_Take
        seen_Take = seen_Take | bind_Take_1
        take_Take_Pool_0 = sel_Take_0
        take_Take_Pool_1 = sel_Take_1
        fire_Take = seen_Take  # Take: Pool -> Done
        Pool_0_present = Pool_0_present & ~take_Take_Pool_0
        Pool_1_present = Pool_1_present & ~take_Take_Pool_1
        # end of step: produced tokens land
        # Pool: survivors close up in slot order
        rank_Pool_1 = ite(Pool_0_present, expr(1.0, theory=LRA, sort=REAL), 0.0)
        kept_Pool = rank_Pool_1 + ite(Pool_1_present, expr(1.0, theory=LRA, sort=REAL), 0.0)
        next_Pool_0_x = ite(Pool_1_present & (rank_Pool_1 == 0.0), Pool_1_x, Pool_0_x)
        next_Pool_1_x = Pool_1_x
        Pool_0_x = next_Pool_0_x
        Pool_1_x = next_Pool_1_x
        Pool_0_present = kept_Pool >= 1.0
        Pool_1_present = kept_Pool >= 2.0
        Done = ite(fire_Take, Done + 1.0, Done)
        return Pool_0_present, Pool_0_x, Pool_1_present, Pool_1_x, Done


net = Bucket(theory=LRA, ctrl=(Pool_0_present, Pool_0_x, Pool_1_present, Pool_1_x, Done), extl=(e_Take,))
`;

/** Balls drawn from a capped coloured pool at a rate that reads each ball. */
export const bucketIr: PetriNetIr = {
  name: "bucket",
  kind: "stochastic",
  colours: { Ball: { x: "real" } },
  places: { Pool: { colour: "Ball", capacity: 2 }, Done: null },
  marking: { Pool: [{ x: 2 }, { x: 0.5 }] },
  transitions: {
    Take: {
      inputs: { Pool: null },
      outputs: { Done: null },
      rate: "return 0.6 * (input.Pool[0].x / 100);",
    },
  },
};

/** A tank whose level rises by dynamics, read by a guarded alarm. */
export const boilerIr: PetriNetIr = {
  name: "boiler",
  kind: "plain",
  colours: { Vessel: { level: "real" } },
  dynamics: {
    Heat: {
      colour: "Vessel",
      code: "return tokens.map((t) => ({ level: 0.5 * (10 - t.level) }));",
    },
  },
  places: {
    Tank: { colour: "Vessel", dynamics: "Heat", capacity: 1 },
    Alarms: null,
  },
  marking: { Tank: [{ level: 0 }] },
  transitions: {
    Alarm: {
      inputs: { Tank: { kind: "read" } },
      outputs: { Alarms: null },
      guard: "return input.Tank[0].level >= 8;",
    },
  },
};

/** The boiler's options: a step of a quarter. */
export const boilerOptions: CompilerOptions = { dt: 0.25 };

/** Drones launched at a rate that reads the battery, drained in the air, landed by a guard. */
export const dronesIr: PetriNetIr = {
  name: "drones",
  kind: "mixed",
  colours: { Drone: { battery: "real", state: { enum: ["idle", "flying"] } } },
  dynamics: {
    Drain: {
      colour: "Drone",
      code: "return tokens.map((d) => ({ battery: -2.5 }));",
    },
  },
  places: {
    Hangar: { colour: "Drone", capacity: 3 },
    Airborne: { colour: "Drone", capacity: 3, dynamics: "Drain" },
    Sorties: null,
  },
  marking: {
    Hangar: [
      { battery: 100, state: "idle" },
      { battery: 60, state: "idle" },
    ],
  },
  transitions: {
    Launch: {
      inputs: { Hangar: null },
      outputs: { Airborne: null, Sorties: null },
      rate: "return 0.6 * (input.Hangar[0].battery / 100);",
      kernel:
        'const d = input.Hangar[0];\nreturn { Airborne: [{ battery: d.battery, state: "flying" }] };',
    },
    Land: {
      inputs: { Airborne: null },
      outputs: { Hangar: null },
      guard: 'return input.Airborne[0].battery < 20 || input.Airborne[0].state !== "flying";',
      kernel: 'return { Hangar: [{ battery: 100, state: "idle" }] };',
    },
  },
};

/** The drones' options: a step of a half. */
export const dronesOptions: CompilerOptions = { dt: 0.5 };
