import { parseConstraint, printConstraint, printMetricExpr } from "../../constraints";

import type { ConstraintDocument } from "../../constraints/ast";
import type { Diagnostic, ParseOptions } from "../../constraints";

/** The constraint line's value as YAML: plain unless a plain scalar would misread it. */
function yamlScalar(printed: string): string {
  return /: | #|^[>|&*!%@`'"[\]{},?-]/u.test(printed) ? JSON.stringify(printed) : printed;
}

/**
 * The constraint file with its `constraint:` entry replaced by the printed
 * constraint. The entry's continuation lines, such as a block scalar's, go
 * with it. A file with no entry gets one at the end.
 */
export function withConstraintLine(text: string, printed: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => /^constraint\s*:/u.test(line));
  const entry = `constraint: ${yamlScalar(printed)}`;
  if (at === -1) {
    return `${text.replace(/\n*$/u, "\n")}${entry}\n`;
  }
  let end = at + 1;
  while (end < lines.length && /^\s+\S/u.test(lines[end] ?? "")) {
    end += 1;
  }
  return [...lines.slice(0, at), entry, ...lines.slice(end)].join("\n");
}

/**
 * A formula typed in math notation, written into the file. The result holds
 * the file with its `constraint:` entry replaced by the formula in function
 * style, or, while the formula does not parse, the file as it was. Either way
 * it holds the parser's diagnostics.
 */
export function withMathFormula(
  text: string,
  formula: string,
  options: ParseOptions,
): { text: string; parses: boolean; diagnostics: Diagnostic[] } {
  const parsed = parseConstraint(formula, options);
  if (parsed.constraint === undefined) {
    return { text, parses: false, diagnostics: parsed.diagnostics };
  }
  return { text: withConstraintLine(text, printConstraint(parsed.constraint)), parses: true, diagnostics: parsed.diagnostics };
}

/** The Math view's metric lines: `Waiting := count(Queue)`, one per metric. */
export function metricDefinitions(metrics: ConstraintDocument["metrics"]): string {
  return metrics.map((metric) => `${metric.name} := ${printMetricExpr(metric.expr)}`).join("\n");
}
