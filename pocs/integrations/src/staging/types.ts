import type { ChangeEvent } from "../connector/types.js";
import type { DuckSchema } from "../transform/schema.js";

export const META_COLUMNS = { op: "_op", key: "_key" } as const;

export type AppendResult = {
  seq: number;
};

export type MaterializeResult = {
  tableName: string;
  rowCount: number;
  nextSeq: number;
};

export type EventStore = {
  append(connectorId: string, table: string, events: ChangeEvent[]): Promise<AppendResult>;
  materialize(connectorId: string, table: string, fromSeq?: number): Promise<MaterializeResult>;
};

export type QueryableStore = {
  query(sql: string): Promise<{ rows: Record<string, unknown>[]; duckSchema: DuckSchema }>;
  exec(sql: string, params?: (string | null)[]): Promise<void>;
  schemaOf(table: string): Promise<DuckSchema>;
  close(): void;
};
