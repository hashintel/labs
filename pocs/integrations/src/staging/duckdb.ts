import { DuckDBInstance, quotedIdentifier as qi } from "@duckdb/node-api";
import type { ColumnInfo, FieldKind } from "../connector/types.js";
import { META_COLUMNS, type QueryableStore } from "./types.js";

type TableSchema = { dataColumns: string[]; kinds: Map<string, FieldKind> };

const META_LIST = [META_COLUMNS.op, META_COLUMNS.key, META_COLUMNS.before] as const;
const META_SET: ReadonlySet<string> = new Set(META_LIST);

function columnType(col: string, kinds: Map<string, FieldKind>): "VARCHAR" | "JSON" {
  if (col === META_COLUMNS.op || col === META_COLUMNS.key) return "VARCHAR";
  if (col === META_COLUMNS.before) return "JSON";
  return kinds.get(col) === "json" ? "JSON" : "VARCHAR";
}

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

  async function readDataColumns(key: string): Promise<string[] | null> {
    try {
      const reader = await conn.runAndReadAll(`DESCRIBE ${qi(key)}`);
      const rows = reader.getRowObjectsJson() as Array<{ column_name: string }>;
      return rows.map((r) => r.column_name).filter((c) => !META_SET.has(c));
    } catch {
      return null;
    }
  }

  // Pushout in Sch: table columns = existing ∪ incoming. ADD COLUMN fills prior rows with NULL;
  // columns absent from `incoming` are never dropped (narrower batches write NULL for them).
  async function ensureTable(key: string, incoming: string[], incomingKinds: Map<string, FieldKind>): Promise<void> {
    const existing = await readDataColumns(key);

    if (existing === null) {
      const allCols = [...META_LIST, ...incoming];
      const colDefs = allCols.map((c) => `${qi(c)} ${columnType(c, incomingKinds)}`).join(", ");
      await conn.run(`CREATE TABLE ${qi(key)} (${colDefs})`);
      schemas.set(key, { dataColumns: [...incoming], kinds: new Map(incomingKinds) });
      return;
    }

    const existingKinds = schemas.get(key)?.kinds ?? new Map<string, FieldKind>();
    const mergedKinds = new Map(existingKinds);
    for (const [col, kind] of incomingKinds) {
      if (!mergedKinds.has(col)) mergedKinds.set(col, kind);
    }

    const existingSet = new Set(existing);
    const additions = incoming.filter((c) => !existingSet.has(c));
    for (const col of additions) {
      await conn.run(`ALTER TABLE ${qi(key)} ADD COLUMN ${qi(col)} ${columnType(col, mergedKinds)}`);
    }

    schemas.set(key, { dataColumns: [...existing, ...additions], kinds: mergedKinds });
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
      const allCols = [...META_LIST, ...dataColumns];
      const width = allCols.length;
      const columnList = allCols.map(qi).join(", ");
      const qiKey = qi(key);

      const ROWS_PER_INSERT = 500;
      for (let start = 0; start < events.length; start += ROWS_PER_INSERT) {
        const chunk = events.slice(start, start + ROWS_PER_INSERT);
        const params: (string | null)[] = new Array(chunk.length * width);
        const rowPlaceholders: string[] = new Array(chunk.length);

        for (let i = 0; i < chunk.length; i++) {
          const ev = chunk[i];
          const base = i * width;
          const slots: string[] = new Array(width);
          for (let s = 0; s < width; s++) slots[s] = `$${base + s + 1}`;
          rowPlaceholders[i] = `(${slots.join(", ")})`;

          params[base] = ev.op;
          params[base + 1] = JSON.stringify(ev.key);
          params[base + 2] = ev.before ? JSON.stringify(ev.before) : null;
          for (let c = 0; c < dataColumns.length; c++) {
            const col = dataColumns[c];
            params[base + 3 + c] = ev.row ? serializeValue(ev.row[col], kinds.get(col) ?? "scalar") : null;
          }
        }

        await conn.run(`INSERT INTO ${qiKey} (${columnList}) VALUES ${rowPlaceholders.join(", ")}`, params);
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
