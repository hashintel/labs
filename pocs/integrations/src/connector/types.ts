export type ChangeOp = "insert" | "update" | "delete" | "upsert" | "snapshot";

export type ChangeEvent = {
  table: string;
  op: ChangeOp;
  key: Record<string, unknown>;
  row: Record<string, unknown> | null;
  before?: Record<string, unknown>;
};

export type FieldKind = "scalar" | "json";

/** Optional per-column hint for `QueryableStore.materialize` -- pass when a field is JSON-shaped. */
export type ColumnInfo = {
  name: string;
  type: string;
  nullable: boolean;
  kind?: FieldKind;
};

export type TableConfig = {
  primaryKey: string | string[];
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
  close(): Promise<void>;
};

/** Pull-based snapshot source. `pull` invokes `onPage` once per page. */
export type BatchConnector = ConnectorBase & {
  readonly mode: "batch";
  readonly pageSize: number;
  pull(table: string, onPage: (batch: Batch) => Promise<void>): Promise<void>;
};

/** Push-based stream source. `subscribe` resumes from `cursor` and fires `onBatch` per change group. */
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
  const col = typeof pk === "string" ? pk : pk.length === 1 ? pk[0] : null;
  if (col !== null) return (row) => (row ? { [col]: row[col] } : {});

  const cols = pk as string[];
  return (row) => {
    if (!row) return {};
    const out: Record<string, unknown> = {};
    for (let i = 0; i < cols.length; i++) out[cols[i]] = row[cols[i]];
    return out;
  };
}
