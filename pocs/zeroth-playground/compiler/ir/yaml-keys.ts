/**
 * Every key of a block-style YAML text, with its path and the lines it
 * spans, read from indentation alone. A key's range runs from its own line
 * to the line before the next key at its indent or less, less the blank
 * lines at its end. The lines under a block scalar are text, however much
 * they look like keys.
 */

export type YamlKey = {
  /** `["transitions", "Go", "inputs", "A"]` for the line `A:` under Go's `inputs:`. */
  path: string[];
  /** 1-based. */
  line: number;
  /** The last line of the key's value: 1-based, inclusive. */
  endLine: number;
};

// A key is bare, or quoted where YAML would read the bare word as another
// value: a dumper quotes `On`, `Off`, `Yes`, `No`, `True`, `Null` and the like.
const KEY_LINE = /^( *)(?:- )?(?:'([^']*)'|"([^"]*)"|([A-Za-z_$][\w-]*)):(?: (.*)|$)/u;
const BLOCK_SCALAR = /^[|>][-+]?$/u;

/** The keys in line order. */
export function yamlKeys(text: string): YamlKey[] {
  const lines = text.split("\n");
  const keys: YamlKey[] = [];
  // The keys still open, innermost last; a key at their indent or less closes them.
  const open: { indent: number; key: YamlKey }[] = [];
  function close(indent: number, before: number): void {
    for (let top = open.at(-1); top !== undefined && top.indent >= indent; top = open.at(-1)) {
      open.pop();
      let end = before - 1;
      while (end > top.key.line && lines[end - 1]?.trim() === "") {
        end -= 1;
      }
      top.key.endLine = end;
    }
  }
  // The indent of a key whose value is a block scalar, while its lines run.
  let blockIndent: number | null = null;
  lines.forEach((line, index) => {
    const number = index + 1;
    if (blockIndent !== null) {
      const indent = /^ */u.exec(line)?.[0].length ?? 0;
      if (line.trim() === "" || indent > blockIndent) {
        return;
      }
      blockIndent = null;
    }
    const match = KEY_LINE.exec(line);
    if (match === null) {
      return;
    }
    const indent = match[1]?.length ?? 0;
    if (BLOCK_SCALAR.test(match[5] ?? "")) {
      blockIndent = indent;
    }
    close(indent, number);
    const name = match[2] ?? match[3] ?? match[4] ?? "";
    const key = { path: [...(open.at(-1)?.key.path ?? []), name], line: number, endLine: number };
    keys.push(key);
    open.push({ indent, key });
  });
  close(-1, lines.length + 1);
  return keys;
}
