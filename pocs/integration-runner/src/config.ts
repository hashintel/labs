import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { IntegrationId } from "./identity.js";

/**
 * Operator throttling + admission policy, loaded from a config FILE. This is
 * deliberately NOT the tenant-authored pipeline YAML (a tenant must not be able
 * to raise its own write budget) and NOT transient env vars (policy should be a
 * reviewable, versioned artifact). See runner.config.example.yaml.
 */
export type RunnerPolicy = {
  /** THE default target: shared write budget (ops/sec), applied to every web. Omit = throttling off. */
  webOpsPerSec: number | undefined;
  /**
   * Per-web overrides of the default rate, keyed by web id. A listed web throttles at
   * its own ops/sec instead of the default; its runs still share one bucket per web.
   */
  overrides: Record<string, number>;
  /** Admission slots across every process sharing the orchestrator. Omit = off. */
  maxConcurrentRuns: number | undefined;
};

export type RunnerConfig = {
  dbosUrl: string | undefined;
  webId: string;
  actorId: string | undefined;
  graphUrl: string | undefined;
  runId: string;
  baseDir: string;
  policy: RunnerPolicy;
};

const DEFAULT_CONFIG_PATH = "runner.config.yaml";

export function loadConfig(): RunnerConfig {
  return {
    dbosUrl: process.env.DBOS_DATABASE_URL,
    webId: process.env.HASH_WEB_ID ?? "unknown",
    actorId: process.env.HASH_ACTOR_ID,
    graphUrl: process.env.HASH_GRAPH_URL,
    runId: process.env.RUN_ID ?? randomUUID(),
    baseDir: process.env.RUNNER_BASE_DIR ?? ".",
    policy: loadPolicy(process.env.RUNNER_CONFIG ?? DEFAULT_CONFIG_PATH),
  };
}

/** Read the operator policy file. A missing file means throttling and admission are off. */
export function loadPolicy(path: string): RunnerPolicy {
  const empty: RunnerPolicy = { webOpsPerSec: undefined, overrides: {}, maxConcurrentRuns: undefined };
  if (!existsSync(path)) return empty;

  const raw = (parseYaml(readFileSync(path, "utf8")) ?? {}) as Record<string, any>;
  const positive = (v: unknown, where: string): number | undefined => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 1) {
      throw new Error(`${path}: ${where} must be a positive number, got ${JSON.stringify(v)}`);
    }
    return v;
  };

  const overrides: Record<string, number> = {};
  for (const [id, rate] of Object.entries(raw.writeBudget?.overrides ?? {})) {
    overrides[id] = positive(rate, `writeBudget.overrides.${id}`)!;
  }

  return {
    webOpsPerSec: positive(raw.writeBudget?.webOpsPerSec, "writeBudget.webOpsPerSec"),
    overrides,
    maxConcurrentRuns: positive(raw.maxConcurrentRuns, "maxConcurrentRuns"),
  };
}

export function workflowId(id: IntegrationId, runId: string): string {
  return `${id.canonical}:${runId}`;
}
