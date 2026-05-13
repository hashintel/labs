import { DBOS } from "@dbos-inc/dbos-sdk";
import type { Integration } from "@integrations/engine.js";
import type { OrchestrationYaml } from "./schema.js";
import type { IntegrationId } from "./identity.js";
import { workflowId } from "./config.js";
import { type SourceResult, type WorkflowResult, sourceResultFromSync, failedSourceResult, buildWorkflowResult } from "./result.js";

let _app: Integration | undefined;
let _id: IntegrationId | undefined;

async function processSource(source: string): Promise<SourceResult> {
  const start = Date.now();
  const sync = await _app!.syncSources([source]);
  return sourceResultFromSync(source, sync, Date.now() - start);
}

async function fullSync(sources: string[]): Promise<WorkflowResult> {
  const startedAt = new Date().toISOString();
  const results: SourceResult[] = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    let sr: SourceResult;
    try {
      sr = await registeredProcessSource(source);
    } catch (err) {
      sr = failedSourceResult(source, `retries exhausted: ${err instanceof Error ? err.message : String(err)}`);
    }
    results.push(sr);
    await DBOS.setEvent(`source:${source}`, {
      status: sr.status, index: i,
      inserts: sr.inserts, updates: sr.updates, errors: sr.errors.length, durationMs: sr.durationMs,
    });
  }

  return buildWorkflowResult(_id!.canonical, _id!.configHash, results, startedAt);
}

let registeredProcessSource = processSource;
let registeredFullSync = fullSync;

export async function getSourceStatus(wfId: string, source: string) {
  return DBOS.getEvent(wfId, `source:${source}`);
}

export async function runWithDbos(
  app: Integration,
  id: IntegrationId,
  runId: string,
  sources: string[],
  dbosUrl: string,
  orch?: OrchestrationYaml,
): Promise<WorkflowResult> {
  if (_app) throw new Error("DBOS already bound (one integration per process)");
  _app = app;
  _id = id;

  registeredProcessSource = DBOS.registerStep(processSource, {
    name: "processSource",
    retriesAllowed: true,
    maxAttempts: (orch?.maxRetries ?? 2) + 1,
    intervalSeconds: orch?.retryIntervalSeconds ?? 30,
    backoffRate: orch?.backoffRate ?? 2,
  });
  registeredFullSync = DBOS.registerWorkflow(fullSync, { name: "fullSync" });

  DBOS.setConfig({ name: "integration-runner", systemDatabaseUrl: dbosUrl, runAdminServer: false });
  await DBOS.launch();

  const wfId = workflowId(id, runId);
  console.log(`[runner] workflow=${wfId}`);
  try {
    const handle = await DBOS.startWorkflow(registeredFullSync, { workflowID: wfId })(sources);
    return handle.getResult();
  } finally {
    await DBOS.shutdown();
  }
}
