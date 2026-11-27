import type { Provenance, Trace } from "../trace/provenance";

/**
 * Python written beside its trace. An emitter writes each line with what it
 * is, and groups lines into blocks that say what they are together: the
 * imports, a class, a method. The trace is read off what was written, so it
 * cannot disagree with the text.
 *
 * A plain string is a line no range of its own holds: a blank, a docstring,
 * the header that opens a block.
 */
export type PythonLine = string | TracedLine | PythonBlock;

type TracedLine = { text: string; provenance: Provenance };

type PythonBlock = { provenance: Provenance; lines: readonly PythonLine[] };

export function traced(text: string, provenance: Provenance): PythonLine {
  return { text, provenance };
}

export function block(provenance: Provenance, lines: readonly PythonLine[]): PythonLine {
  return { provenance, lines };
}

/**
 * The lines as text, ending in a newline, and their trace. A traced line's
 * range is the line; a block's runs from its first non-blank line to its
 * last, and comes before the ranges inside it.
 */
export function written(lines: readonly PythonLine[]): { text: string; trace: Trace } {
  const texts: string[] = [];
  const trace: Trace = [];
  function write(line: PythonLine): void {
    if (typeof line === "string") {
      texts.push(line);
      return;
    }
    if ("text" in line) {
      texts.push(line.text);
      trace.push({ startLine: texts.length, endLine: texts.length, provenance: line.provenance });
      return;
    }
    const at = trace.length;
    const first = texts.length;
    line.lines.forEach(write);
    const filled = texts
      .slice(first)
      .flatMap((text, offset) => (text.trim() === "" ? [] : [first + offset + 1]));
    const startLine = filled[0];
    const endLine = filled.at(-1);
    if (startLine !== undefined && endLine !== undefined) {
      trace.splice(at, 0, { startLine, endLine, provenance: line.provenance });
    }
  }
  lines.forEach(write);
  return { text: `${texts.join("\n")}\n`, trace };
}
