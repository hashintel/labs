import { describe, expect, it } from "vitest";

import { itemLabel } from "../ir/net-item";
import { birthDeathIr, birthDeathOptions } from "../testing/birth-death.fixtures";
import {
  boilerIr,
  boilerOptions,
  bucketIr,
  dronesIr,
  dronesOptions,
} from "../testing/coloured-nets.fixtures";
import { compileNet } from "../testing/compile-net";
import { parseCode } from "../testing/fixture-parser";
import { forkClockedIr, forkClockedOptions } from "../testing/fork.fixtures";
import { capacity, conflict, cycle, queue } from "../testing/small-nets.fixtures";
import {
  attributeName,
  availableName,
  bindName,
  choiceName,
  clockName,
  describeName,
  drawName,
  enabledName,
  eventName,
  exponentialDrawName,
  fillName,
  firedName,
  fireName,
  firesName,
  hitName,
  keptName,
  kernelDrawName,
  landedName,
  nextName,
  outName,
  overflowName,
  pickName,
  presentName,
  rankName,
  seenName,
  selectName,
  takeName,
  timeReference,
} from "./names";

import type { LinearModule } from "../graph/linear-graph";
import type { ModuleGraph } from "../graph/module-graph";
import type { SpnModule } from "../graph/spn-graph";
import type { PetriNetIr } from "../ir/schema";
import type { CompilerOptions } from "../options";

/** Every name a graph declares or binds: its variables and each module's locals. */
function namesOf(graph: ModuleGraph): string[] {
  const modules: (LinearModule | SpnModule)[] = graph.modules;
  return [
    ...graph.variables.map((variable) => variable.name),
    ...modules.flatMap((module) =>
      module.next.flatMap((statement) => (statement.kind === "assign" ? [statement.target] : [])),
    ),
  ];
}

/** The fixture nets, each under the options that coin the most names. */
const COMPILED: [PetriNetIr, CompilerOptions][] = [
  [cycle, {}],
  [cycle, { shape: "modular" }],
  [capacity, {}],
  [capacity, { shape: "modular" }],
  [queue, {}],
  [queue, { marking: "int" }],
  [queue, { shape: "modular", marking: "int" }],
  [conflict, { control: "open", conflicts: "nondet" }],
  [conflict, { shape: "modular", control: "open", conflicts: "nondet" }],
  [forkClockedIr, forkClockedOptions],
  [birthDeathIr, birthDeathOptions],
  [bucketIr, {}],
  [boilerIr, boilerOptions],
  [dronesIr, dronesOptions],
];

