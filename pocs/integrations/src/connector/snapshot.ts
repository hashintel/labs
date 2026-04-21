import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { HydrateResult } from "./types.js";
import { pkColumns } from "./types.js";
import { META_COLUMNS, type QueryableStore } from "../staging/types.js";

const META_SET: ReadonlySet<string> = new Set([META_COLUMNS.op, META_COLUMNS.key, META_COLUMNS.before]);

type MaterializeCtx = {
  readonly source: string;
  readonly stagingTable: string;
  readonly store: QueryableStore;
};

/** Wraps `readExpr` with snapshot meta (`_op`/`_key`/`_before`) into `ctx.stagingTable`. */
export async function materialize(
  ctx: MaterializeCtx,
  readExpr: string,
  primaryKey: string | string[],
): Promise<HydrateResult> {
  const pk = pkColumns(primaryKey);
  const qTable = qi(ctx.stagingTable);

  const { rows: descRows } = await ctx.store.query(`DESCRIBE (${readExpr})`);
  const cols = descRows.map((r) => String(r.column_name));

  const collisions = cols.filter((c) => META_SET.has(c));
  if (collisions.length > 0) {
    throw new Error(
      `Source "${ctx.source}" has reserved column names [${collisions.join(", ")}]. ` +
      `Rename them at the source, or via a read expression that aliases them.`,
    );
  }
  const missingPk = pk.filter((c) => !cols.includes(c));
  if (missingPk.length > 0) {
    throw new Error(
      `Source "${ctx.source}" primaryKey references missing columns [${missingPk.join(", ")}]. ` +
      `Available: [${cols.join(", ")}]`,
    );
  }

  const dataCols = cols.map(qi).join(", ");
  const keyEntries = pk.map((c) => `${quoteLit(c)}: ${qi(c)}`).join(", ");
  const keyExpr = `CAST(to_json({${keyEntries}}) AS VARCHAR)`;

  await ctx.store.exec(
    `CREATE OR REPLACE TABLE ${qTable} AS ` +
    `SELECT 'snapshot' AS ${qi(META_COLUMNS.op)}, ` +
    `${keyExpr} AS ${qi(META_COLUMNS.key)}, ` +
    `CAST(NULL AS JSON) AS ${qi(META_COLUMNS.before)}, ` +
    `${dataCols} FROM (${readExpr}) _src`,
  );

  const { rows } = await ctx.store.query(`SELECT COUNT(*) AS n FROM ${qTable}`);
  return { rowCount: Number(rows[0].n) };
}

function quoteLit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
