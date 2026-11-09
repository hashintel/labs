import type { editor } from "monaco-editor/editor/editor.api.js";

/** A whole-line mark: lit by a hover on the other side, or flagged by a diagnostic. */
export type LineDecoration = {
  startLine: number;
  endLine: number;
  kind: "lit" | "error" | "warning";
};

const CLASS_NAMES: Record<LineDecoration["kind"], editor.IModelDecorationOptions> = {
  lit: { isWholeLine: true, className: "line-lit" },
  error: {
    isWholeLine: true,
    className: "line-error",
    linesDecorationsClassName: "line-error-mark",
  },
  warning: {
    isWholeLine: true,
    className: "line-warning",
    linesDecorationsClassName: "line-warning-mark",
  },
};

export function toModelDecorations(
  decorations: readonly LineDecoration[],
): editor.IModelDeltaDecoration[] {
  return decorations.map((decoration) => ({
    range: {
      startLineNumber: decoration.startLine,
      startColumn: 1,
      endLineNumber: decoration.endLine,
      endColumn: 1,
    },
    options: CLASS_NAMES[decoration.kind],
  }));
}
