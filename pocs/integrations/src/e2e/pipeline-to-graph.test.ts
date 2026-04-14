import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import sql from "sql-template-tag";
import { createMemoryEventStore } from "../staging/memory.js";
import { createDuckDbQueryStore } from "../staging/duckdb.js";
import { createGraphClient, type GraphClientConfig } from "../graph/client.js";
import { pipe, sqlStep, graphSinkStep, namespace, type SideEffectHandler } from "../transform/pipeline.js";
import { validatePipeline, runPipeline } from "../transform/run.js";
import { processGraphSink, archiveDeletes } from "../graph/sink.js";
import type { ChangeEvent } from "../connector/types.js";
import type { QueryableStore } from "../staging/types.js";

const T = namespace("https://hash.ai/@test/types");

type RequestLog = { method: string; path: string; body: Record<string, unknown> };

function startGraphServer(): Promise<{ port: number; requests: RequestLog[]; close(): Promise<void> }> {
  const requests: RequestLog[] = [];

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ method: req.method!, path: req.url!, body });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ metadata: { recordId: { entityId: "e-1", editionId: "ed-1" } } }));
  });

  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        port,
        requests,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function userEvents(): ChangeEvent[] {
  return [
    { table: "users", op: "insert", key: { id: 1 }, row: { id: "1", email: "ALICE@example.com ", first_name: "Alice", last_name: "Smith", city: "NYC", org_id: "org-1" } },
    { table: "users", op: "insert", key: { id: 2 }, row: { id: "2", email: " bob@example.com", first_name: "Bob", last_name: "Jones", city: "LA", org_id: "org-2" } },
  ];
}

const pipeline = pipe("test/users",
  sqlStep({
    id: "clean",
    query: sql`SELECT *, TRIM(first_name || ' ' || last_name) AS full_name FROM input`,
  }),
  sqlStep({
    id: "normalize",
    query: sql`SELECT _op, _key, id AS userId, LOWER(TRIM(email)) AS email, full_name AS displayName, city, org_id AS orgId FROM input`,
  }),
  graphSinkStep({
    id: "write-users",
    entityType: T.entity("user/v/1"),
    entityId: "userId",
    webId: "web-test",
    properties: {
      [T.property("email/v/1")]: "email",
      [T.property("display-name/v/1")]: "displayName",
      [T.property("city/v/1")]: "city",
    },
    links: [{
      column: "orgId",
      linkType: T.link("is-member-of/v/1"),
      targetEntityType: T.entity("organization/v/1"),
    }],
    provenance: { location: { name: "e2e-test" } },
  }),
);

