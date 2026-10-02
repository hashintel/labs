import { codeStrings, optionStates, yamlKeys } from "../../../compiler";
import { NOT_USED, OPTION_SECTIONS, valueLabel } from "../../options/option-labels";
import { excerptOf } from "./excerpt";
import { notParsed } from "./not-reached";
import { diagnosticRow, plural } from "./rows";

import type { CodeString, PetriNetIr } from "../../../compiler";
import type { SampleInput, StageSample } from "../stage-sample";

/** A code string's IR path: `transitions.Take.rate`. */
function codePath({ item, field }: CodeString): string {
  return `${item.kind === "dynamics" ? "dynamics" : "transitions"}.${item.name}.${field}`;
}

function markingOf(ir: PetriNetIr): string {
  const entries = Object.entries(ir.marking ?? {}).map(([place, tokens]) =>
    typeof tokens === "number" ? `${place} ${tokens}` : `${place} ${plural(tokens.length, "token")}`,
  );
  return entries.length === 0 ? "every place empty" : entries.join(", ");
}

export function irTextSample({ irText }: SampleInput): StageSample {
  const lines = irText.split("\n");
  const sections = [
    ...new Set(yamlKeys(irText).flatMap((key) => (key.path.length === 1 ? key.path : []))),
  ];
  return {
    tone: "ok",
    headline: `${plural(lines.length, "line")} of YAML.`,
    rows: [
      { label: "sections", value: sections.join(", ") || "none" },
      { label: "characters", value: String(irText.length) },
    ],
    excerpt: excerptOf("IR", irText, 1),
  };
}

export function parseSample({ compilation }: SampleInput): StageSample {
  const { ir, errors } = compilation;
  if (ir === null) {
    return {
      tone: "refused",
      headline: `Refused with ${plural(errors.length, "error")}.`,
      rows: errors.map((error) => diagnosticRow(error, "error")),
    };
  }
  const places = Object.keys(ir.places).length;
  const transitions = Object.keys(ir.transitions).length;
  return {
    tone: "ok",
    headline: `Parsed: ${plural(places, "place")}, ${plural(transitions, "transition")}.`,
    rows: [
      { label: "kind", value: ir.kind },
      { label: "colours", value: String(Object.keys(ir.colours ?? {}).length) },
      { label: "dynamics", value: String(Object.keys(ir.dynamics ?? {}).length) },
      { label: "code strings", value: String(codeStrings(ir).length) },
    ],
  };
}

export function irSample({ compilation }: SampleInput): StageSample {
  const { ir } = compilation;
  if (ir === null) {
    return notParsed();
  }
  const colours = Object.keys(ir.colours ?? {});
  return {
    tone: "ok",
    headline: `The net ${ir.name}, ${ir.kind}.`,
    rows: [
      { label: "places", value: Object.keys(ir.places).join(", ") },
      { label: "transitions", value: Object.keys(ir.transitions).join(", ") },
      { label: "marking", value: markingOf(ir) },
      ...(colours.length === 0 ? [] : [{ label: "colours", value: colours.join(", ") }]),
    ],
  };
}

export function optionsSample({ compilation, options }: SampleInput): StageSample {
  const { ir } = compilation;
  if (ir === null) {
    return notParsed();
  }
  const states = optionStates(ir, options);
  const applying = states.filter((state) => state.notApplicable === undefined);
  const labelled = OPTION_SECTIONS.flatMap((section) => section.options);
  const set = labelled.flatMap((labels) => {
    const value = options[labels.name];
    return value === undefined ? [] : [`${labels.label} ${valueLabel(labels, String(value))}`];
  });
  const rows = labelled.flatMap((labels) => {
    const state = states.find((candidate) => candidate.name === labels.name);
    if (state === undefined) {
      return [];
    }
    return state.notApplicable === undefined
      ? [{ label: labels.label, value: valueLabel(labels, state.value) }]
      : [{ label: labels.label, value: `${NOT_USED}: ${state.notApplicable}`, muted: true }];
  });
  return {
    tone: "ok",
    headline: `${applying.length} of ${states.length} options apply; ${
      set.length === 0 ? "each keeps the compiler's default" : `the panel sets ${set.join(", ")}`
    }.`,
    rows,
  };
}

export function codeParserSample({ compilation }: SampleInput): StageSample {
  const { ir, errors } = compilation;
  if (ir === null) {
    return notParsed();
  }
  const codes = codeStrings(ir);
  if (codes.length === 0) {
    return { tone: "ok", headline: "No code strings: the lowering never asks for a parser.", rows: [] };
  }
  const rows = codes.map((code) => ({ label: code.surface, value: codePath(code) }));
  const refused = errors.filter((error) => error.code === "code-not-parsed").length;
  if (compilation.graph === null && refused === 0) {
    return { tone: "idle", headline: "Not reached: the lowering refused the net before it read the code.", rows };
  }
  return {
    tone: refused > 0 ? "refused" : "ok",
    headline: `${plural(codes.length, "code string")} and no parser: ${plural(refused, "code-not-parsed error")}.`,
    rows,
  };
}
