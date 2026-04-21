import { MongoClient, type ChangeStream, type ChangeStreamDocument, type ChangeStreamInsertDocument, type ChangeStreamUpdateDocument, type ChangeStreamReplaceDocument, type ChangeStreamDeleteDocument, type Document, type ResumeToken } from "mongodb";
import type { BatchHandler, ChangeEvent, ChangeOp, Connector, KeyExtractor, Subscription, TableConfig } from "./types.js";
import { compileKeyExtractor } from "./types.js";
import type { Logger } from "../log.js";

export type MongoStreamConfig = {
  id: string;
  url: string;
  database: string;
  collections: Record<string, TableConfig>;
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

export function createMongoStreamConnector(config: MongoStreamConfig, log?: Logger): Connector {
  const client = new MongoClient(config.url);
  const db = client.db(config.database);

  return {
    id: config.id,
    mode: "stream",

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
        try {
          for await (const change of stream) {
            resumeToken = change._id;
            if (isDml(change)) await onBatch({ events: [toChangeEvent(change, keyFrom)], cursor: resumeToken });
          }
        } catch (err) {
          // Without this catch the subscription dies silently on iterator/onBatch throw.
          log?.error(`mongo-stream "${collection}" subscription ended: ${err instanceof Error ? err.message : String(err)}`);
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
