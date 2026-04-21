import type { Connector, TableConfig } from "./types.js";
import { createPostgresBatchConnector, type PostgresTableConfig } from "./postgres.js";
import { createPostgresCdcConnector } from "./postgres-cdc.js";
import { createMongoStreamConnector } from "./mongodb-stream.js";
import { createRestApiBatchConnector, type RestApiBatchConfig, type RestApiEndpoint } from "./rest-api.js";
import type { Logger } from "../log.js";

/**
 * `id` prefixes every materialised DuckDB table (`${id}/${source}`) and every
 * `_state/sync/${id}/${sink}` state table -- it must be stable across runs.
 */
export type ConnectorDef = { id: string } & (
  | { mode: "batch"; url: string; tables: Record<string, PostgresTableConfig>; pageSize?: number }
  | { mode: "rest-api"; endpoints: Record<string, RestApiEndpoint>; auth?: RestApiBatchConfig["auth"]; rateLimitMs?: number; pageSize?: number }
  | { mode: "cdc"; url: string; publication: string; slot: string; tables: Record<string, TableConfig> }
  | { mode: "mongo-stream"; url: string; database: string; collections: Record<string, TableConfig> }
);

export function createConnector(def: ConnectorDef, log?: Logger): Connector {
  switch (def.mode) {
    case "batch":
      return createPostgresBatchConnector({ id: def.id, url: def.url, tables: def.tables, pageSize: def.pageSize });
    case "rest-api":
      return createRestApiBatchConnector(
        { id: def.id, endpoints: def.endpoints, auth: def.auth, rateLimitMs: def.rateLimitMs, pageSize: def.pageSize },
        log,
      );
    case "cdc":
      return createPostgresCdcConnector(
        { id: def.id, url: def.url, publication: def.publication, slot: def.slot, tables: def.tables },
        log,
      );
    case "mongo-stream":
      return createMongoStreamConnector(
        { id: def.id, url: def.url, database: def.database, collections: def.collections },
        log,
      );
  }
}
