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
    errors: capErrors(sync.errors),
    durationMs,
  };
}

// Cap errors kept in the checkpointed step result; full detail stays in the logs.
const MAX_SERIALIZED_ERRORS = 25;

function capErrors(errors: SyncError[]): SyncError[] {
  if (errors.length <= MAX_SERIALIZED_ERRORS) return errors;
  return [
    ...errors.slice(0, MAX_SERIALIZED_ERRORS),
    { kind: "table", entityType: "", entityId: "(truncated)", message: `... and ${errors.length - MAX_SERIALIZED_ERRORS} more error(s), see logs` },
  ];
}

// Throws on systemic failure (abort, or errors with zero progress) so the step
// retries. Partial row errors don't throw; they retry next sync.
export function assertSyncProgress(step: string, sync: SyncResult, opts: { requireProgress?: boolean } = {}): void {
  const progressed = sync.inserts + sync.updates + sync.deletes + sync.unchanged > 0;
  const noProgress = (opts.requireProgress ?? true) && sync.errors.length > 0 && !progressed;
  if (!sync.aborted && !noProgress) return;
  const first = sync.errors.slice(0, 3).map((e) => `${e.entityId}: ${e.message}`).join("; ");
  throw new Error(
    `${step}: ${sync.aborted ? "systemic failure, no writes succeeded" : "no progress"} -- ${sync.errors.length} error(s)${first ? `. First: ${first}` : ""}`,
  );
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
