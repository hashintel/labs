import { YAMLException, load } from "js-yaml";

import { type ParseOptions, parseConstraint } from "./constraint-parser";
import { parseMetricExpr } from "./metric-parser";
import { printMetricRef } from "./printer";
import { constraintAtoms, metricExprRefs } from "./walk";

import type { PetriNetIr } from "../compiler/ir/schema";
import type { ConstraintDocument, MetricRef } from "./ast";
import type { Diagnostic } from "./diagnostics";

/** Where each part of a `constraint.yaml` starts, counted from line 1. */
export type DocumentLines = {
  name?: number;
  constraint?: number;
  metrics?: number;
  run?: number;
  /** Line of each metric's key. */
  metric: Record<string, number>;
};

export type ParsedConstraintDocument = {
  /** Present only when there is no error. */
  doc?: ConstraintDocument;
  diagnostics: Diagnostic[];
  lines: DocumentLines;
};

export const DEFAULT_RUN = { seed: 1, maxSteps: 200 } as const;

const TOP_LEVEL_KEYS = ["name", "metrics", "constraint", "run"];
const RUN_KEYS = ["seed", "maxSteps", "maxTime"];
const METRIC_NAME = /^[A-Z][A-Za-z0-9]*$/u;

/** Finds the line of each top-level key and of each metric key by scanning the text. */
function findLines(text: string): DocumentLines {
  const lines: DocumentLines = { metric: {} };
  let section: string | undefined;
  text.split(/\r?\n/u).forEach((lineText, index) => {
    const lineNumber = index + 1;
    const top = /^([A-Za-z_]\w*)\s*:/u.exec(lineText);
    if (top?.[1] !== undefined) {
      section = top[1];
      if (section === "name" || section === "constraint" || section === "metrics" || section === "run") {
        lines[section] = lineNumber;
      }
      return;
    }
    const nested = /^\s+([A-Za-z_]\w*)\s*:/u.exec(lineText);
    if (section === "metrics" && nested?.[1] !== undefined && lines.metric[nested[1]] === undefined) {
      lines.metric[nested[1]] = lineNumber;
    }
  });
  return lines;
}

