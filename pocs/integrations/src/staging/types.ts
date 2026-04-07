import type { ChangeEvent, ColumnInfo } from "../connector/types.js";
import type { DuckSchema } from "../transform/schema.js";

export const META_COLUMNS = { op: "_op", key: "_key" } as const;

export type AppendResult = {
  seq: number;
};

export type MaterializeResult = {
  tableName: string;
  rowCount: number;
};

export type EventStore = {
  append(connectorId: string, table: string, events: ChangeEvent[]): Promise<AppendResult>;
  read(connectorId: string, table: string, fromSeq?: number): Promise<{ events: ChangeEvent[]; nextSeq: number }>;
};

export type QueryableStore = {
  materialize(connectorId: string, table: string, events: ChangeEvent[], columns?: ColumnInfo[]): Promise<MaterializeResult>;
  query(sql: string): Promise<{ rows: Record<string, unknown>[]; duckSchema: DuckSchema }>;
  exec(sql: string, params?: (string | null)[]): Promise<void>;
  schemaOf(table: string): Promise<DuckSchema>;
  close(): void;
};
