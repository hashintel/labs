import { createHash } from "node:crypto";
import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { QueryableStore } from "../staging/types.js";
import type { ChangeEvent } from "../connector/types.js";
import type { Accessor, GraphSinkConfig, Row, Envelope } from "../transform/pipeline.js";
import type { GraphLinkOp, GraphOp, SourceProvenance, PropertyProvenance, GraphClient } from "./types.js";
import { typedValueReplacer, typedValueReviver } from "./types.js";
import type { Logger } from "../log.js";
import { parallel } from "../parallel.js";
import { GraphApiError } from "./client.js";
import { HASH_VERSION, readMeta, writeMeta } from "./state-meta.js";

export { parallel };

const DEFAULT_CONCURRENCY = Math.max(1, Number(process.env.HASH_GRAPH_CONCURRENCY ?? 16));

// Rows held in memory per window, bounding peak memory regardless of table size.
export function syncWindow(): number {
  return Math.max(1, Number(process.env.HASH_SYNC_WINDOW ?? 20000));
}

export function resolve(accessor: Accessor, data: Row): unknown {
  return typeof accessor === "string" ? data[accessor] : accessor(data);
}

// Source text is often fixed-width padded; trim string property values (blank -> null).
export function trimmed(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const t = value.trim();
  return t === "" ? null : t;
}

// Suffixes location.name with the source field, e.g. `acme/marc` -> `acme/marc/WEBAZ`.
function withField(base: SourceProvenance, field: string): PropertyProvenance {
  const baseName = base.location?.name;
  const name = baseName ? `${baseName}/${field}` : field;
  return { sources: [{ ...base, location: { ...base.location, name } }] };
}

function applyProvenanceFields(base: SourceProvenance, data: Row, fields: GraphSinkConfig["provenanceFields"]): SourceProvenance {
  if (!fields) return base;
  const str = (accessor: Accessor | undefined): string | undefined => {
    if (accessor == null) return undefined;
    const v = resolve(accessor, data);
    if (v == null) return undefined;
    const s = String(v).trim();
    return s === "" ? undefined : s;
  };
  // Provenance timestamps need RFC3339; promote date-only values to midnight UTC.
  const ts = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  const authors = str(fields.authors);
  const firstPublished = ts(str(fields.firstPublished));
  const lastUpdated = ts(str(fields.lastUpdated));
  if (authors === undefined && firstPublished === undefined && lastUpdated === undefined) return base;
  return {
    ...base,
    ...(authors !== undefined ? { authors: [authors] } : {}),
    ...(firstPublished !== undefined ? { firstPublished } : {}),
    ...(lastUpdated !== undefined ? { lastUpdated } : {}),
  };
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

  const prov = applyProvenanceFields(provenance, data, config.provenanceFields);
  const propSources: PropertyProvenance = { sources: [prov] };
  const properties: Record<string, unknown> = {};
  const propertyProvenance: Record<string, PropertyProvenance> = {};
  for (const [propUrl, accessor] of Object.entries(config.properties)) {
    properties[propUrl] = trimmed(resolve(accessor, data));
    const field = config.propertyFields?.[propUrl];
    propertyProvenance[propUrl] = field ? withField(prov, field) : propSources;
  }

  return { kind: "upsert", namespace, entityType: config.entityType, entityId, properties, propertyProvenance, provenance: prov, webId: config.webId };
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
  // Circuit breaker tripped: remaining ops unattempted, treat the step as failed.
  aborted?: boolean;
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
    ...(a.aborted || b.aborted ? { aborted: true } : {}),
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
    ...linkOps.map((op) => ({ id: op.opId, operation: "upsert", payload: JSON.stringify(op, typedValueReplacer) })),
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
    const payload = JSON.parse(String(row.payload), typedValueReviver) as GraphLinkOp | Extract<GraphOp, { kind: "archive" }>;
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

  let flushAborted = false;
  if (linkOps.length > 0) {
    log?.info(`${tag}: starting bulk upsert of ${linkOps.length} link(s) in ${Math.ceil(linkOps.length / 128)} batches`);
    const onProgress = bulkProgressLogger(label ?? "links", log);
    const { ok, failed, batches, fellBackBatches, durationMs, aborted } = await client.bulkUpsertLinks(linkOps, {
      onProgress,
      onBatchOk: (opIds) => deletePendingLinks(db, connectorId, opIds),
      onFailure: failureLogger(log, ({ op, error }) =>
        `link-upsert failed for ${typeSlug(op.linkType)}/${String(op.sourceEntityId)}::${String(op.targetId)}: ${errMsg(error)} (will retry next sync)`),
      onBatchFallback: batchFallbackLogger(tag, log),
    });
    const perSec = durationMs > 0 ? Math.round((ok.length / durationMs) * 1000) : 0;
    log?.info(`bulk-upsert ${label ?? "links"}: ${ok.length}/${linkOps.length} ok, ${failed.length} failed, ${batches} batches (${fellBackBatches} fell back) in ${durationMs}ms (${perSec}/s)`);
    if (aborted || (failed.length > 0 && ok.length === 0)) {
      flushAborted = true;
      log?.error(`${tag}: ${aborted ? "ABORTED" : "no link op succeeded"} (${failed.length} failures, 0 ok) -- systemic failure (graph down? wrong actor? missing link targets?). ${linkOps.length - ok.length - failed.length} op(s) unattempted; all stay pending for the next sync.`);
    }
    for (const { op, error } of failed) {
      errors.push(syncError("link-upsert", op.linkType, `${String(op.sourceEntityId)}::${String(op.targetId)}`, error));
    }
  }

  await commitLinkState(db, connectorId, table, label);

  const durationMs = Date.now() - start;
  if (rows.length > 0) {
    const failureSummary = errors.length > 0 ? `, ${errors.length} FAILED` : "";
    log?.info(`link sync: ${rows.length - errors.length} done${failureSummary} (${durationMs}ms)`);
  }
  return { ...emptySyncResult(), errors, durationMs, ...(flushAborted ? { aborted: true } : {}) };
}

