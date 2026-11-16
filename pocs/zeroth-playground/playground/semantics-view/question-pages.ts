import { folderOf } from "../../examples/catalog";

import type { MDXContent } from "mdx/types";

/** Each question folder's `page.mdx`, keyed by the folder, as the register is. */
export const QUESTION_PAGES: Readonly<Record<string, MDXContent>> = Object.fromEntries(
  Object.entries(
    import.meta.glob<MDXContent>("../../semantics/*/page.mdx", { eager: true, import: "default" }),
  ).map(([path, page]) => [folderOf(path), page]),
);
