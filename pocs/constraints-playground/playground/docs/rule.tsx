import { CodeBlock } from "./code-block";
import { builderWords, ruleOf } from "../app/example-list";

import type { Example } from "../../examples/catalog";

/** The example's rule as the builder shows it; a rule that does not parse (the sandbox's blank) is read from its constraint file. */
export function ruleTextOf(example: Example): string {
  const shown = ruleOf(example);
  if (shown !== "") {
    return shown;
  }
  return builderWords(/^constraint:\s*(.+)$/mu.exec(example.constraint)?.[1]?.trim() ?? "");
}

/** The page's Rule block: the rule of the example the page belongs to, in the builder's words, so it cannot drift from the constraint file. */
export function ruleBlock(example: Example | undefined): React.FC {
  return () => <CodeBlock>{example === undefined ? "" : ruleTextOf(example)}</CodeBlock>;
}
