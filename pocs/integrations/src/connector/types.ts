export type ChangeOp = "insert" | "update" | "delete" | "upsert" | "snapshot";

export type ChangeEvent = {
  table: string;
  op: ChangeOp;
  key: Record<string, unknown>;
  row: Record<string, unknown> | null;
  before?: Record<string, unknown>;
};

export type ForeignKey = {
  columns: string | string[];
  references: string;
  on?: string | string[];
};

export type ColumnInfo = {
  name: string;
  type: string;
  nullable: boolean;
};

export type TableConfig = {
  primaryKey: string | string[];
  foreignKeys?: Record<string, ForeignKey>;
  columns?: ColumnInfo[];
};

export type PullResult = {
  events: ChangeEvent[];
  cursor: unknown;
};

export type Connector = {
  readonly id: string;
  introspect(): Promise<Record<string, TableConfig>>;
  pull(table: string, cursor: unknown): Promise<PullResult>;
  close(): Promise<void>;
};

export function pkColumns(pk: string | string[]): string[] {
  return Array.isArray(pk) ? pk : [pk];
}

export function extractKey(
  row: Record<string, unknown> | null | undefined,
  pk: string | string[],
): Record<string, unknown> {
  if (!row) return {};
  return Object.fromEntries(pkColumns(pk).map((k) => [k, row[k]]));
}
