import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { QueryableStore } from "../staging/types.js";
import type { ChangeEvent } from "../connector/types.js";
import type { Accessor, GraphSinkConfig, Row, Envelope } from "../transform/pipeline.js";
import type { GraphOp, ResolvedLink, SourceProvenance, GraphClient } from "./types.js";
import type { Logger } from "../log.js";

const DEFAULT_CONCURRENCY = 5;

async function parallel<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
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

function typeSlug(url: string): string {
  return url.split("/entity-type/")[1] ?? url;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function buildProvenance(config: GraphSinkConfig): SourceProvenance {
  return {
    type: "integration",
    location: config.provenance?.location,
    authors: config.provenance?.authors,
    loadedAt: new Date().toISOString(),
  };
}

export function rowToGraphOp(row: Row & Envelope, config: GraphSinkConfig, provenance: SourceProvenance): GraphOp {
  const { _op, _key, _before: rawBefore, ...data } = row;

  if (_op === "delete") {
    const key: Record<string, unknown> = typeof _key === "string" ? JSON.parse(_key) : {};
    const nonNull = Object.fromEntries(Object.entries(data).filter(([, v]) => v != null));
    const entityId = resolve(config.entityId, { ...key, ...nonNull });
    return { kind: "archive", entityType: config.entityType, entityId, provenance, webId: config.webId };
  }

  const entityId = resolve(config.entityId, data);

  const properties: Record<string, unknown> = {};
  for (const [propUrl, accessor] of Object.entries(config.properties)) {
    properties[propUrl] = resolve(accessor, data);
  }

  const links: ResolvedLink[] = (config.links ?? [])
    .filter((l) => data[l.column] != null)
    .map((l) => {
      const resolved: ResolvedLink = { linkType: l.linkType, targetEntityType: l.targetEntityType, targetId: data[l.column] };
      if (l.properties) {
        resolved.properties = {};
        for (const [url, accessor] of Object.entries(l.properties)) {
          resolved.properties[url] = resolve(accessor, data);
        }
      }
      return resolved;
    });

  let before: Record<string, unknown> | null = null;
  if (rawBefore != null) {
    if (typeof rawBefore === "string") {
      try { before = JSON.parse(rawBefore); } catch {}
    } else if (typeof rawBefore === "object") {
      before = rawBefore as Record<string, unknown>;
    }
  }

  const staleLinks: ResolvedLink[] = [];
  if (before && config.links) {
    for (const l of config.links) {
      const oldVal = before[l.sourceColumn ?? l.column];
      const newVal = data[l.column];
      if (oldVal != null && String(oldVal) !== String(newVal)) {
        staleLinks.push({ linkType: l.linkType, targetEntityType: l.targetEntityType, targetId: oldVal });
      }
    }
  }

  return { kind: "upsert", entityType: config.entityType, entityId, properties, links, staleLinks, provenance, webId: config.webId };
}

export async function processGraphSink(
  config: GraphSinkConfig,
  inputTable: string,
  db: QueryableStore,
  client: GraphClient,
  log?: Logger,
): Promise<{ syncedIds: string[]; errors: SyncError[] }> {
  const provenance = buildProvenance(config);
  const { rows } = await db.query(`SELECT * FROM ${qi(inputTable)}`);

  // Collapse multiple events for the same entity (e.g. insert+update in one
  // commit) to the last one. Map.set keeps the position of the first occurrence.
  const latest = new Map<string, Row & Envelope>();
  for (const row of rows) {
    const id = String(resolve(config.entityId, row as Row));
    latest.set(id, row as Row & Envelope);
  }

  const syncedIds: string[] = [];
  const errors: SyncError[] = [];
  const items = [...latest.values()];

  await parallel(items, DEFAULT_CONCURRENCY, async (row) => {
    let op: GraphOp;
    try {
      op = rowToGraphOp(row, config, provenance);
    } catch (err) {
      const id = String(resolve(config.entityId, row as Row));
      errors.push(syncError("row-build", config.entityType, id, err));
      log?.error(`failed to build op for ${typeSlug(config.entityType)}/${id}: ${errMsg(err)}`);
      return;
    }
    try {
      if (op.kind === "upsert") {
        log?.info(`upsert ${typeSlug(op.entityType)} id=${String(op.entityId)} links=${op.links.length}${op.staleLinks.length ? ` stale=${op.staleLinks.length}` : ""}`);
        await client.upsertEntity(op);
        syncedIds.push(String(op.entityId));
      } else {
        log?.info(`archive ${typeSlug(op.entityType)} id=${String(op.entityId)}`);
        await client.archiveEntity(op);
      }
    } catch (err) {
      errors.push(syncError(op.kind, op.entityType, op.entityId, err));
      log?.error(`${op.kind} failed for ${typeSlug(op.entityType)}/${String(op.entityId)}: ${errMsg(err)}`);
    }
  });

  if (errors.length > 0) log?.warn(`${errors.length} op(s) failed in sink "${inputTable}"; the remaining ${syncedIds.length} succeeded`);

  return { syncedIds, errors };
}

/** An error from a single graph op or wider scope. Collected in `SyncResult.errors`. */
export type SyncError = {
  kind: "upsert" | "archive" | "stale-link" | "row-build" | "table";
  entityType: string;
  entityId: string;
  message: string;
};

/**
 * Outcome of a sink invocation. Counts and errors combine via `mergeSyncResults`;
 * `emptySyncResult()` is the starting value for aggregation.
 */
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
    errors: a.errors.length === 0 ? b.errors : b.errors.length === 0 ? a.errors : [...a.errors, ...b.errors],
    durationMs: a.durationMs + b.durationMs,
  };
}

