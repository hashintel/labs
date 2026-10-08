import { netClassName, RESERVED_MODULE_NAMES } from "./reserved-names";

import type { z } from "zod";
import type { DiagnosticCode } from "../diagnostics";
import type { PetriNetIr } from "./schema";

/**
 * What the shape of the document cannot say on its own: every name it uses
 * is declared, no name is one the generated Python claims, the marking
 * fits its places and `kind` agrees with the rates. Each issue carries its
 * diagnostic code in `params.code`.
 */

type Issue = { code: DiagnosticCode; message: string; path: PropertyKey[] };

const SECTIONS = ["places", "transitions", "colours", "dynamics"] as const;

/** The kind the rates give the net: no rates, a rate on every transition, or some. */
function kindOfRates(ir: PetriNetIr): PetriNetIr["kind"] {
  const transitions = Object.values(ir.transitions);
  const rated = transitions.filter((transition) => transition.rate !== undefined).length;
  return rated === 0 ? "plain" : rated === transitions.length ? "stochastic" : "mixed";
}

function unknownNames(ir: PetriNetIr): Issue[] {
  const issues: Issue[] = [];
  function place(name: string, path: PropertyKey[]): void {
    if (!(name in ir.places)) {
      issues.push({ code: "unknown-place", message: `no place ${name} is declared`, path });
    }
  }
  function colour(name: string, path: PropertyKey[]): void {
    if (ir.colours?.[name] === undefined) {
      issues.push({ code: "unknown-colour", message: `no colour ${name} is declared`, path });
    }
  }
  for (const [name, entry] of Object.entries(ir.places)) {
    if (entry?.colour !== undefined) {
      colour(entry.colour, ["places", name, "colour"]);
    }
    if (entry?.dynamics !== undefined && ir.dynamics?.[entry.dynamics] === undefined) {
      issues.push({
        code: "unknown-dynamics",
        message: `no dynamics ${entry.dynamics} is declared`,
        path: ["places", name, "dynamics"],
      });
    }
  }
  for (const [name, equation] of Object.entries(ir.dynamics ?? {})) {
    colour(equation.colour, ["dynamics", name, "colour"]);
  }
  for (const [name, transition] of Object.entries(ir.transitions)) {
    for (const side of ["inputs", "outputs"] as const) {
      for (const arcPlace of Object.keys(transition[side] ?? {})) {
        place(arcPlace, ["transitions", name, side, arcPlace]);
      }
    }
  }
  for (const marked of Object.keys(ir.marking ?? {})) {
    place(marked, ["marking", marked]);
  }
  return issues;
}

function reservedNames(ir: PetriNetIr): Issue[] {
  const issues: Issue[] = SECTIONS.flatMap((section) =>
    Object.keys(ir[section] ?? {})
      .filter((name) => RESERVED_MODULE_NAMES.includes(name))
      .map((name) => ({
        code: "reserved-name",
        message: `${name} is a name the generated Python uses`,
        path: [section, name],
      })),
  );
  const className = netClassName(ir.name);
  if (RESERVED_MODULE_NAMES.includes(className)) {
    issues.push({
      code: "reserved-name",
      message: `the net's module class would be ${className}, a name the generated Python uses`,
      path: ["name"],
    });
  }
  return issues;
}

function markingIssues(ir: PetriNetIr): Issue[] {
  return Object.entries(ir.marking ?? {}).flatMap(([name, marking]): Issue[] => {
    if (!(name in ir.places)) {
      return [];
    }
    const place = ir.places[name];
    const path = ["marking", name];
    if (place?.colour !== undefined && !Array.isArray(marking)) {
      return [
        {
          code: "marking-invalid",
          message: `a coloured place starts with a list of tokens; the marking is ${marking}`,
          path,
        },
      ];
    }
    if (
      place?.colour === undefined &&
      !(typeof marking === "number" && Number.isInteger(marking) && marking >= 0)
    ) {
      return [
        {
          code: "marking-invalid",
          message: `a plain place starts with a whole, non-negative count; the marking is ${Array.isArray(marking) ? "a list of tokens" : marking}`,
          path,
        },
      ];
    }
    const tokens = Array.isArray(marking) ? marking.length : marking;
    return place?.capacity !== undefined && tokens > place.capacity
      ? [
          {
            code: "marking-over-capacity",
            message: `the place starts with ${tokens} tokens and holds at most ${place.capacity}`,
            path,
          },
        ]
      : [];
  });
}

function kindIssues(ir: PetriNetIr): Issue[] {
  const fromRates = kindOfRates(ir);
  return fromRates === ir.kind
    ? []
    : [
        {
          code: "kind-mismatch",
          message: `the net is ${ir.kind}, but its rates make it ${fromRates}: plain has no rates, stochastic a rate on every transition, mixed a rate on some`,
          path: ["kind"],
        },
      ];
}

/** The schema's last check, over a document whose shape is already right. */
export function checkReferences(ir: PetriNetIr, context: z.RefinementCtx): void {
  for (const { code, message, path } of [
    ...unknownNames(ir),
    ...reservedNames(ir),
    ...markingIssues(ir),
    ...kindIssues(ir),
  ]) {
    context.addIssue({ code: "custom", message, path, params: { code } });
  }
}
