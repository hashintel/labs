import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { QueryableStore } from "../staging/types.js";

export type MultiRowHeadersOpts = {
  /** Row indices (0-based) that carry header data. */
  rows: number[];
  /** Fill empty cells within a header row by propagating the most recent non-empty value from the left. Models Excel merged cells. */
  forwardFill?: boolean;
  /** Combine the per-row header cells for a single column into the final name. Default: non-empty parts joined by `_`, coerced to `[A-Za-z0-9_]`. */
  combine?: (parts: string[]) => string;
  /** Columns whose combined name is empty are dropped. Default: true. */
  dropUnnamed?: boolean;
};

/**
 * Build a read expression whose column names come from N header rows of the
 * underlying data. Composes with any `readExpr` that produces generic column
 * names -- `read_xlsx(path, header=false)`, `read_csv(path, header=false)`,
 * and so on. The returned SQL skips the header rows.
 *
 * CT: a natural transformation `Raw → Named` on read morphisms.
 */
export async function readMultiRowHeaders(
  store: QueryableStore,
  readExpr: string,
  opts: MultiRowHeadersOpts,
): Promise<string> {
  if (opts.rows.length === 0) throw new Error("readMultiRowHeaders: rows must be non-empty");
  const topN = Math.max(...opts.rows) + 1;
  const { rows, columns } = await store.query(`SELECT * FROM (${readExpr}) LIMIT ${topN}`);

  const headerMatrix: string[][] = opts.rows.map((rowIdx) => {
    const row = rows[rowIdx];
    const cells = columns.map((c) => (row?.[c] == null ? "" : String(row[c]).trim()));
    if (opts.forwardFill) {
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
    const parts = headerMatrix.map((rowVals) => rowVals[i]);
    const combined = combine(parts);
    if (!combined) {
      if (dropUnnamed) continue;
      throw new Error(`readMultiRowHeaders: column at index ${i} has no combined name; set dropUnnamed:true or supply a name via combine()`);
    }
    const n = seen.get(combined) ?? 0;
    const unique = n === 0 ? combined : `${combined}_${n + 1}`;
    seen.set(combined, n + 1);
    projection.push(`${qi(columns[i])} AS ${qi(unique)}`);
  }

  return `SELECT ${projection.join(", ")} FROM (${readExpr}) OFFSET ${topN}`;
}

function defaultCombine(parts: string[]): string {
  return parts
    .filter((p) => p.length > 0)
    .join("_")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "");
}
