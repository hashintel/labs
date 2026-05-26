import type { Backend, StepContext, RetryPolicy } from "./orchestrator.js";

export function createDirectBackend(retry: RetryPolicy): Backend {
  return {
    async invoke(_id, workflow) {
      const ctx: StepContext = {
        run(_name, fn) {
          return withRetry(fn, retry);
        },
      };
      return workflow(ctx);
    },
    async shutdown() {},
  };
}

async function withRetry<T>(fn: () => Promise<T>, retry: RetryPolicy): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retry.maxAttempts) {
        const delay = retry.intervalSeconds * Math.pow(retry.backoffRate, attempt - 1) * 1000;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}
