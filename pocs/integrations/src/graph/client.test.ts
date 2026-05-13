import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createGraphClient, GraphApiError, type GraphClientConfig } from "./client.js";
import { namespace } from "../transform/pipeline.js";
import type { SourceProvenance } from "./types.js";

const T = namespace("https://hash.ai/@test/types");

type RequestLog = { method: string; path: string; headers: Record<string, string>; body: unknown };

function startMockServer(): Promise<{ port: number; requests: RequestLog[]; close(): Promise<void>; nextStatus: (s: number) => void }> {
  const requests: RequestLog[] = [];
  let overrideStatus: number | undefined;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
    requests.push({ method: req.method!, path: req.url!, headers, body });

    const status = overrideStatus ?? 200;
    overrideStatus = undefined;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ metadata: { recordId: { entityId: "test-id", editionId: "ed-1" } } }));
  });

  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        port,
        requests,
        close: () => new Promise<void>((r) => server.close(() => r())),
        nextStatus: (s: number) => { overrideStatus = s; },
      });
    });
  });
}

describe("createGraphClient", () => {
  let mock: Awaited<ReturnType<typeof startMockServer>>;
  let config: GraphClientConfig;
  const prov: SourceProvenance = { type: "integration", loadedAt: "2026-01-01T00:00:00Z", location: { name: "test" } };

  beforeEach(async () => {
    mock = await startMockServer();
    config = { baseUrl: `http://localhost:${mock.port}`, actorId: "actor-uuid" };
  });

  it("upsert sends POST /entities with correct shape", async () => {
    const client = createGraphClient(config);
    await client.upsertEntity({
      kind: "upsert", namespace: "test-connector",
      entityType: T.entity("user/v/1"),
      entityId: "u-1",
      webId: "web-1",
      properties: { [T.property("email/v/1")]: "a@example.com" },
      links: [], staleLinks: [],
      provenance: prov,
    });
    await mock.close();

    assert.equal(mock.requests.length, 1);
    const req = mock.requests[0];
    assert.equal(req.method, "POST");
    assert.equal(req.path, "/entities");
    assert.equal(req.headers["x-authenticated-user-actor-id"], "actor-uuid");

    const body = req.body as Record<string, unknown>;
    assert.equal(body.webId, "web-1");
    assert.equal(body.draft, false);
    assert.deepEqual(body.entityTypeIds, [T.entity("user/v/1")]);
    assert.ok(typeof body.entityUuid === "string" && body.entityUuid.includes("-"));

    const props = (body.properties as { value: Record<string, { value: unknown }> }).value;
    assert.equal(props[T.property("email/")].value, "a@example.com");

    const provOut = body.provenance as { actorType: string; origin: { type: string }; sources: unknown[] };
    assert.equal(provOut.actorType, "machine");
    assert.equal(provOut.origin.type, "api");
    assert.equal(provOut.sources.length, 1);
  });

  it("upsert falls back to PATCH on 409 conflict", async () => {
    mock.nextStatus(409);
    const client = createGraphClient(config);
    await client.upsertEntity({
      kind: "upsert", namespace: "test-connector",
      entityType: T.entity("user/v/1"),
      entityId: "u-1",
      webId: "web-1",
      properties: { [T.property("email/v/1")]: "b@example.com" },
      links: [], staleLinks: [],
      provenance: prov,
    });
    await mock.close();

    assert.equal(mock.requests.length, 2);
    assert.equal(mock.requests[0].method, "POST");
    assert.equal(mock.requests[1].method, "PATCH");

    const patchBody = mock.requests[1].body as Record<string, unknown>;
    assert.ok(typeof patchBody.entityId === "string");
    assert.equal(patchBody.archived, false);
    assert.ok(Array.isArray(patchBody.properties));
    const patches = patchBody.properties as { op: string; path: string[]; property: { value: unknown } }[];
    assert.equal(patches[0].op, "add");
    assert.deepEqual(patches[0].path, [T.property("email/")]);
    assert.equal(patches[0].property.value, "b@example.com");
  });

  it("upsert creates link entities", async () => {
    const client = createGraphClient(config);
    await client.upsertEntity({
      kind: "upsert", namespace: "test-connector",
      entityType: T.entity("user/v/1"),
      entityId: "u-1",
      webId: "web-1",
      properties: {},
      links: [{ linkType: T.link("is-member-of/v/1"), targetEntityType: T.entity("org/v/1"), targetId: "org-1" }],
      staleLinks: [],
      provenance: prov,
    });
    await mock.close();

    assert.equal(mock.requests.length, 2);
    const linkReq = mock.requests[1];
    assert.equal(linkReq.method, "POST");

    const body = linkReq.body as Record<string, unknown>;
    assert.deepEqual(body.entityTypeIds, [T.link("is-member-of/v/1")]);
    assert.ok(body.linkData);
    const ld = body.linkData as { leftEntityId: string; rightEntityId: string };
    assert.ok(ld.leftEntityId.startsWith("web-1~"));
    assert.ok(ld.rightEntityId.startsWith("web-1~"));
  });

  it("archive sends PATCH with archived: true", async () => {
    const client = createGraphClient(config);
    await client.archiveEntity({
      kind: "archive", namespace: "test-connector",
      entityType: T.entity("user/v/1"),
      entityId: "u-1",
      webId: "web-1",
      provenance: prov,
    });
    await mock.close();

    assert.equal(mock.requests.length, 1);
    assert.equal(mock.requests[0].method, "PATCH");
    const body = mock.requests[0].body as Record<string, unknown>;
    assert.equal(body.archived, true);
    assert.ok(typeof body.entityId === "string");
  });

  it("archive swallows 404 for non-existent entities", async () => {
    mock.nextStatus(404);
    const client = createGraphClient(config);
    await client.archiveEntity({
      kind: "archive", namespace: "test-connector",
      entityType: T.entity("user/v/1"),
      entityId: "gone",
      webId: "web-1",
      provenance: prov,
    });
    await mock.close();
    assert.equal(mock.requests.length, 1);
  });

  it("throws GraphApiError on non-409 failure", async () => {
    mock.nextStatus(500);
    const client = createGraphClient(config);
    await assert.rejects(
      () => client.upsertEntity({
        kind: "upsert", namespace: "test-connector", entityType: T.entity("x/v/1"), entityId: "1",
        webId: "w", properties: {}, links: [], staleLinks: [], provenance: prov,
      }),
      (err: unknown) => err instanceof GraphApiError && err.status === 500,
    );
    await mock.close();
  });

  it("embeds per-property provenance in POST body", async () => {
    const client = createGraphClient(config);
    await client.upsertEntity({
      kind: "upsert", namespace: "test-connector",
      entityType: T.entity("user/v/1"),
      entityId: "u-1",
      webId: "web-1",
      properties: {
        [T.property("email/v/1")]: "a@example.com",
        [T.property("city/v/1")]: "NYC",
      },
      propertyProvenance: {
        [T.property("email/v/1")]: { sources: [prov] },
        [T.property("city/v/1")]: { sources: [prov] },
      },
      links: [], staleLinks: [],
      provenance: prov,
    });
    await mock.close();

    const body = mock.requests[0].body as Record<string, unknown>;
    const props = (body.properties as { value: Record<string, { metadata: { provenance?: { sources: unknown[] } } }> }).value;
    assert.ok(props[T.property("email/")].metadata.provenance);
    assert.equal(props[T.property("email/")].metadata.provenance!.sources.length, 1);
    assert.ok(props[T.property("city/")].metadata.provenance);
    const editionProv = body.provenance as { sources: unknown[] };
    assert.equal(editionProv.sources.length, 1);
  });

  it("embeds per-link-property provenance on link POST body", async () => {
    const client = createGraphClient(config);
    await client.upsertEntity({
      kind: "upsert", namespace: "test-connector",
      entityType: T.entity("user/v/1"),
      entityId: "u-1",
      webId: "web-1",
      properties: {},
      links: [{
        linkType: T.link("is-member-of/v/1"),
        targetEntityType: T.entity("org/v/1"),
        targetId: "org-1",
        properties: { [T.property("role/v/1")]: "admin" },
        propertyProvenance: { [T.property("role/v/1")]: { sources: [prov] } },
      }],
      staleLinks: [],
      provenance: prov,
    });
    await mock.close();

    const linkBody = mock.requests[1].body as Record<string, unknown>;
    const props = (linkBody.properties as { value: Record<string, { metadata: { provenance?: { sources: unknown[] } } }> }).value;
    assert.ok(props[T.property("role/")].metadata.provenance);
  });

  it("omits metadata.provenance when propertyProvenance is absent", async () => {
    const client = createGraphClient(config);
    await client.upsertEntity({
      kind: "upsert", namespace: "test-connector",
      entityType: T.entity("user/v/1"),
      entityId: "u-1",
      webId: "web-1",
      properties: { [T.property("email/v/1")]: "a@example.com" },
      links: [], staleLinks: [],
      provenance: prov,
    });
    await mock.close();

    const props = ((mock.requests[0].body as { properties: { value: Record<string, { metadata: { provenance?: unknown } }> } }).properties).value;
    assert.equal(props[T.property("email/")].metadata.provenance, undefined);
  });

  it("deterministic UUIDs are stable across calls", async () => {
    const client = createGraphClient(config);
    await client.upsertEntity({
      kind: "upsert", namespace: "test-connector", entityType: T.entity("user/v/1"), entityId: "u-1",
      webId: "web-1", properties: {}, links: [], staleLinks: [], provenance: prov,
    });
    await client.upsertEntity({
      kind: "upsert", namespace: "test-connector", entityType: T.entity("user/v/1"), entityId: "u-1",
      webId: "web-1", properties: {}, links: [], staleLinks: [], provenance: prov,
    });
    await mock.close();

    const uuid1 = (mock.requests[0].body as { entityUuid: string }).entityUuid;
    const uuid2 = (mock.requests[1].body as { entityUuid: string }).entityUuid;
    assert.equal(uuid1, uuid2);
  });
});
