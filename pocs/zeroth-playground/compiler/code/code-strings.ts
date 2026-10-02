import type { NetItem } from "../ir/net-item";
import type { PetriNetIr } from "../ir/schema";
import type { CodeSurface } from "./code-tree";

/** One code string of a document: where it stands, and the surface a parser reads it as. */
export type CodeString = {
  item: NetItem;
  /** The key that holds it: `code` in a dynamics entry, the others in a transition. */
  field: "guard" | "rate" | "kernel" | "code";
  surface: CodeSurface;
  code: string;
};

/** Every code string of a document: the dynamics first, then each transition's guard, rate and kernel. */
export function codeStrings(ir: PetriNetIr): CodeString[] {
  const dynamics = Object.entries(ir.dynamics ?? {}).map(([name, equation]): CodeString => ({
    item: { kind: "dynamics", name },
    field: "code",
    surface: "dynamics",
    code: equation.code,
  }));
  const transitions = Object.entries(ir.transitions).flatMap(([name, transition]) => {
    const item: NetItem = { kind: "transition", name };
    return [
      ...(transition.guard === undefined
        ? []
        : [{ item, field: "guard", surface: "lambda", code: transition.guard } as const]),
      ...(typeof transition.rate === "string"
        ? [{ item, field: "rate", surface: "lambda", code: transition.rate } as const]
        : []),
      ...(transition.kernel === undefined
        ? []
        : [{ item, field: "kernel", surface: "kernel", code: transition.kernel } as const]),
    ];
  });
  return [...dynamics, ...transitions];
}
