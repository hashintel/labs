import type { SyncResult, SyncError } from "@integrations/graph/sink.js";

export type SourceResult = {
  source: string;
  status: "ok" | "errors" | "retries_exhausted";
  inserts: number;
  updates: number;
  deletes: number;
  unchanged: number;
  errors: SyncError[];
  durationMs: number;
};

export type WorkflowResult = {
  integrationId: string;
  configHash: string;
  sources: SourceResult[];
  totals: { inserts: number; updates: number; deletes: number; unchanged: number };
  errorCount: number;
  durationMs: number;
  startedAt: string;
  completedAt: string;
};

export function sourceResultFromSync(source: string, sync: SyncResult, durationMs: number): SourceResult {
  return {
    source,
    status: sync.errors.length > 0 ? "errors" : "ok",
    inserts: sync.inserts,
    updates: sync.updates,
    deletes: sync.deletes,
    unchanged: sync.unchanged,
    errors: sync.errors,
    durationMs,
  };
}

export function failedSourceResult(source: string, error: string): SourceResult {
  return {
    source,
    status: "retries_exhausted",
    inserts: 0, updates: 0, deletes: 0, unchanged: 0,
    errors: [{ kind: "table", entityType: "", entityId: source, message: error }],
    durationMs: 0,
  };
}

export function buildWorkflowResult(
  integrationId: string,
  configHash: string,
  sources: SourceResult[],
  startedAt: string,
): WorkflowResult {
  const totals = { inserts: 0, updates: 0, deletes: 0, unchanged: 0 };
  let errorCount = 0;
  let totalDuration = 0;
  for (const s of sources) {
    totals.inserts += s.inserts;
    totals.updates += s.updates;
    totals.deletes += s.deletes;
    totals.unchanged += s.unchanged;
    errorCount += s.errors.length;
    totalDuration += s.durationMs;
  }
  return {
    integrationId,
    configHash,
    sources,
    totals,
    errorCount,
    durationMs: totalDuration,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}
