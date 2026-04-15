import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createRestApiBatchConnector, interpolate } from "./rest-api.js";
import type { Batch } from "./types.js";

type Handler = (url: URL) => { status: number; body: unknown };

function startServer(handler: Handler): Promise<{ port: number; calls: URL[]; close(): Promise<void>; server: Server }> {
  const calls: URL[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, `http://localhost`);
    calls.push(url);
    const { status, body } = handler(url);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        port,
        calls,
        server,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

async function collect(connector: { pull: (t: string, onPage: (b: Batch) => Promise<void>) => Promise<void> }, table: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  await connector.pull(table, async (page) => { for (const ev of page.events) rows.push(ev.row); });
  return rows;
}

describe("interpolate", () => {
  it("replaces ${NOW} with a minute-truncated ISO 8601 timestamp", () => {
    const out = interpolate("${NOW}");
    assert.match(out, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/, "must truncate seconds and fractional seconds");
    const parsed = new Date(out).getTime();
    assert.ok(Math.abs(parsed - Date.now()) < 60_000);
  });

  it("supports ${NOW+Nh}, ${NOW-Nm}, ${NOW+Nd}", () => {
    const plusOneHour = new Date(interpolate("${NOW+1h}")).getTime();
    const minusThirtyMin = new Date(interpolate("${NOW-30m}")).getTime();
    const plusTwoDays = new Date(interpolate("${NOW+2d}")).getTime();
    const now = Date.now();
    assert.ok(Math.abs(plusOneHour - (now + 3_600_000)) < 60_000);
    assert.ok(Math.abs(minusThirtyMin - (now - 30 * 60_000)) < 60_000);
    assert.ok(Math.abs(plusTwoDays - (now + 2 * 86_400_000)) < 60_000);
  });

  it("replaces ${ENV_VAR} from process.env", () => {
    process.env.REST_API_TEST_TOKEN = "secret-123";
    assert.equal(interpolate("Bearer ${REST_API_TEST_TOKEN}"), "Bearer secret-123");
    delete process.env.REST_API_TEST_TOKEN;
  });

  it("leaves unknown tokens as empty strings", () => {
    assert.equal(interpolate("${NOPE_NOT_SET}"), "");
  });

  it("mixes ENV and NOW in one value", () => {
    process.env.REST_API_TEST_PREFIX = "from-";
    const out = interpolate("${REST_API_TEST_PREFIX}${NOW}");
    assert.match(out, /^from-\d{4}-\d{2}-\d{2}T/);
    delete process.env.REST_API_TEST_PREFIX;
  });
});

describe("rest-api connector", () => {
  let srv: Awaited<ReturnType<typeof startServer>>;
  afterEach(async () => { await srv?.close(); });

  it("passes ${NOW±offset} params through to the HTTP call", async () => {
    srv = await startServer(() => ({ status: 200, body: { items: [{ id: 1 }] } }));

    const connector = createRestApiBatchConnector({
      id: "t",
      endpoints: {
        things: {
          url: `http://localhost:${srv.port}/api/things`,
          primaryKey: "id",
          resultsField: "items",
          params: { start: "${NOW-1h}", end: "${NOW+1h}" },
        },
      },
    });

    await collect(connector, "things");
    const call = srv.calls[0];
    const start = call.searchParams.get("start");
    const end = call.searchParams.get("end");
    assert.ok(start && /^\d{4}-\d{2}-\d{2}T/.test(start), "start should be ISO datetime");
    assert.ok(end && /^\d{4}-\d{2}-\d{2}T/.test(end), "end should be ISO datetime");
    assert.ok(new Date(start).getTime() < new Date(end).getTime(), "start < end");
  });

  it("re-evaluates templates on each pull (not baked at connector creation)", async () => {
    srv = await startServer(() => ({ status: 200, body: { items: [{ id: 1 }] } }));
    const connector = createRestApiBatchConnector({
      id: "t",
      endpoints: {
        things: {
          url: `http://localhost:${srv.port}/api/things`,
          primaryKey: "id", resultsField: "items",
          params: { token: "${REST_API_TEST_ROTATING}" },
        },
      },
    });

    process.env.REST_API_TEST_ROTATING = "v1";
    await collect(connector, "things");
    process.env.REST_API_TEST_ROTATING = "v2";
    await collect(connector, "things");
    delete process.env.REST_API_TEST_ROTATING;

    assert.equal(srv.calls[0].searchParams.get("token"), "v1");
    assert.equal(srv.calls[1].searchParams.get("token"), "v2");
  });

  it("respects maxPages regardless of server next-link", async () => {
    // Server always returns a next link -- connector must stop at maxPages.
    srv = await startServer((url) => {
      const page = Number(url.searchParams.get("page") ?? "1");
      return {
        status: 200,
        body: {
          items: [{ id: page }],
          links: { next: `http://localhost:${srv.port}/api/things?page=${page + 1}` },
        },
      };
    });

    const connector = createRestApiBatchConnector({
      id: "t",
      endpoints: {
        things: {
          url: `http://localhost:${srv.port}/api/things`,
          primaryKey: "id",
          resultsField: "items",
          pagination: { type: "next-link", field: "links.next" },
          maxPages: 2,
        },
      },
    });

    const rows = await collect(connector, "things");
    assert.equal(rows.length, 2);
    assert.equal(srv.calls.length, 2);
  });

  it("handles links: null (no further pages)", async () => {
    srv = await startServer(() => ({
      status: 200,
      body: { items: [{ id: 1 }, { id: 2 }], links: null },
    }));

    const connector = createRestApiBatchConnector({
      id: "t",
      endpoints: {
        things: {
          url: `http://localhost:${srv.port}/api/things`,
          primaryKey: "id",
          resultsField: "items",
          pagination: { type: "next-link", field: "links.next" },
        },
      },
    });

    const rows = await collect(connector, "things");
    assert.equal(rows.length, 2);
    assert.equal(srv.calls.length, 1);
  });
});
