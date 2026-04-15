import { MongoClient, type ChangeStream, type ChangeStreamDocument, type ChangeStreamInsertDocument, type ChangeStreamUpdateDocument, type ChangeStreamReplaceDocument, type ChangeStreamDeleteDocument, type Document, type ResumeToken } from "mongodb";
import type { BatchHandler, ChangeEvent, ChangeOp, Connector, KeyExtractor, Subscription, TableConfig, ColumnInfo } from "./types.js";
import { compileKeyExtractor } from "./types.js";

export type MongoStreamConfig = {
  id: string;
  url: string;
  database: string;
  collections: Record<string, TableConfig>;
  pollTimeoutMs?: number;
};

function serializeDoc(doc: Document): Record<string, unknown> {
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

type DmlChange =
  | ChangeStreamInsertDocument
  | ChangeStreamUpdateDocument
  | ChangeStreamReplaceDocument
  | ChangeStreamDeleteDocument;

const OP_MAP: Record<string, ChangeOp | undefined> = {
  insert: "insert",
  update: "update",
  replace: "update",
  delete: "delete",
};

function isDml(change: ChangeStreamDocument): change is DmlChange {
  return change.operationType in OP_MAP;
}

function toChangeEvent(change: DmlChange, keyFrom: KeyExtractor): ChangeEvent {
  const op = OP_MAP[change.operationType]!;
  const coll = change.ns.coll;

  if (change.operationType === "delete") {
    return { table: coll, op: "delete", key: change.documentKey ? serializeDoc(change.documentKey) : {}, row: null };
  }

  const fullDoc = change.fullDocument;
  if (!fullDoc) return { table: coll, op, key: {}, row: {} };
  const row = serializeDoc(fullDoc);
  return { table: coll, op, key: keyFrom(row), row };
}

export function createMongoStreamConnector(config: MongoStreamConfig): Connector {
  const client = new MongoClient(config.url);
  const db = client.db(config.database);
  const timeoutMs = config.pollTimeoutMs ?? 5000;

  return {
    id: config.id,
    mode: "stream",

    async introspect() {
      await client.connect();
      const result: Record<string, TableConfig> = {};
      for (const [name, tc] of Object.entries(config.collections)) {
        const sample = await db.collection(name).findOne();
        const columns: ColumnInfo[] = [];
        if (sample) {
          for (const [k, v] of Object.entries(sample)) {
            const isJson = typeof v === "object" && v !== null && !("_bsontype" in v);
            columns.push({ name: k, type: isJson ? "json" : typeof v, nullable: true, kind: isJson ? "json" : "scalar" });
          }
        }
        result[name] = { primaryKey: tc.primaryKey, foreignKeys: tc.foreignKeys, columns };
      }
      return result;
    },

    async subscribe(collection: string, cursor: unknown, onBatch: BatchHandler): Promise<Subscription> {
      await client.connect();
      const tc = config.collections[collection];
      if (!tc) throw new Error(`Collection "${collection}" not configured on connector "${config.id}"`);

      const keyFrom = compileKeyExtractor(tc.primaryKey);
      let resumeToken = cursor as ResumeToken | undefined;

      const stream: ChangeStream = db.watch([{ $match: { "ns.coll": collection } }], {
        resumeAfter: resumeToken ?? undefined,
        fullDocument: "updateLookup",
      });

      (async () => {
        for await (const change of stream) {
          resumeToken = change._id;
          if (isDml(change)) await onBatch({ events: [toChangeEvent(change, keyFrom)], cursor: resumeToken });
        }
      })();

      return {
        async stop() {
          await stream.close();
          await client.close();
        },
      };
    },

    async close() {
      await client.close();
    },
  };
}