function syncError(kind: SyncError["kind"], entityType: string, entityId: unknown, err: unknown): SyncError {
  return { kind, entityType, entityId: String(entityId), message: err instanceof Error ? err.message : String(err) };
}

export async function diffAndSync(
  sinkId: string,
  config: GraphSinkConfig,
  inputTable: string | null,
  connectorId: string,
  db: QueryableStore,
  client: GraphClient,
  log?: Logger,
  partial: boolean = false,
): Promise<SyncResult> {
  const start = Date.now();
  const provenance = buildProvenance(config);
  const entityIdCol = typeof config.entityId === "string" ? config.entityId : null;
  const currentTable = qi(`_sync/current/${sinkId}`);
  const stateTable = qi(`_state/sync/${connectorId}/${sinkId}`);

  if (!entityIdCol) throw new Error("diffAndSync requires a string entityId accessor");

  const linkCols = (config.links ?? []).map((l) => l.column);
  const linkColsSql = linkCols.map((c) => `${qi(c)}::VARCHAR AS ${qi("_lk_" + c)}`).join(", ");
  const linkColsSelect = linkCols.length > 0 ? `, ${linkColsSql}` : "";

  if (inputTable) {
    await db.exec(`CREATE OR REPLACE TABLE ${currentTable} AS
      SELECT ${qi(entityIdCol)}::VARCHAR AS _entity_id, md5(data::VARCHAR) AS _content_hash${linkColsSelect}
      FROM (SELECT * EXCLUDE (${qi("_op")}, ${qi("_key")}, ${qi("_before")}) FROM ${qi(inputTable)}) data`);
    await assertUniqueEntityIds(db, currentTable, sinkId, entityIdCol);
  } else {
    const linkColDefs = linkCols.map((c) => `${qi("_lk_" + c)} VARCHAR`).join(", ");
    await db.exec(`CREATE OR REPLACE TABLE ${currentTable} (_entity_id VARCHAR, _content_hash VARCHAR${linkColDefs ? ", " + linkColDefs : ""})`);
  }

  let hasPrevious = false;
  try {
    await db.schemaOf(`_state/sync/${connectorId}/${sinkId}`);
    hasPrevious = true;
  } catch {}

  // Partial snapshot: fold prior state rows for absent ids into current so
  // they resolve as unchanged instead of fabricated archives.
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
    const { rows: ins } = await db.query(
      `SELECT c._entity_id FROM ${currentTable} c LEFT JOIN ${stateTable} p ON c._entity_id = p._entity_id WHERE p._entity_id IS NULL`,
    );
    const { rows: upd } = await db.query(
      `SELECT c._entity_id FROM ${currentTable} c JOIN ${stateTable} p ON c._entity_id = p._entity_id WHERE c._content_hash != p._content_hash`,
    );
    const { rows: del } = await db.query(
      `SELECT p._entity_id FROM ${stateTable} p LEFT JOIN ${currentTable} c ON p._entity_id = c._entity_id WHERE c._entity_id IS NULL`,
    );
    const { rows: [{ cnt }] } = await db.query(
      `SELECT COUNT(*) AS cnt FROM ${currentTable} c JOIN ${stateTable} p ON c._entity_id = p._entity_id WHERE c._content_hash = p._content_hash`,
    );

    inserts = ins.map((r) => r._entity_id as string);
    updates = upd.map((r) => r._entity_id as string);
    deletes = del.map((r) => r._entity_id as string);
    unchanged = Number(cnt);
  }

  const failedIds = new Set<string>();
  const errors: SyncError[] = [];

  const changedIds = [...inserts, ...updates];
  if (changedIds.length > 0 && inputTable) {
    const idList = changedIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
    const { rows } = await db.query(
      `SELECT * FROM ${qi(inputTable)} WHERE CAST(${qi(entityIdCol)} AS VARCHAR) IN (${idList})`,
    );
    await parallel(rows, DEFAULT_CONCURRENCY, async (row) => {
      let op: GraphOp;
      try {
        op = rowToGraphOp(row as Row & Envelope, config, provenance);
      } catch (err) {
        const id = String((row as Row)[entityIdCol]);
        failedIds.add(id);
        errors.push(syncError("row-build", config.entityType, id, err));
        log?.error(`row-build failed for ${typeSlug(config.entityType)}/${id}: ${errMsg(err)}`);
        return;
      }
      if (op.kind !== "upsert") return;
      try {
        log?.info(`upsert ${typeSlug(op.entityType)} id=${String(op.entityId)} links=${op.links.length}`);
        await client.upsertEntity(op);
      } catch (err) {
        failedIds.add(String(op.entityId));
        errors.push(syncError("upsert", op.entityType, op.entityId, err));
        log?.error(`upsert failed for ${typeSlug(op.entityType)}/${String(op.entityId)}: ${errMsg(err)} (will retry next sync)`);
      }
    });
  }

  if (updates.length > 0 && hasPrevious && linkCols.length > 0) {
    const updList = updates.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
    for (const l of config.links ?? []) {
      const lkCol = qi("_lk_" + l.column);
      const { rows: changed } = await db.query(
        `SELECT p._entity_id, p.${lkCol} AS old_val, c.${lkCol} AS new_val
         FROM ${stateTable} p JOIN ${currentTable} c ON p._entity_id = c._entity_id
         WHERE p._entity_id IN (${updList}) AND p.${lkCol} IS NOT NULL AND p.${lkCol} != c.${lkCol}`,
      );
      for (const row of changed) {
        log?.info(`archive stale link ${typeSlug(l.linkType)} ${row._entity_id} -> ${String(row.old_val)}`);
        const staleLinkId = `${row._entity_id}::${String(row.old_val)}`;
        try {
          await client.archiveEntity({
            kind: "archive",
            entityType: l.linkType,
            entityId: staleLinkId,
            provenance,
            webId: config.webId,
          });
        } catch (err) {
          errors.push(syncError("stale-link", l.linkType, staleLinkId, err));
          log?.error(`stale-link archive failed for ${typeSlug(l.linkType)}/${staleLinkId}: ${errMsg(err)}`);
        }
      }
    }
  }

  await parallel(deletes, DEFAULT_CONCURRENCY, async (entityId) => {
    try {
      log?.info(`archive ${typeSlug(config.entityType)} id=${entityId} (removed)`);
      await client.archiveEntity({
        kind: "archive",
        entityType: config.entityType,
        entityId,
        provenance,
        webId: config.webId,
      });
    } catch (err) {
      failedIds.add(entityId);
      errors.push(syncError("archive", config.entityType, entityId, err));
      log?.error(`archive failed for ${typeSlug(config.entityType)}/${entityId}: ${errMsg(err)} (will retry next sync)`);
    }
  });

  // Keep old state for failed ids so the next sync detects them as changed and retries.
  if (failedIds.size > 0) {
    const failedIdsSql = [...failedIds].map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
    await db.exec(`DELETE FROM ${currentTable} WHERE _entity_id IN (${failedIdsSql})`);
    if (hasPrevious) {
      await db.exec(`INSERT INTO ${currentTable} SELECT * FROM ${stateTable} WHERE _entity_id IN (${failedIdsSql})`);
    }
  }
  await db.exec(`CREATE OR REPLACE TABLE ${stateTable} AS SELECT * FROM ${currentTable}`);
  await db.exec(`DROP TABLE IF EXISTS ${currentTable}`);

  const durationMs = Date.now() - start;
  const failureSummary = errors.length > 0 ? `, ${errors.length} FAILED` : "";
  log?.info(`sync: ${inserts.length} inserts, ${updates.length} updates, ${deletes.length} deletes, ${unchanged} unchanged${failureSummary} (${durationMs}ms)`);

  return { inserts: inserts.length, updates: updates.length, deletes: deletes.length, unchanged, errors, durationMs };
}

function entityIdFromKey(key: Record<string, unknown>): unknown {
  const vals = Object.values(key);
  return vals.length === 1 ? vals[0] : vals.join("::");
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
  client: GraphClient,
  log?: Logger,
): Promise<{ errors: SyncError[] }> {
  if (deletes.length === 0) return { errors: [] };
  const provenance = buildProvenance(config);
  const errors: SyncError[] = [];

  await parallel(deletes, DEFAULT_CONCURRENCY, async (del) => {
    const entityId = entityIdFromKey(del.key);
    try {
      log?.info(`archive ${typeSlug(config.entityType)} id=${String(entityId)}`);
      await client.archiveEntity({
        kind: "archive",
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
