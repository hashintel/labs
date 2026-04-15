import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { integrate } from "./engine.js";
import { pipe, sqlStep, type TablePipeline } from "./transform/pipeline.js";
import { createMemoryEventStore } from "./staging/memory.js";
import { createDuckDbQueryStore } from "./staging/duckdb.js";

const trivialPipeline = (source: string): TablePipeline => ({
  source,
  pipeline: pipe(`test/${source}`, sqlStep({ id: `s-${source}`, query: "SELECT _op, _key FROM input" })),
});

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
