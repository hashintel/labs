import { DuckDBInstance, quotedIdentifier as qi } from "@duckdb/node-api";
import type { ChangeEvent, ColumnInfo, FieldKind } from "../connector/types.js";
import { duckSchemaFrom, type DuckSchema } from "../transform/schema.js";
import { META_COLUMNS, type EventStore, type AppendResult, type MaterializeResult, type QueryableStore } from "./types.js";

export type DuckDbStaging = EventStore & QueryableStore;

export async function createDuckDbStaging(): Promise<DuckDbStaging> {
  const instance = await DuckDBInstance.create();
  const conn = await instance.connect();

  const streams = new Map<string, { events: ChangeEvent[]; seq: number }>();

  function streamKey(connectorId: string, table: string): string {
    return `${connectorId}/${table}`;
  }

  function fieldKinds(dataColumns: string[], row: Record<string, unknown>, columns?: ColumnInfo[]): Map<string, FieldKind> {
    const kinds = new Map<string, FieldKind>();
    if (columns) {
      for (const col of columns) kinds.set(col.name, col.kind ?? "scalar");
    }
    for (const col of dataColumns) {
      if (kinds.has(col)) continue;
      const val = row[col];
      kinds.set(col, (typeof val === "object" && val !== null) ? "json" : "scalar");
    }
    return kinds;
  }

  function serializeValue(val: unknown, kind: FieldKind): string | null {
    if (val == null) return null;
    if (kind === "json" || (typeof val === "object" && val !== null)) return JSON.stringify(val);
    return String(val);
  }

  return {
    async append(connectorId: string, table: string, events: ChangeEvent[]): Promise<AppendResult> {
      if (events.length === 0) return { seq: 0 };

      const key = streamKey(connectorId, table);
      const stream = streams.get(key) ?? { events: [], seq: 0 };
      stream.events.push(...events);
      stream.seq += events.length;
      streams.set(key, stream);

      return { seq: stream.seq };
    },

    async read(connectorId: string, table: string, fromSeq?: number) {
      const key = streamKey(connectorId, table);
      const stream = streams.get(key);
      if (!stream) return { events: [], nextSeq: fromSeq ?? 0 };

      const startIdx = fromSeq ?? 0;
      return { events: stream.events.slice(startIdx), nextSeq: stream.seq };
    },

    async materialize(connectorId: string, table: string, events: ChangeEvent[], columns?: ColumnInfo[]): Promise<MaterializeResult> {
      const key = streamKey(connectorId, table);
      if (events.length === 0) return { tableName: key, rowCount: 0 };

      const tableName = qi(key);
      const firstWithRow = events.find((e) => e.row != null);

      if (!firstWithRow?.row) {
        await conn.run(`CREATE OR REPLACE TABLE ${tableName} ("_op" VARCHAR, "_key" VARCHAR)`);
        for (const ev of events) {
          await conn.run(`INSERT INTO ${tableName} VALUES ($1, $2)`, [ev.op, JSON.stringify(ev.key)]);
        }
        return { tableName: key, rowCount: events.length };
      }

      const dataColumns = Object.keys(firstWithRow.row);
      const kinds = fieldKinds(dataColumns, firstWithRow.row, columns);

      const allColumns = ["_op", "_key", ...dataColumns];
      const colDefs = allColumns.map((c) => {
        if (c === "_op" || c === "_key") return `${qi(c)} VARCHAR`;
        return `${qi(c)} ${kinds.get(c) === "json" ? "JSON" : "VARCHAR"}`;
      }).join(", ");
      await conn.run(`CREATE OR REPLACE TABLE ${tableName} (${colDefs})`);

      const placeholders = allColumns.map((_, i) => `$${i + 1}`).join(", ");
      const insertSql = `INSERT INTO ${tableName} VALUES (${placeholders})`;

      for (const ev of events) {
        const keyJson = JSON.stringify(ev.key);
        if (ev.row) {
          const dataVals = dataColumns.map((c) => serializeValue(ev.row![c], kinds.get(c) ?? "scalar"));
          await conn.run(insertSql, [ev.op, keyJson, ...dataVals]);
        } else {
          const nulls = dataColumns.map(() => null);
          await conn.run(insertSql, [ev.op, keyJson, ...nulls]);
        }
      }

      return { tableName: key, rowCount: events.length };
    },

    async query(sql: string) {
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

    async schemaOf(table: string) {
      const reader = await conn.runAndReadAll(`SELECT * FROM ${qi(table)} LIMIT 0`);
      return duckSchemaFrom(reader.columnNames(), reader.columnTypes());
    },

    close() {
      conn.closeSync();
      instance.closeSync();
    },
  };
}