/** Offset of the value on the key's own line, so an expression column lines up with the file. */
function valueOffset(lineText: string | undefined): number {
  if (lineText === undefined) {
    return 0;
  }
  const match = /^[^:]*:\s*(["']?)(?=[^|>\s#])/u.exec(lineText);
  return match ? match[0].length : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a `constraint.yaml`: YAML first, then its shape, then each metric and
 * the constraint through their parsers. Every diagnostic carries the line of
 * the key it concerns; an expression error also carries its column in that line.
 */
export function parseConstraintDocument(text: string, options: ParseOptions = {}): ParsedConstraintDocument {
  const lines = findLines(text);
  const sourceLines = text.split(/\r?\n/u);
  const diagnostics: Diagnostic[] = [];
  const error = (message: string, line: number | undefined, extra: Partial<Diagnostic> = {}) =>
    diagnostics.push({ severity: "error", message, ...(line === undefined ? {} : { line }), ...extra });

  let loaded: unknown;
  try {
    loaded = load(text);
  } catch (caught) {
    if (caught instanceof YAMLException) {
      error(caught.reason, caught.mark === undefined ? undefined : caught.mark.line + 1);
      return { diagnostics, lines };
    }
    throw caught;
  }
  if (!isRecord(loaded)) {
    error("A constraint document is a mapping with name, metrics, constraint and run", 1);
    return { diagnostics, lines };
  }

  for (const key of Object.keys(loaded)) {
    if (!TOP_LEVEL_KEYS.includes(key)) {
      error(`Unknown key "${key}". Use name, metrics, constraint or run`, undefined, { item: key });
    }
  }

  let name = "Untitled constraint";
  if (loaded["name"] === undefined) {
    diagnostics.push({ severity: "warning", message: "Add a name for the constraint", line: 1 });
  } else if (typeof loaded["name"] === "string") {
    name = loaded["name"];
  } else {
    error("name is text", lines.name);
  }

  const metrics: ConstraintDocument["metrics"] = [];
  const metricsValue = loaded["metrics"];
  if (metricsValue !== undefined && metricsValue !== null) {
    if (!isRecord(metricsValue)) {
      error("metrics is a mapping from a metric name to its expression", lines.metrics);
    } else {
      for (const [metricName, source] of Object.entries(metricsValue)) {
        const line = lines.metric[metricName] ?? lines.metrics;
        const item = `metric ${metricName}`;
        if (!METRIC_NAME.test(metricName)) {
          error(`Metric name "${metricName}" starts with a capital letter`, line, { item });
          continue;
        }
        if (typeof source !== "string" && typeof source !== "number") {
          error(`Metric ${metricName} is an expression such as count(Queue) + 1`, line, { item });
          continue;
        }
        const result = parseMetricExpr(String(source));
        const offset = valueOffset(line === undefined ? undefined : sourceLines[line - 1]);
        for (const diagnostic of result.diagnostics) {
          error(diagnostic.message, line, {
            item,
            ...(diagnostic.column === undefined ? {} : { column: diagnostic.column + offset }),
          });
        }
        if (result.expr) {
          metrics.push({ name: metricName, expr: result.expr });
        }
      }
    }
  }

  let constraint: ConstraintDocument["constraint"] | undefined;
  const constraintValue = loaded["constraint"];
  if (typeof constraintValue !== "string") {
    error("Add a constraint, such as: always(Waiting <= 5)", lines.constraint ?? 1, {
      item: "constraint",
    });
  } else {
    const result = parseConstraint(constraintValue, options);
    const offset = valueOffset(lines.constraint === undefined ? undefined : sourceLines[lines.constraint - 1]);
    for (const diagnostic of result.diagnostics) {
      diagnostics.push({
        ...diagnostic,
        ...(lines.constraint === undefined ? {} : { line: lines.constraint }),
        ...(diagnostic.column === undefined ? {} : { column: diagnostic.column + offset }),
        item: "constraint",
      });
    }
    constraint = result.constraint;
  }

  const run: ConstraintDocument["run"] = { ...DEFAULT_RUN };
  const runValue = loaded["run"];
  if (runValue !== undefined && runValue !== null) {
    if (!isRecord(runValue)) {
      error("run is a mapping with seed, maxSteps and maxTime", lines.run);
    } else {
      for (const key of Object.keys(runValue)) {
        if (!RUN_KEYS.includes(key)) {
          error(`Unknown run setting "${key}". Use seed, maxSteps or maxTime`, lines.run);
        }
      }
      const seed = runValue["seed"];
      if (seed !== undefined) {
        if (typeof seed === "number" && Number.isInteger(seed)) {
          run.seed = seed;
        } else {
          error("seed is a whole number", lines.run);
        }
      }
      const maxSteps = runValue["maxSteps"];
      if (maxSteps !== undefined) {
        if (typeof maxSteps === "number" && Number.isInteger(maxSteps) && maxSteps >= 0) {
          run.maxSteps = maxSteps;
        } else {
          error("maxSteps is a whole number, 0 or more", lines.run);
        }
      }
      const maxTime = runValue["maxTime"];
      if (maxTime !== undefined) {
        if (typeof maxTime === "number" && maxTime > 0) {
          run.maxTime = maxTime;
        } else {
          error("maxTime is a number above 0", lines.run);
        }
      }
    }
  }

  const failed = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  if (failed || constraint === undefined) {
    return { diagnostics, lines };
  }
  return { doc: { name, metrics, constraint, run }, diagnostics, lines };
}

/**
 * Checks the document against the net: places, transitions and metrics it
 * names exist, no metric depends on itself, and every metric is used. Pass
 * the lines from `parseConstraintDocument` to get a line on each diagnostic.
 */
export function checkReferences(
  doc: ConstraintDocument,
  ir: PetriNetIr,
  lines?: DocumentLines,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const definitions = new Map(doc.metrics.map((metric) => [metric.name, metric.expr]));

  function report(severity: Diagnostic["severity"], message: string, item: string, line?: number) {
    diagnostics.push({ severity, message, item, ...(line === undefined ? {} : { line }) });
  }

  function checkRefs(refs: MetricRef[], item: string, line: number | undefined) {
    const flagged = new Set<string>();
    for (const ref of refs) {
      const text = printMetricRef(ref);
      if (flagged.has(text)) {
        continue;
      }
      let message: string | undefined;
      if (ref.kind === "count" && !(ref.place in ir.places)) {
        message = `Unknown place ${ref.place} in ${text}`;
      } else if (ref.kind === "fired" && !(ref.transition in ir.transitions)) {
        message = `Unknown transition ${ref.transition} in ${text}`;
      } else if (ref.kind === "metric" && !definitions.has(ref.name)) {
        message = `Unknown metric ${ref.name}`;
      }
      if (message !== undefined) {
        flagged.add(text);
        report("error", message, item, line);
      }
    }
  }

  for (const metric of doc.metrics) {
    checkRefs(metricExprRefs(metric.expr), `metric ${metric.name}`, lines?.metric[metric.name]);
  }
  const constraintRefs = constraintAtoms(doc.constraint).map((atom) => atom.ref);
  checkRefs(constraintRefs, "constraint", lines?.constraint);

  const dependencies = (name: string): string[] =>
    metricExprRefs(definitions.get(name) ?? { kind: "number", value: 0 }).flatMap((ref) =>
      ref.kind === "metric" && definitions.has(ref.name) ? [ref.name] : [],
    );

  // Depth-first search; meeting a metric still on the path closes a cycle.
  const finished = new Set<string>();
  const path: string[] = [];
  function visit(name: string) {
    const onPath = path.indexOf(name);
    if (onPath >= 0) {
      const cycle = [...path.slice(onPath), name];
      report("error", `Metrics depend on each other: ${cycle.join(" -> ")}`, `metric ${name}`, lines?.metric[name]);
      return;
    }
    if (finished.has(name)) {
      return;
    }
    path.push(name);
    for (const dependency of dependencies(name)) {
      visit(dependency);
    }
    path.pop();
    finished.add(name);
  }
  for (const metric of doc.metrics) {
    visit(metric.name);
  }

  // A metric counts as used when the constraint reaches it, directly or through other metrics.
  const used = new Set<string>();
  function reach(name: string) {
    if (used.has(name)) {
      return;
    }
    used.add(name);
    dependencies(name).forEach(reach);
  }
  for (const ref of constraintRefs) {
    if (ref.kind === "metric" && definitions.has(ref.name)) {
      reach(ref.name);
    }
  }
  for (const metric of doc.metrics) {
    if (!used.has(metric.name)) {
      report("warning", `Metric ${metric.name} is defined but not used`, `metric ${metric.name}`, lines?.metric[metric.name]);
    }
  }
  return diagnostics;
}
