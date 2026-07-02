import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { QueryableStore } from "../staging/types.js";
import type { GraphClient } from "./types.js";
import type { GraphSinkConfig, LinkPipeline, Step, TablePipeline } from "../transform/pipeline.js";
import { deterministicUuid, compositeEntityId } from "./client.js";
import { readMeta, writeMeta, type MetaScope, type SinkMeta } from "./state-meta.js";
import { escLiteral } from "./sink.js";
import type { Logger } from "../log.js";

export type SinkRef = { sinkId: string; config: GraphSinkConfig };

export function collectGraphSinks(pipelines: readonly TablePipeline[]): SinkRef[] {
  const sinks: SinkRef[] = [];
  const walk = (steps: readonly Step[]) => {
    for (const step of steps) {
      if (step.kind === "graph-sink") sinks.push({ sinkId: step.id, config: step.config });
      if (step.kind === "branch") for (const branch of step.branches) walk(branch as readonly Step[]);
    }
  };
  for (const tp of pipelines) walk(tp.pipeline.steps);
  return sinks;
}

type Fingerprint = { graphIdentity: string; webId: string; namespace: string };

function fingerprintOf(meta: SinkMeta): Fingerprint | null {
  if (meta.graphIdentity == null || meta.webId == null || meta.namespace == null) return null;
  return { graphIdentity: meta.graphIdentity, webId: meta.webId, namespace: meta.namespace };
}

function mismatch(stored: Fingerprint | null, current: Fingerprint): string | null {
  if (!stored) return "state exists but no fingerprint is recorded (state predates the coherence check, or meta was lost)";
  const diffs: string[] = [];
  if (stored.graphIdentity !== current.graphIdentity) diffs.push(`graph "${stored.graphIdentity}" vs "${current.graphIdentity}"`);
  if (stored.webId !== current.webId) diffs.push(`web "${stored.webId}" vs "${current.webId}"`);
  if (stored.namespace !== current.namespace) diffs.push(`namespace "${stored.namespace}" vs "${current.namespace}"`);
  return diffs.length > 0 ? `stored vs current: ${diffs.join(", ")}` : null;
}

const REMEDY =
  "A mismatched target mis-diffs (wrong ops or duplicate entities). Point the state dir at the graph it was " +
  "written against, use a fresh state dir for a clean full sync, or set HASH_ALLOW_STATE_MISMATCH=1 to drop " +
  "local state and cold-start (inserts only, no archives).";

/** Deterministic given the state dir and target graph; retrying cannot succeed. */
export class StateCoherenceError extends Error {
  readonly nonRetryable = true;
}

function allowMismatch(): boolean {
  return process.env.HASH_ALLOW_STATE_MISMATCH === "1";
}

