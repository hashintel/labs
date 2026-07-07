import type { OrchestrationYaml } from "./schema.js";
import type { SourceResult } from "./result.js";
import type { SyncInput } from "./sync-workflow.js";
import type { GraphLimiter } from "@integrations/graph/client.js";

export type StepContext = {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
};

export type RetryPolicy = {
  maxAttempts: number;
  intervalSeconds: number;
  backoffRate: number;
};

/**
 * THE COORDINATION CONTRACT: what any orchestrator runtime must provide so that
 * throttling metadata can be shared across every process using that runtime.
 * One primitive suffices: an atomic token-bucket consume. The DBOS backend
 * stores the bucket in the DBOS system database; the direct backend keeps it
 * in-process (correct for its single-process scope); a future runtime
 * (Inngest/Restate) implements it with its own facilities. The engine never
 * sees this type -- it gets only a GraphLimiter built on top.
 */
export type CoordinationStore = {
  /**
   * Refill the scope's bucket to `nowMs` at `ratePerSec` (clamped to `capacity`),
   * then deduct `ops` and return the resulting token balance. The balance MAY go
   * negative: the caller has reserved those ops and waits `-balance/rate` before
   * proceeding, so concurrent callers self-pace at the rate without retrying. A
   * fresh bucket starts full (`capacity` tokens), allowing an initial burst.
   */
  consume(scope: string, ratePerSec: number, capacity: number, ops: number, nowMs: number): Promise<number>;
};

/**
 * A backend runtime executes sync workflows from serializable inputs (any
 * process of the runtime may execute; nothing is closed over) and provides:
 * - admission: at most the configured number of runs execute at once across
 *   every process sharing the runtime; a second invocation with the same
 *   `dedupKey` while one is queued/running is rejected (per-integration
 *   exclusion: one store.duckdb, one writer).
 * - coordination: the shared throttling counter above.
 */
export type Backend = {
  invoke(workflowId: string, input: SyncInput, admission?: { dedupKey: string }): Promise<SourceResult[]>;
  coordination: CoordinationStore;
  shutdown(): Promise<void>;
};

export type BackendConfig =
  | { kind: "direct" }
  | { kind: "dbos"; databaseUrl: string; maxConcurrentRuns?: number };

export function retryPolicyFrom(orch?: OrchestrationYaml): RetryPolicy {
  return {
    maxAttempts: (orch?.maxRetries ?? 0) + 1,
    intervalSeconds: orch?.retryIntervalSeconds ?? 30,
    backoffRate: orch?.backoffRate ?? 2,
  };
}

/** Raised when the same integration is already queued or running. */
export class RunAlreadyActiveError extends Error {
  constructor(dedupKey: string) {
    super(`a run for "${dedupKey}" is already queued or running (re-invoke with the same RUN_ID to attach)`);
  }
}

// Bucket capacity as a multiple of the rate: a fresh scope may burst up to this
// many ops, then the refill paces it to the rate. 2x rate = up to a 2-second
// burst, enough to absorb a wave of concurrent bulk chunks while still capping
// the sustained rate. Not a knob (keeps the config surface to rate + override).
const BURST_FACTOR = 2;

export function capacityFor(ratePerSec: number): number {
  return ratePerSec * BURST_FACTOR;
}

/**
 * Runtime-agnostic write limiter: a debt-based token bucket over the
 * coordination contract. Each acquire consumes `ops` tokens; if that drives the
 * balance negative the caller has RESERVED those ops and sleeps
 * `-balance / rate` before proceeding, so concurrent callers self-pace to the
 * rate with no retry loop and no thundering herd (each reservation is told a
 * progressively longer wait). Bursts up to capacity are allowed; sustained rate
 * is hard-capped. Store failures fail OPEN to a local bucket at the same params:
 * throttling is protective, not correctness, and a coordination blip must not
 * halt ingestion.
 */
export function createTokenLimiter(store: CoordinationStore, scope: string, ratePerSec: number): GraphLimiter {
  const capacity = capacityFor(ratePerSec);
  const local = createLocalBucket(ratePerSec, capacity);
  let failedOpen = false;

  const consume = async (ops: number, now: number): Promise<number> => {
    try {
      const balance = await store.consume(scope, ratePerSec, capacity, ops, now);
      failedOpen = false;
      return balance;
    } catch (err) {
      if (!failedOpen) {
        failedOpen = true;
        console.warn(`[throttle] coordination store unreachable, failing open to a local bucket for "${scope}": ${err instanceof Error ? err.message : String(err)}`);
      }
      return local(ops, now);
    }
  };

  return {
    async acquire(ops: number): Promise<void> {
      const balance = await consume(ops, Date.now());
      if (balance < 0) {
        await new Promise((r) => setTimeout(r, Math.ceil((-balance / ratePerSec) * 1000)));
      }
    },
  };
}

/** Pure token-bucket refill+deduct; shared by the in-process store and the fail-open path. */
export function tokenConsume(
  state: { tokens: number; lastMs: number },
  ratePerSec: number,
  capacity: number,
  ops: number,
  nowMs: number,
): number {
  const elapsed = Math.max(0, nowMs - state.lastMs);
  const refilled = Math.min(capacity, state.tokens + (elapsed * ratePerSec) / 1000);
  state.tokens = refilled - ops;
  state.lastMs = nowMs;
  return state.tokens;
}

function createLocalBucket(ratePerSec: number, capacity: number): (ops: number, nowMs: number) => number {
  const state = { tokens: capacity, lastMs: Date.now() };
  return (ops, nowMs) => tokenConsume(state, ratePerSec, capacity, ops, nowMs);
}

/** The direct backend's CoordinationStore: correct within its single process. */
export function createInProcessCoordination(): CoordinationStore {
  const buckets = new Map<string, { tokens: number; lastMs: number }>();
  return {
    async consume(scope, ratePerSec, capacity, ops, nowMs) {
      let state = buckets.get(scope);
      if (!state) {
        state = { tokens: capacity, lastMs: nowMs };
        buckets.set(scope, state);
      }
      return tokenConsume(state, ratePerSec, capacity, ops, nowMs);
    },
  };
}

export async function createBackend(config: BackendConfig): Promise<Backend> {
  switch (config.kind) {
    case "dbos": {
      const { createDbosBackend } = await import("./orchestrate-dbos.js");
      return createDbosBackend(config.databaseUrl, config.maxConcurrentRuns);
    }
    case "direct": {
      const { createDirectBackend } = await import("./orchestrate-direct.js");
      return createDirectBackend();
    }
  }
}
