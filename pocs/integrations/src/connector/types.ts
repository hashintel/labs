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

export type FieldKind = "scalar" | "json";

export type ColumnInfo = {
  name: string;
  type: string;
  nullable: boolean;
  kind?: FieldKind;
};

export type TableConfig = {
  primaryKey: string | string[];
  foreignKeys?: Record<string, ForeignKey>;
  columns?: ColumnInfo[];
};

export type Batch = {
  events: ChangeEvent[];
  cursor: unknown;
};

export type BatchHandler = (batch: Batch) => void | Promise<void>;

export type Subscription = {
  stop(): Promise<void>;
};

type ConnectorBase = {
  readonly id: string;
  introspect(): Promise<Record<string, TableConfig>>;
  close(): Promise<void>;
};

export type BatchConnector = ConnectorBase & {
  readonly mode: "batch";
  readonly pageSize: number;
  pull(table: string, onPage: (batch: Batch) => Promise<void>): Promise<void>;
};

export type StreamConnector = ConnectorBase & {
  readonly mode: "stream";
  subscribe(table: string, cursor: unknown, onBatch: BatchHandler): Promise<Subscription>;
};

export type Connector = BatchConnector | StreamConnector;

export function pkColumns(pk: string | string[]): string[] {
  return Array.isArray(pk) ? pk : [pk];
}

export type KeyExtractor = (row: Record<string, unknown> | null | undefined) => Record<string, unknown>;

export function compileKeyExtractor(pk: string | string[]): KeyExtractor {
  if (typeof pk === "string") {
    const col = pk;
    return (row) => (row ? { [col]: row[col] } : {});
  }
  if (pk.length === 1) {
    const col = pk[0];
    return (row) => (row ? { [col]: row[col] } : {});
  }
  const cols = pk;
  return (row) => {
    if (!row) return {};
    const out: Record<string, unknown> = {};
    for (let i = 0; i < cols.length; i++) out[cols[i]] = row[cols[i]];
    return out;
  };
}

export function extractKey(
  row: Record<string, unknown> | null | undefined,
  pk: string | string[],
): Record<string, unknown> {
  if (!row) return {};
  if (typeof pk === "string") return { [pk]: row[pk] };
  const out: Record<string, unknown> = {};
  for (let i = 0; i < pk.length; i++) out[pk[i]] = row[pk[i]];
  return out;
}
