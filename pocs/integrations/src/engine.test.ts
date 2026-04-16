import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { integrate } from "./engine.js";
import { pipe, sqlStep, graphSinkStep, namespace, type TablePipeline } from "./transform/pipeline.js";
import { createMemoryEventStore } from "./staging/memory.js";
import { createDuckDbQueryStore } from "./staging/duckdb.js";
import type { Connector, BatchConnector } from "./connector/types.js";
import type { ConnectorDef } from "./connector/create.js";
import type { GraphClient, GraphOp } from "./graph/types.js";
import type { QueryableStore } from "./staging/types.js";

const trivialPipeline = (source: string): TablePipeline => ({
  source,
  pipeline: pipe(`test/${source}`, sqlStep({ id: `s-${source}`, query: "SELECT _op, _key, _before FROM input" })),
});

function emptyBatchConnector(id: string): BatchConnector {
  return {
    id,
    mode: "batch",
    pageSize: 100,
    pull: async () => {},
    close: async () => {},
  };
}

function recordingGraphClient(): GraphClient & { ops: GraphOp[] } {
  const ops: GraphOp[] = [];
  return {
    ops,
    async upsertEntity(op) { ops.push(op); },
    async archiveEntity(op) { ops.push(op); },
  };
}

async function seedState(db: QueryableStore, connectorId: string, sinkId: string, ids: string[]): Promise<void> {
  const table = `_state/sync/${connectorId}/${sinkId}`;
  await db.exec(`CREATE OR REPLACE TABLE "${table}" (_entity_id VARCHAR, _content_hash VARCHAR)`);
  for (const id of ids) {
    await db.exec(`INSERT INTO "${table}" VALUES ($1, $2)`, [id, "hash-" + id]);
  }
}

