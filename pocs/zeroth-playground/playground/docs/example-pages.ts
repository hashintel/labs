import { folderOf } from "../../examples/catalog";

import type { MDXContent } from "mdx/types";

/** Each example folder's `page.mdx`, keyed by the folder, as the catalog is. */
export const EXAMPLE_PAGES: Readonly<Record<string, MDXContent>> = Object.fromEntries(
  Object.entries(
    import.meta.glob<MDXContent>("../../examples/*/page.mdx", { eager: true, import: "default" }),
  ).map(([path, page]) => [folderOf(path), page]),
);
