import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { capacityFor, createInProcessCoordination, createTokenLimiter, tokenConsume, type CoordinationStore } from "./orchestrator.js";
import { budgetScope, type SyncInput } from "./sync-workflow.js";

describe("tokenConsume (pure refill+deduct)", () => {
  it("deducts from the bucket and refills over elapsed time, clamped to capacity", () => {
    const s = { tokens: 100, lastMs: 0 };
    assert.equal(tokenConsume(s, 100, 200, 40, 0), 60); // no time -> 100-40
    assert.equal(tokenConsume(s, 100, 200, 0, 500), 110); // +0.5s*100 = +50 -> 110
    // large gap refills but never past capacity
    assert.equal(tokenConsume(s, 100, 200, 0, 100_000), 200);
  });

  it("goes negative (debt) when ops exceed available tokens", () => {
    const s = { tokens: 10, lastMs: 0 };
    assert.equal(tokenConsume(s, 100, 200, 60, 0), -50);
  });
});

describe("CoordinationStore contract (in-process)", () => {
  function contractTests(make: () => CoordinationStore | Promise<CoordinationStore>) {
    it("a fresh scope starts full (initial burst up to capacity)", async () => {
      const store = await make();
      assert.equal(await store.consume("s", 100, 200, 150, 1000), 50); // 200 - 150
    });

    it("refills at the rate and deducts atomically; scopes are independent", async () => {
      const store = await make();
      await store.consume("a", 100, 200, 200, 0); // drain a to 0
      assert.equal(await store.consume("a", 100, 200, 10, 1000), 90); // +100 refill, -10
      assert.equal(await store.consume("b", 100, 200, 5, 1000), 195); // b fresh/full
    });

    it("balance goes into debt under sustained over-rate demand", async () => {
      const store = await make();
      await store.consume("s", 100, 200, 200, 0); // 0
      assert.equal(await store.consume("s", 100, 200, 100, 0), -100); // no refill, -100 debt
    });
  }
  contractTests(() => createInProcessCoordination());

  // Same contract, PG-backed; needs a database. Uses a unique scope per run.
  describe("PG implementation", { skip: !process.env.DBOS_DATABASE_URL }, () => {
    it("refills, deducts, goes into debt, and serializes concurrent consumes on the row lock", async () => {
      const { createPgCoordination } = await import("./orchestrate-dbos.js");
      const store = await createPgCoordination(process.env.DBOS_DATABASE_URL!);
      const scope = `tb-${Date.now()}`;
      try {
        assert.equal(await store.consume(scope, 100, 200, 150, 1000), 50); // fresh: full 200 - 150
        assert.equal(await store.consume(scope, 100, 200, 0, 1500), 100); // +0.5s*100, clamp, -0
        // 10 concurrent 30-op consumes at a drained-ish bucket land distinct balances (row-lock serialized)
        await store.consume(scope, 100, 200, 100, 1500); // -> 0
        const results = await Promise.all(Array.from({ length: 10 }, () => store.consume(scope, 100, 200, 30, 1500)));
        const sorted = [...results].sort((a, b) => b - a);
        assert.equal(sorted[0], -30);
        assert.equal(sorted[9], -300);
        assert.equal(new Set(results).size, 10);
      } finally {
        await store.close();
      }
    });
  });
});

describe("createTokenLimiter", () => {
  it("initial burst up to capacity is admitted without waiting", async () => {
    const limiter = createTokenLimiter(createInProcessCoordination(), "s", 100); // capacity 200
    const start = Date.now();
    await limiter.acquire(100);
    await limiter.acquire(100); // still within the 200 burst
    assert.ok(Date.now() - start < 80, "the initial burst should not sleep");
  });

  it("caps SUSTAINED rate under concurrency (the regression: no N*chunk over-admit)", async () => {
    // rate 50/s, capacity 100. 20 concurrent acquire(10) = 200 ops. First 100
    // (the burst) are free; the remaining 100 must be paced at 50/s => ~2s.
    const limiter = createTokenLimiter(createInProcessCoordination(), "s", 50);
    const start = Date.now();
    await Promise.all(Array.from({ length: 20 }, () => limiter.acquire(10)));
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 1800, `expected ~2s of pacing for 100 over-budget ops at 50/s, got ${elapsed}ms`);
    assert.ok(elapsed <= 3500, `should not massively overshoot the pacing, got ${elapsed}ms`);
  });

  it("an op larger than the whole capacity is let through after a proportional wait, never spins", async () => {
    const limiter = createTokenLimiter(createInProcessCoordination(), "s", 100); // capacity 200
    const start = Date.now();
    await limiter.acquire(300); // 200 - 300 = -100 debt => wait 100/100 = 1s
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 900 && elapsed <= 1600, `expected ~1s proportional wait, got ${elapsed}ms`);
  });

  it("fails open to a local bucket when the store errors, with one warning", async () => {
    let warned = 0;
    const originalWarn = console.warn;
    console.warn = () => { warned++; };
    const broken: CoordinationStore = { consume: async () => { throw new Error("pg down"); } };
    try {
      const limiter = createTokenLimiter(broken, "s", 100);
      await limiter.acquire(10);
      await limiter.acquire(10);
      assert.equal(warned, 1);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("capacityFor is 2x the rate (burst allowance, not a knob)", () => {
    assert.equal(capacityFor(1000), 2000);
    assert.equal(capacityFor(50), 100);
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

  it("always scopes to the web; a per-web override just changes that web's rate", () => {
    assert.deepEqual(budgetScope(input({ webOpsPerSec: 500, opsPerSecOverride: 200 })), {
      scope: "web-1",
      opsPerSec: 200,
    });
    assert.deepEqual(budgetScope(input({ webOpsPerSec: 500 })), { scope: "web-1", opsPerSec: 500 });
    assert.equal(budgetScope(input({})), undefined);
  });
});
