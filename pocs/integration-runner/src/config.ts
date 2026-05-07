import { randomUUID } from "node:crypto";

export type RunnerConfig = {
  dbosUrl: string | undefined;
  webId: string;
  actorId: string | undefined;
  graphUrl: string | undefined;
  forceResync: boolean;
  runId: string;
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
  };
}

export function workflowId(connectorId: string, config: RunnerConfig): string {
  return `${connectorId}:${config.webId}:${config.runId}`;
}
