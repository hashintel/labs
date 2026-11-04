import { yamlKeys } from "../ir/yaml-keys";
import { resolveOptions } from "../options";
import { arcText, placeWhy, transitionWhy } from "./describe-item";

import type { PetriNetIr } from "../ir/schema";
import type { CompilerOptions } from "../options";
import type { Provenance, Trace } from "./provenance";

/**
 * The trace over the IR text: one range per section, entry, field and arc,
 * each over the lines `yamlKeys` gives its key. Rates read as clocks or as
 * coins, as the options say.
 */

const KIND_WHY: Record<string, string> = {
  plain: "Every transition fires whenever it is enabled.",
  stochastic: "Every transition has a rate; a step tests each enabled one against a draw.",
  mixed: "Some transitions fire whenever enabled, others by rate.",
};

const KIND_WHY_CLOCKS: Record<string, string> = {
  ...KIND_WHY,
  stochastic:
    "Every transition has a rate; each arms an exponential clock and fires when it expires.",
};

function describeIrPath(ir: PetriNetIr, path: string[], clocks: boolean): Provenance | null {
  const [section, entry, field, sub] = path;
  const irPath = path.join(".");
  switch (section) {
    case "name":
      return {
        what: "The net's name, as the module calls itself",
        ir: irPath,
        source: { kind: "net", name: ir.name },
      };
    case "description":
      return { what: "The net's description", ir: irPath };
    case "kind":
      return {
        what: `A ${ir.kind} net`,
        why: (clocks ? KIND_WHY_CLOCKS : KIND_WHY)[ir.kind],
        ir: irPath,
      };
    case "colours":
      if (entry === undefined) {
        return {
          what: "The token colours, each with its attributes and their types",
          ir: irPath,
        };
      }
      return field === undefined
        ? {
            what: `Colour ${entry}`,
            why: "A closed string attribute lists the values the net can write.",
            ir: irPath,
            source: { kind: "colour", name: entry },
          }
        : {
            what: `Attribute ${field} of ${entry}`,
            ir: irPath,
            source: { kind: "colour", name: entry },
          };
    case "dynamics":
      if (entry === undefined) {
        return {
          what: "The differential equations, each with the colour it moves",
          ir: irPath,
        };
      }
      return {
        what:
          field === "code"
            ? `The equation ${entry}, as the body you wrote`
            : field === "colour"
              ? `The colour ${entry} moves`
              : `Dynamics ${entry}`,
        why:
          field === undefined
            ? "Applied as one Euler step of dt before the transitions fire."
            : undefined,
        ir: irPath,
        source: { kind: "dynamics", name: entry },
      };
    case "places":
      if (entry === undefined) {
        return {
          what: "The places, in the order the net lists them",
          ir: irPath,
        };
      }
      if (field === undefined) {
        return {
          what: `Place ${entry}`,
          why: placeWhy(ir, entry),
          ir: irPath,
          source: { kind: "place", name: entry },
        };
      }
      return {
        what:
          field === "capacity"
            ? `${entry} holds at most ${ir.places[entry]?.capacity ?? ""} tokens`
            : field === "colour"
              ? `${entry}'s tokens are ${ir.places[entry]?.colour ?? ""} records`
              : `${entry}'s tokens move by ${ir.places[entry]?.dynamics ?? ""}`,
        ir: irPath,
        source: { kind: "place", name: entry },
      };
    case "marking":
      if (entry === undefined) {
        return {
          what: "The initial marking: the tokens each place starts with",
          why: "A place absent here starts empty.",
          ir: irPath,
        };
      }
      return {
        what: field === undefined ? `Initial tokens of ${entry}` : `A token ${entry} starts with`,
        ir: irPath,
        source: { kind: "place", name: entry },
      };
    case "transitions":
      if (entry === undefined) {
        return {
          what: "The transitions, in the order a step sweeps them",
          ir: irPath,
        };
      }
      if (field === undefined) {
        return {
          what: `Transition ${entry}`,
          why: transitionWhy(ir, entry, clocks),
          ir: irPath,
          source: { kind: "transition", name: entry },
        };
      }
      if (field === "inputs" || field === "outputs") {
        if (sub === undefined) {
          return {
            what: field === "inputs" ? `The arcs into ${entry}` : `The arcs out of ${entry}`,
            ir: irPath,
            source: { kind: "transition", name: entry },
          };
        }
        const arc = ir.transitions[entry]?.[field]?.[sub] ?? null;
        return {
          what:
            field === "inputs"
              ? `Arc from ${sub} into ${entry}: ${arcText(arc)}`
              : `Arc from ${entry} into ${sub}: ${arcText(arc)}`,
          // The arc's weight and kind lines describe the arc, not themselves.
          ir: path.slice(0, 4).join("."),
          source: { kind: "place", name: sub },
        };
      }
      return {
        what:
          field === "rate"
            ? `${entry}'s firing rate`
            : field === "guard"
              ? `${entry}'s guard, as the body you wrote`
              : field === "kernel"
                ? `${entry}'s kernel: the tokens it produces, as the body you wrote`
                : field === "controllable"
                  ? `${entry} is marked controllable in its metadata`
                  : `${field} of ${entry}`,
        why:
          field === "rate"
            ? clocks
              ? "Arms an exponential clock with this rate when the transition fires."
              : "Tested over dt each step; code when the rate reads its tokens."
            : field === "guard"
              ? "Present when the condition reads its tokens; a constant condition is folded away."
              : undefined,
        ir: irPath,
        source: { kind: "transition", name: entry },
      };
    default:
      return null;
  }
}

/** Traces the IR text: one range per section, entry, field and arc. */
export function traceIr(ir: PetriNetIr, text: string, options: CompilerOptions = {}): Trace {
  const clocks = resolveOptions(options).rates === "clock";
  return yamlKeys(text).flatMap(({ path, line, endLine }) => {
    const provenance = describeIrPath(ir, path, clocks);
    return provenance === null ? [] : [{ startLine: line, endLine, provenance }];
  });
}
