/**
 * Names the generated Python uses for itself; the IR must not claim them.
 * IR names are UpperCamelCase, so only the capitalised identifiers can
 * collide; the lowercase ones are listed for the reader.
 */
export const RESERVED_MODULE_NAMES: readonly string[] = [
  "net",
  "ite",
  "X",
  "Module",
  "Var",
  "LIA",
  "LRA",
  "Int",
  "Real",
  "Bool",
  "INT",
  "REAL",
  "BOOL",
  "SPN",
  "Nat",
  "Clock",
  "Event",
  "t",
  "d",
  "exp",
  "fired",
  "self",
  "None",
  "True",
  "False",
];

/** The class the net's module is named after: `birth_death` becomes `BirthDeath`, and an empty name `Net`. */
export function netClassName(netName: string): string {
  return (
    netName
      .split("_")
      .filter((part) => part !== "")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("") || "Net"
  );
}