describe("the coined names", () => {
  it("reads the coined prefixes back into words with their item", () => {
    // GIVEN names the monolithic lowering coins for firings, places, slots and draws
    const names = [
      "fire_Go",
      "avail_Pool",
      "take_Launch_Hangar_2",
      "out_Launch_Air_0_battery",
      "Hangar_1_present",
      "Hangar_1_battery",
      "z_Launch_0",
      "out_Launch_Air_0_arrival_time",
      "next_Hangar_2_present",
    ];
    // WHEN each is read back
    const [fire, avail, take, out, present, attribute, draw, outWithUnderscore, next] = names.map(
      (name) => describeName(name),
    );
    // THEN each says what it holds, with the item it belongs to
    expect(fire).toMatchObject({
      what: "Go fires this step",
      source: { kind: "transition", name: "Go" },
    });
    expect(avail).toMatchObject({
      what: "Pool's tokens after the transitions swept so far",
      source: { kind: "place", name: "Pool" },
    });
    expect(take).toMatchObject({
      what: "Launch takes the token in slot 2 of Hangar",
      source: { kind: "transition", name: "Launch" },
    });
    expect(out).toMatchObject({
      what: "battery of token 0 that Launch produces into Air",
    });
    expect(present).toMatchObject({
      what: "Slot 1 of Hangar holds a token",
      source: { kind: "place", name: "Hangar" },
    });
    expect(attribute).toMatchObject({
      what: "battery of the token in slot 1 of Hangar",
    });
    expect(draw?.what).toBe("Gaussian draw 0 of Launch's kernel");
    expect(outWithUnderscore?.what).toBe("arrival_time of token 0 that Launch produces into Air");
    expect(next).toMatchObject({
      what: "Hangar_2_present once the survivors closed up",
      source: { kind: "place", name: "Hangar" },
    });
  });

  it("reads the clock strategy's names and the bare time reference", () => {
    // GIVEN the time reference, the clock strategy's names, a pick and a rate draw
    const names = ["t", "clk_Birth", "ev_Death", "pick_Go", "fires_Birth", "fired_Death", "e_Go"];
    // WHEN each is read back
    const [time, clock, event, pick, fires, fired, rateDraw] = names.map((name) =>
      describeName(name),
    );
    // THEN each says what it holds, and why when the name alone does not
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
    expect(pick).toEqual({
      what: "The environment lets Go fire this step",
      why: "An input nothing drives: any resolution of the conflict is a run, and a proof ranges over all of them.",
      source: { kind: "transition", name: "Go" },
    });
    expect(fires).toEqual({
      what: "Birth's clock ran out and its arcs allow it",
      source: { kind: "transition", name: "Birth" },
    });
    expect(fired).toMatchObject({
      what: "Death fired this step",
      source: { kind: "transition", name: "Death" },
    });
    expect(rateDraw?.what).toBe("Exponential draw for Go's token-dependent rate");
  });

  it("reads back every name the fixture graphs declare or bind, apart from IR names", () => {
    // GIVEN the fixture nets compiled under options that coin draws, picks, choices, clocks, slots and bindings
    const unread = COMPILED.flatMap(([ir, options]) => {
      const { graph } = compileNet(ir, options, parseCode);
      const irNames = new Set([...Object.keys(ir.places), ...Object.keys(ir.transitions)]);
      // WHEN each coined name is read back
      return graph === null
        ? [`${ir.name} did not compile`]
        : namesOf(graph).filter((name) => !irNames.has(name) && describeName(name) === null);
    });
    // THEN none is left unread
    expect(unread).toEqual([]);
  });

  it("gives each coin function a prefix of its own, read back with its item", () => {
    // GIVEN one name from each coin function
    const coined = [
      [fireName("Go"), "transition Go"],
      [drawName("Go"), "transition Go"],
      [hitName("Go"), "transition Go"],
      [choiceName("Go"), "transition Go"],
      [pickName("Go"), "transition Go"],
      [fillName("Pool"), "place Pool"],
      [availableName("Pool"), "place Pool"],
      [exponentialDrawName("Go"), "transition Go"],
      [kernelDrawName("Go", "z", 0), "transition Go"],
      [kernelDrawName("Go", "v", 1), "transition Go"],
      [enabledName("Go"), "transition Go"],
      [bindName("Go", 0), "transition Go"],
      [selectName("Go", 0), "transition Go"],
      [seenName("Go"), "transition Go"],
      [takeName("Go", "Pool", 1), "transition Go"],
      [outName("Go", "Pool", 0, "size"), "transition Go"],
      [rankName("Pool", 1), "place Pool"],
      [keptName("Pool"), "place Pool"],
      [landedName("Pool"), "place Pool"],
      [nextName(attributeName("Pool", 1, "size")), "place Pool"],
      [overflowName("Pool"), "place Pool"],
      [clockName("Go"), "transition Go"],
      [eventName("Go"), "transition Go"],
      [firesName("Go"), "transition Go"],
      [firedName("Go"), "transition Go"],
    ] as const;
    // WHEN each is read back
    const read = coined.map(([name]) => {
      const source = describeName(name)?.source;
      return source === undefined ? "unread" : itemLabel(source);
    });
    // THEN each names its item, and no two functions share a prefix
    expect(read).toEqual(coined.map(([, item]) => item));
    const prefixes = coined.map(([name]) => name.split("_")[0]);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(describeName(presentName("Pool", 0))?.source).toEqual({ kind: "place", name: "Pool" });
    expect(describeName(timeReference)?.what).toBe("The time reference");
  });

  it("returns null for a name the lowerings do not coin", () => {
    // GIVEN a place name and the system instance
    const names = ["Waiting", "net"];
    // WHEN each is read back
    const read = names.map((name) => describeName(name));
    // THEN neither has a description
    expect(read[0]).toBeNull();
    expect(read[1]).toBeNull();
  });
});
