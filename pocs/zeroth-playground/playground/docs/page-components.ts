import { CodeBlock } from "./code-block";
import { Figure } from "./figures/figure";
import { OpenQuestion } from "./open-question";

import type { MDXComponents } from "mdx/types";

/**
 * The components every page uses without importing them. The documentation
 * view passes them to each page, so the examples import nothing from the
 * playground. `pre` renders the page's fenced code.
 */
export const PAGE_COMPONENTS = { Figure, OpenQuestion, pre: CodeBlock } satisfies MDXComponents;
