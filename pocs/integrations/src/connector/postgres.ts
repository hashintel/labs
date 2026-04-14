import pg from "pg";
import type { ChangeEvent, BatchConnector, Batch, TableConfig } from "./types.js";
import { extractKey, pkColumns } from "./types.js";
import { introspectTables } from "./pg-introspect.js";

const esc = pg.escapeIdentifier;

export type PostgresTableConfig = TableConfig & {
  query?: string;
};

export type PostgresBatchConfig = {
  id: string;
  url: string;
  tables: Record<string, PostgresTableConfig>;
  pageSize?: number;
};

export function createPostgresBatchConnector(config: PostgresBatchConfig): BatchConnector {
  const pool = new pg.Pool({ connectionString: config.url });
  const pageSize = config.pageSize ?? 1000;

  return {
    id: config.id,
    mode: "batch" as const,
    pageSize,

    async introspect() {
      return introspectTables(config.url, config.tables);
    },

    async pull(table, onPage) {
      const tc = config.tables[table];
      if (!tc) throw new Error(`Unknown table "${table}" on connector "${config.id}"`);

      const pk = pkColumns(tc.primaryKey);
      const base = tc.query ?? `SELECT * FROM ${esc(table)}`;
      const orderBy = pk.map(esc).join(", ");

      let lastKey: unknown[] | null = null;

      while (true) {
        let query: string;
        const params: unknown[] = [];

        if (lastKey) {
          const conditions = pk.map((col, i) => { params.push(lastKey![i]); return `${esc(col)} > $${i + 1}`; });
          query = `SELECT * FROM (${base}) _src WHERE ${conditions.join(" AND ")} ORDER BY ${orderBy} LIMIT ${pageSize}`;
        } else {
          query = `SELECT * FROM (${base}) _src ORDER BY ${orderBy} LIMIT ${pageSize}`;
        }

        const { rows } = await pool.query(query, params);
        if (rows.length === 0) break;

        const events: ChangeEvent[] = rows.map((row) => ({
          table,
          op: "snapshot" as const,
          key: extractKey(row, tc.primaryKey),
          row,
        }));

        await onPage({ events, cursor: undefined });

        lastKey = pk.map((col) => rows[rows.length - 1][col]);
        if (rows.length < pageSize) break;
      }
    },

    async close() {
      await pool.end();
    },
  };
}
