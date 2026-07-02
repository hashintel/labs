import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { QueryableStore } from "../staging/types.js";

export type SourceAsserts = {
  rowCount?: { min?: number; max?: number };
  notNull?: readonly string[];
  unique?: readonly (string | readonly string[])[];
};

const OFFENDER_SAMPLE = 5;

/**
 * Declarative post-hydrate invariants on the materialized source table.
 * A failure throws with a diagnostic; the engine's per-source isolation turns
 * that into a source-level error without touching other sources.
 */
export async function runSourceAsserts(
  db: QueryableStore,
  sourceTable: string,
  source: string,
  asserts: SourceAsserts,
  rowCount: number,
): Promise<void> {
  const failures: string[] = [];

  const { min, max } = asserts.rowCount ?? {};
  if (min != null && rowCount < min) failures.push(`rowCount: ${rowCount} < min ${min}`);
  if (max != null && rowCount > max) failures.push(`rowCount: ${rowCount} > max ${max}`);

  if (rowCount > 0) {
    for (const col of asserts.notNull ?? []) {
      const { rows } = await db.query(
        `SELECT COUNT(*) FILTER (WHERE ${qi(col)} IS NULL OR TRIM(${qi(col)}::VARCHAR) = '')::BIGINT AS n
         FROM ${qi(sourceTable)}`,
      );
      const n = Number(rows[0]?.n ?? 0);
      if (n > 0) failures.push(`notNull(${col}): ${n} of ${rowCount} rows null or blank`);
    }

    for (const key of asserts.unique ?? []) {
      const cols = Array.isArray(key) ? key : [key as string];
      const colList = cols.map((c) => qi(c)).join(", ");
      const { rows } = await db.query(
        `SELECT ${colList}, COUNT(*)::BIGINT AS n
         FROM ${qi(sourceTable)}
         GROUP BY ${colList} HAVING COUNT(*) > 1
         ORDER BY n DESC LIMIT ${OFFENDER_SAMPLE}`,
      );
      if (rows.length > 0) {
        const offenders = rows.map((r) => `${cols.map((c) => String(r[c])).join("::")} (${r.n} rows)`).join(", ");
        failures.push(`unique(${cols.join(", ")}): duplicated keys, e.g. ${offenders}`);
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`source "${source}" failed asserts:\n  ${failures.join("\n  ")}`);
  }
}
