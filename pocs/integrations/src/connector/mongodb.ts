import { MongoClient, type Collection, type Document, type Filter, type Sort } from "mongodb";
import type { ChangeEvent, Connector, PullResult, TableConfig, ColumnInfo } from "./types.js";
import { extractKey } from "./types.js";

export type MongoCollectionConfig = TableConfig & {
  watermark?: string;
  filter?: Filter<Document>;
  projection?: Document;
};

export type MongoConnectorConfig = {
  id: string;
  url: string;
  database: string;
  collections: Record<string, MongoCollectionConfig>;
  pollIntervalMs?: number;
};

export function createMongoConnector(config: MongoConnectorConfig): Connector {
  const client = new MongoClient(config.url);
  const db = client.db(config.database);

  function serialize(doc: Document): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(doc)) {
      if (v != null && typeof v === "object" && "_bsontype" in v) {
        row[k] = v.toString();
      } else {
        row[k] = v;
      }
    }
    return row;
  }

  return {
    id: config.id,
    mode: "poll" as const,
    pollIntervalMs: config.pollIntervalMs,

    async introspect() {
      await client.connect();
      const result: Record<string, TableConfig> = {};

      for (const [name, cc] of Object.entries(config.collections)) {
        const coll = db.collection(name);
        const sample = await coll.findOne({}, { projection: cc.projection });
        const columns: ColumnInfo[] = [];

        if (sample) {
          for (const [k, v] of Object.entries(sample)) {
            const isJson = typeof v === "object" && v !== null && !("_bsontype" in v);
            columns.push({
              name: k,
              type: isJson ? "json" : typeof v,
              nullable: true,
              kind: isJson ? "json" : "scalar",
            });
          }
        }

        result[name] = {
          primaryKey: cc.primaryKey,
          foreignKeys: cc.foreignKeys,
          columns,
        };
      }

      return result;
    },

    async pull(collection: string, cursor: unknown): Promise<PullResult> {
      await client.connect();
      const cc = config.collections[collection];
      if (!cc) throw new Error(`Collection "${collection}" not configured on connector "${config.id}"`);

      const coll = db.collection(collection);
      const pk = Array.isArray(cc.primaryKey) ? cc.primaryKey : [cc.primaryKey];

      const filter: Filter<Document> = { ...cc.filter };

      if (cc.watermark && cursor != null) {
        filter[cc.watermark] = { $gt: cursor };
      }

      const docs = await coll.find(filter, {
        projection: cc.projection,
        sort: cc.watermark ? { [cc.watermark]: 1 } as Sort : undefined,
      }).toArray();

      const isSnapshot = cursor == null;
      const events: ChangeEvent[] = docs.map((doc) => {
        const row = serialize(doc);
        return {
          table: collection,
          op: isSnapshot ? "snapshot" : "upsert",
          key: extractKey(row, pk),
          row,
        };
      });

      let newCursor = cursor;
      if (cc.watermark && docs.length > 0) {
        const lastDoc = docs[docs.length - 1];
        const wmVal = lastDoc[cc.watermark];
        newCursor = wmVal != null && typeof wmVal === "object" && "_bsontype" in wmVal
          ? wmVal.toString()
          : wmVal;
      }

      return { events, cursor: newCursor };
    },

    async close() {
      await client.close();
    },
  };
}
