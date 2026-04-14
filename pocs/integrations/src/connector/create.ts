import type { Connector, TableConfig } from "./types.js";
import { createPostgresBatchConnector, type PostgresTableConfig } from "./postgres.js";
import { createPostgresCdcConnector } from "./postgres-cdc.js";
import { createMongoStreamConnector, type MongoStreamConfig } from "./mongodb-stream.js";
import { createRestApiBatchConnector, type RestApiBatchConfig, type RestApiEndpoint } from "./rest-api.js";

export type ConnectorDef = { id: string } & (
  | { mode: "batch"; url: string; tables: Record<string, PostgresTableConfig>; pageSize?: number }
  | { mode: "rest-api"; endpoints: Record<string, RestApiEndpoint>; auth?: RestApiBatchConfig["auth"]; rateLimitMs?: number; pageSize?: number }
  | { mode: "cdc"; url: string; publication: string; slot: string; tables: Record<string, TableConfig>; pollTimeoutMs?: number }
  | { mode: "mongo-stream"; url: string; database: string; collections: Record<string, TableConfig>; pollTimeoutMs?: number }
);

export function createConnector(def: ConnectorDef): Connector {
  switch (def.mode) {
    case "batch":
      return createPostgresBatchConnector({ id: def.id, url: def.url, tables: def.tables, pageSize: def.pageSize });
    case "rest-api":
      return createRestApiBatchConnector({ id: def.id, endpoints: def.endpoints, auth: def.auth, rateLimitMs: def.rateLimitMs, pageSize: def.pageSize });
    case "cdc":
      return createPostgresCdcConnector({
        id: def.id,
        url: def.url,
        publication: def.publication,
        slot: def.slot,
        tables: def.tables,
        pollTimeoutMs: def.pollTimeoutMs,
      });
    case "mongo-stream":
      return createMongoStreamConnector({
        id: def.id,
        url: def.url,
        database: def.database,
        collections: def.collections,
        pollTimeoutMs: def.pollTimeoutMs,
      });
  }
}
