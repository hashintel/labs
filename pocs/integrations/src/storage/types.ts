import type { QueryableStore } from "../staging/types.js";

export type Uri = string;

/** Bulk Parquet I/O goes through `uriFor(key)`; DuckDB reads/writes via the extension loaded in `prepare`. */
export type Storage = {
  uriFor(key: string): Uri;
  exists(key: string): Promise<boolean>;
  /** Make `uriFor(key)` writable by an external writer (local fs: mkdir -p; object stores: no-op). */
  prepareWrite(key: string): Promise<void>;
  /** Load extensions / set credentials. Idempotent; called once per `integrate()`. */
  prepare(store: QueryableStore): Promise<void>;
};
