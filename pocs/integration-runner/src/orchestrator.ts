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
 * One primitive suffices: an atomic op-weighted fixed-window counter. The DBOS
 * backend stores it in the DBOS system database; the direct backend keeps it
 * in-process (correct for its single-process scope); a future runtime
 * (Inngest/Restate) implements it with its own facilities. The engine never
 * sees this type -- it gets only a GraphLimiter built on top.
 */
export type CoordinationStore = {
  /** Add `ops` to the scope's window starting at `windowStartMs`; return usage after the add. */
  addToWindow(scope: string, windowStartMs: number, ops: number): Promise<number>;
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

const WINDOW_MS = 1000;

/**
 * Runtime-agnostic write limiter over the coordination contract. An op is
 * RELEASED only once it fits under the budget: charge it to the current window
 * and, if that pushes usage over the cap, wait out the window and retry in the
 * next one. Counting-then-releasing (an earlier design) let every in-flight
 * caller charge the same window and proceed, so N concurrent chunks of size C
 * sustained ~N*C ops/sec regardless of the cap; retrying-until-it-fits caps at
 * the budget instead (phantom charges in skipped windows reset each window and
 * only make it more conservative). Store failures fail OPEN to a local window
 * at the same rate: throttling is protective, not correctness, and a
 * coordination blip must not halt ingestion.
 */
export function createWindowLimiter(store: CoordinationStore, scope: string, opsPerSec: number): GraphLimiter {
  const local = createLocalWindow();
  let failedOpen = false;

  const charge = async (windowStart: number, ops: number): Promise<number> => {
    try {
      const used = await store.addToWindow(scope, windowStart, ops);
      failedOpen = false;
      return used;
    } catch (err) {
      if (!failedOpen) {
        failedOpen = true;
        console.warn(`[throttle] coordination store unreachable, failing open to a local window for "${scope}": ${err instanceof Error ? err.message : String(err)}`);
      }
      return local(windowStart, ops);
    }
  };

  return {
    async acquire(ops: number): Promise<void> {
      for (;;) {
        const now = Date.now();
        const windowStart = now - (now % WINDOW_MS);
        const used = await charge(windowStart, ops);
        // A single op larger than the whole budget can never "fit"; let it
        // through once its window opens rather than spin forever.
        if (used <= opsPerSec || ops >= opsPerSec) return;
        await new Promise((r) => setTimeout(r, windowStart + WINDOW_MS - Date.now()));
      }
    },
  };
}

function createLocalWindow(): (windowStartMs: number, ops: number) => number {
  let windowStart = 0;
  let used = 0;
  return (win, ops) => {
    if (win !== windowStart) {
      windowStart = win;
      used = 0;
    }
    used += ops;
    return used;
  };
}

/** The direct backend's CoordinationStore: correct within its single process. */
export function createInProcessCoordination(): CoordinationStore {
  const windows = new Map<string, { windowStart: number; used: number }>();
  return {
    async addToWindow(scope, windowStartMs, ops) {
      const entry = windows.get(scope);
      if (!entry || entry.windowStart !== windowStartMs) {
        windows.set(scope, { windowStart: windowStartMs, used: ops });
        return ops;
      }
      entry.used += ops;
      return entry.used;
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
