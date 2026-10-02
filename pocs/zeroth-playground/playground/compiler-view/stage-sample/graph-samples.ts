import { excerptOf } from "./excerpt";
import { notLowered, notParsed } from "./not-reached";
import { countsBy, diagnosticRows, listed, plural } from "./rows";

import type { LinearGraph, ModuleGraph } from "../../../compiler";
import type { SampleInput, StageSample } from "../stage-sample";

function theoriesOf(graph: ModuleGraph): string {
  if (graph.language === "spn") {
    return "SPN";
  }
  return [...new Set(graph.modules.map((module) => module.theory))].join(", ");
}

/** How a linear graph's system is made up, naming its module by the class the Python uses. */
function rootOf(graph: LinearGraph): string {
  const { root } = graph;
  if (root.kind !== "single") {
    return `compose of ${root.modules.length}`;
  }
  const module = graph.modules.find((candidate) => candidate.instance === root.module);
  return `one module, ${module?.className ?? root.module}`;
}

export function lowerSample({ compilation }: SampleInput): StageSample {
  const { ir, graph, errors } = compilation;
  if (ir === null) {
    return notParsed();
  }
  if (graph === null) {
    return {
      tone: "refused",
      headline: `Refused with ${plural(errors.length, "error")}; the IR stands alone.`,
      rows: diagnosticRows(errors, []),
    };
  }
  const { options } = compilation;
  return {
    tone: "ok",
    headline: `Lowered to ${graph.language === "spn" ? "an SPN graph" : "a linear graph"} in ${theoriesOf(graph)}.`,
    rows: [
      { label: "rates", value: options.rates },
      { label: "shape", value: graph.language === "spn" ? "composed per transition and place" : options.shape },
    ],
  };
}

export function graphSample(input: SampleInput): StageSample {
  const { graph } = input.compilation;
  if (graph === null) {
    return notLowered(input);
  }
  const modules = graph.modules.map((module) => module.className);
  if (graph.language === "spn") {
    return {
      tone: "ok",
      headline: `An SPN graph: ${plural(modules.length, "module")}, ${plural(graph.variables.length, "variable")}.`,
      rows: [
        { label: "language", value: "spn" },
        { label: "modules", value: listed(modules) },
        { label: "variables", value: countsBy(graph.variables, (variable) => variable.role) },
        { label: "hidden", value: graph.hidden.join(", ") || "none" },
      ],
    };
  }
  return {
    tone: "ok",
    headline: `A linear graph in ${theoriesOf(graph)}: ${plural(modules.length, "module")}, ${plural(graph.variables.length, "variable")}.`,
    rows: [
      { label: "language", value: "linear" },
      { label: "modules", value: listed(modules) },
      { label: "variables", value: countsBy(graph.variables, (variable) => variable.role) },
      { label: "root", value: rootOf(graph) },
    ],
  };
}

export function emitSample(input: SampleInput): StageSample {
  const { ir, graph, files } = input.compilation;
  if (ir === null || graph === null) {
    return notLowered(input);
  }
  const { layout } = input.compilation.options;
  return {
    tone: "ok",
    headline: `${plural(files.length, "file")} from ${graph.language === "spn" ? "the SPN emitter" : "the linear emitter"}.`,
    rows: [
      { label: "files", value: layout === "per-module" ? "one per module" : "one file" },
      { label: "step method", value: graph.language === "spn" ? "next and flow" : "next" },
    ],
  };
}

export function filesSample(input: SampleInput): StageSample {
  const { files } = input.compilation;
  const main = files[0];
  if (main === undefined) {
    return notLowered(input);
  }
  return {
    tone: "ok",
    headline: `${plural(files.length, "file")}, ${main.path} first.`,
    rows: files.map((file) => ({ label: file.path, value: plural(file.text.split("\n").length, "line") })),
    excerpt: excerptOf(main.path, main.text, 1),
  };
}