const NEXT_LINK_STATE_PREFIX = "_state/links-next";

// Finalize `_state/links/...` from the staged next state, keeping only ops that
// left the pending table: upserts that flushed, and archives that did NOT (their
// link still exists, so it stays recorded for a retry next run).
async function commitLinkState(db: QueryableStore, connectorId: string, pendingTable: string, label?: string): Promise<void> {
  const prefix = `${NEXT_LINK_STATE_PREFIX}/${connectorId}/`;
  const match = label ? `${prefix}${label}` : null;
  const { rows } = await db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_name LIKE ${escLiteral(`${prefix}%`)}${match ? ` AND table_name = ${escLiteral(match)}` : ""}`,
  );
  for (const row of rows) {
    const nextStateName = String(row.table_name);
    const sinkId = nextStateName.slice(prefix.length);
    const nextStateTable = qi(nextStateName);
    const stateTable = qi(`_state/links/${connectorId}/${sinkId}`);
    await db.exec(`CREATE OR REPLACE TABLE ${stateTable} AS
      SELECT n._source_id, n._target_id, n._content_hash
      FROM ${nextStateTable} n
      LEFT JOIN ${qi(pendingTable)} p ON p.op_id = n._op_id
      WHERE (n._op_kind = 'upsert' AND p.op_id IS NULL)
         OR (n._op_kind = 'archive' AND p.op_id IS NOT NULL)`);
    await db.exec(`DROP TABLE IF EXISTS ${nextStateTable}`);
  }
}

/**
 * md5 over a struct of the given columns. Struct-to-VARCHAR rendering is injective
 * (NULL vs 'NULL' distinguished, delimiters quoted), unlike CONCAT_WS which drops
 * NULLs positionally. VARCHAR columns mirror trimmed(): TRIM + blank-to-NULL.
 */
export function structHashExpr(cols: readonly string[], columnTypes: Map<string, string>, onMissing?: (col: string) => void): string {
  if (cols.length === 0) return `md5('')`;
  const fields = cols.map((col, i) => {
    if (!columnTypes.has(col)) {
      onMissing?.(col);
      return `p${i} := NULL`;
    }
    const expr = columnTypes.get(col) === "VARCHAR" ? `NULLIF(TRIM(${qi(col)}), '')` : qi(col);
    return `p${i} := ${expr}`;
  });
  return `md5(struct_pack(${fields.join(", ")})::VARCHAR)`;
}

/**
 * Content-hash expression over exactly the columns the sink maps into the emitted op:
 * sorted-by-URL property columns plus provenanceFields columns. The entityId column is
 * the diff join key and stays out. Returns null when any accessor is a function; the
 * caller falls back to the whole-row hash (conservative: output changes imply some
 * input column changed).
 */
export function canonicalHashExpr(config: GraphSinkConfig, columnTypes: Map<string, string>, log?: Logger): string | null {
  const accessors = [
    ...Object.entries(config.properties)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, accessor]) => accessor),
    config.provenanceFields?.authors,
    config.provenanceFields?.firstPublished,
    config.provenanceFields?.lastUpdated,
  ].filter((a): a is Accessor => a != null);
  if (accessors.some((a) => typeof a !== "string")) return null;
  return structHashExpr(accessors as string[], columnTypes, (col) =>
    log?.warn(`content hash: column "${col}" not in pipeline output; hashed as NULL (property will be null)`));
}

function accessorRepr(a: Accessor | undefined): string | null {
  if (a == null) return null;
  return typeof a === "string" ? a : `fn:${a.toString()}`;
}

/** Hash of the config surface that shapes emitted ops; a change forces one re-upsert pass. */
export function sinkConfigHash(config: GraphSinkConfig, connectorId: string): string {
  const payload = {
    entityType: config.entityType,
    entityId: accessorRepr(config.entityId),
    namespace: config.idNamespace ?? connectorId,
    properties: Object.entries(config.properties)
      .map(([url, a]) => [url, accessorRepr(a)] as const)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
    propertyFields: Object.entries(config.propertyFields ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)),
    provenanceFields: {
      authors: accessorRepr(config.provenanceFields?.authors),
      firstPublished: accessorRepr(config.provenanceFields?.firstPublished),
      lastUpdated: accessorRepr(config.provenanceFields?.lastUpdated),
    },
    provenance: config.provenance ?? null,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function columnTypesOf(db: QueryableStore, table: string): Promise<Map<string, string>> {
  const { rows } = await db.query(`DESCRIBE ${qi(table)}`);
  return new Map(rows.map((r) => [String(r.column_name), String(r.column_type)]));
}

/**
 * Per mapped property, the share of rows with a value. An always-empty source
 * column silently yields an entity property that never populates; surface it.
 */
async function reportPropertyCoverage(
  db: QueryableStore,
  inputTable: string,
  config: GraphSinkConfig,
  columnTypes: Map<string, string>,
  sinkId: string,
  log?: Logger,
): Promise<void> {
  if (!log) return;
  const mapped = Object.entries(config.properties)
    .filter((e): e is [string, string] => typeof e[1] === "string")
    .filter(([, col]) => columnTypes.has(col));
  if (mapped.length === 0) return;

  const cols = [...new Set(mapped.map(([, col]) => col))];
  const aggs = cols.map((col, i) => `COUNT(NULLIF(TRIM(${qi(col)}::VARCHAR), '')) AS ${qi(`c${i}`)}`);
  const { rows } = await db.query(`SELECT COUNT(*)::BIGINT AS _total, ${aggs.join(", ")} FROM ${qi(inputTable)}`);
  const total = Number(rows[0]?._total ?? 0);
  if (total === 0) return;

  const empty: string[] = [];
  const parts = cols.map((col, i) => {
    const pct = (100 * Number(rows[0][`c${i}`])) / total;
    if (pct === 0) empty.push(col);
    return `${col} ${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
  });
  log.debug(`coverage ${typeSlug(config.entityType)}: ${parts.join(", ")}`);
  if (empty.length > 0) {
    log.warn(`sink "${sinkId}": mapped column(s) with NO values in ${total} rows: ${empty.join(", ")} (property will never populate)`);
  }
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

  let canonical = false;
  if (inputTable) {
    const columnTypes = await columnTypesOf(db, inputTable);
    await reportPropertyCoverage(db, inputTable, config, columnTypes, sinkId, log);
    const hashExpr = canonicalHashExpr(config, columnTypes, log);
    canonical = hashExpr != null;
    if (hashExpr) {
      await db.exec(`CREATE OR REPLACE TABLE ${currentTable} AS
        SELECT ${qi(entityIdCol)}::VARCHAR AS _entity_id, ${hashExpr} AS _content_hash
        FROM ${qi(inputTable)}`);
    } else {
      // Function accessors: hash every non-envelope column (conservative superset).
      await db.exec(`CREATE OR REPLACE TABLE ${currentTable} AS
        SELECT ${qi(entityIdCol)}::VARCHAR AS _entity_id, md5(data::VARCHAR) AS _content_hash
        FROM (SELECT * EXCLUDE (${qi("_op")}, ${qi("_key")}, ${qi("_before")}) FROM ${qi(inputTable)}) data`);
    }
    await assertUniqueEntityIds(db, currentTable, sinkId, entityIdCol);
  } else {
    await db.exec(`CREATE OR REPLACE TABLE ${currentTable} (_entity_id VARCHAR, _content_hash VARCHAR)`);
  }

  let hasPrevious = false;
  try {
    await db.schemaOf(`_state/sync/${connectorId}/${sinkId}`);
    hasPrevious = true;
  } catch {}

  // Hash-algorithm or sink-config changes must not mis-diff. State rows carrying
  // old-style hashes simply classify as updates once (upserts are PATCH-idempotent)
  // and converge; deletes stay id-based throughout. Version the newly written hashes.
  if (inputTable) {
    const scope = { scope: "entity" as const, connectorId, sinkId };
    const hashVersion = canonical ? HASH_VERSION : 1;
    const configHash = sinkConfigHash(config, connectorId);
    const meta = await readMeta(db, scope);
    if (meta?.hashVersion !== hashVersion || meta?.configHash !== configHash) {
      if (hasPrevious) {
        log?.info(`sink "${sinkId}": content-hash algorithm or config changed (v${meta?.hashVersion ?? "?"} -> v${hashVersion}); rows with old-style hashes re-upsert once`);
      }
      await writeMeta(db, scope, {
        hashVersion, configHash,
        graphIdentity: meta?.graphIdentity ?? null,
        webId: meta?.webId ?? null,
        namespace: meta?.namespace ?? null,
      });
    }
  }

  if (partial && hasPrevious) {
    await db.exec(`INSERT INTO ${currentTable}
      SELECT * FROM ${stateTable}
      WHERE _entity_id NOT IN (SELECT _entity_id FROM ${currentTable})`);
  }

  const errors: SyncError[] = [];
  if (!hasPrevious) await db.exec(`CREATE TABLE ${stateTable} AS SELECT * FROM ${currentTable} WHERE 1=0`);

  // Classify in DuckDB; the diff table holds only id + op, rows fetched later in windows.
  const diffTable = qi(`_diff/${connectorId}/${sinkId}`);
  await db.exec(`CREATE OR REPLACE TABLE ${diffTable} AS
    SELECT
      COALESCE(c._entity_id, p._entity_id) AS _entity_id,
      CASE
        WHEN p._entity_id IS NULL THEN 'insert'
        WHEN c._entity_id IS NULL THEN 'delete'
        WHEN c._content_hash = p._content_hash THEN 'unchanged'
        ELSE 'update'
      END AS _diff_op
    FROM ${currentTable} c
    FULL OUTER JOIN ${stateTable} p ON c._entity_id = p._entity_id`);

  const counts = await db.query(`SELECT _diff_op, COUNT(*)::BIGINT AS n FROM ${diffTable} GROUP BY _diff_op`);
  let inserts = 0, updates = 0, deletes = 0, unchanged = 0;
  for (const r of counts.rows) {
    const n = Number(r.n);
    switch (r._diff_op) {
      case "insert":    inserts = n; break;
      case "update":    updates = n; break;
      case "delete":    deletes = n; break;
      case "unchanged": unchanged = n; break;
    }
  }

  // A truncated or wrong source file shows up as a mass delete; no fingerprint can
  // catch it because the target graph is unchanged. Refuse before any write.
  const stateRows = updates + deletes + unchanged;
  if (deletes > Math.max(1000, stateRows * 0.5) && process.env.HASH_ALLOW_MASS_ARCHIVE !== "1") {
    await db.exec(`DROP TABLE IF EXISTS ${currentTable}`);
    await db.exec(`DROP TABLE IF EXISTS ${diffTable}`);
    throw new Error(
      `sink "${sinkId}": refusing to archive ${deletes} of ${stateRows} previously synced rows ` +
      `(truncated source file?). Set HASH_ALLOW_MASS_ARCHIVE=1 if this mass archive is intended.`,
    );
  }

  const namespace = config.idNamespace ?? connectorId;

  const commitSlice = async (ids: string[]) => {
    if (ids.length === 0) return;
    const idList = inList(ids);
    await db.exec(`DELETE FROM ${stateTable} WHERE _entity_id IN (${idList})`);
    await db.exec(`INSERT INTO ${stateTable} SELECT * FROM ${currentTable} WHERE _entity_id IN (${idList})`);
  };

  const window = syncWindow();
  const changedTotal = inserts + updates;
  let syncAborted = false;
  if (changedTotal > 0 && inputTable) {
    const slug = typeSlug(config.entityType);
    // Stage changed rows with a window index, then stream out one window at a time.
    const upsertTable = qi(`_upsert/${connectorId}/${sinkId}`);
    await db.exec(`CREATE OR REPLACE TABLE ${upsertTable} AS
      SELECT i.*, row_number() OVER () - 1 AS "__rn"
      FROM ${qi(inputTable)} i
      JOIN ${diffTable} d ON CAST(i.${qi(entityIdCol)} AS VARCHAR) = d._entity_id
      WHERE d._diff_op IN ('insert', 'update')`);

    log?.info(`bulk-upsert ${slug}: ${changedTotal} changed, streaming in windows of ${window}`);
    const overall = bulkProgressLogger(slug, log);
    let okTotal = 0, failedTotal = 0;
    for (let offset = 0; offset < changedTotal; offset += window) {
      const { rows } = await db.query(
        `SELECT * EXCLUDE ("__rn") FROM ${upsertTable} WHERE "__rn" >= ${offset} AND "__rn" < ${offset + window}`,
      );
      if (rows.length === 0) break;

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
      let windowAborted = false;
      if (ops.length > 0) {
        const { ok, failed, aborted } = await client.bulkUpsertEntities(ops, {
          onFailure: failureLogger(log, ({ op, error }) =>
            `upsert failed for ${typeSlug(op.entityType)}/${String(op.entityId)}: ${errMsg(error)} (will retry next sync)`),
          onBatchFallback: batchFallbackLogger(slug, log),
        });
        await commitSlice(ok);
        okTotal += ok.length;
        failedTotal += failed.length;
        windowAborted = aborted ?? false;
        for (const { op, error } of failed) {
          errors.push(syncError("upsert", op.entityType, op.entityId, error));
        }
      }
      overall(Math.min(offset + rows.length, changedTotal), changedTotal);
      if (windowAborted) {
        syncAborted = true;
        log?.error(`bulk-upsert ${slug}: ABORTED -- no batch succeeded; failed/unattempted rows retry next sync`);
        break;
      }
    }
    await db.exec(`DROP TABLE IF EXISTS ${upsertTable}`);
    // All-failed (too small to trip the batch-streak breaker) is still systemic.
    if (failedTotal > 0 && okTotal === 0) syncAborted = true;
    log?.info(`bulk-upsert ${slug}: ${okTotal}/${changedTotal} ok, ${failedTotal} failed`);
  }

  if (deletes > 0) {
    let cursor = "";
    for (;;) {
      const { rows } = await db.query(
        `SELECT _entity_id FROM ${diffTable}
         WHERE _diff_op = 'delete' AND _entity_id > ${escLiteral(cursor)}
         ORDER BY _entity_id LIMIT ${window}`,
      );
      if (rows.length === 0) break;
      cursor = String(rows[rows.length - 1]._entity_id);
      const ids = rows.map((r) => r._entity_id as string);
      await parallel(ids, DEFAULT_CONCURRENCY, async (entityId) => {
        try {
          log?.info(`archive ${typeSlug(config.entityType)} id=${entityId} (removed)`);
          await client.archiveEntity({ kind: "archive", namespace, entityType: config.entityType, entityId, provenance, webId: config.webId });
          await db.exec(`DELETE FROM ${stateTable} WHERE _entity_id = ${escLiteral(entityId)}`);
        } catch (err) {
          errors.push(syncError("archive", config.entityType, entityId, err));
          log?.error(`archive failed for ${typeSlug(config.entityType)}/${entityId}: ${errMsg(err)} (will retry next sync)`);
        }
      });
    }
  }

  await db.exec(`DROP TABLE IF EXISTS ${currentTable}`);
  await db.exec(`DROP TABLE IF EXISTS ${diffTable}`);

  const durationMs = Date.now() - start;
  const failureSummary = errors.length > 0 ? `, ${errors.length} FAILED` : "";
  log?.info(`sync: ${inserts} inserts, ${updates} updates, ${deletes} deletes, ${unchanged} unchanged${failureSummary} (${durationMs}ms)`);

  return { inserts, updates, deletes, unchanged, errors, durationMs, ...(syncAborted ? { aborted: true } : {}) };
}

// Logs the first few batch rejections (with the db error tail), then goes quiet.
export function batchFallbackLogger(tag: string, log: Logger | undefined): (error: Error) => void {
  let count = 0;
  return (error) => {
    if (++count <= 3) {
      const detail = error instanceof GraphApiError ? `${error.status}: ${error.body.slice(0, 600)}` : errMsg(error).slice(0, 600);
      log?.warn(`${tag}: bulk batch rejected (${detail}); retrying per-op`);
    } else if (count === 4) {
      log?.warn(`${tag}: further batch rejections not logged individually (see summary)`);
    }
  };
}

// Logs the first few failures, then samples; the summary carries the total.
export function failureLogger<F>(log: Logger | undefined, render: (failure: F) => string): (failure: F) => void {
  let count = 0;
  return (failure) => {
    count++;
    if (count <= 5 || count % 1000 === 0) {
      log?.error(render(failure) + (count === 5 ? " (further failures sampled 1/1000)" : ""));
    }
  };
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
