import { describe, expect, it } from "vitest";

import { birthDeathIr, birthDeathOptions } from "../testing/birth-death.fixtures";
import { compileNet } from "../testing/compile-net";
import { forkClockedIr, forkClockedOptions, forkIr } from "../testing/fork.fixtures";
import { lineContaining } from "../testing/line-containing";
import { servedQueue } from "../testing/small-nets.fixtures";
import { provenanceAt } from "../trace/provenance";

import type { PetriNetIr } from "../ir/schema";
import type { CompilerOptions } from "../options";

/** The net's main file with its trace, or a thrown error naming the net. */
function compiled(ir: PetriNetIr, options: CompilerOptions) {
  const main = compileNet(ir, options).files[0];
  if (main === undefined) {
    throw new Error(`expected ${ir.name} to compile`);
  }
  return main;
}

describe("the provenance written beside the Python", () => {
  const { text, trace } = compiled(servedQueue, { shape: "modular", dt: 0.5 });

  it("describes variables, modules, methods, statements and the system", () => {
    // GIVEN the modular queue's Python and its trace
    // WHEN declarations, a class, a method, a statement, the system and an instance are looked up
    const fire = provenanceAt(trace, lineContaining(text, "fire_Serve = Var("));
    const draw = provenanceAt(trace, lineContaining(text, "u_Arrive = Var("));
    const place = provenanceAt(trace, lineContaining(text, "Waiting = Var("));
    const module = provenanceAt(trace, lineContaining(text, "class Place_Waiting(Module):"));
    const method = provenanceAt(trace, lineContaining(text, "    def next(self, Waiting"));
    const statement = provenanceAt(trace, lineContaining(text, "        Waiting = ite("));
    const system = provenanceAt(trace, lineContaining(text, "net = compose("));
    const instance = provenanceAt(trace, lineContaining(text, "place_Waiting = Place_Waiting("));
    // THEN each says what it is and which item it comes from
    expect(fire).toMatchObject({
      what: "Serve fires this step",
      source: { kind: "transition", name: "Serve" },
    });
    expect(draw).toEqual({
      what: "Uniform draw for Arrive, each step",
      why: "An input the harness writes; the transition fires when the draw is at least e^(-rate·dt).",
      source: { kind: "transition", name: "Arrive" },
    });
    expect(place).toMatchObject({
      what: "The tokens in Waiting",
      ir: "places.Waiting",
      source: { kind: "place", name: "Waiting" },
    });
    expect(module).toMatchObject({
      what: "The module of place Waiting",
      source: { kind: "place", name: "Waiting" },
    });
    expect(method?.what).toBe("One step of the net: the statements, then the next values");
    expect(statement).toMatchObject({
      what: "Sets the tokens in Waiting",
      source: { kind: "place", name: "Waiting" },
    });
    expect(system).toMatchObject({
      what: "The system",
      source: { kind: "net", name: "queue" },
    });
    expect(instance).toMatchObject({
      what: "An instance of Place_Waiting in the LRA theory",
    });
  });

  it("drops a lone read's comma", () => {
    // GIVEN the modular queue's Python and its trace
    // WHEN the instance of Served, which reads one variable, is looked up
    const instance = provenanceAt(trace, lineContaining(text, "place_Served = Place_Served("));
    // THEN its reads are listed without a trailing comma
    expect(instance?.why).toBe("Drives Served and reads fire_Serve.");
  });

  it("reads the monolithic net as the system and keeps a name's case", () => {
    // GIVEN the queue compiled as one module
    // WHEN it is emitted with its trace
    const { text: python, trace: singleTrace } = compiled(servedQueue, {
      shape: "monolithic",
      dt: 0.5,
    });
    // THEN the one instance is the system, and a local keeps its name's case
    expect(provenanceAt(singleTrace, lineContaining(python, "net = "))).toMatchObject({
      what: "The system",
      why: "The one module, driving every place.",
    });
    expect(provenanceAt(singleTrace, lineContaining(python, "        fire_Serve = "))?.what).toBe(
      "Sets fire_Serve: Serve fires this step",
    );
  });

  it("names a draw module after its transition under marking int", () => {
    // GIVEN the modular queue with Int places, so each rated transition has a draw module
    // WHEN it is emitted with its trace
    const { text: python, trace: intTrace } = compiled(servedQueue, {
      shape: "modular",
      marking: "int",
    });
    // THEN the draw module's class and instance stand for the transition
    expect(
      provenanceAt(intTrace, lineContaining(python, "class Draw_Arrive(Module):")),
    ).toMatchObject({
      what: "The draw module of Arrive",
      ir: "transitions.Arrive",
      source: { kind: "transition", name: "Arrive" },
    });
    expect(
      provenanceAt(intTrace, lineContaining(python, "draw_Arrive = Draw_Arrive(")),
    ).toMatchObject({
      what: "An instance of Draw_Arrive in the LRA theory",
      why: "Drives hit_Arrive and reads u_Arrive.",
      source: { kind: "transition", name: "Arrive" },
    });
    expect(
      provenanceAt(intTrace, lineContaining(python, "class Transition_Arrive(Module):"))?.what,
    ).toBe("The module of transition Arrive");
  });
});

