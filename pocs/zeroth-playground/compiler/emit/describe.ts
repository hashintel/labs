import { describeName } from "../lower/names";
import { placeWhy } from "../trace/describe-item";

import type { ModuleGraph } from "../graph/module-graph";
import type { NetItem } from "../ir/net-item";
import type { PetriNetIr } from "../ir/schema";
import type { Provenance } from "../trace/provenance";

/**
 * What each emitted line of Python is, in words: the provenance an emitter
 * writes beside it. A coined name reads back through `describeName`, a
 * place through the IR.
 */

export type MethodName = "init" | "next" | "flow";

/** The parts of a module its class and instance are described by. */
type DescribedModule = {
  className: string;
  docstring: string;
  ctrl: readonly string[];
  extl: readonly string[];
  source: NetItem;
  draw?: true;
};

export const IMPORTS: Provenance = {
  what: "What the module needs from zrth, and the modules of the other files",
  why: "Only the names the bodies use are imported.",
};

/** `INT = Int([1, 1])`. */
export function sortConstantProvenance(constructor: string): Provenance {
  return {
    what: `The ${constructor} sort of a single value`,
    why: "Every variable is a 1×1 tensor of this sort.",
  };
}

function variableProvenance(
  name: string,
  ir: PetriNetIr,
  comment: string | undefined,
  role: "declaration" | "statement",
): Provenance {
  const described = describeName(name);
  if (described !== null) {
    // The emitter's trailing comment repeats the what for some names, in
    // its own case; it joins the why only when it says something else.
    const notes = [...new Set([described.why, comment])].filter(
      (note): note is string =>
        note !== undefined && note !== "" && note.toLowerCase() !== described.what.toLowerCase(),
    );
    return {
      what: role === "statement" ? `Sets ${name}: ${described.what}` : described.what,
      ...(notes.length === 0 ? {} : { why: notes.join(" ") }),
      ...(described.source === undefined ? {} : { source: described.source }),
    };
  }
  if (name in ir.places) {
    return {
      what: role === "statement" ? `Sets the tokens in ${name}` : `The tokens in ${name}`,
      why: comment ?? placeWhy(ir, name),
      ir: `places.${name}`,
      source: { kind: "place", name },
    };
  }
  return {
    what: role === "statement" ? `A local of the step, ${name}` : name,
    why: comment,
  };
}

/** `Pool = Var(INT)`: a variable of the system. */
export function declarationProvenance(
  variable: { name: string; role: string; comment?: string },
  ir: PetriNetIr,
): Provenance {
  const provenance = variableProvenance(variable.name, ir, variable.comment, "declaration");
  return variable.role === "input"
    ? { ...provenance, why: provenance.why ?? "An input the harness writes each step." }
    : provenance;
}

/** `fire_Go = A >= 1`: a statement of a step. */
export function statementProvenance(
  statement: { target: string; comment?: string },
  ir: PetriNetIr,
): Provenance {
  return variableProvenance(statement.target, ir, statement.comment, "statement");
}

/** A comment line of a step says what follows itself. */
export function commentProvenance(text: string): Provenance {
  return { what: text };
}

function moduleWhat({ source, draw }: DescribedModule): string {
  switch (source.kind) {
    case "transition":
      return draw === true
        ? `The draw module of ${source.name}`
        : `The module of transition ${source.name}`;
    case "place":
      return `The module of place ${source.name}`;
    default:
      return "The module of the whole net";
  }
}

/** A module's class, from its header to its last method. */
export function moduleProvenance(module: DescribedModule): Provenance {
  const { source } = module;
  return {
    what: moduleWhat(module),
    why: module.docstring,
    ...(source.kind === "net" ? {} : { ir: `${source.kind}s.${source.name}` }),
    source,
  };
}

const METHODS: Record<MethodName, Provenance> = {
  init: {
    what: "The initial values of the variables the module drives, in order",
    why: "From the initial marking.",
  },
  next: {
    what: "One step of the net: the statements, then the next values",
    why: "Transitions sweep in order, consumption is immediate, production lands at the end.",
  },
  flow: { what: "The continuous evolution between steps" },
};

/** The methods of an SPN module: a step is a firing, and a flow runs the clocks. */
const SPN_METHODS: Record<MethodName, Provenance> = {
  init: METHODS.init,
  next: {
    what: "A firing: the statements, then the next values",
    why: "Time runs until the first clock expires; its transition re-arms the clock, toggles its event, and the places count.",
  },
  flow: {
    what: "The tangents between firings, one per driven variable",
    why: "A clock counts down against t while its transition is enabled; an event flows 0 and stays still.",
  },
};

/** A method, from its `def` to its `return`. */
export function methodProvenance(
  language: ModuleGraph["language"],
  method: MethodName,
): Provenance {
  return (language === "spn" ? SPN_METHODS : METHODS)[method];
}

const RETURNS: Record<MethodName, string> = {
  init: "The initial values, one per driven variable",
  next: "The next values, one per driven variable, in the order the module drives them",
  flow: "The tangents, one per driven variable, 0 where it does not move",
};

export function returnProvenance(method: MethodName): Provenance {
  return { what: RETURNS[method] };
}

/** The line that binds `net`: one module's instance, or the start of the composition. */
export function systemProvenance(composed: boolean, ir: PetriNetIr): Provenance {
  return {
    what: "The system",
    why: composed
      ? "Every module composed: a variable one module drives is awaited by the others, in an order the awaits allow."
      : "The one module, driving every place.",
    source: { kind: "net", name: ir.name },
  };
}

/** A line of a composition written one module per line, and its closing bracket. */
export function compositionProvenance(ir: PetriNetIr): Provenance {
  return {
    what: "The system",
    why: "The composition, one module per line.",
    source: { kind: "net", name: ir.name },
  };
}

/** The `hide={...}` argument of the composition. */
export function hiddenProvenance(ir: PetriNetIr): Provenance {
  return {
    what: "The clocks kept private",
    why: "Each clock belongs to its transition; the events and the places stay in the interface for a controller or an observer to await.",
    source: { kind: "net", name: ir.name },
  };
}

/** `place_A = Place_A(theory=LIA, ctrl=(A,), extl=(fire_Go,))`. */
export function instanceProvenance(module: DescribedModule, theory: string): Provenance {
  const reads = module.extl.join(", ");
  return {
    what: `An instance of ${module.className} in the ${theory} theory`,
    why: `Drives ${module.ctrl.join(", ")}${reads === "" ? "" : ` and reads ${reads}`}.`,
    source: module.source,
  };
}
