import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { QueryableStore } from "../staging/types.js";
import type { Storage } from "../storage/types.js";

export function checkpointKey(name: string): string {
  return `checkpoints/${name}.parquet`;
}

export async function writeCheckpoint(
  name: string,
  sourceTable: string,
  store: QueryableStore,
  storage: Storage,
): Promise<void> {
  const key = checkpointKey(name);
  await storage.prepareWrite(key);
  const uri = storage.uriFor(key);
  await store.exec(
    `COPY (SELECT * FROM ${qi(sourceTable)}) TO '${uri.replace(/'/g, "''")}' (FORMAT PARQUET)`,
  );
}