describe("integrate(): runtime validation", () => {
  it("throws when a pipeline source is not declared on the connector", async () => {
    const queryStore = await createDuckDbQueryStore();
    try {
      assert.throws(
        () => integrate({
          connector: { id: "test", mode: "batch", url: "postgres://x", tables: { users: { primaryKey: "id" } } },
          pipelines: [trivialPipeline("users"), trivialPipeline("widgets")],
          eventStore: createMemoryEventStore(),
          queryStore,
        }),
        (err: Error) =>
          err.message.includes(`"widgets"`) &&
          err.message.includes("not declared") &&
          err.message.includes("users"),
      );
    } finally {
      queryStore.close();
    }
  });

  it("throws when pipeline.source doesn't match `${connectorId}/${source}`", async () => {
    const queryStore = await createDuckDbQueryStore();
    try {
      const bad: TablePipeline = {
        source: "users",
        // pipe() starts from the wrong path -- typo in connector id.
        pipeline: pipe("wrong/users", sqlStep({ id: "s", query: "SELECT _op, _key FROM input" })),
      };
      assert.throws(
        () => integrate({
          connector: { id: "test", mode: "batch", url: "postgres://x", tables: { users: { primaryKey: "id" } } },
          pipelines: [bad],
          eventStore: createMemoryEventStore(),
          queryStore,
        }),
        (err: Error) =>
          err.message.includes(`"wrong/users"`) &&
          err.message.includes(`"test/users"`),
      );
    } finally {
      queryStore.close();
    }
  });

  it("accepts matching source + pipeline.source", async () => {
    const queryStore = await createDuckDbQueryStore();
    try {
      assert.doesNotThrow(() =>
        integrate({
          connector: { id: "test", mode: "batch", url: "postgres://x", tables: { users: { primaryKey: "id" } } },
          pipelines: [trivialPipeline("users")],
          eventStore: createMemoryEventStore(),
          queryStore,
        }),
      );
    } finally {
      queryStore.close();
    }
  });

  it("zero-page pull with prior state refuses to archive (no archiveOnEmpty, no partial)", async () => {
    const queryStore = await createDuckDbQueryStore();
    try {
      const T = namespace("https://hash.ai/@test/types");
      const sinkId = "write-users";
      await seedState(queryStore, "test", sinkId, ["u1", "u2"]);

      const client = recordingGraphClient();
      const connector: Connector = emptyBatchConnector("test");
      const def: ConnectorDef = { id: "test", mode: "batch", url: "postgres://ignored", tables: { users: { primaryKey: "id" } } };

      const app = integrate({
        connector: def,
        pipelines: [{
          source: "users",
          pipeline: pipe("test/users",
            sqlStep({ id: "pass", query: "SELECT _op, _key, _before, id FROM input" }),
            graphSinkStep({
              id: sinkId,
              entityType: T.entity("user/v/1"),
              entityId: "id",
              webId: "w",
              properties: {},
            }),
          ),
        }],
        eventStore: createMemoryEventStore(),
        queryStore,
        graphClient: client,
        logLevel: "error",
        connectorFactory: () => connector,
      });

      const result = await app.sync();

      assert.equal(client.ops.length, 0);
      assert.equal(result.deletes, 0);
      assert.equal(result.inserts, 0);
      assert.equal(result.updates, 0);

      const { rows } = await queryStore.query(`SELECT _entity_id FROM "_state/sync/test/${sinkId}" ORDER BY _entity_id`);
      assert.deepEqual(rows.map((r) => r._entity_id), ["u1", "u2"]);
    } finally {
      queryStore.close();
    }
  });

  it("zero-page pull with archiveOnEmpty=true does archive prior state", async () => {
    const queryStore = await createDuckDbQueryStore();
    try {
      const T = namespace("https://hash.ai/@test/types");
      const sinkId = "write-users";
      await seedState(queryStore, "test", sinkId, ["u1", "u2"]);

      const client = recordingGraphClient();
      const connector: Connector = emptyBatchConnector("test");
      const def: ConnectorDef = {
        id: "test", mode: "batch", url: "postgres://ignored",
        tables: { users: { primaryKey: "id", archiveOnEmpty: true } },
      };

      const app = integrate({
        connector: def,
        pipelines: [{
          source: "users",
          pipeline: pipe("test/users",
            sqlStep({ id: "pass", query: "SELECT _op, _key, _before, id FROM input" }),
            graphSinkStep({
              id: sinkId,
              entityType: T.entity("user/v/1"),
              entityId: "id",
              webId: "w",
              properties: {},
            }),
          ),
        }],
        eventStore: createMemoryEventStore(),
        queryStore,
        graphClient: client,
        logLevel: "error",
        connectorFactory: () => connector,
      });

      const result = await app.sync();

      assert.equal(client.ops.length, 2);
      assert.ok(client.ops.every((op) => op.kind === "archive"));
      assert.equal(result.deletes, 2);
    } finally {
      queryStore.close();
    }
  });

  it("zero-page pull with partial=true leaves prior state as unchanged (no archive, no warn)", async () => {
    const queryStore = await createDuckDbQueryStore();
    try {
      const T = namespace("https://hash.ai/@test/types");
      const sinkId = "write-users";
      await seedState(queryStore, "test", sinkId, ["u1", "u2"]);

      const client = recordingGraphClient();
      const connector: Connector = emptyBatchConnector("test");
      const def: ConnectorDef = {
        id: "test", mode: "batch", url: "postgres://ignored",
        tables: { users: { primaryKey: "id", partial: true } },
      };

      const app = integrate({
        connector: def,
        pipelines: [{
          source: "users",
          pipeline: pipe("test/users",
            sqlStep({ id: "pass", query: "SELECT _op, _key, _before, id FROM input" }),
            graphSinkStep({
              id: sinkId,
              entityType: T.entity("user/v/1"),
              entityId: "id",
              webId: "w",
              properties: {},
            }),
          ),
        }],
        eventStore: createMemoryEventStore(),
        queryStore,
        graphClient: client,
        logLevel: "error",
        connectorFactory: () => connector,
      });

      const result = await app.sync();

      assert.equal(client.ops.length, 0);
      assert.equal(result.deletes, 0);
      assert.equal(result.unchanged, 2);
    } finally {
      queryStore.close();
    }
  });

  it("zero-page pull with no prior state is a silent no-op (first sync edge case)", async () => {
    const queryStore = await createDuckDbQueryStore();
    try {
      const T = namespace("https://hash.ai/@test/types");
      const sinkId = "write-users";

      const client = recordingGraphClient();
      const connector: Connector = emptyBatchConnector("test");
      const def: ConnectorDef = { id: "test", mode: "batch", url: "postgres://ignored", tables: { users: { primaryKey: "id" } } };

      const app = integrate({
        connector: def,
        pipelines: [{
          source: "users",
          pipeline: pipe("test/users",
            sqlStep({ id: "pass", query: "SELECT _op, _key, _before, id FROM input" }),
            graphSinkStep({
              id: sinkId,
              entityType: T.entity("user/v/1"),
              entityId: "id",
              webId: "w",
              properties: {},
            }),
          ),
        }],
        eventStore: createMemoryEventStore(),
        queryStore,
        graphClient: client,
        logLevel: "error",
        connectorFactory: () => connector,
      });

      const result = await app.sync();

      assert.equal(client.ops.length, 0);
      assert.equal(result.inserts + result.updates + result.deletes, 0);
    } finally {
      queryStore.close();
    }
  });

  it("validates against endpoints (rest-api) and collections (mongo-stream)", async () => {
    const queryStore = await createDuckDbQueryStore();
    try {
      assert.throws(
        () => integrate({
          connector: {
            id: "api", mode: "rest-api",
            endpoints: { arrivals: { url: "http://x", primaryKey: "id" } },
          },
          pipelines: [{
            source: "departures",
            pipeline: pipe("api/departures", sqlStep({ id: "s", query: "SELECT _op, _key FROM input" })),
          }],
          eventStore: createMemoryEventStore(),
          queryStore,
        }),
        (err: Error) => err.message.includes(`"departures"`) && err.message.includes("arrivals"),
      );

      assert.throws(
        () => integrate({
          connector: {
            id: "mg", mode: "mongo-stream", url: "mongodb://x", database: "d",
            collections: { users: { primaryKey: "_id" } },
          },
          pipelines: [{
            source: "accounts",
            pipeline: pipe("mg/accounts", sqlStep({ id: "s", query: "SELECT _op, _key FROM input" })),
          }],
          eventStore: createMemoryEventStore(),
          queryStore,
        }),
        (err: Error) => err.message.includes(`"accounts"`) && err.message.includes("users"),
      );
    } finally {
      queryStore.close();
    }
  });
});
