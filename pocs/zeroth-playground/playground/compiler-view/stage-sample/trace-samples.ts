import { matchingLines } from "../../../compiler";
import { coveredLines, EXCERPT_LINES, excerptOf, excerptOfLines, lineSpan, linesLabel } from "./excerpt";
import { notParsed } from "./not-reached";
import { diagnosticRows, plural, provenanceRows, sourceName } from "./rows";

import type { CompiledFile, Trace, TraceRange } from "../../../compiler";
import type { SampleInput, StageSample } from "../stage-sample";

/** The text a sample quotes its traces from: the first file, else the IR. */
function tracedText({ irText, compilation }: SampleInput): { source: string; text: string; trace: Trace } {
  const main: CompiledFile | undefined = compilation.files[0];
  return main === undefined
    ? { source: "IR", text: irText, trace: compilation.irTrace }
    : { source: main.path, text: main.text, trace: main.trace };
}

/** The ranges holding a line, innermost first, as `provenanceAt` ranks them. */
function holders(trace: Trace, line: number): TraceRange[] {
  return trace
    .filter((range) => range.startLine <= line && line <= range.endLine)
    .toSorted((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine));
}

export function traceSample({ irText, compilation }: SampleInput): StageSample {
  const { ir, irTrace, files } = compilation;
  if (ir === null) {
    return notParsed();
  }
  return {
    tone: "ok",
    headline: `${plural(irTrace.length, "range")} over the IR text.`,
    rows: [
      { label: "IR", value: `${plural(irTrace.length, "range")} over ${plural(irText.split("\n").length, "line")}` },
      ...(files.length === 0
        ? [{ label: "Python", value: "none: the lowering refused", muted: true }]
        : files.map((file) => ({ label: file.path, value: `${plural(file.trace.length, "range")}, written by emit` }))),
    ],
  };
}

export function tracesSample(input: SampleInput): StageSample {
  if (input.compilation.ir === null) {
    return notParsed();
  }
  const { source, text, trace } = tracedText(input);
  const example =
    trace.find((range) => range.provenance.source !== undefined && range.provenance.why !== undefined) ?? trace[0];
  if (example === undefined) {
    return { tone: "ok", headline: `No ranges in ${source}.`, rows: [] };
  }
  return {
    tone: "ok",
    headline: `One range of ${source}, ${lineSpan(example)}.`,
    rows: provenanceRows(example.provenance),
    excerpt: excerptOf(source, text, example.startLine, example.endLine - example.startLine + 1),
  };
}

export function provenanceSample(input: SampleInput): StageSample {
  if (input.compilation.ir === null) {
    return notParsed();
  }
  const { source, text, trace } = tracedText(input);
  const lineCount = text.split("\n").length;
  const lines = Array.from({ length: lineCount }, (_, index) => index + 1);
  const line =
    lines.find((candidate) => {
      const held = holders(trace, candidate);
      return held.length >= 2 && held[0]?.provenance.source !== undefined;
    }) ?? lines.find((candidate) => holders(trace, candidate).length > 0);
  const held = line === undefined ? [] : holders(trace, line);
  const innermost = held[0];
  if (line === undefined || innermost === undefined) {
    return { tone: "ok", headline: `No line of ${source} is traced.`, rows: [] };
  }
  return {
    tone: "ok",
    headline: `${source} line ${line}: ${plural(held.length, "range holds", "ranges hold")} it; the innermost is ${lineSpan(innermost)}.`,
    rows: provenanceRows(innermost.provenance),
    excerpt: excerptOf(source, text, Math.max(1, line - 2), 5, [line]),
  };
}

export function hoverSample({ irText, compilation }: SampleInput): StageSample {
  const { ir, irTrace, files } = compilation;
  if (ir === null) {
    return notParsed();
  }
  const range =
    irTrace.find((candidate) => candidate.provenance.source?.kind === "transition") ??
    irTrace.find((candidate) => candidate.provenance.source?.kind === "place");
  if (range === undefined) {
    return { tone: "ok", headline: "No IR range names a place or transition.", rows: [] };
  }
  const source = sourceName(range.provenance) ?? "";
  const irRow = { label: "IR", value: `${lineSpan(range)}, ${source}` };
  const matched = files.map((file) => ({ file, lines: matchingLines(file.trace, range.provenance) }));
  const main = matched[0];
  if (main === undefined) {
    return {
      tone: "ok",
      headline: `A hover on ${source} lights its node in the preview; there is no Python to light.`,
      rows: [irRow],
      excerpt: excerptOf("IR", irText, range.startLine, range.endLine - range.startLine + 1),
    };
  }
  const lit = coveredLines(main.lines);
  const excerptSource =
    lit.length > EXCERPT_LINES ? `${main.file.path} · first ${EXCERPT_LINES} of ${lit.length} lit lines` : main.file.path;
  return {
    tone: "ok",
    headline: `A hover on ${source} in the IR lights ${plural(lit.length, "line")} of ${main.file.path}.`,
    rows: [
      irRow,
      ...matched.map(({ file, lines }) => ({
        label: file.path,
        value: lines.length === 0 ? "nothing" : linesLabel(coveredLines(lines)),
        ...(lines.length === 0 ? { muted: true } : {}),
      })),
    ],
    ...(lit.length === 0 ? {} : { excerpt: excerptOfLines(excerptSource, main.file.text, lit) }),
  };
}

export function diagnosticsSample({ compilation }: SampleInput): StageSample {
  const { errors, warnings } = compilation;
  if (errors.length === 0 && warnings.length === 0) {
    return { tone: "ok", headline: "No diagnostics: the net compiles cleanly.", rows: [] };
  }
  // The list of errors stops nothing itself: its rows are red, the box is not.
  return {
    tone: "ok",
    headline: `${plural(errors.length, "error")}, ${plural(warnings.length, "warning")}.`,
    rows: diagnosticRows(errors, warnings),
  };
}
