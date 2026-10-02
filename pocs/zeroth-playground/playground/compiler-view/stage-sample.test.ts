import { describe, expect, it } from "vitest";

import { compile } from "../../compiler";
import { exampleById } from "../../examples/catalog";
import { STAGES } from "./stages";
import { stageSample } from "./stage-sample";

import type { CompilerOptions } from "../../compiler";
import type { SampleInput } from "./stage-sample";

/** The example as the view samples it, with the options it opens with unless others are given. */
function inputOf(id: string, asked?: CompilerOptions): SampleInput {
  const example = exampleById(id);
  if (example === undefined) {
    throw new Error(`no example ${id}`);
  }
  const options = asked ?? example.options;
  return {
    exampleTitle: example.title,
    irText: example.ir,
    options,
    compilation: compile(example.ir, { options }),
  };
}

function inputOfText(irText: string, options: CompilerOptions = {}): SampleInput {
  return { exampleTitle: "Edited", irText, options, compilation: compile(irText, { options }) };
}

const queue = inputOf("queue");
const drones = inputOf("drones");
const forkClocked = inputOf("fork-clocked");

describe("stageSample on a net that compiles", () => {
  it("marks every stage's sample ok", () => {
    // GIVEN Queue as it opens, which compiles
    // THEN every stage's sample is ok
    for (const stage of STAGES) {
      expect(stageSample(stage.id, queue).tone, stage.id).toBe("ok");
    }
  });

  it("quotes the IR and counts what parses", () => {
    // GIVEN Queue as it opens
    // WHEN the IR text is sampled
    const text = stageSample("ir-text", queue);
    // THEN it counts the lines and quotes the first, and the parse counts the places and transitions
    expect(text.headline).toBe(`${queue.irText.split("\n").length} lines of YAML.`);
    expect(text.excerpt?.lines[0]).toEqual({ number: 1, text: "name: queue", lit: false });
    expect(stageSample("parse", queue).headline).toBe("Parsed: 2 places, 2 transitions.");
  });

  it("names the options that apply and the ones the panel sets", () => {
    // GIVEN Queue as it opens, with the modular shape and a time step of 0.5
    // WHEN the options are sampled
    const options = stageSample("options", queue);
    // THEN the panel's two options are named, and Slots, which a plain net has no use for, is muted
    expect(options.headline).toContain("the panel sets Shape modular, Time step 0.5");
    expect(options.rows.find((row) => row.label === "Time step")).toEqual({ label: "Time step", value: "0.5" });
    expect(options.rows.find((row) => row.label === "Slots")?.muted).toBe(true);
  });

  it("reads the graph's language, theory and modules", () => {
    // GIVEN Queue as it opens, and Queue under the monolithic shape
    // WHEN the graph is sampled
    const monolithic = inputOf("queue", { dt: 0.5 });
    // THEN the modular graph has four modules and the monolithic one a single root module
    expect(stageSample("graph", queue).headline).toBe("A linear graph in LRA: 4 modules, 6 variables.");
    const graph = stageSample("graph", monolithic);
    expect(graph.headline).toBe("A linear graph in LRA: 1 module, 4 variables.");
    expect(graph.rows).toContainEqual({ label: "modules", value: "Queue" });
    expect(graph.rows).toContainEqual({ label: "root", value: "one module, Queue" });
    expect(stageSample("code-parser", queue).headline).toContain("No code strings");
  });

  it("lists the files with net.py first and quotes it", () => {
    // GIVEN Queue as it opens
    // WHEN the files are sampled
    const files = stageSample("files", queue);
    // THEN net.py comes first and the excerpt quotes it from its first line
    expect(files.rows[0]?.label).toBe("net.py");
    expect(files.excerpt?.source).toBe("net.py");
    expect(files.excerpt?.lines[0]?.number).toBe(1);
  });

  it("picks a nested line for the provenance and lights matching Python for the hover", () => {
    // GIVEN Queue as it opens
    // WHEN the provenance and the hover are sampled
    const provenance = stageSample("provenance", queue);
    const hover = stageSample("hover", queue);
    // THEN the provenance names the innermost of the ranges at its line, and the hover lights Arrive's lines
    expect(provenance.headline).toMatch(/^net\.py line \d+: \d+ ranges hold it; the innermost is line/u);
    expect(provenance.rows.some((row) => row.label === "source")).toBe(true);
    expect(hover.rows[0]?.value).toContain("transition Arrive");
    expect(hover.excerpt?.lines.length).toBeGreaterThan(0);
    expect(hover.excerpt?.lines.every((line) => line.lit)).toBe(true);
    expect(provenance.excerpt?.lines.filter((line) => line.lit)).toHaveLength(1);
  });
});