async function stateTablesWithPrefix(db: QueryableStore, prefix: string): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT table_name FROM information_schema.tables WHERE starts_with(table_name, ${escLiteral(prefix)})`,
  );
  return rows.map((r) => String(r.table_name));
}

async function upsertFingerprint(db: QueryableStore, scope: MetaScope, fp: Fingerprint): Promise<void> {
  const existing = await readMeta(db, scope);
  await writeMeta(db, scope, {
    hashVersion: existing?.hashVersion ?? null,
    configHash: existing?.configHash ?? null,
    graphIdentity: fp.graphIdentity,
    webId: fp.webId,
    namespace: fp.namespace,
  });
}

/**
 * Verifies that the local sync state was written against the graph this run targets,
 * before any state or graph write. State diffing is only meaningful against the graph
 * it was built from; a reseeded graph or a different web/namespace re-keys entity ids.
 */
export async function checkStateCoherence(opts: {
  db: QueryableStore;
  client: GraphClient;
  connectorId: string;
  sinks: SinkRef[];
  linkPipelines: readonly LinkPipeline[];
  log?: Logger;
}): Promise<void> {
  const { db, client, connectorId, sinks, linkPipelines, log } = opts;
  const graphIdentity = client.identity();

  const syncTables = new Set(await stateTablesWithPrefix(db, `_state/sync/${connectorId}/`));
  const linkTables = new Set(await stateTablesWithPrefix(db, `_state/links/${connectorId}/`));

  const scoped: { scope: MetaScope; current: Fingerprint; stateTable: string | null; entityType?: string }[] = [
    ...sinks.map((s) => ({
      scope: { scope: "entity" as const, connectorId, sinkId: s.sinkId },
      current: { graphIdentity, webId: s.config.webId, namespace: s.config.idNamespace ?? connectorId },
      stateTable: syncTables.has(`_state/sync/${connectorId}/${s.sinkId}`) ? `_state/sync/${connectorId}/${s.sinkId}` : null,
      entityType: s.config.entityType,
    })),
    ...linkPipelines.map((lp) => ({
      scope: { scope: "link" as const, connectorId, sinkId: lp.id },
      current: { graphIdentity, webId: lp.webId, namespace: lp.idNamespace ?? connectorId },
      stateTable: linkTables.has(`_state/links/${connectorId}/${lp.id}`) ? `_state/links/${connectorId}/${lp.id}` : null,
    })),
  ];

  const failures: string[] = [];
  for (const s of scoped) {
    if (!s.stateTable) continue; // cold start for this sink; fingerprint written below
    const meta = await readMeta(db, s.scope);
    const reason = mismatch(meta ? fingerprintOf(meta) : null, s.current);
    if (reason) failures.push(`${s.scope.scope} sink "${s.scope.sinkId}": ${reason}`);
  }

  if (failures.length === 0) {
    const probeFailure = await sentinelProbe(db, client, scoped, log);
    if (probeFailure) failures.push(probeFailure);
  }

  if (failures.length > 0) {
    if (!allowMismatch()) {
      throw new StateCoherenceError(`state/graph coherence check failed:\n  ${failures.join("\n  ")}\n${REMEDY}`);
    }
    log?.warn(`state/graph coherence OVERRIDDEN (HASH_ALLOW_STATE_MISMATCH=1): dropping state for connector "${connectorId}"`);
    for (const prefix of [`_state/sync/${connectorId}/`, `_state/links/${connectorId}/`, `_state/links-next/${connectorId}/`]) {
      for (const table of await stateTablesWithPrefix(db, prefix)) {
        await db.exec(`DROP TABLE IF EXISTS ${qi(table)}`);
      }
    }
    await db.exec(`DROP TABLE IF EXISTS ${qi(`_state/pending-links/${connectorId}`)}`);
  }

  for (const s of scoped) {
    await upsertFingerprint(db, s.scope, s.current);
  }
}

// One legitimately purged entity must not trip the check; a wiped graph trips it always.
const PROBE_SAMPLE = 3;

async function sentinelProbe(
  db: QueryableStore,
  client: GraphClient,
  scoped: { scope: MetaScope; current: Fingerprint; stateTable: string | null; entityType?: string }[],
  log?: Logger,
): Promise<string | null> {
  const candidates = scoped.filter((s) => s.stateTable && s.entityType);
  if (candidates.length === 0) return null;

  let best: (typeof candidates)[number] | null = null;
  let bestCount = 0;
  for (const c of candidates) {
    const { rows } = await db.query(`SELECT COUNT(*)::BIGINT AS n FROM ${qi(c.stateTable!)}`);
    const n = Number(rows[0]?.n ?? 0);
    if (n > bestCount) {
      best = c;
      bestCount = n;
    }
  }
  if (!best || bestCount === 0) return null;

  const { rows } = await db.query(
    `SELECT _entity_id FROM ${qi(best.stateTable!)} ORDER BY _entity_id LIMIT ${PROBE_SAMPLE}`,
  );
  const ids = rows.map((r) => String(r._entity_id));
  let found = 0;
  for (const id of ids) {
    const composite = compositeEntityId(best.current.webId, deterministicUuid(best.current.namespace, best.entityType!, id));
    if (await client.hasEntity(composite)) found += 1;
  }
  if (found > 0) {
    log?.debug(`coherence probe: ${found}/${ids.length} sentinel entities present`);
    return null;
  }
  return (
    `sentinel probe: none of ${ids.length} sampled entities from "${best.stateTable}" exist in the target graph ` +
    `(graph wiped or reseeded since this state was written?)`
  );
}
