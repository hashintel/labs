import { randomUUID } from "node:crypto";
import type { IntegrationId } from "./identity.js";

export type RunnerConfig = {
  dbosUrl: string | undefined;
  webId: string;
  actorId: string | undefined;
  graphUrl: string | undefined;
  runId: string;
  baseDir: string;
};

export function loadConfig(): RunnerConfig {
  return {
    dbosUrl: process.env.DBOS_DATABASE_URL,
    webId: process.env.HASH_WEB_ID ?? "unknown",
    actorId: process.env.HASH_ACTOR_ID,
    graphUrl: process.env.HASH_GRAPH_URL,
    runId: process.env.RUN_ID ?? randomUUID(),
    baseDir: process.env.RUNNER_BASE_DIR ?? ".",
  };
}

export function workflowId(id: IntegrationId, runId: string): string {
  return `${id.canonical}:${runId}`;
}
