import { type Diagnostic as IrDiagnostic, type PetriNetIr, parsePetriNetIr } from "../../compiler";
import { checkReferences, evaluate, parseConstraintDocument, simulate } from "../../constraints";
import { hasErrors } from "../../constraints/diagnostics";
import { conditionsOnMetric } from "./condition-links";
import { passCondition, summarise, thresholdsOf, withSymbols } from "./run-summary";

import type { ConstraintDocument, Verdict } from "../../constraints/ast";
import type { Evaluation } from "../../constraints";
import type { Diagnostic } from "../../constraints/diagnostics";
import type { Timeline } from "./timeline-model";

/** The run as the Run panel shows it. */
export type RunView = {
  verdict: Verdict;
  /** A slot of the constraint is still a hole, so there is no verdict. */
  incomplete: boolean;
  /** The step the verdict was decided at; `undefined` when it holds only at the end of the run. */
  decidedAt: number | undefined;
  /** How the verdict was reached: `monitor` for a nested, windowed or `now` constraint. */
  check: Evaluation["check"];
  stopReason: string;
  /** One plain sentence on the result; `null` while a slot is open. */
  summary: string | null;
  /** What the rule needs to pass, with its conditions in code between backticks. */
  pass: string;
  timeline: Timeline;
  diagnostics: Diagnostic[];
};

/** Everything the panels read off the two texts and the seed. */
export type Analysis = {
  /** The net, or `null` while its text is not an IR. */
  ir: PetriNetIr | null;
  irDiagnostics: IrDiagnostic[];
  /** The constraint file as it parses now, or `null` while it has errors. */
  doc: ConstraintDocument | null;
  constraintDiagnostics: Diagnostic[];
  /** Whether the constraint text parses at all, whatever its references say. */
  textParses: boolean;
  /** The run, or `null` with `blocked` saying why there is none. */
  run: RunView | null;
  blocked: string | null;
};

/** Runs the net, evaluates the constraint over the states, and lays the result out as a timeline. */
function runViewOf(ir: PetriNetIr, doc: ConstraintDocument): RunView {
  const simulation = simulate(ir, doc.run);
  const evaluation = evaluate(doc, simulation.states, { stopReason: simulation.stopReason });
  const steps = simulation.states.map((state) => ({
    step: state.step,
    time: state.time,
    fired: state.firedTransition ?? null,
  }));
  // A rule with one condition on a defined metric reads from that metric's row and the verdict, so it gets no strip of its own.
  const [only] = evaluation.atoms;
  const showAtoms = !(evaluation.atoms.length === 1 && only?.ref.kind === "metric");
  const atomRows = (showAtoms ? evaluation.atoms : []).map((atom) => ({
    kind: "atom" as const,
    label: withSymbols(atom.text),
    values: [...atom.truth],
    link: [atom.text],
  }));
  const metricRows = evaluation.metrics.map((metric) => ({
    kind: "metric" as const,
    label: metric.name,
    values: [...metric.values],
    thresholds: thresholdsOf(doc, metric.name),
    link: conditionsOnMetric(doc.constraint, metric.name),
  }));
  // A verdict decided only at the end of the run belongs to the last state.
  const decidedAtEnd = evaluation.decidedAt === null && evaluation.finalVerdict !== "pending";
  const verdicts = decidedAtEnd
    ? evaluation.verdicts.map((verdict, index, all) => (index === all.length - 1 ? evaluation.finalVerdict : verdict))
    : [...evaluation.verdicts];
  const window = doc.constraint.op === "now" ? undefined : doc.constraint.window;
  return {
    verdict: evaluation.finalVerdict,
    incomplete: evaluation.incomplete,
    decidedAt: evaluation.decidedAt ?? undefined,
    check: evaluation.check,
    stopReason: simulation.stopReason,
    pass: passCondition(doc.constraint),
    summary: summarise(doc, evaluation, steps.at(-1)?.step ?? 0),
    timeline: {
      steps,
      rows: [...metricRows, ...atomRows, { kind: "verdict", label: "Verdict", values: verdicts }],
      ...(window === undefined ? {} : { window }),
    },
    diagnostics: [...simulation.diagnostics, ...evaluation.diagnostics],
  };
}

/**
 * Parses both texts and, when both are sound, runs the net under the
 * constraint. `seed` replaces the file's own seed when given. `mtl` lets the
 * constraint carry time windows, `nested` a temporal operator inside another.
 */
export function analyse(
  irText: string,
  constraintText: string,
  seed: number | null,
  mtl: boolean,
  nested = false,
): Analysis {
  const net = parsePetriNetIr(irText);
  const ir = net.ok ? net.ir : null;
  const irDiagnostics = net.ok ? [] : net.errors;
  const parsed = parseConstraintDocument(constraintText, { mtl, nested });
  const references = parsed.doc !== undefined && ir !== null ? checkReferences(parsed.doc, ir, parsed.lines) : [];
  const constraintDiagnostics = [...parsed.diagnostics, ...references];
  const textParses = parsed.doc !== undefined;
  const doc = parsed.doc !== undefined && !hasErrors(constraintDiagnostics) ? parsed.doc : null;
  if (ir === null || doc === null) {
    const blocked = ir === null ? "The run needs a net that parses." : "The run needs a constraint without errors.";
    return { ir, irDiagnostics, doc, constraintDiagnostics, textParses, run: null, blocked };
  }
  const seeded = seed === null ? doc : { ...doc, run: { ...doc.run, seed } };
  return { ir, irDiagnostics, doc, constraintDiagnostics, textParses, run: runViewOf(ir, seeded), blocked: null };
}
