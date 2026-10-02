import type { Diagnostic } from "../../compiler";

import "./diagnostics-list.css";

type DiagnosticsListProps = {
  errors: readonly Diagnostic[];
  warnings: readonly Diagnostic[];
  /** Reveals the IR line a diagnostic points at. */
  onReveal?: (line: number) => void;
};

type DiagnosticLineProps = {
  diagnostic: Diagnostic;
  severity: "error" | "warning";
  onReveal?: (line: number) => void;
};

const DiagnosticLine: React.FC<DiagnosticLineProps> = ({ diagnostic, severity, onReveal }) => {
  const { line } = diagnostic;
  const where =
    diagnostic.item.name === "" ? null : (
      <i className="diagnostic__item">{diagnostic.item.name}</i>
    );
  return (
    <li className="diagnostic" data-severity={severity}>
      <code className="diagnostic__code">{diagnostic.code}</code>
      <span className="diagnostic__message">{diagnostic.message}</span>
      {where}
      {line === undefined ? null : (
        <button
          type="button"
          className="diagnostic__line"
          onClick={() => onReveal?.(line)}
        >
          line {line}
        </button>
      )}
    </li>
  );
};

/** Errors then warnings, one line each, under the module. Nothing when both are empty. */
export const DiagnosticsList: React.FC<DiagnosticsListProps> = ({ errors, warnings, onReveal }) => {
  return errors.length === 0 && warnings.length === 0 ? null : (
    <ul className="diagnostics">
      {errors.map((diagnostic, index) => (
        <DiagnosticLine
          key={`error-${index}`}
          diagnostic={diagnostic}
          severity="error"
          onReveal={onReveal}
        />
      ))}
      {warnings.map((diagnostic, index) => (
        <DiagnosticLine
          key={`warning-${index}`}
          diagnostic={diagnostic}
          severity="warning"
          onReveal={onReveal}
        />
      ))}
    </ul>
  );
};
