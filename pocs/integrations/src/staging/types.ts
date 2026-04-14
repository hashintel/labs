import type { ChangeEvent, ColumnInfo } from "../connector/types.js";

export const META_COLUMNS = { op: "_op", key: "_key", before: "_before" } as const;

export type EventStore = {
  append(connectorId: string, table: string, events: ChangeEvent[]): Promise<void>;
  read(connectorId: string, table: string, fromSeq?: number): Promise<{ events: ChangeEvent[]; nextSeq: number }>;
  trim(connectorId: string, table: string, beforeSeq: number): void;
};

export type QueryableStore = {
  materialize(connectorId: string, table: string, events: ChangeEvent[], columns?: ColumnInfo[]): Promise<void>;
  query(sql: string): Promise<{ rows: Record<string, unknown>[]; columns: string[] }>;
  exec(sql: string, params?: (string | null)[]): Promise<void>;
  schemaOf(table: string): Promise<string[]>;
  close(): void;
};
