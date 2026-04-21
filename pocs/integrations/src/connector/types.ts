import type { QueryableStore } from "../staging/types.js";
import type { Logger } from "../log.js";

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

/**
 * Handed to `BatchConnector.hydrate`. The connector must populate
 * `stagingTable` in `store` with rows + meta columns (_op, _key, _before).
 * The engine drops the staging table before the call and after it returns,
 * so the connector creates fresh (CREATE OR REPLACE / CREATE IF NOT EXISTS via materialize).
 */
export type HydrateContext = {
  readonly connectorId: string;
  readonly source: string;
  readonly stagingTable: string;
  readonly store: QueryableStore;
  readonly log: Logger;
};

export type HydrateResult = {
  rowCount: number;
  cursor?: unknown;
};

/** Pull-based snapshot source. `hydrate` lands rows in `ctx.stagingTable` and returns the count. */
export type BatchConnector = ConnectorBase & {
  readonly mode: "batch";
  hydrate(ctx: HydrateContext): Promise<HydrateResult>;
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
