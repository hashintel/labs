import type { NetItem } from "./ir/net-item";

/** Every diagnostic code, with one line of what it means. */
export const DIAGNOSTIC_CODES = {
  // The text is not a document.
  "yaml-syntax": "The text is not YAML.",
  schema: "The document does not fit the IR's shape.",
  "unknown-place": "An arc or the marking names a place that is not declared.",
  "unknown-colour": "A place or a dynamics entry names a colour that is not declared.",
  "unknown-dynamics": "A place names dynamics that are not declared.",
  "reserved-name": "An IR name, or the net's class name, is one the generated Python uses.",
  "marking-invalid":
    "A plain place starts with something other than a whole count, or a coloured one without a token list.",
  "marking-over-capacity": "A place starts with more tokens than its capacity.",
  "kind-mismatch": "The net's kind disagrees with its rates.",

  // An option is dropped.
  "option-not-applicable": "An option asked for does not apply to the net and is ignored.",

  // A lowering cannot express the net.
  "modular-coloured-not-lowered":
    "The modular shape is not lowered for coloured places or dynamics.",
  "clocks-capacity": "Clock rates cannot test a capacity.",
  "clocks-plain-transition": "Clock rates need a rate on every transition.",
  "clocks-rate-code": "Clock rates need a constant rate.",
  "clocks-rate-not-positive": "Clock rates need a positive rate.",
  "clocks-guard": "Clock rates cannot test a guard.",
  "clocks-kernel": "Clock rates move plain tokens and run no kernel.",
  "clocks-arc-weight": "Clock rates move one token per arc.",
  "code-not-parsed":
    "A code string could not be read into a tree; no parser was given, or it returned none.",
  "marking-exceeds-slots": "A coloured place starts with more tokens than it has slots.",
  "kernel-missing": "A transition produces coloured tokens without a kernel.",
  "binding-explosion": "A transition has too many token combinations to try.",

  // Code outside the linear theories.
  "nonlinear-product": "Two values the tokens decide are multiplied.",
  "nonlinear-division": "A value is divided by one that is not a non-zero constant.",
  "nonlinear-power": "A value is raised to a power or taken modulo another.",
  "nonlinear-math": "A Math function has no linear form.",
  "math-random": "Math.random cannot run in a module.",
  "non-finite-constant": "Infinity or NaN has no value in the linear theories.",
  "distribution-unsupported": "A draw cannot become an input the harness draws.",
  "sort-mismatch": "A number, boolean or string is used where another sort is needed.",
  "string-as-value": "A string literal is used other than in a comparison with a string attribute.",
  "string-codes-differ": "Two string attributes with different values are compared.",
  "string-code-unknown": "A kernel writes a string the attribute does not take.",
  "token-as-value": "A whole token is used as a value.",
  "unbound-local": "The code reads a name it does not define.",
  "unknown-field": "A field is read from a value that is not a token.",
  "unknown-attribute": "The token's colour has no such attribute.",
  "unknown-length": "A length is read from something other than an input place.",
  "attribute-not-lowerable":
    "The code reads an attribute the theories cannot hold: a uuid or an open string.",
  "array-in-expression": "An array or a record is used as a value.",
  "kernel-output-shape": "A kernel's result is not a record of token lists keyed by output place.",
  "kernel-output-missing": "A kernel writes nothing into a coloured output place.",
  "kernel-output-count": "A kernel writes a different number of tokens than the arc carries.",
  "kernel-attribute-missing": "A produced token lacks an attribute of its colour.",
  "dynamics-shape": "Dynamics are not a map of the tokens to a record of derivatives.",
} as const;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_CODES;

/**
 * Why an IR, or one of its items, cannot become a module, or what the
 * compile left out. `compile` adds the IR line the item starts on.
 */
export type Diagnostic = {
  code: DiagnosticCode;
  message: string;
  item: NetItem;
  /** 1-based, in the IR text. */
  line?: number;
};

/** Code or a construct the lowering cannot express; the caller reports it on its item. */
export class Refusal extends Error {
  readonly code: DiagnosticCode;

  constructor(code: DiagnosticCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Throws a `Refusal`, where an expression is expected. */
export function refuse(code: DiagnosticCode, message: string): never {
  throw new Refusal(code, message);
}

/** Runs `compute`, saying which code a refusal comes from: "In the guard, ...". */
export function within<T>(surface: "guard" | "rate" | "kernel" | "dynamics", compute: () => T): T {
  try {
    return compute();
  } catch (error) {
    if (error instanceof Refusal) {
      throw new Refusal(error.code, `In the ${surface}, ${error.message}`);
    }
    throw error;
  }
}

export function isDiagnosticCode(code: unknown): code is DiagnosticCode {
  return typeof code === "string" && Object.hasOwn(DIAGNOSTIC_CODES, code);
}
