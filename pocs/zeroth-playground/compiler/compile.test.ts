import { describe, expect, it } from "vitest";

import { compile } from "./compile";
import { resolveOptions } from "./options";
import { birthDeathIr } from "./testing/birth-death.fixtures";
import { bucketIr, bucketPython, dronesIr, dronesOptions } from "./testing/coloured-nets.fixtures";
import { yaml } from "./testing/compile-net";
import { parseCode } from "./testing/fixture-parser";
import { cycle } from "./testing/small-nets.fixtures";

import type { PetriNetIr } from "./ir/schema";

/** The birth-death net with a controllable Death. */
const controlledBirthDeath: PetriNetIr = {
  ...birthDeathIr,
  transitions: {
    ...birthDeathIr.transitions,
    Death: { ...birthDeathIr.transitions.Death, controllable: true },
  },
};

/** A stochastic net whose one place holds coloured tokens, with no code. */
const pool: PetriNetIr = {
  name: "pool",
  kind: "stochastic",
  colours: { Ball: { size: "real" } },
  places: { Pool: { colour: "Ball" } },
  transitions: { Drain: { inputs: { Pool: null }, rate: 1 } },
};

/** The 1-based line of the first line of the text that reads exactly so. */
function lineReading(text: string, line: string): number {
  return text.split("\n").indexOf(line) + 1;
}

describe("compile", () => {
  it("opens the module on its imports and steps it in next", () => {
    // GIVEN the cycle
    // WHEN it is compiled
    const { files } = compile(yaml(cycle));
    // THEN the one file starts on its zrth import, and its step method is next
    expect(files.map((file) => file.path)).toEqual(["net.py"]);
    expect(files[0]?.text.startsWith("from zrth import ")).toBe(true);
    expect(files[0]?.text).toContain("    def next(self, A, B):");
  });

  it("reports the options in force: those asked for that apply, the defaults for the rest", () => {
    // GIVEN the plain cycle, asked for the modular shape, a step and one file per module
    // WHEN it is compiled
    const { options } = compile(yaml(cycle), {
      options: { shape: "modular", dt: 0.5, layout: "per-module" },
    });
    // THEN the step, which a plain net does not have, is back at its default
    expect(options).toEqual({ ...resolveOptions(), shape: "modular", layout: "per-module" });
  });

  it("writes one file under the monolithic shape whatever the layout says", () => {
    // GIVEN the monolithic cycle, asked for one module per file
    // WHEN it is compiled
    const { files, options, warnings } = compile(yaml(cycle), {
      options: { layout: "per-module" },
    });
    // THEN one module needs one file, and the layout is dropped with a warning
    expect(files.map((file) => file.path)).toEqual(["net.py"]);
    expect(options.layout).toBe("single");
    expect(warnings.map((warning) => warning.code)).toEqual(["option-not-applicable"]);
  });

  it("reads code strings with the parser it is given", () => {
    // GIVEN the bucket, whose rate reads each ball
    // WHEN it is compiled with a parser, and without one
    const parsed = compile(yaml(bucketIr), { parseCode });
    const unparsed = compile(yaml(bucketIr));
    // THEN the parser's trees compile, and without them the rate is refused
    expect(parsed.files[0]?.text).toBe(bucketPython);
    expect(unparsed.errors.map((error) => error.code)).toEqual(["code-not-parsed"]);
  });
});

describe("compile diagnostics", () => {
  it("refuses a document that carries code, one diagnostic per code surface at the item's IR line", () => {
    // GIVEN the drones, with dynamics and kernels as code
    const text = yaml(dronesIr);
    // WHEN they are compiled without a parser
    const { ir, files, errors } = compile(text, { options: dronesOptions });
    // THEN the document stands, and each code string is refused at its item's first line
    expect(ir).not.toBeNull();
    expect(files).toEqual([]);
    expect(errors.map((error) => [error.code, error.item.name, error.line])).toEqual([
      ["code-not-parsed", "Airborne", lineReading(text, "  Airborne:")],
      ["code-not-parsed", "Launch", lineReading(text, "  Launch:")],
      ["code-not-parsed", "Launch", lineReading(text, "  Launch:")],
      ["code-not-parsed", "Land", lineReading(text, "  Land:")],
      ["code-not-parsed", "Land", lineReading(text, "  Land:")],
    ]);
  });

  it("drops an option that does not apply with a warning on the net's name, and compiles without it", () => {
    // GIVEN the birth-death net with a controllable Death
    const text = yaml(controlledBirthDeath);
    // WHEN it is compiled under clocks with control open
    const { files, warnings } = compile(text, { options: { rates: "clock", control: "open" } });
    // THEN it compiles, and the open control is dropped with its reason at the name's line
    expect(files).toHaveLength(1);
    expect(
      warnings.map((warning) => [warning.code, warning.item.kind, warning.line, warning.message]),
    ).toEqual([
      [
        "option-not-applicable",
        "net",
        lineReading(text, "name: birth_death"),
        "control: open is ignored. Clock rates take no external choice.",
      ],
    ]);
  });

  it("compiles a coloured net under coins when clock rates are asked for, warning that they do not apply", () => {
    // GIVEN a stochastic net whose one place holds coloured tokens
    const text = yaml(pool);
    // WHEN it is compiled under clock rates
    const compiled = compile(text, { options: { rates: "clock" } });
    // THEN the rates are dropped with their reason, and the net compiles as under coins
    expect(compiled.errors).toEqual([]);
    expect(compiled.warnings.map((warning) => warning.message)).toEqual([
      "rates: clock is ignored. A coloured net, or one with dynamics, compiles under coins only.",
    ]);
    expect(compiled.files.map((file) => file.text)).toEqual(
      compile(text).files.map((file) => file.text),
    );
  });

  it("warns once for each step option clock rates leave out, and compiles as without them", () => {
    // GIVEN the birth-death net with a controllable Death
    const text = yaml(controlledBirthDeath);
    // WHEN it is compiled under clocks with every step option set, and under clocks alone
    const busy = compile(text, {
      options: { rates: "clock", shape: "monolithic", marking: "int", control: "open", dt: 0.25 },
    });
    const clocks = compile(text, { options: { rates: "clock" } });
    // THEN the options off their default are each warned about, and the Python is the same
    expect(busy.warnings.map((warning) => warning.message.split(" is ignored.")[0])).toEqual([
      "marking: int",
      "control: open",
      "dt: 0.25",
    ]);
    expect(busy.files.map((file) => file.text)).toEqual(clocks.files.map((file) => file.text));
  });

  it("returns the parse errors and no document for a text that is not an IR", () => {
    // GIVEN a text that is not YAML
    // WHEN it is compiled with the modular shape
    const compiled = compile("places: [\n", { options: { shape: "modular" } });
    // THEN there is no document, no trace, and the options are the ones asked for
    expect(compiled.ir).toBeNull();
    expect(compiled.irTrace).toEqual([]);
    expect(compiled.errors[0]?.code).toBe("yaml-syntax");
    expect(compiled.options.shape).toBe("modular");
  });
});