describe("e2e: events to pipeline to graph", () => {
  let graphServer: Awaited<ReturnType<typeof startGraphServer>>;
  let queryStore: QueryableStore;

  beforeEach(async () => {
    graphServer = await startGraphServer();
    queryStore = await createDuckDbQueryStore();
  });

  afterEach(async () => {
    queryStore.close();
    await graphServer.close();
  });

  function buildSideEffectHandler(): SideEffectHandler {
    const config: GraphClientConfig = { baseUrl: `http://localhost:${graphServer.port}`, actorId: "test-actor" };
    const client = createGraphClient(config);
    return async (step, table) => {
      if (step.kind === "graph-sink") {
        await processGraphSink(step.config, table, queryStore, client);
      }
    };
  }

  async function runE2E(events: ChangeEvent[]): Promise<RequestLog[]> {
    const eventStore = createMemoryEventStore();

    await eventStore.append("test", "users", events);
    const { events: stored, nextSeq } = await eventStore.read("test", "users");
    await queryStore.materialize("test", "users", stored);
    eventStore.trim("test", "users", nextSeq);

    await validatePipeline(pipeline, queryStore);
    await runPipeline(pipeline, queryStore, undefined, buildSideEffectHandler());

    return graphServer.requests;
  }

  function propsOf(req: RequestLog): Record<string, unknown> {
    const wrapped = (req.body.properties as { value: Record<string, { value: unknown }> }).value;
    return Object.fromEntries(Object.entries(wrapped).map(([k, v]) => [k, v.value]));
  }

  it("inserts flow through pipeline and produce graph upserts", async () => {
    const requests = await runE2E(userEvents());

    assert.equal(requests.length, 4);

    const user1 = requests[0];
    assert.equal(user1.method, "POST");
    assert.equal(user1.path, "/entities");
    assert.deepEqual(user1.body.entityTypeIds, [T.entity("user/v/1")]);
    assert.equal(user1.body.webId, "web-test");
    assert.equal(user1.body.draft, false);

    const p1 = propsOf(user1);
    assert.equal(p1[T.property("email/")], "alice@example.com");
    assert.equal(p1[T.property("display-name/")], "Alice Smith");
    assert.equal(p1[T.property("city/")], "NYC");

    const link1 = requests[1];
    assert.equal(link1.method, "POST");
    assert.deepEqual(link1.body.entityTypeIds, [T.link("is-member-of/v/1")]);
    assert.ok(link1.body.linkData);

    const p2 = propsOf(requests[2]);
    assert.equal(p2[T.property("email/")], "bob@example.com");
    assert.equal(p2[T.property("display-name/")], "Bob Jones");

    for (const req of requests) {
      const prov = req.body.provenance as { actorType: string; origin: { type: string }; sources: { type: string; location: { name: string } }[] };
      assert.equal(prov.actorType, "machine");
      assert.equal(prov.origin.type, "api");
      assert.equal(prov.sources[0].type, "integration");
      assert.equal(prov.sources[0].location.name, "e2e-test");
    }
  });

  it("deletes bypass pipeline and produce graph archives", async () => {
    const deletes: ChangeEvent[] = [
      { table: "users", op: "delete", key: { id: 1 }, row: null },
    ];
    const sinkConfig = pipeline.steps.find((s) => s.kind === "graph-sink")!;
    if (sinkConfig.kind !== "graph-sink") throw new Error("unreachable");

    const config: GraphClientConfig = { baseUrl: `http://localhost:${graphServer.port}`, actorId: "test-actor" };
    const client = createGraphClient(config);

    await archiveDeletes(deletes, sinkConfig.config, client);

    const archiveReq = graphServer.requests.find((r) => r.method === "PATCH");
    assert.ok(archiveReq, "expected a PATCH request for archive");
    assert.equal(archiveReq.body.archived, true);
  });

  it("updates produce graph upserts (idempotent)", async () => {
    const events: ChangeEvent[] = [
      { table: "users", op: "insert", key: { id: 1 }, row: { id: "1", email: "alice@example.com", first_name: "Alice", last_name: "Smith", city: "NYC", org_id: "org-1" } },
      { table: "users", op: "update", key: { id: 1 }, row: { id: "1", email: "alice.new@example.com", first_name: "Alice", last_name: "Smith", city: "SF", org_id: "org-1" } },
    ];
    const requests = await runE2E(events);

    const entityPosts = requests.filter((r) => !r.body.linkData);
    assert.equal(entityPosts.length, 2);
    assert.equal(entityPosts[0].method, "POST");
    assert.equal(entityPosts[1].method, "POST");

    const p2 = propsOf(entityPosts[1]);
    assert.equal(p2[T.property("email/")], "alice.new@example.com");
    assert.equal(p2[T.property("city/")], "SF");
  });

  it("SQL transforms are applied (LOWER, TRIM, aliasing)", async () => {
    const events: ChangeEvent[] = [
      { table: "users", op: "insert", key: { id: 1 }, row: { id: "1", email: "  UPPER@EXAMPLE.COM  ", first_name: " Spaced ", last_name: "Name  ", city: "Boston", org_id: "org-1" } },
    ];
    const requests = await runE2E(events);

    const p = propsOf(requests[0]);
    assert.equal(p[T.property("email/")], "upper@example.com");
    assert.equal(p[T.property("display-name/")], "Spaced  Name");
  });

  it("null link columns are skipped", async () => {
    const events: ChangeEvent[] = [
      { table: "users", op: "insert", key: { id: 1 }, row: { id: "1", email: "a@b.com", first_name: "A", last_name: "B", city: "X", org_id: null } },
    ];
    const requests = await runE2E(events);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "POST");
    assert.ok(!requests[0].body.linkData);
  });

  it("graph-sink mid-pipeline passes data through to downstream steps", async () => {
    const midPipeline = pipe("test/users",
      sqlStep({ id: "add-col", query: sql`SELECT _op, _key, id, email, 'injected' AS marker FROM input` }),
      graphSinkStep({
        id: "mid-sink",
        entityType: T.entity("user/v/1"),
        entityId: "id",
        webId: "web-test",
        properties: { [T.property("email/v/1")]: "email" },
        provenance: { location: { name: "mid-test" } },
      }),
      sqlStep({ id: "post-sink", query: sql`SELECT _op, _key, id, email, marker, 'after' AS phase FROM input` }),
    );

    const eventStore = createMemoryEventStore();
    await eventStore.append("test", "users", userEvents());
    const { events: stored, nextSeq } = await eventStore.read("test", "users");
    await queryStore.materialize("test", "users", stored);
    eventStore.trim("test", "users", nextSeq);

    const outputTable = await runPipeline(midPipeline, queryStore, undefined, buildSideEffectHandler());

    assert.ok(graphServer.requests.length > 0, "graph sink should have fired");

    const { rows } = await queryStore.query(`SELECT * FROM "${outputTable}"`);
    assert.ok(rows.length > 0, "downstream step should produce rows");
    assert.equal(rows[0].marker, "injected", "columns from pre-sink step should be available");
    assert.equal(rows[0].phase, "after", "post-sink step should have added its column");
  });

  it("validation catches missing columns", async () => {
    const badPipeline = pipe("test/users",
      sqlStep({ id: "drop-cols", query: sql`SELECT _op, _key, id FROM input` }),
      graphSinkStep({
        id: "write",
        entityType: T.entity("user/v/1"),
        entityId: "nonexistent",
        webId: "w",
        properties: {},
      }),
    );

    const eventStore = createMemoryEventStore();
    await eventStore.append("test", "users", userEvents());
    const { events } = await eventStore.read("test", "users");
    await queryStore.materialize("test", "users", events);

    await assert.rejects(
      () => validatePipeline(badPipeline, queryStore),
      (err: Error) => err.message.includes("nonexistent"),
    );
  });
});
