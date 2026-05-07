import { randomUUID } from "node:crypto";
import type { IntegrationId } from "./identity.js";

export type RunnerConfig = {
  dbosUrl: string | undefined;
  webId: string;
  actorId: string | undefined;
  graphUrl: string | undefined;
  forceResync: boolean;
  runId: string;
  baseDir: string;
};

export function loadConfig(): RunnerConfig {
  const forceResync = !!process.env.FORCE_RESYNC;
  const runId = process.env.RUN_ID
    ?? (forceResync ? randomUUID() : new Date().toISOString().slice(0, 10));

  return {
    dbosUrl: process.env.DBOS_DATABASE_URL,
    webId: process.env.HASH_WEB_ID ?? "unknown",
    actorId: process.env.HASH_ACTOR_ID,
    graphUrl: process.env.HASH_GRAPH_URL,
    forceResync,
    runId,
    baseDir: process.env.RUNNER_BASE_DIR ?? ".",
  };
}

export function workflowId(id: IntegrationId, runId: string): string {
  return `${id.canonical}:${runId}`;
}
