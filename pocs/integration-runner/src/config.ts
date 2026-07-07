import { randomUUID } from "node:crypto";
import type { IntegrationId } from "./identity.js";

export type RunnerConfig = {
  dbosUrl: string | undefined;
  webId: string;
  actorId: string | undefined;
  graphUrl: string | undefined;
  runId: string;
  baseDir: string;
  /** THE throttling target: shared write budget (ops/sec) per web. Unset = off. */
  webOpsPerSec: number | undefined;
  /**
   * Operator-only override: a dedicated ops/sec lane for THIS run's integration
   * instead of the shared per-web pool. Set by whoever launches the run, never by
   * the pipeline YAML (a tenant must not be able to raise their own write budget).
   * Unset = draw from the web pool.
   */
  opsPerSecOverride: number | undefined;
  /** Admission slots across every process sharing the orchestrator. Unset = off. */
  maxConcurrentRuns: number | undefined;
};

export function loadConfig(): RunnerConfig {
  const num = (v: string | undefined) => (v ? Math.max(1, Number(v)) : undefined);
  return {
    dbosUrl: process.env.DBOS_DATABASE_URL,
    webId: process.env.HASH_WEB_ID ?? "unknown",
    actorId: process.env.HASH_ACTOR_ID,
    graphUrl: process.env.HASH_GRAPH_URL,
    runId: process.env.RUN_ID ?? randomUUID(),
    baseDir: process.env.RUNNER_BASE_DIR ?? ".",
    webOpsPerSec: num(process.env.HASH_GRAPH_WEB_OPS_PER_SEC),
    opsPerSecOverride: num(process.env.HASH_GRAPH_OPS_PER_SEC_OVERRIDE),
    maxConcurrentRuns: num(process.env.RUNNER_MAX_CONCURRENT_RUNS),
  };
}

export function workflowId(id: IntegrationId, runId: string): string {
  return `${id.canonical}:${runId}`;
}
