import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { QueryableStore } from "../staging/types.js";

export type MultiRowHeadersOpts = {
  rows: number[];
  /** Fill empty cells from the last non-empty value in the same header row (Excel merged cells). */
  forwardFill?: boolean;
  /** Header rows excluded from `forwardFill`. */
  unfilledRows?: readonly number[];
  /** Case-insensitive tokens excluded from each combined name. */
  dropTokens?: readonly string[];
  /** Default: non-empty parts joined by `_`, coerced to `[A-Za-z0-9_]`. */
  combine?: (parts: string[]) => string;
  /** Default true. */
  dropUnnamed?: boolean;
};

/** Derives column names from N header rows; returns a read expression that skips them. `Raw → Named`. */
export async function readMultiRowHeaders(
  store: QueryableStore,
  readExpr: string,
  opts: MultiRowHeadersOpts,
): Promise<string> {
  if (opts.rows.length === 0) throw new Error("readMultiRowHeaders: rows must be non-empty");
  const topN = Math.max(...opts.rows) + 1;
  const { rows, columns } = await store.query(`SELECT * FROM (${readExpr}) LIMIT ${topN}`);
  const unfilled = new Set(opts.unfilledRows ?? []);
  const drop = new Set((opts.dropTokens ?? []).map((t) => t.toLowerCase()));

  const headerMatrix: string[][] = opts.rows.map((rowIdx) => {
    const row = rows[rowIdx];
    const cells = columns.map((c) => (row?.[c] == null ? "" : String(row[c]).trim()));
    if (opts.forwardFill && !unfilled.has(rowIdx)) {
      let last = "";
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] === "") cells[i] = last;
        else last = cells[i];
      }
    }
    return cells;
  });

  const combine = opts.combine ?? defaultCombine;
  const dropUnnamed = opts.dropUnnamed ?? true;

  const seen = new Map<string, number>();
  const projection: string[] = [];
  for (let i = 0; i < columns.length; i++) {
    const parts = headerMatrix
      .map((rowVals) => rowVals[i])
      .filter((p) => !drop.has(p.toLowerCase()));
    const combined = combine(parts);
    if (!combined) {
      if (dropUnnamed) continue;
      throw new Error(`readMultiRowHeaders: column at index ${i} has no combined name; set dropUnnamed:true or supply a name via combine()`);
    }
    const n = seen.get(combined) ?? 0;
    const unique = n === 0 ? combined : `${combined}_${n}`;
    seen.set(combined, n + 1);
    projection.push(`${qi(columns[i])} AS ${qi(unique)}`);
  }

  return `SELECT ${projection.join(", ")} FROM (${readExpr}) OFFSET ${topN}`;
}

function defaultCombine(parts: string[]): string {
  return parts
    .filter((p) => p.length > 0)
    .join("_")
    .replace(/[()]/g, "")
    .replace(/[^A-Za-z0-9_/]/g, "_")
    .replace(/^_+|_+$/g, "");
}
