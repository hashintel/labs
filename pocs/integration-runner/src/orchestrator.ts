import type { OrchestrationYaml } from "./schema.js";

export type StepContext = {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
};

export type RetryPolicy = {
  maxAttempts: number;
  intervalSeconds: number;
  backoffRate: number;
};

export type WorkflowFn<T> = (ctx: StepContext) => Promise<T>;

export type Backend = {
  invoke<T>(workflowId: string, workflow: WorkflowFn<T>): Promise<T>;
  shutdown(): Promise<void>;
};

export type BackendConfig =
  | { kind: "direct"; retry: RetryPolicy }
  | { kind: "dbos"; databaseUrl: string; retry: RetryPolicy };

export function retryPolicyFrom(orch?: OrchestrationYaml): RetryPolicy {
  return {
    maxAttempts: (orch?.maxRetries ?? 0) + 1,
    intervalSeconds: orch?.retryIntervalSeconds ?? 30,
    backoffRate: orch?.backoffRate ?? 2,
  };
}

export async function createBackend(config: BackendConfig): Promise<Backend> {
  switch (config.kind) {
    case "dbos": {
      const { createDbosBackend } = await import("./orchestrate-dbos.js");
      return createDbosBackend(config.databaseUrl, config.retry);
    }
    case "direct": {
      const { createDirectBackend } = await import("./orchestrate-direct.js");
      return createDirectBackend(config.retry);
    }
  }
}
