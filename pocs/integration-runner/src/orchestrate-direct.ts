import { createInProcessCoordination, createTokenLimiter, type Backend, type RetryPolicy, type StepContext } from "./orchestrator.js";
import { runSync, budgetScope } from "./sync-workflow.js";

export function createDirectBackend(): Backend {
  const coordination = createInProcessCoordination();
  const active = new Set<string>();

  return {
    coordination,

    async invoke(_workflowId, input, admission) {
      // Single-process scope: exclusion holds here only; the DuckDB file lock
      // is the (crashing) backstop against other processes.
      if (admission && active.has(admission.dedupKey)) {
        const { RunAlreadyActiveError } = await import("./orchestrator.js");
        throw new RunAlreadyActiveError(admission.dedupKey);
      }
      if (admission) active.add(admission.dedupKey);

      const scope = budgetScope(input);
      const limiter = scope ? createTokenLimiter(coordination, scope.scope, scope.opsPerSec) : undefined;

      try {
        return await runSync(input, directCtx(input.retry), { limiter });
      } finally {
        if (admission) active.delete(admission.dedupKey);
      }
    },

    async shutdown() {},
  };
}

function directCtx(retry: RetryPolicy): StepContext {
  return {
    run(_name, fn) {
      return withRetry(fn, retry);
    },
  };
}

async function withRetry<T>(fn: () => Promise<T>, retry: RetryPolicy): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if ((err as { nonRetryable?: boolean } | null)?.nonRetryable) break;
      if (attempt < retry.maxAttempts) {
        const delay = retry.intervalSeconds * Math.pow(retry.backoffRate, attempt - 1) * 1000;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}
