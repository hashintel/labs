import type { QueryableStore } from "../staging/types.js";

export type Uri = string;

/**
 * Durable persistence for checkpoints and run-level artefacts. Bulk Parquet
 * I/O flows through `uriFor(key)` -- DuckDB's COPY / read_parquet do the
 * transfer via whichever extension was loaded in `prepare`.
 */
export type Storage = {
  readonly name: string;
  uriFor(key: string): Uri;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
  remove(key: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  /** Atomic per key: a partial write is never observable by `get`/`exists`. */
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** Prepare `uriFor(key)` for an external writer (DuckDB COPY). Local fs creates parent dirs; object stores are typically no-ops. */
  prepareWrite(key: string): Promise<void>;
  /** Load DuckDB extensions / set credentials. Idempotent; called once per integrate(). */
  prepare(store: QueryableStore): Promise<void>;
};
