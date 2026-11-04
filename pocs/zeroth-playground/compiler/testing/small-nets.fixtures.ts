import type { PetriNetIr } from "../ir/schema";

/** The small nets the tests share. */

/** One token going round two places. */
export const cycle: PetriNetIr = {
  name: "cycle",
  kind: "plain",
  places: { A: null, B: null },
  marking: { A: 1 },
  transitions: {
    Go: { inputs: { A: null }, outputs: { B: null } },
    Back: { inputs: { B: null }, outputs: { A: null } },
  },
};

/** Two producers into a buffer that holds at most 2, and a taker. */
export const capacity: PetriNetIr = {
  name: "capacity",
  kind: "plain",
  places: {
    LeftSource: null,
    RightSource: null,
    Buffer: { capacity: 2 },
    Sink: null,
  },
  marking: { LeftSource: 5, RightSource: 5 },
  transitions: {
    PutLeft: { inputs: { LeftSource: null }, outputs: { Buffer: null } },
    PutRight: { inputs: { RightSource: null }, outputs: { Buffer: null } },
    Take: { inputs: { Buffer: null }, outputs: { Sink: null } },
  },
};

/** Arrivals into a capped queue and a server, both at a rate. */
export const queue: PetriNetIr = {
  name: "queue",
  kind: "stochastic",
  places: { Waiting: { capacity: 4 }, Served: null },
  transitions: {
    Arrive: { outputs: { Waiting: null }, rate: 2.5 },
    Serve: { inputs: { Waiting: null }, outputs: { Served: null }, rate: 3 },
  },
};

/** Arrivals into a queue served two at a time, with a controllable server. */
export const servedQueue: PetriNetIr = {
  name: "queue",
  kind: "stochastic",
  places: { Waiting: null, Served: { capacity: 5 } },
  marking: { Waiting: 2 },
  transitions: {
    Arrive: { outputs: { Waiting: null }, rate: 2 },
    Serve: {
      inputs: { Waiting: { weight: 2 } },
      outputs: { Served: null },
      rate: 1.5,
      controllable: true,
    },
  },
};

/** Two transitions sharing Pool, the first one controllable and taking two tokens. */
export const conflict: PetriNetIr = {
  name: "conflict",
  kind: "plain",
  places: { Pool: null, Left: null, Right: null },
  marking: { Pool: 3 },
  transitions: {
    TakeLeft: {
      inputs: { Pool: { weight: 2 } },
      outputs: { Left: null },
      controllable: true,
    },
    TakeRight: { inputs: { Pool: null }, outputs: { Right: null } },
  },
};
