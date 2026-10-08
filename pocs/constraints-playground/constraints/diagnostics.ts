/** One message about a document, an expression or a run. */
export type Diagnostic = {
  /** `info` explains a result and never blocks one, such as an unfilled slot. */
  severity: "error" | "warning" | "info";
  message: string;
  /** Line in the YAML document, counted from 1. */
  line?: number;
  /** Column in the expression text (or in the YAML line, for a document), counted from 1. */
  column?: number;
  /** What the message is about, such as `metric Waiting` or `constraint`. */
  item?: string;
};

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
