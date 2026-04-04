import { DuckDBInstance, quotedIdentifier as qi } from "@duckdb/node-api";
import type { ChangeEvent } from "../connector/types.js";
import { duckSchemaFrom, type DuckSchema } from "../transform/schema.js";

export type QueryResult = {
  rows: Record<string, unknown>[];
  duckSchema: DuckSchema;
};

export type StagingDb = {
  loadEvents(connectorId: string, events: ChangeEvent[]): Promise<void>;
  query(sql: string): Promise<QueryResult>;
  exec(sql: string, params?: (string | null)[]): Promise<void>;
  schemaOf(table: string): Promise<DuckSchema>;
  close(): void;
};

// Reserved columns injected by loadEvents. Steps see these as regular columns.
// The sink reads _op to decide upsert vs archive.
export const META_COLUMNS = { op: "_op", key: "_key" } as const;

export async function createStagingDb(): Promise<StagingDb> {
  const instance = await DuckDBInstance.create();
  const conn = await instance.connect();

  return {
    async loadEvents(connectorId: string, events: ChangeEvent[]) {
      if (events.length === 0) return;

      const byTable = new Map<string, ChangeEvent[]>();
      for (const ev of events) {
        const list = byTable.get(ev.table) ?? [];
        list.push(ev);
        byTable.set(ev.table, list);
      }

      for (const [table, tableEvents] of byTable) {
        const tableName = qi(`${connectorId}/${table}`);

        const firstWithRow = tableEvents.find((e) => e.row != null);
        if (!firstWithRow?.row) {
          await conn.run(`CREATE TABLE IF NOT EXISTS ${tableName} ("_op" VARCHAR, "_key" VARCHAR)`);
          for (const ev of tableEvents) {
            await conn.run(`INSERT INTO ${tableName} VALUES ($1, $2)`, [ev.op, JSON.stringify(ev.key)]);
          }
          continue;
        }

        const dataColumns = Object.keys(firstWithRow.row);
        const allColumns = ["_op", "_key", ...dataColumns];
        const colDefs = allColumns.map((c) => `${qi(c)} VARCHAR`).join(", ");
        await conn.run(`CREATE TABLE IF NOT EXISTS ${tableName} (${colDefs})`);

        const placeholders = allColumns.map((_, i) => `$${i + 1}`).join(", ");
        const insertSql = `INSERT INTO ${tableName} VALUES (${placeholders})`;

        for (const ev of tableEvents) {
          const keyJson = JSON.stringify(ev.key);
          if (ev.row) {
            const dataVals = dataColumns.map((c) => ev.row![c] == null ? null : String(ev.row![c]));
            await conn.run(insertSql, [ev.op, keyJson, ...dataVals]);
          } else {
            const nulls = dataColumns.map(() => null);
            await conn.run(insertSql, [ev.op, keyJson, ...nulls]);
          }
        }
      }
    },

    async query(sql: string): Promise<QueryResult> {
      const reader = await conn.runAndReadAll(sql);
      const duckSchema = duckSchemaFrom(reader.columnNames(), reader.columnTypes());
      const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
      return { rows, duckSchema };
    },

    async exec(sql: string, params?: (string | null)[]) {
      if (params) {
        await conn.run(sql, params);
      } else {
        await conn.run(sql);
      }
    },

    async schemaOf(table: string): Promise<DuckSchema> {
      const reader = await conn.runAndReadAll(`SELECT * FROM ${qi(table)} LIMIT 0`);
      return duckSchemaFrom(reader.columnNames(), reader.columnTypes());
    },

    close() {
      conn.closeSync();
      instance.closeSync();
    },
  };
}
