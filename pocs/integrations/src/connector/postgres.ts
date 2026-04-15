import pg from "pg";
import type { ChangeEvent, BatchConnector, TableConfig } from "./types.js";
import { compileKeyExtractor, pkColumns } from "./types.js";
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
      const escPk = pk.map(esc);
      const orderBy = escPk.join(", ");
      const firstPageSql = `SELECT * FROM (${base}) _src ORDER BY ${orderBy} LIMIT ${pageSize}`;
      const conditions = escPk.map((c, i) => `${c} > $${i + 1}`).join(" AND ");
      const cursorPageSql = `SELECT * FROM (${base}) _src WHERE ${conditions} ORDER BY ${orderBy} LIMIT ${pageSize}`;
      const keyFrom = compileKeyExtractor(pk);

      let sql = firstPageSql;
      let params: unknown[] = [];

      while (true) {
        const { rows } = await pool.query(sql, params);
        if (rows.length === 0) break;

        const events: ChangeEvent[] = new Array(rows.length);
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          events[i] = { table, op: "snapshot", key: keyFrom(row), row };
        }

        await onPage({ events, cursor: undefined });
        if (rows.length < pageSize) break;

        const lastRow = rows[rows.length - 1];
        params = pk.map((col) => lastRow[col]);
        sql = cursorPageSql;
      }
    },

    async close() {
      await pool.end();
    },
  };
}
