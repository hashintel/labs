import { describe, expect, it } from "vitest";

import { lowerPetriNetIr } from "../lower/lower";
import { resolveOptions } from "../options";
import { birthDeathIr } from "../testing/birth-death.fixtures";
import { cycle } from "../testing/small-nets.fixtures";
import { emitPython } from "./emit";

import type { PetriNetIr } from "../ir/schema";
import type { CompilerOptions } from "../options";

/** The files of a net the lowering accepts, in the layout its options give. */
function emitted(ir: PetriNetIr, options: CompilerOptions) {
  const inForce = resolveOptions(options);
  const lowered = lowerPetriNetIr(ir, inForce);
  if (!lowered.ok) {
    throw new Error(lowered.errors.map((error) => error.code).join(", "));
  }
  return emitPython(lowered.graph, inForce.layout, ir);
}

describe("emitPython", () => {
  it("writes the whole program as net.py under the single layout", () => {
    // GIVEN the modular cycle in one file
    // WHEN it is emitted
    const files = emitted(cycle, { shape: "modular" });
    // THEN net.py holds the classes and the system
    expect(files.map((file) => file.path)).toEqual(["net.py"]);
    expect(files[0]?.text).toContain("class Transition_Go(Module):");
    expect(files[0]?.text).toContain("net = compose(");
  });

  it("writes net.py and one file per module under the per-module layout", () => {
    // GIVEN the birth-death net under clocks, one module per file
    // WHEN it is emitted
    const files = emitted(birthDeathIr, { rates: "clock", layout: "per-module" });
    const main = files[0]?.text;
    // THEN net.py imports the classes and composes them, and each class file imports its own sugar
    expect(files.map((file) => file.path)).toEqual([
      "net.py",
      "transition_birth.py",
      "transition_death.py",
      "place_population.py",
    ]);
    expect(main).toContain(
      "from zrth import SPN, Clock, Event, Nat, Var\nfrom zrth import Module as compose\n\nfrom transition_birth import Transition_Birth\nfrom transition_death import Transition_Death\nfrom place_population import Place_Population\n",
    );
    expect(main).toContain("    hide={clk_Birth, clk_Death},\n");
    expect(main).not.toContain("class ");
    const place = files.find((file) => file.path === "place_population.py");
    expect(
      place?.text.startsWith(
        "from zrth.sugar import Module, ite, fired\n\n\nclass Place_Population(Module):",
      ),
    ).toBe(true);
    expect(place?.text).not.toContain("from zrth import");
    expect(place?.text).not.toContain("def flow(");
  });

  it("writes net.py and one file per module of the modular shape, each traced", () => {
    // GIVEN the cycle, modular and one module per file
    // WHEN it is emitted
    const files = emitted(cycle, { shape: "modular", layout: "per-module" });
    const main = files[0]?.text;
    // THEN net.py imports and composes the classes, and each class file holds its class alone
    expect(files.map((file) => file.path)).toEqual([
      "net.py",
      "transition_go.py",
      "transition_back.py",
      "place_a.py",
      "place_b.py",
    ]);
    expect(main).toContain("from transition_go import Transition_Go");
    expect(main).toContain("from place_b import Place_B");
    expect(main).toContain("net = compose(");
    expect(main).not.toContain("class ");
    const placeA = files.find((file) => file.path === "place_a.py");
    expect(placeA?.text).toContain("from zrth.sugar import Module, X");
    expect(placeA?.text).toContain("class Place_A(Module):");
    expect(placeA?.text).not.toContain("Var(");
    for (const file of files) {
      expect(file.trace.length).toBeGreaterThan(0);
    }
  });
});
