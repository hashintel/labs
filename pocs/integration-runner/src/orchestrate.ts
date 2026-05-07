import { DBOS } from "@dbos-inc/dbos-sdk";
import type { Integration } from "@integrations/engine.js";
import { emptySyncResult, mergeSyncResults, type SyncResult } from "@integrations/graph/sink.js";
import type { OrchestrationYaml } from "./schema.js";

let _integration: Integration | undefined;

export function bindIntegration(app: Integration) {
  _integration = app;
}

function getIntegration(): Integration {
  if (!_integration) throw new Error("No integration bound. Call bindIntegration() before running workflows.");
  return _integration;
}

export class SyncWorkflow {
  @DBOS.workflow()
  static async fullSync(sources: string[]): Promise<SyncResult> {
    let totals = emptySyncResult();
    for (const source of sources) {
      const result = await SyncWorkflow.processSource(source);
      totals = mergeSyncResults(totals, result);
    }
    return totals;
  }

  @DBOS.step({ retriesAllowed: true, maxAttempts: 3, intervalSeconds: 30, backoffRate: 2 })
  static async processSource(source: string): Promise<SyncResult> {
    return getIntegration().syncSources([source]);
  }
}

export async function configureStep(orch: OrchestrationYaml | undefined) {
  if (!orch) return;
  // Step config is set via decorator defaults above; runtime overrides
  // would require DBOS's registerStep API. For now the YAML values serve
  // as documentation and the defaults in the decorator are the source of truth.
  // TODO: wire orch.maxRetries/retryIntervalSeconds/backoffRate dynamically
  // once DBOS supports runtime step config overrides.
}

export async function launchDbos(dbosUrl: string) {
  DBOS.setConfig({
    name: "integration-runner",
    systemDatabaseUrl: dbosUrl,
    runAdminServer: false,
  });
  await DBOS.launch();
}

export async function shutdownDbos() {
  await DBOS.shutdown();
}

export async function runDurableSync(workflowId: string, sources: string[]): Promise<SyncResult> {
  const handle = await DBOS.startWorkflow(SyncWorkflow, { workflowID: workflowId }).fullSync(sources);
  return handle.getResult();
}
