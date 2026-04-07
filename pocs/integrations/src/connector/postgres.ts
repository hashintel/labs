import pg from "pg";
import type { ChangeEvent, Connector, PullResult, TableConfig } from "./types.js";
import { extractKey } from "./types.js";
import { introspectTables } from "./pg-introspect.js";

const esc = pg.escapeIdentifier;

export type PostgresTableConfig = TableConfig & {
  query?: string;
  watermark?: string;
};

export type PostgresConnectorConfig = {
  id: string;
  url: string;
  tables: Record<string, PostgresTableConfig>;
  pollIntervalMs?: number;
};

export function createPostgresConnector(config: PostgresConnectorConfig): Connector {
  const pool = new pg.Pool({ connectionString: config.url });

  return {
    id: config.id,
    mode: "poll" as const,
    pollIntervalMs: config.pollIntervalMs,

    async introspect() {
      return introspectTables(config.url, config.tables);
    },

    async pull(table: string, cursor: unknown): Promise<PullResult> {
      const tc = config.tables[table];
      if (!tc) throw new Error(`Unknown table "${table}" on connector "${config.id}"`);

      // Watermark is cast to text to preserve microsecond precision across the JS boundary
      const wm = tc.watermark ? esc(tc.watermark) : null;
      const base = tc.query ?? `SELECT * FROM ${esc(table)}`;
      const params: unknown[] = [];
      let query: string;

      if (cursor != null && wm) {
        query = `SELECT *, ${wm}::text AS _wm FROM (${base}) _src WHERE ${wm} > $1::timestamptz ORDER BY ${wm}`;
        params.push(cursor);
      } else if (wm) {
        query = `SELECT *, ${wm}::text AS _wm FROM (${base}) _src ORDER BY ${wm}`;
      } else {
        query = base;
      }

      const { rows } = await pool.query(query, params);

      const isSnapshot = cursor == null;
      const events: ChangeEvent[] = rows.map((row) => {
        const { _wm, ...rest } = row;
        return { table, op: isSnapshot ? "snapshot" : "upsert", key: extractKey(rest, tc.primaryKey), row: rest };
      });

      let newCursor = cursor;
      if (wm && rows.length > 0) {
        newCursor = rows[rows.length - 1]._wm;
      }

      return { events, cursor: newCursor };
    },

    async close() {
      await pool.end();
    },
  };
}
