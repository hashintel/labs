import { itemLabel } from "../../../compiler";

import type { Diagnostic, Provenance } from "../../../compiler";
import type { SampleRow } from "../stage-sample";

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The names joined, the ones past `limit` counted. */
export function listed(names: readonly string[], limit = 6): string {
  return names.length <= limit
    ? names.join(", ")
    : `${names.slice(0, limit).join(", ")} and ${names.length - limit} more`;
}

/** How many values share each key, in first-seen order: `2 input, 1 state`. */
export function countsBy<T>(values: readonly T[], key: (value: T) => string): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(key(value), (counts.get(key(value)) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => `${count} ${name}`).join(", ");
}

export function sourceName(provenance: Provenance): string | undefined {
  return provenance.source === undefined ? undefined : itemLabel(provenance.source);
}

export function provenanceRows(provenance: Provenance): SampleRow[] {
  const source = sourceName(provenance);
  return [
    { label: "what", value: provenance.what },
    ...(provenance.why === undefined || provenance.why === "" ? [] : [{ label: "why", value: provenance.why }]),
    ...(provenance.ir === undefined ? [] : [{ label: "ir", value: provenance.ir }]),
    ...(source === undefined ? [] : [{ label: "source", value: source }]),
  ];
}

export function diagnosticRow(diagnostic: Diagnostic, severity: "error" | "warning"): SampleRow {
  const item = diagnostic.item.name === "" ? "" : ` (${itemLabel(diagnostic.item)})`;
  return {
    label: diagnostic.line === undefined ? "no line" : `line ${diagnostic.line}`,
    value: `${diagnostic.code}: ${diagnostic.message}${item}`,
    ...(severity === "error" ? { error: true } : {}),
  };
}

export function diagnosticRows(errors: readonly Diagnostic[], warnings: readonly Diagnostic[]): SampleRow[] {
  return [
    ...errors.map((error) => diagnosticRow(error, "error")),
    ...warnings.map((warning) => diagnosticRow(warning, "warning")),
  ];
}
