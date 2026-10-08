import { exampleById } from "../../examples/catalog";
import { CodeBlock } from "./code-block";
import { Figure } from "./figures/figure";
import { Context, Example } from "./page-sections";
import { ruleBlock } from "./rule";
import { Term } from "./term";

import type { MDXComponents } from "mdx/types";

/**
 * The components every page uses without importing them. The documentation
 * view passes them to each page, so the examples import nothing from the
 * playground. `pre` renders the page's fenced code; `Rule` renders the
 * example's own constraint in the builder's words.
 */
export function pageComponents(exampleId: string): MDXComponents {
  return { Context, Example, Figure, Term, pre: CodeBlock, Rule: ruleBlock(exampleById(exampleId)) };
}