describe("stageSample on a refused net", () => {
  it("counts the code strings the absent parser leaves refused", () => {
    // GIVEN Drones as it opens, a net with five code strings
    // WHEN the code parser is sampled
    const parser = stageSample("code-parser", drones);
    // THEN it is refused, and lists each string by surface and IR path
    expect(parser.tone).toBe("refused");
    expect(parser.headline).toBe("5 code strings and no parser: 5 code-not-parsed errors.");
    expect(parser.rows.map((row) => `${row.label} ${row.value}`)).toEqual([
      "dynamics dynamics.Drain.code",
      "lambda transitions.Launch.rate",
      "kernel transitions.Launch.kernel",
      "lambda transitions.Land.guard",
      "kernel transitions.Land.kernel",
    ]);
  });

  it("refuses at lower with the codes and lines, and leaves the later stages idle", () => {
    // GIVEN Drones as it opens
    // WHEN the lowering and the diagnostics are sampled
    const lower = stageSample("lower", drones);
    const diagnostics = stageSample("diagnostics", drones);
    // THEN the lowering is refused with lined errors, the stages after it idle, and the diagnostics list five errors
    expect(lower.tone).toBe("refused");
    expect(lower.rows[0]?.value).toMatch(/^code-not-parsed: /u);
    expect(lower.rows[0]?.label).toMatch(/^line \d+$/u);
    for (const stage of ["graph", "emit", "files"] as const) {
      expect(stageSample(stage, drones).tone, stage).toBe("idle");
    }
    expect(diagnostics.headline).toBe("5 errors, 0 warnings.");
    expect(diagnostics.tone).toBe("ok");
    expect(diagnostics.rows.every((row) => row.error === true)).toBe(true);
  });

  it("leaves the code parser idle when the lowering refused the net before it read the code", () => {
    // GIVEN a rate that reads its tokens, under clock rates, which arm a clock with a constant
    const clocked = inputOfText(
      [
        "name: decay",
        "kind: stochastic",
        "places:",
        "  Atoms:",
        "transitions:",
        "  Decay:",
        "    inputs:",
        "      Atoms:",
        "    rate: |",
        "      return input.Atoms.length;",
        "",
      ].join("\n"),
      { rates: "clock" },
    );
    // WHEN the code parser is sampled
    const parser = stageSample("code-parser", clocked);
    // THEN the clocks refuse the rate before any code is read, so the parser idles
    expect(clocked.compilation.errors.map((error) => error.code)).toEqual(["clocks-rate-code"]);
    expect(parser.tone).toBe("idle");
  });

  it("still traces the IR and quotes a provenance from it", () => {
    // GIVEN Drones as it opens, which the lowering refuses
    // THEN the trace has no Python, the provenance quotes an IR line, and the hover has nothing to light
    expect(stageSample("trace", drones).rows[1]).toMatchObject({ label: "Python", muted: true });
    expect(stageSample("provenance", drones).headline).toMatch(/^IR line \d+/u);
    expect(stageSample("hover", drones).headline).toContain("no Python to light");
  });
});

describe("stageSample under clocks", () => {
  it("reads an SPN graph with its hidden clocks", () => {
    // GIVEN Fork under clocks as it opens
    // WHEN the graph is sampled
    const graph = stageSample("graph", forkClocked);
    // THEN it is an SPN graph that hides one clock per transition, emitted with next and flow
    expect(graph.headline).toBe("An SPN graph: 6 modules, 12 variables.");
    expect(graph.rows).toContainEqual({ label: "hidden", value: "clk_TakeLeft, clk_TakeRight, clk_Return" });
    expect(stageSample("emit", forkClocked).rows).toContainEqual({ label: "step method", value: "next and flow" });
  });

  it("lights each line once, written as runs, and says the excerpt is cut", () => {
    // GIVEN Fork under clocks as it opens
    // WHEN the hover is sampled
    const hover = stageSample("hover", forkClocked);
    // THEN the lit lines are listed as runs, and the excerpt shows the first 8 of them, once each
    expect(hover.headline).toContain("lights 18 lines of net.py");
    expect(hover.rows).toContainEqual({ label: "net.py", value: "lines 11, 15, 19, 23–34, 73, 85, 101" });
    expect(hover.excerpt?.source).toBe("net.py · first 8 of 18 lit lines");
    expect(new Set(hover.excerpt?.lines.map((line) => line.number)).size).toBe(8);
  });

  it("greys the options clocks fix", () => {
    // GIVEN Fork under clocks as it opens
    // WHEN the options are sampled
    const options = stageSample("options", forkClocked);
    // THEN Shape is muted and reads as not used, not as its default, and Rates reads clock
    expect(options.rows.find((row) => row.label === "Shape")).toEqual({
      label: "Shape",
      value: "not used: Clock rates compose the modules in continuous time; there is no step.",
      muted: true,
    });
    expect(options.rows.find((row) => row.label === "Rates")).toEqual({ label: "Rates", value: "clock" });
  });
});

describe("stageSample on a text that does not parse", () => {
  it("reports a YAML error at its line and idles everything after the parse", () => {
    // GIVEN a text with an unclosed bracket
    const broken = inputOfText("name: x\nkind: [plain\n");
    // WHEN the parse is sampled
    const parse = stageSample("parse", broken);
    // THEN it is refused with a YAML error, and the stages after it idle
    expect(parse.tone).toBe("refused");
    expect(parse.rows[0]?.value).toMatch(/^yaml-syntax: /u);
    expect(stageSample("lower", broken).tone).toBe("idle");
    expect(stageSample("hover", broken).tone).toBe("idle");
  });

  it("reports every schema issue", () => {
    // GIVEN a document with an unknown kind and a place name that is not UpperCamelCase
    const odd = inputOfText("name: x\nkind: odd\nplaces:\n  a:\ntransitions: {}\n");
    // WHEN the parse is sampled
    const parse = stageSample("parse", odd);
    // THEN both issues are listed, each at its line
    expect(parse.headline).toBe("Refused with 2 errors.");
    expect(parse.rows.map((row) => row.label)).toEqual(["line 2", "line 4"]);
  });
});