describe("provenance under conflicts nondet", () => {
  const pick = {
    what: "The environment lets TakeLeft fire this step",
    why: "An input nothing drives: any resolution of the conflict is a run, and a proof ranges over all of them.",
    source: { kind: "transition", name: "TakeLeft" },
  };

  it("describes the pick in the coin module", () => {
    // GIVEN the fork with conflicts left open
    // WHEN it is emitted with its trace
    const { text, trace } = compiled(forkIr, { conflicts: "nondet" });
    // THEN the pick and the firing say what they are
    expect(provenanceAt(trace, lineContaining(text, "pick_TakeLeft = Var(BOOL)"))).toEqual(pick);
    expect(provenanceAt(trace, lineContaining(text, "        fire_TakeLeft = "))?.what).toBe(
      "Sets fire_TakeLeft: TakeLeft fires this step",
    );
  });

  it("describes the pick's Bool declaration and instance under clock rates", () => {
    // GIVEN the clocked fork
    // WHEN it is emitted with its trace
    const { text, trace } = compiled(forkClockedIr, forkClockedOptions);
    // THEN the pick is described with its clocked comment, and the transition's instance reads it
    expect(provenanceAt(trace, lineContaining(text, "pick_TakeLeft = Var(Bool([1, 1]))"))).toEqual({
      ...pick,
      why: `${pick.why} the environment lets TakeLeft fire when its clock expires`,
    });
    expect(
      provenanceAt(trace, lineContaining(text, "transition_TakeLeft = Transition_TakeLeft("))?.why,
    ).toBe("Drives clk_TakeLeft, ev_TakeLeft and reads Pool, pick_TakeLeft, t.");
  });
});

describe("the provenance written beside the Python under clock rates", () => {
  const { text, trace } = compiled(birthDeathIr, birthDeathOptions);

  it("describes the time reference, the clocks, the events and their locals", () => {
    // GIVEN the clocked birth-death Python and its trace
    // WHEN the time reference, a clock, an event, a counter and two locals are looked up
    const time = provenanceAt(trace, lineContaining(text, "t = Var(Clock())"));
    const clock = provenanceAt(trace, lineContaining(text, "clk_Birth = Var("));
    const event = provenanceAt(trace, lineContaining(text, "ev_Death = Var("));
    const counter = provenanceAt(trace, lineContaining(text, "Population = Var(Nat())"));
    const fires = provenanceAt(trace, lineContaining(text, "        fires_Birth = "));
    const fired = provenanceAt(trace, lineContaining(text, "        fired_Death = "));
    // THEN each says what it is
    expect(time).toEqual({
      what: "The time reference",
      why: "External and driven by nothing: a clock's flow is a rate against d(t), so a module that reads it awaits t.",
    });
    expect(clock).toMatchObject({
      what: "Time left until Birth fires",
      source: { kind: "transition", name: "Birth" },
    });
    expect(event).toMatchObject({
      what: "Toggles when Death fires",
      source: { kind: "transition", name: "Death" },
    });
    expect(counter).toMatchObject({ what: "The tokens in Population" });
    expect(fires?.what).toBe("Sets fires_Birth: Birth's clock ran out and its arcs allow it");
    expect(fired).toMatchObject({
      what: "Sets fired_Death: Death fired this step",
      source: { kind: "transition", name: "Death" },
    });
  });

  it("describes the methods, their returns, the instances and the hidden clocks", () => {
    // GIVEN the clocked birth-death Python and its trace
    // WHEN the methods, their returns, a class, an instance, the hide set
    // and the system are looked up
    const next = provenanceAt(trace, lineContaining(text, "    def next(self, clk_Birth"));
    const flow = provenanceAt(trace, lineContaining(text, "    def flow(self, clk_Birth"));
    const tangents = provenanceAt(trace, lineContaining(text, "        return ite(clk_Birth >= 0"));
    const initial = provenanceAt(trace, lineContaining(text, "        return exp(2.0), False"));
    const module = provenanceAt(trace, lineContaining(text, "class Transition_Birth(Module):"));
    const instance = provenanceAt(
      trace,
      lineContaining(text, "transition_Birth = Transition_Birth("),
    );
    const hidden = provenanceAt(trace, lineContaining(text, "    hide={clk_Birth, clk_Death},"));
    const system = provenanceAt(trace, lineContaining(text, "net = compose("));
    // THEN each says what it is and why it is there
    expect(next).toMatchObject({
      what: "A firing: the statements, then the next values",
    });
    expect(flow).toEqual({
      what: "The tangents between firings, one per driven variable",
      why: "A clock counts down against t while its transition is enabled; an event flows 0 and stays still.",
    });
    expect(tangents?.what).toBe("The tangents, one per driven variable, 0 where it does not move");
    expect(initial?.what).toBe("The initial values, one per driven variable");
    expect(module).toMatchObject({
      what: "The module of transition Birth",
      why: "Birth: nothing -> Population, at rate 2",
    });
    expect(instance?.why).toBe("Drives clk_Birth, ev_Birth and reads t.");
    expect(hidden).toMatchObject({
      what: "The clocks kept private",
      source: { kind: "net", name: "birth_death" },
    });
    expect(system).toMatchObject({
      what: "The system",
      why: "Every module composed: a variable one module drives is awaited by the others, in an order the awaits allow.",
    });
  });
});
