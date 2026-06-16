import { DBOS } from "@dbos-inc/dbos-sdk";
import type { Backend, StepContext, RetryPolicy } from "./orchestrator.js";

// Workflow bodies close over live resources, so they can't be DBOS inputs; keyed
// by workflow ID instead. Recovery re-runs with the same RUN_ID to re-register.
const bodies = new Map<string, () => Promise<unknown>>();

async function integrationWorkflow(): Promise<unknown> {
  const body = bodies.get(DBOS.workflowID ?? "");
  if (!body) {
    throw new Error(
      `No body registered for workflow "${DBOS.workflowID}". ` +
      `This workflow cannot be recovered by DBOS alone; re-run the runner with the same RUN_ID.`,
    );
  }
  return body();
}

export async function createDbosBackend(databaseUrl: string, retry: RetryPolicy): Promise<Backend> {
  const workflow = DBOS.registerWorkflow(integrationWorkflow, { name: "integration-sync" });
  DBOS.setConfig({ name: "integration-runner", systemDatabaseUrl: databaseUrl, runAdminServer: false });
  await DBOS.launch();

  const ctx: StepContext = {
    run(name, fn) {
      return DBOS.runStep(fn, {
        name,
        retriesAllowed: true,
        maxAttempts: retry.maxAttempts,
        intervalSeconds: retry.intervalSeconds,
        backoffRate: retry.backoffRate,
      });
    },
  };

  return {
    async invoke<T>(workflowId: string, wf: (ctx: StepContext) => Promise<T>) {
      bodies.set(workflowId, () => wf(ctx));
      try {
        const handle = await DBOS.startWorkflow(workflow, { workflowID: workflowId })();
        return (await handle.getResult()) as T;
      } finally {
        bodies.delete(workflowId);
      }
    },
    async shutdown() {
      await DBOS.shutdown();
    },
  };
}
