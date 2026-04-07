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

export type PullResult = {
  events: ChangeEvent[];
  cursor: unknown;
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

export type PollConnector = ConnectorBase & {
  readonly mode: "poll";
  readonly pollIntervalMs?: number;
  pull(table: string, cursor: unknown): Promise<PullResult>;
};

export type StreamConnector = ConnectorBase & {
  readonly mode: "stream";
  pull(table: string, cursor: unknown): Promise<PullResult>;
  subscribe(table: string, cursor: unknown, onBatch: BatchHandler): Promise<Subscription>;
};

export type Connector = PollConnector | StreamConnector;

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
