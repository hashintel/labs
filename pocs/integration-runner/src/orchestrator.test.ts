import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createInProcessCoordination, createWindowLimiter, type CoordinationStore } from "./orchestrator.js";
import { budgetScope, type SyncInput } from "./sync-workflow.js";

describe("CoordinationStore contract (in-process implementation)", () => {
  // These assertions define what ANY backend's store must do; the PG-backed
  // implementation runs the same suite when DBOS_DATABASE_URL is set (below).
  function contractTests(makeStore: () => CoordinationStore | Promise<CoordinationStore>) {
    it("accumulates op-weighted usage within a window", async () => {
      const store = await makeStore();
      assert.equal(await store.addToWindow("web-1", 1000, 128), 128);
      assert.equal(await store.addToWindow("web-1", 1000, 72), 200);
    });

    it("a new window resets the count; scopes are independent", async () => {
      const store = await makeStore();
      await store.addToWindow("web-1", 1000, 100);
      assert.equal(await store.addToWindow("web-1", 2000, 10), 10);
      assert.equal(await store.addToWindow("web-2", 2000, 5), 5);
    });
  }

  contractTests(() => createInProcessCoordination());
});

// The SAME contract against the PG-backed store; needs a database. Uses unique
// scopes per run so reruns are independent.
describe("CoordinationStore contract (PG implementation)", { skip: !process.env.DBOS_DATABASE_URL }, () => {
  it("accumulates, rolls windows, isolates scopes, and serializes concurrent adds", async () => {
    const { createPgCoordination } = await import("./orchestrate-dbos.js");
    const store = await createPgCoordination(process.env.DBOS_DATABASE_URL!);
    const scope = `contract-${Date.now()}`;

    try {
      assert.equal(await store.addToWindow(scope, 1000, 128), 128);
      assert.equal(await store.addToWindow(scope, 1000, 72), 200);
      assert.equal(await store.addToWindow(scope, 2000, 10), 10);
      assert.equal(await store.addToWindow(`${scope}-other`, 2000, 5), 5);

      // concurrency: 10 parallel op-weighted adds serialize on the row lock
      const results = await Promise.all(
        Array.from({ length: 10 }, () => store.addToWindow(scope, 3000, 10)),
      );
      assert.equal(Math.max(...results), 100);
      assert.equal(new Set(results).size, 10);
    } finally {
      await store.close();
    }
  });
});

describe("createWindowLimiter", () => {
  it("under budget: acquire returns without sleeping", async () => {
    const limiter = createWindowLimiter(createInProcessCoordination(), "web-1", 100);
    const start = Date.now();
    await limiter.acquire(50);
    await limiter.acquire(50);
    assert.ok(Date.now() - start < 100);
  });

  it("over budget: acquire sleeps to the next window (ops already counted)", async () => {
    const limiter = createWindowLimiter(createInProcessCoordination(), "web-1", 10);
    await limiter.acquire(10);
    const start = Date.now();
    await limiter.acquire(1);
    const elapsed = Date.now() - start;
    assert.ok(elapsed > 0 && elapsed <= 1100, `expected a sleep to the window boundary, got ${elapsed}ms`);
  });

  it("holds the cap under concurrency (many parallel chunks do not sum past the budget)", async () => {
    // The regression: 16 concurrent chunks of 128 must not sustain ~2048/s
    // against a 1000/s cap. Release 20 chunks of 10 (200 ops) at cap 50/s and
    // require it to take at least the windows the budget implies (~3s), i.e. the
    // achieved rate stays at/under the cap rather than admitting all at once.
    const limiter = createWindowLimiter(createInProcessCoordination(), "web-1", 50);
    const start = Date.now();
    await Promise.all(Array.from({ length: 20 }, () => limiter.acquire(10)));
    const elapsed = Date.now() - start;
    // 200 ops at 50/s = 4 windows; allow the first window to be "free" => >= ~3s.
    assert.ok(elapsed >= 2900, `expected the cap to spread 200 ops over ~4s, got ${elapsed}ms (over-admitting)`);
  });

  it("an op larger than the whole budget is let through rather than spinning forever", async () => {
    const limiter = createWindowLimiter(createInProcessCoordination(), "web-1", 50);
    const start = Date.now();
    await limiter.acquire(500);
    assert.ok(Date.now() - start < 1100);
  });

  it("fails open to a local window when the store errors, with one warning", async () => {
    let warned = 0;
    const originalWarn = console.warn;
    console.warn = () => { warned++; };
    const broken: CoordinationStore = {
      addToWindow: async () => { throw new Error("pg down"); },
    };
    try {
      const limiter = createWindowLimiter(broken, "web-1", 100);
      await limiter.acquire(10);
      await limiter.acquire(10);
      assert.equal(warned, 1);
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("budgetScope", () => {
  const input = (limits: SyncInput["limits"]): SyncInput =>
    ({
      yaml: { connector: { id: "conn-a", mode: "batch" }, pipelines: { entities: [] } },
      runId: "r", linksOnly: false, logLevel: "info",
      retry: { maxAttempts: 1, intervalSeconds: 1, backoffRate: 2 },
      runtime: { webId: "web-1", baseDir: ".", duckdb: { sandboxOff: true, allowedExtraDirs: [] } },
      limits,
    }) as SyncInput;

  it("an integration override gets its own lane; the web target is the shared pool", () => {
    assert.deepEqual(budgetScope(input({ webOpsPerSec: 500, opsPerSecOverride: 200 })), {
      scope: "web-1:conn-a",
      opsPerSec: 200,
    });
    assert.deepEqual(budgetScope(input({ webOpsPerSec: 500 })), { scope: "web-1", opsPerSec: 500 });
    assert.equal(budgetScope(input({})), undefined);
  });
});
