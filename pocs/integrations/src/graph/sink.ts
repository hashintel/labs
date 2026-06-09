import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { QueryableStore } from "../staging/types.js";
import type { ChangeEvent } from "../connector/types.js";
import type { Accessor, GraphSinkConfig, Row, Envelope } from "../transform/pipeline.js";
import type { GraphLinkOp, GraphOp, SourceProvenance, PropertyProvenance, GraphClient } from "./types.js";
import type { Logger } from "../log.js";

const DEFAULT_CONCURRENCY = Math.max(1, Number(process.env.HASH_GRAPH_CONCURRENCY ?? 16));

export async function parallel<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

function resolve(accessor: Accessor, data: Row): unknown {
  return typeof accessor === "string" ? data[accessor] : accessor(data);
}

export function typeSlug(url: string): string {
  return url.split("/entity-type/")[1] ?? url;
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function rowToGraphOp(
  row: Row & Envelope,
  config: GraphSinkConfig,
  namespace: string,
  provenance: SourceProvenance,
): Extract<GraphOp, { kind: "upsert" }> {
  const { _op, _key, _before: _rawBefore, ...data } = row;

  if (_op === "delete") {
    throw new Error(`rowToGraphOp: _op="delete" reached the pipeline (deletes must bypass it)`);
  }

  const entityId = resolve(config.entityId, data);

  const propSources: PropertyProvenance = { sources: [provenance] };
  const properties: Record<string, unknown> = {};
  const propertyProvenance: Record<string, PropertyProvenance> = {};
  for (const [propUrl, accessor] of Object.entries(config.properties)) {
    properties[propUrl] = resolve(accessor, data);
    propertyProvenance[propUrl] = propSources;
  }

  return { kind: "upsert", namespace, entityType: config.entityType, entityId, properties, propertyProvenance, provenance, webId: config.webId };
}

export async function processGraphSink(
  _sinkId: string,
  config: GraphSinkConfig,
  inputTable: string,
  connectorId: string,
  db: QueryableStore,
  client: GraphClient,
  provenance: SourceProvenance,
  log?: Logger,
): Promise<{ syncedIds: string[]; errors: SyncError[] }> {
  const { rows } = await db.query(`SELECT * FROM ${qi(inputTable)}`);

  const latest = new Map<string, Row & Envelope>();
  for (const row of rows) {
    const id = String(resolve(config.entityId, row as Row));
    latest.set(id, row as Row & Envelope);
  }

  const namespace = config.idNamespace ?? connectorId;
  const syncedIds: string[] = [];
  const errors: SyncError[] = [];
  const items = [...latest.values()];

  await parallel(items, DEFAULT_CONCURRENCY, async (row) => {
    let op: Extract<GraphOp, { kind: "upsert" }>;
    try {
      op = rowToGraphOp(row, config, namespace, provenance);
    } catch (err) {
      const id = String(resolve(config.entityId, row as Row));
      errors.push(syncError("row-build", config.entityType, id, err));
      log?.error(`failed to build op for ${typeSlug(config.entityType)}/${id}: ${errMsg(err)}`);
      return;
    }
    try {
      log?.info(`upsert ${typeSlug(op.entityType)} id=${String(op.entityId)}`);
      await client.upsertEntity(op);
      syncedIds.push(String(op.entityId));
    } catch (err) {
      errors.push(syncError("upsert", op.entityType, op.entityId, err));
      log?.error(`upsert failed for ${typeSlug(op.entityType)}/${String(op.entityId)}: ${errMsg(err)}`);
    }
  });

  if (errors.length > 0) log?.warn(`${errors.length} op(s) failed in sink "${inputTable}"; the remaining ${syncedIds.length} succeeded`);

  return { syncedIds, errors };
}

export type SyncError = {
  kind: "upsert" | "archive" | "link-upsert" | "stale-link" | "row-build" | "table";
  entityType: string;
  entityId: string;
  message: string;
};

export type SyncResult = {
  inserts: number;
  updates: number;
  deletes: number;
  unchanged: number;
  errors: SyncError[];
  durationMs: number;
};

export const emptySyncResult = (): SyncResult => ({
  inserts: 0, updates: 0, deletes: 0, unchanged: 0, errors: [], durationMs: 0,
});

export function mergeSyncResults(a: SyncResult, b: SyncResult): SyncResult {
  return {
    inserts: a.inserts + b.inserts,
    updates: a.updates + b.updates,
    deletes: a.deletes + b.deletes,
    unchanged: a.unchanged + b.unchanged,
    errors: [...a.errors, ...b.errors],
    durationMs: a.durationMs + b.durationMs,
  };
}

export function syncError(kind: SyncError["kind"], entityType: string, entityId: unknown, err: unknown): SyncError {
  return { kind, entityType, entityId: String(entityId), message: err instanceof Error ? err.message : String(err) };
}

export function escLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export function inList(ids: readonly string[]): string {
  return ids.map(escLiteral).join(",");
}

const PENDING_LINK_PREFIX = "_state/pending-links";
export const STAGE_CHUNK = 500;

function pendingLinksTable(connectorId: string): string {
  return `${PENDING_LINK_PREFIX}/${connectorId}`;
}

export async function ensurePendingLinksTable(db: QueryableStore, connectorId: string): Promise<string> {
  const table = pendingLinksTable(connectorId);
  await db.exec(`CREATE TABLE IF NOT EXISTS ${qi(table)} (op_id VARCHAR, sink_id VARCHAR, operation VARCHAR, payload VARCHAR)`);
  return table;
}

export async function deletePendingLinks(db: QueryableStore, connectorId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const table = await ensurePendingLinksTable(db, connectorId);
  for (let start = 0; start < ids.length; start += STAGE_CHUNK) {
    const chunk = ids.slice(start, start + STAGE_CHUNK);
    await db.exec(`DELETE FROM ${qi(table)} WHERE op_id IN (${inList(chunk)})`);
  }
}

export async function stageGraphLinks(
  db: QueryableStore,
  connectorId: string,
  sinkId: string,
  linkOps: GraphLinkOp[],
  archiveOps: Extract<GraphOp, { kind: "archive" }>[],
  log?: Logger,
): Promise<void> {
  if (linkOps.length === 0 && archiveOps.length === 0) return;
  const table = await ensurePendingLinksTable(db, connectorId);

  function archiveOpId(op: Extract<GraphOp, { kind: "archive" }>): string {
    return ["archive", op.namespace, op.webId, op.entityType, String(op.entityId)].join("::");
  }

  const rows = [
    ...linkOps.map((op) => ({ id: op.opId, operation: "upsert", payload: JSON.stringify(op) })),
    ...archiveOps.map((op) => ({ id: archiveOpId(op), operation: "archive", payload: JSON.stringify(op) })),
  ];

  for (let start = 0; start < rows.length; start += STAGE_CHUNK) {
    const chunk = rows.slice(start, start + STAGE_CHUNK);
    await db.exec(`DELETE FROM ${qi(table)} WHERE op_id IN (${inList(chunk.map((r) => r.id))})`);

    const width = 4;
    const params: (string | null)[] = new Array(chunk.length * width);
    const placeholders: string[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const base = i * width;
      placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
      params[base] = chunk[i].id;
      params[base + 1] = sinkId;
      params[base + 2] = chunk[i].operation;
      params[base + 3] = chunk[i].payload;
    }
    await db.exec(`INSERT INTO ${qi(table)} (op_id, sink_id, operation, payload) VALUES ${placeholders.join(", ")}`, params);
  }
  log?.debug(`staged ${rows.length} link op(s) for sink "${sinkId}"`);
}

export async function flushGraphLinks(
  connectorId: string,
  db: QueryableStore,
  client: GraphClient,
  log?: Logger,
  label?: string,
): Promise<SyncResult> {
  const start = Date.now();
  const table = await ensurePendingLinksTable(db, connectorId);
  const where = label ? ` WHERE sink_id = ${escLiteral(label)}` : "";
  const { rows } = await db.query(`SELECT op_id, operation, payload FROM ${qi(table)}${where} ORDER BY operation, op_id`);
  const tag = label ? `flush ${label}` : "flush";
  if (rows.length > 0) log?.info(`${tag}: ${rows.length} pending link op(s) to process`);
  const errors: SyncError[] = [];
  const archiveOps: Array<{ opId: string; op: Extract<GraphOp, { kind: "archive" }> }> = [];
  const linkOps: GraphLinkOp[] = [];

  for (const row of rows) {
    const operation = String(row.operation);
    const payload = JSON.parse(String(row.payload)) as GraphLinkOp | Extract<GraphOp, { kind: "archive" }>;
    if (operation === "archive") archiveOps.push({ opId: String(row.op_id), op: payload as Extract<GraphOp, { kind: "archive" }> });
    else linkOps.push(payload as GraphLinkOp);
  }

  await parallel(archiveOps, DEFAULT_CONCURRENCY, async ({ opId, op }) => {
    try {
      await client.archiveEntity(op);
      await deletePendingLinks(db, connectorId, [opId]);
    } catch (err) {
      errors.push(syncError("stale-link", op.entityType, op.entityId, err));
      log?.error(`stale-link archive failed for ${typeSlug(op.entityType)}/${String(op.entityId)}: ${errMsg(err)}`);
    }
  });

  if (linkOps.length > 0) {
    log?.info(`${tag}: starting bulk upsert of ${linkOps.length} link(s) in ${Math.ceil(linkOps.length / 128)} batches`);
    const onProgress = bulkProgressLogger(label ?? "links", log);
    const { ok, failed, batches, fellBackBatches, durationMs } = await client.bulkUpsertLinks(linkOps, {
      onProgress,
      onBatchOk: (opIds) => deletePendingLinks(db, connectorId, opIds),
    });
    const perSec = durationMs > 0 ? Math.round((ok.length / durationMs) * 1000) : 0;
    log?.info(`bulk-upsert ${label ?? "links"}: ${ok.length}/${linkOps.length} ok, ${failed.length} failed, ${batches} batches (${fellBackBatches} fell back) in ${durationMs}ms (${perSec}/s)`);
    for (const { op, error } of failed) {
      errors.push(syncError("link-upsert", op.linkType, `${String(op.sourceEntityId)}::${String(op.targetId)}`, error));
      log?.error(`link-upsert failed for ${typeSlug(op.linkType)}/${String(op.sourceEntityId)}::${String(op.targetId)}: ${errMsg(error)} (will retry next sync)`);
    }
  }

  const durationMs = Date.now() - start;
  if (rows.length > 0) {
    const failureSummary = errors.length > 0 ? `, ${errors.length} FAILED` : "";
    log?.info(`link sync: ${rows.length - errors.length} done${failureSummary} (${durationMs}ms)`);
  }
  return { ...emptySyncResult(), errors, durationMs };
}

export async function diffAndSync(
  sinkId: string,
  config: GraphSinkConfig,
  inputTable: string | null,
  connectorId: string,
  db: QueryableStore,
  client: GraphClient,
  provenance: SourceProvenance,
  log?: Logger,
  partial: boolean = false,
): Promise<SyncResult> {
  const start = Date.now();
  const entityIdCol = typeof config.entityId === "string" ? config.entityId : null;
  const currentTable = qi(`_sync/current/${sinkId}`);
  const stateTable = qi(`_state/sync/${connectorId}/${sinkId}`);

  if (!entityIdCol) throw new Error("diffAndSync requires a string entityId accessor");

  if (inputTable) {
    await db.exec(`CREATE OR REPLACE TABLE ${currentTable} AS
      SELECT ${qi(entityIdCol)}::VARCHAR AS _entity_id, md5(data::VARCHAR) AS _content_hash
      FROM (SELECT * EXCLUDE (${qi("_op")}, ${qi("_key")}, ${qi("_before")}) FROM ${qi(inputTable)}) data`);
    await assertUniqueEntityIds(db, currentTable, sinkId, entityIdCol);
  } else {
    await db.exec(`CREATE OR REPLACE TABLE ${currentTable} (_entity_id VARCHAR, _content_hash VARCHAR)`);
  }

  let hasPrevious = false;
  try {
    await db.schemaOf(`_state/sync/${connectorId}/${sinkId}`);
    hasPrevious = true;
  } catch {}

  if (partial && hasPrevious) {
    await db.exec(`INSERT INTO ${currentTable}
      SELECT * FROM ${stateTable}
      WHERE _entity_id NOT IN (SELECT _entity_id FROM ${currentTable})`);
  }

  let inserts: string[];
  let updates: string[];
  let deletes: string[];
  let unchanged: number;

  if (!hasPrevious) {
    const { rows } = await db.query(`SELECT _entity_id FROM ${currentTable}`);
    inserts = rows.map((r) => r._entity_id as string);
    updates = [];
    deletes = [];
    unchanged = 0;
  } else {
    const { rows } = await db.query(
      `SELECT
         COALESCE(c._entity_id, p._entity_id) AS _entity_id,
         CASE
           WHEN p._entity_id IS NULL THEN 'insert'
           WHEN c._entity_id IS NULL THEN 'delete'
           WHEN c._content_hash = p._content_hash THEN 'unchanged'
           ELSE 'update'
         END AS op
       FROM ${currentTable} c
       FULL OUTER JOIN ${stateTable} p ON c._entity_id = p._entity_id`,
    );

    inserts = [];
    updates = [];
    deletes = [];
    unchanged = 0;
    for (const r of rows) {
      switch (r.op) {
        case "insert":    inserts.push(r._entity_id as string); break;
        case "update":    updates.push(r._entity_id as string); break;
        case "delete":    deletes.push(r._entity_id as string); break;
        case "unchanged": unchanged++; break;
      }
    }
  }

  const errors: SyncError[] = [];
  if (!hasPrevious) await db.exec(`CREATE TABLE ${stateTable} AS SELECT * FROM ${currentTable} WHERE 1=0`);

  const namespace = config.idNamespace ?? connectorId;

  const commitSlice = async (ids: string[]) => {
    if (ids.length === 0) return;
    const idList = inList(ids);
    await db.exec(`DELETE FROM ${stateTable} WHERE _entity_id IN (${idList})`);
    await db.exec(`INSERT INTO ${stateTable} SELECT * FROM ${currentTable} WHERE _entity_id IN (${idList})`);
  };

  const changedIds = [...inserts, ...updates];
  if (changedIds.length > 0 && inputTable) {
    const idList = inList(changedIds);
    const { rows } = await db.query(
      `SELECT * FROM ${qi(inputTable)} WHERE CAST(${qi(entityIdCol)} AS VARCHAR) IN (${idList})`,
    );
    const ops: Extract<GraphOp, { kind: "upsert" }>[] = [];
    for (const row of rows) {
      try {
        ops.push(rowToGraphOp(row as Row & Envelope, config, namespace, provenance));
      } catch (err) {
        const id = String((row as Row)[entityIdCol]);
        errors.push(syncError("row-build", config.entityType, id, err));
        log?.error(`row-build failed for ${typeSlug(config.entityType)}/${id}: ${errMsg(err)}`);
      }
    }
    if (ops.length > 0) {
      const slug = typeSlug(config.entityType);
      log?.info(`bulk-upsert ${slug}: ${ops.length} ops starting`);
      const onProgress = bulkProgressLogger(slug, log);
      const { ok, failed, batches, fellBackBatches, durationMs } = await client.bulkUpsertEntities(ops, { onProgress });
      const perSec = durationMs > 0 ? Math.round((ok.length / durationMs) * 1000) : 0;
      log?.info(`bulk-upsert ${slug}: ${ok.length}/${ops.length} ok, ${failed.length} failed, ${batches} batches (${fellBackBatches} fell back) in ${durationMs}ms (${perSec}/s)`);
      await commitSlice(ok);
      for (const { op, error } of failed) {
        errors.push(syncError("upsert", op.entityType, op.entityId, error));
        log?.error(`upsert failed for ${typeSlug(op.entityType)}/${String(op.entityId)}: ${errMsg(error)} (will retry next sync)`);
      }
    }
  }

  await parallel(deletes, DEFAULT_CONCURRENCY, async (entityId) => {
    try {
      log?.info(`archive ${typeSlug(config.entityType)} id=${entityId} (removed)`);
      await client.archiveEntity({ kind: "archive", namespace, entityType: config.entityType, entityId, provenance, webId: config.webId });
      await db.exec(`DELETE FROM ${stateTable} WHERE _entity_id = ${escLiteral(entityId)}`);
    } catch (err) {
      errors.push(syncError("archive", config.entityType, entityId, err));
      log?.error(`archive failed for ${typeSlug(config.entityType)}/${entityId}: ${errMsg(err)} (will retry next sync)`);
    }
  });

  await db.exec(`DROP TABLE IF EXISTS ${currentTable}`);

  const durationMs = Date.now() - start;
  const failureSummary = errors.length > 0 ? `, ${errors.length} FAILED` : "";
  log?.info(`sync: ${inserts.length} inserts, ${updates.length} updates, ${deletes.length} deletes, ${unchanged} unchanged${failureSummary} (${durationMs}ms)`);

  return { inserts: inserts.length, updates: updates.length, deletes: deletes.length, unchanged, errors, durationMs };
}

export function bulkProgressLogger(slug: string, log: Logger | undefined): (done: number, total: number) => void {
  const start = Date.now();
  let lastLog = 0;
  return (done, total) => {
    const now = Date.now();
    if (now - lastLog < 10000 && done < total) return;
    lastLog = now;
    const elapsed = now - start;
    const perSec = elapsed > 0 ? Math.round((done / elapsed) * 1000) : 0;
    const eta = perSec > 0 ? Math.round((total - done) / perSec) : 0;
    log?.info(`bulk-upsert ${slug}: ${done}/${total} (${((done / total) * 100).toFixed(1)}%) ${perSec}/s, eta ${eta}s`);
  };
}

function entityIdFromKey(key: Record<string, unknown>): unknown {
  const names = Object.keys(key);
  if (names.length === 1) return key[names[0]];
  names.sort();
  return names.map((n) => String(key[n])).join("::");
}

async function assertUniqueEntityIds(
  db: QueryableStore,
  currentTable: string,
  sinkId: string,
  entityIdCol: string,
): Promise<void> {
  const { rows } = await db.query(
    `SELECT _entity_id, COUNT(*) AS n FROM ${currentTable} GROUP BY _entity_id HAVING n > 1 LIMIT 5`,
  );
  if (rows.length === 0) return;
  const detail = rows.map((r) => `"${r._entity_id}" (${r.n} rows)`).join(", ");
  throw new Error(
    `Graph sink "${sinkId}" received duplicate rows for entity id(s) ${detail}. ` +
    `Each sink expects at most one row per entity id -- deduplicate the preceding SQL step, ` +
    `e.g. SELECT DISTINCT ON (${entityIdCol}) ... FROM ...`,
  );
}

export async function archiveDeletes(
  deletes: ChangeEvent[],
  config: GraphSinkConfig,
  connectorId: string,
  client: GraphClient,
  provenance: SourceProvenance,
  log?: Logger,
): Promise<{ errors: SyncError[] }> {
  if (deletes.length === 0) return { errors: [] };
  const namespace = config.idNamespace ?? connectorId;
  const errors: SyncError[] = [];

  await parallel(deletes, DEFAULT_CONCURRENCY, async (del) => {
    const entityId = entityIdFromKey(del.key);
    try {
      log?.info(`archive ${typeSlug(config.entityType)} id=${String(entityId)}`);
      await client.archiveEntity({
        kind: "archive",
        namespace,
        entityType: config.entityType,
        entityId,
        provenance,
        webId: config.webId,
      });
    } catch (err) {
      errors.push(syncError("archive", config.entityType, entityId, err));
      log?.error(`archive failed for ${typeSlug(config.entityType)}/${String(entityId)}: ${errMsg(err)}`);
    }
  });

  return { errors };
}
