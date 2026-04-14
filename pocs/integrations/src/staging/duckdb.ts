import { DuckDBInstance, quotedIdentifier as qi } from "@duckdb/node-api";
import type { ColumnInfo, FieldKind } from "../connector/types.js";
import { META_COLUMNS, type QueryableStore } from "./types.js";

type TableSchema = { dataColumns: string[]; kinds: Map<string, FieldKind> };

export async function createDuckDbQueryStore(path?: string): Promise<QueryableStore> {
  const instance = await DuckDBInstance.create(path ?? ":memory:");
  const conn = await instance.connect();
  const schemas = new Map<string, TableSchema>();

  function detectFieldKinds(dataColumns: string[], row: Record<string, unknown>, columns?: ColumnInfo[]): Map<string, FieldKind> {
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

  function tableKey(connectorId: string, table: string): string {
    return `${connectorId}/${table}`;
  }

  async function ensureTable(key: string, dataColumns: string[], kinds: Map<string, FieldKind>): Promise<void> {
    const allColumns = [META_COLUMNS.op, META_COLUMNS.key, META_COLUMNS.before, ...dataColumns];
    const colDefs = allColumns.map((c) => {
      if (c === META_COLUMNS.op || c === META_COLUMNS.key) return `${qi(c)} VARCHAR`;
      if (c === META_COLUMNS.before) return `${qi(c)} JSON`;
      return `${qi(c)} ${kinds.get(c) === "json" ? "JSON" : "VARCHAR"}`;
    }).join(", ");
    await conn.run(`CREATE TABLE IF NOT EXISTS ${qi(key)} (${colDefs})`);
    schemas.set(key, { dataColumns, kinds });
  }

  return {
    async materialize(connectorId, table, events, columns) {
      const key = tableKey(connectorId, table);
      if (events.length === 0) return;

      const firstWithRow = events.find((e) => e.row != null);
      const cached = schemas.get(key);

      if (firstWithRow?.row) {
        const dataColumns = Object.keys(firstWithRow.row);
        const kinds = detectFieldKinds(dataColumns, firstWithRow.row, columns);
        await ensureTable(key, dataColumns, kinds);
      } else if (cached) {
        await ensureTable(key, cached.dataColumns, cached.kinds);
      } else {
        await ensureTable(key, [], new Map());
      }

      const { dataColumns, kinds } = schemas.get(key)!;
      const allColumns = [META_COLUMNS.op, META_COLUMNS.key, META_COLUMNS.before, ...dataColumns];
      const placeholders = allColumns.map((_, i) => `$${i + 1}`).join(", ");
      const insertSql = `INSERT INTO ${qi(key)} VALUES (${placeholders})`;

      for (const ev of events) {
        const keyJson = JSON.stringify(ev.key);
        const beforeJson = ev.before ? JSON.stringify(ev.before) : null;
        if (ev.row) {
          const dataVals = dataColumns.map((c) => serializeValue(ev.row![c], kinds.get(c) ?? "scalar"));
          await conn.run(insertSql, [ev.op, keyJson, beforeJson, ...dataVals]);
        } else {
          const nulls = dataColumns.map(() => null);
          await conn.run(insertSql, [ev.op, keyJson, beforeJson, ...nulls]);
        }
      }
    },

    async query(sql) {
      const reader = await conn.runAndReadAll(sql);
      const columns = reader.columnNames();
      const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
      return { rows, columns };
    },

    async exec(sql, params) {
      if (params) {
        await conn.run(sql, params);
      } else {
        await conn.run(sql);
      }
    },

    async schemaOf(table) {
      const reader = await conn.runAndReadAll(`SELECT * FROM ${qi(table)} LIMIT 0`);
      return reader.columnNames();
    },

    close() {
      conn.closeSync();
      instance.closeSync();
    },
  };
}
