import { DBOS } from "@dbos-inc/dbos-sdk";
import type { Integration } from "@integrations/engine.js";
import type { OrchestrationYaml } from "./schema.js";
import type { IntegrationId } from "./identity.js";
import { type SourceResult, type WorkflowResult, sourceResultFromSync, failedSourceResult, buildWorkflowResult } from "./result.js";

let _app: Integration | undefined;
let _id: IntegrationId | undefined;

export function bindIntegration(app: Integration, id: IntegrationId) {
  _app = app;
  _id = id;
}

function bound() {
  if (!_app || !_id) throw new Error("bindIntegration() not called");
  return { app: _app, id: _id };
}

async function _processSource(source: string): Promise<SourceResult> {
  const start = Date.now();
  const sync = await bound().app.syncSources([source]);
  return sourceResultFromSync(source, sync, Date.now() - start);
}

async function _fullSync(sources: string[]): Promise<WorkflowResult> {
  const { id } = bound();
  const startedAt = new Date().toISOString();
  const results: SourceResult[] = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    let sr: SourceResult;
    try {
      sr = await processSource(source);
    } catch (err) {
      sr = failedSourceResult(source, `retries exhausted: ${err instanceof Error ? err.message : String(err)}`);
    }
    results.push(sr);
    await DBOS.setEvent(`source:${source}`, {
      status: sr.status, index: i,
      inserts: sr.inserts, updates: sr.updates, errors: sr.errors.length, durationMs: sr.durationMs,
    });
  }

  return buildWorkflowResult(id.canonical, id.configHash, results, startedAt);
}

let processSource = _processSource;
let fullSync = _fullSync;

export function registerWorkflows(orch?: OrchestrationYaml) {
  processSource = DBOS.registerStep(_processSource, {
    name: "processSource",
    retriesAllowed: true,
    maxAttempts: (orch?.maxRetries ?? 2) + 1,
    intervalSeconds: orch?.retryIntervalSeconds ?? 30,
    backoffRate: orch?.backoffRate ?? 2,
  });
  fullSync = DBOS.registerWorkflow(_fullSync, { name: "fullSync" });
}

export async function launchDbos(dbosUrl: string) {
  DBOS.setConfig({ name: "integration-runner", systemDatabaseUrl: dbosUrl, runAdminServer: false });
  await DBOS.launch();
}

export async function shutdownDbos() {
  await DBOS.shutdown();
}

export async function runDurableSync(wfId: string, sources: string[]): Promise<WorkflowResult> {
  const handle = await DBOS.startWorkflow(fullSync, { workflowID: wfId })(sources);
  return handle.getResult();
}
