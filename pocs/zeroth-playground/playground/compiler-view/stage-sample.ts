import { codeParserSample, irSample, irTextSample, optionsSample, parseSample } from "./stage-sample/document-samples";
import { emitSample, filesSample, graphSample, lowerSample } from "./stage-sample/graph-samples";
import {
  diagnosticsSample,
  hoverSample,
  provenanceSample,
  traceSample,
  tracesSample,
} from "./stage-sample/trace-samples";
import { STAGES } from "./stages";

import type { Compilation, CompilerOptions } from "../../compiler";
import type { Stage, StageId } from "./stages";

/**
 * What one stage made of the example in the editor: a headline, a few
 * labelled values and, where it helps, a few lines quoted from a text. Pure:
 * everything is read off the compile the app already ran.
 */

export type SampleInput = {
  exampleTitle: string;
  irText: string;
  /** The options the panel holds, as the compile was asked for them. */
  options: CompilerOptions;
  compilation: Compilation;
};

/** `ok`: the stage ran. `refused`: it stopped the compile. `idle`: an earlier stage stopped it first. */
export type SampleTone = "ok" | "refused" | "idle";

export type SampleRow = {
  label: string;
  value: string;
  /** A value that does not bear on this net, such as an option that does not apply. */
  muted?: boolean;
  /** An error the stage stopped on. */
  error?: boolean;
};

type ExcerptLine = {
  /** 1-based, in the source text. */
  number: number;
  text: string;
  /** A line the sample points at, lit as the editors light it. */
  lit: boolean;
};

/** Lines quoted from one text, in order; the numbers may skip. */
export type SampleExcerpt = {
  /** The text the lines come from: `net.py`, `IR`. */
  source: string;
  lines: ExcerptLine[];
};

export type StageSample = {
  tone: SampleTone;
  headline: string;
  rows: SampleRow[];
  excerpt?: SampleExcerpt;
};

const SAMPLES: Record<StageId, (input: SampleInput) => StageSample> = {
  "ir-text": irTextSample,
  parse: parseSample,
  ir: irSample,
  options: optionsSample,
  "code-parser": codeParserSample,
  lower: lowerSample,
  graph: graphSample,
  emit: emitSample,
  files: filesSample,
  trace: traceSample,
  traces: tracesSample,
  provenance: provenanceSample,
  hover: hoverSample,
  diagnostics: diagnosticsSample,
};

export function stageSample(stage: StageId, input: SampleInput): StageSample {
  return SAMPLES[stage](input);
}

export type StageWithSample = { stage: Stage; sample: StageSample };

/** Every stage in pipeline order, with what it made of the example. */
export function stageSamples(input: SampleInput): StageWithSample[] {
  return STAGES.map((stage) => ({ stage, sample: stageSample(stage.id, input) }));
}
