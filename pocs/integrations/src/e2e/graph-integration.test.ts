/**
 * Integration tests against a live HASH graph instance.
 * Requires seed-graph.ts run first, with env vars:
 *   HASH_GRAPH_URL, HASH_ACTOR_ID, HASH_WEB_ID, HASH_TYPE_BASE
 * Skips if HASH_GRAPH_URL is not set.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import sql from "sql-template-tag";
import { createGraphClient, queryEntities, type GraphClientConfig, type GraphEntity } from "../graph/client.js";
import { createMemoryEventStore } from "../staging/memory.js";
import { createDuckDbQueryStore } from "../staging/duckdb.js";
import { pipe, sqlStep, graphSinkStep, namespace, type SideEffectHandler } from "../transform/pipeline.js";
import { runPipeline } from "../transform/run.js";
import { processGraphSink } from "../graph/sink.js";
import type { ChangeEvent } from "../connector/types.js";
import type { QueryableStore } from "../staging/types.js";
import type { GraphClient, SourceProvenance } from "../graph/types.js";

const GRAPH_URL = process.env.HASH_GRAPH_URL;
const ACTOR_ID = process.env.HASH_ACTOR_ID;
const WEB_ID = process.env.HASH_WEB_ID;
const TYPE_BASE = process.env.HASH_TYPE_BASE;

const skip = !GRAPH_URL || !ACTOR_ID || !WEB_ID || !TYPE_BASE;
if (skip) console.log("[graph-integration] skipping — set HASH_GRAPH_URL, HASH_ACTOR_ID, HASH_WEB_ID, HASH_TYPE_BASE");

const T = skip ? namespace("unused") : namespace(TYPE_BASE!);

function graphConfig(): GraphClientConfig {
  return { baseUrl: GRAPH_URL!, actorId: ACTOR_ID! };
}

const prov: SourceProvenance = { type: "integration", location: { name: "integration-test" }, loadedAt: new Date().toISOString() };

function entitiesOfType(entities: GraphEntity[], typeUrl: string): GraphEntity[] {
  return entities.filter((e) => e.metadata.entityTypeIds.includes(typeUrl) && !e.metadata.archived);
}

function findByProp(entities: GraphEntity[], propBaseUrl: string, value: unknown): GraphEntity | undefined {
  return entities.find((e) => !e.metadata.archived && e.properties[propBaseUrl] === value);
}

describe("graph integration", { skip }, () => {
  let client: GraphClient;
  let config: GraphClientConfig;

  before(() => {
    config = graphConfig();
    client = createGraphClient(config);
  });

  describe("direct client operations", () => {
    it("creates an entity and reads it back", async () => {
      await client.upsertEntity({
        kind: "upsert",
        entityType: T.entity("organization/v/1"),
        entityId: "int-org-1",
        webId: WEB_ID!,
        properties: {},
        links: [],
        provenance: prov,
      });

      const all = await queryEntities(config);
      const orgs = entitiesOfType(all, T.entity("organization/v/1"));
      assert.ok(orgs.length >= 1, "at least one organization should exist");
    });

    it("creates an entity with properties and verifies round-trip", async () => {
      await client.upsertEntity({
        kind: "upsert",
        entityType: T.entity("user/v/1"),
        entityId: "int-user-props",
        webId: WEB_ID!,
        properties: {
          [T.property("email/v/1")]: "roundtrip@test.com",
          [T.property("display-name/v/1")]: "Round Trip",
          [T.property("city/v/1")]: "Berlin",
        },
        links: [],
        provenance: prov,
      });

      const all = await queryEntities(config);
      const user = findByProp(all, T.property("email/"), "roundtrip@test.com");
      assert.ok(user, "user should exist with correct email");
      assert.equal(user.properties[T.property("display-name/")], "Round Trip");
      assert.equal(user.properties[T.property("city/")], "Berlin");
    });

    it("updates properties via idempotent upsert", async () => {
      await client.upsertEntity({
        kind: "upsert",
        entityType: T.entity("user/v/1"),
        entityId: "int-user-props",
        webId: WEB_ID!,
        properties: {
          [T.property("email/v/1")]: "updated@test.com",
          [T.property("display-name/v/1")]: "Updated",
          [T.property("city/v/1")]: "Munich",
        },
        links: [],
        provenance: prov,
      });

      const all = await queryEntities(config);
      const user = findByProp(all, T.property("email/"), "updated@test.com");
      assert.ok(user, "updated user should exist");
      assert.equal(user.properties[T.property("city/")], "Munich");
    });

    it("creates a link between entities", async () => {
      await client.upsertEntity({
        kind: "upsert",
        entityType: T.entity("user/v/1"),
        entityId: "int-user-linked",
        webId: WEB_ID!,
        properties: {
          [T.property("email/v/1")]: "linked@test.com",
          [T.property("display-name/v/1")]: "Linked",
          [T.property("city/v/1")]: "X",
        },
        links: [{
          linkType: T.link("member-of/v/1"),
          targetEntityType: T.entity("organization/v/1"),
          targetId: "int-org-1",
        }],
        provenance: prov,
      });

      const all = await queryEntities(config);
      const links = entitiesOfType(all, T.link("member-of/v/1")).filter((e) => e.linkData);
      assert.ok(links.length >= 1, "at least one member-of link should exist");

      const link = links[0];
      assert.ok(link.linkData!.leftEntityId.includes(WEB_ID!));
      assert.ok(link.linkData!.rightEntityId.includes(WEB_ID!));
    });

    it("archives an entity", async () => {
      await client.upsertEntity({
        kind: "upsert",
        entityType: T.entity("organization/v/1"),
        entityId: "int-org-to-archive",
        webId: WEB_ID!,
        properties: {},
        links: [],
        provenance: prov,
      });

      await client.archiveEntity({
        kind: "archive",
        entityType: T.entity("organization/v/1"),
        entityId: "int-org-to-archive",
        webId: WEB_ID!,
        provenance: prov,
      });

      const all = await queryEntities(config);
      // The entity may still appear in the query but must be flagged as archived
      const orgs = all.filter((e) => e.metadata.entityTypeIds.includes(T.entity("organization/v/1")));
      const thisOrg = orgs.find((e) => e.metadata.recordId.entityId.includes(WEB_ID!));
      // Either it's gone from the query, or it's marked archived
      const isGoneOrArchived = !thisOrg || thisOrg.metadata.archived;
      assert.ok(isGoneOrArchived, "entity should be archived or absent from query");
    });

    it("carries provenance through to the graph", async () => {
      await client.upsertEntity({
        kind: "upsert",
        entityType: T.entity("organization/v/1"),
        entityId: "int-org-prov",
        webId: WEB_ID!,
        properties: {},
        links: [],
        provenance: { ...prov, location: { name: "provenance-check" } },
      });

      const all = await queryEntities(config);
      const withProv = all.find((e) =>
        e.metadata.provenance.edition.sources?.some((s) => s.location?.name === "provenance-check"),
      );
      assert.ok(withProv, "entity with provenance-check source should exist");
    });
  });

  describe("full pipeline → graph", () => {
    let queryStore: QueryableStore;

    before(async () => {
      queryStore = await createDuckDbQueryStore();
    });

    after(() => {
      queryStore.close();
    });

    function userPipeline(): ReturnType<typeof pipe> {
      return pipe("test/users",
        sqlStep({ id: "clean", query: sql`SELECT *, TRIM(first_name || ' ' || last_name) AS full_name FROM input` }),
        sqlStep({ id: "normalize", query: sql`SELECT _op, _key, id AS userId, LOWER(TRIM(email)) AS email, full_name AS displayName, city, org_id AS orgId FROM input` }),
        graphSinkStep({
          id: "write-users",
          entityType: T.entity("user/v/1"),
          entityId: "userId",
          webId: WEB_ID!,
          properties: {
            [T.property("email/v/1")]: "email",
            [T.property("display-name/v/1")]: "displayName",
            [T.property("city/v/1")]: "city",
          },
          links: [{
            column: "orgId",
            linkType: T.link("member-of/v/1"),
            targetEntityType: T.entity("organization/v/1"),
          }],
          provenance: { location: { name: "pipeline-integration" } },
        }),
      );
    }

    function buildSideEffectHandler(): SideEffectHandler {
      return async (step, table) => {
        if (step.kind === "graph-sink") {
          await processGraphSink(step.config, table, queryStore, client);
        }
      };
    }

    async function materializeAndRun(events: ChangeEvent[], pipeline: ReturnType<typeof pipe>): Promise<void> {
      const eventStore = createMemoryEventStore();
      await eventStore.append("test", "users", events);
      const { events: stored, nextSeq } = await eventStore.read("test", "users");
      await queryStore.materialize("test", "users", stored);
      eventStore.trim("test", "users", nextSeq);

      await runPipeline(pipeline, queryStore, undefined, buildSideEffectHandler());
    }

    it("CDC insert events flow through SQL transforms into the graph", async () => {
      const events: ChangeEvent[] = [
        { table: "users", op: "insert", key: { id: 300 }, row: { id: "300", email: "  PIPELINE@INTEGRATION.COM ", first_name: "Pipeline", last_name: "Int", city: "London", org_id: "int-org-1" } },
      ];

      await materializeAndRun(events, userPipeline());

      const all = await queryEntities(config);
      const user = findByProp(all, T.property("email/"), "pipeline@integration.com");
      assert.ok(user, "pipeline entity should exist in graph");
      assert.equal(user.properties[T.property("display-name/")], "Pipeline Int");
      assert.equal(user.properties[T.property("city/")], "London");

      // Link to org should exist
      const links = entitiesOfType(all, T.link("member-of/v/1")).filter((e) => e.linkData);
      assert.ok(links.length >= 1, "pipeline should have created a link");

      // Provenance should carry through
      const sources = user.metadata.provenance.edition.sources;
      assert.ok(sources?.some((s) => s.location?.name === "pipeline-integration"));
    });

    it("CDC delete events archive entities in the graph", async () => {
      // Insert
      const inserts: ChangeEvent[] = [
        { table: "users", op: "insert", key: { id: 400 }, row: { id: "400", email: "to-delete@pipeline.com", first_name: "Del", last_name: "Ete", city: "Gone", org_id: null } },
      ];
      const noLinkPipeline = pipe("test/users",
        sqlStep({ id: "clean", query: sql`SELECT *, TRIM(first_name || ' ' || last_name) AS full_name FROM input` }),
        sqlStep({ id: "normalize", query: sql`SELECT _op, _key, id AS userId, LOWER(TRIM(email)) AS email, full_name AS displayName, city, org_id AS orgId FROM input` }),
        graphSinkStep({
          id: "write-users",
          entityType: T.entity("user/v/1"),
          entityId: "userId",
          webId: WEB_ID!,
          properties: {
            [T.property("email/v/1")]: "email",
            [T.property("display-name/v/1")]: "displayName",
            [T.property("city/v/1")]: "city",
          },
          provenance: { location: { name: "delete-integration" } },
        }),
      );

      await materializeAndRun(inserts, noLinkPipeline);

      let all = await queryEntities(config);
      assert.ok(findByProp(all, T.property("email/"), "to-delete@pipeline.com"), "entity should exist before delete");

      // Delete — _key carries userId for identity recovery
      const deletes: ChangeEvent[] = [
        { table: "users", op: "delete", key: { id: 400, userId: "400" }, row: null },
      ];
      await queryStore.materialize("test", "users", deletes);

      await runPipeline(noLinkPipeline, queryStore, undefined, buildSideEffectHandler());

      all = await queryEntities(config);
      assert.ok(!findByProp(all, T.property("email/"), "to-delete@pipeline.com"), "entity should be gone after archive");
    });
  });
});
