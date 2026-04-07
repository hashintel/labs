import type { Connector, TableConfig } from "./types.js";
import { createPostgresConnector, type PostgresTableConfig } from "./postgres.js";
import { createPostgresCdcConnector } from "./postgres-cdc.js";
import { createMongoConnector, type MongoCollectionConfig } from "./mongodb.js";
import { createMongoStreamConnector, type MongoStreamConfig } from "./mongodb-stream.js";

export type ConnectorDef = { id: string } & (
  | { mode: "watermark"; url: string; tables: Record<string, PostgresTableConfig> }
  | { mode: "cdc"; url: string; publication: string; slot: string; tables: Record<string, TableConfig>; pollTimeoutMs?: number }
  | { mode: "mongo"; url: string; database: string; collections: Record<string, MongoCollectionConfig> }
  | { mode: "mongo-stream"; url: string; database: string; collections: Record<string, TableConfig>; pollTimeoutMs?: number }
);

export function createConnector(def: ConnectorDef): Connector {
  switch (def.mode) {
    case "watermark":
      return createPostgresConnector({ id: def.id, url: def.url, tables: def.tables });
    case "cdc":
      return createPostgresCdcConnector({
        id: def.id,
        url: def.url,
        publication: def.publication,
        slot: def.slot,
        tables: def.tables,
        pollTimeoutMs: def.pollTimeoutMs,
      });
    case "mongo":
      return createMongoConnector({
        id: def.id,
        url: def.url,
        database: def.database,
        collections: def.collections,
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
