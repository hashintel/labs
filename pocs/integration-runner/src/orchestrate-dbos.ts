import { DBOS } from "@dbos-inc/dbos-sdk";
import type { Backend, StepContext, RetryPolicy } from "./orchestrator.js";

const stepFns = new Map<string, () => Promise<unknown>>();

async function dbosStep(name: string): Promise<unknown> {
  return stepFns.get(name)!();
}

let _workflowBody: (() => Promise<unknown>) | undefined;

async function dbosWorkflow(): Promise<unknown> {
  return _workflowBody!();
}

export async function createDbosBackend(databaseUrl: string, retry: RetryPolicy): Promise<Backend> {
  const registeredStep = DBOS.registerStep(dbosStep, {
    name: "step",
    retriesAllowed: true,
    maxAttempts: retry.maxAttempts,
    intervalSeconds: retry.intervalSeconds,
    backoffRate: retry.backoffRate,
  });

  const registeredWorkflow = DBOS.registerWorkflow(dbosWorkflow, { name: "workflow" });

  DBOS.setConfig({ name: "integration-runner", systemDatabaseUrl: databaseUrl, runAdminServer: false });
  await DBOS.launch();

  return {
    async invoke<T>(workflowId: string, workflow: (ctx: StepContext) => Promise<T>) {
      const ctx: StepContext = {
        async run(name, fn) {
          stepFns.set(name, fn);
          return registeredStep(name) as any;
        },
      };

      _workflowBody = () => workflow(ctx);
      const handle = await DBOS.startWorkflow(registeredWorkflow, { workflowID: workflowId })();
      return handle.getResult() as T;
    },
    async shutdown() {
      await DBOS.shutdown();
      stepFns.clear();
      _workflowBody = undefined;
    },
  };
}
