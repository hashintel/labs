import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { QueryableStore } from "../staging/types.js";
import type { LinkPipeline } from "../transform/pipeline.js";
import type { GraphLinkOp, GraphOp, SourceProvenance, PropertyProvenance } from "./types.js";
import type { Storage } from "../storage/types.js";
import type { Logger } from "../log.js";
import { checkpointKey } from "../transform/checkpoint.js";
import { stageGraphLinks, escLiteral, syncWindow, trimmed, resolve, structHashExpr, columnTypesOf, type SyncResult } from "./sink.js";
import { executeSqlStep } from "../transform/run.js";
import { createHash } from "node:crypto";
import { HASH_VERSION, readMeta, writeMeta } from "./state-meta.js";

function linkOpId(namespace: string, webId: string, linkType: string, sourceId: string, targetId: string): string {
  return ["upsert", namespace, webId, linkType, sourceId, targetId].join("::");
}

/** Hash of the link-pipeline surface that shapes emitted ops; a change forces one re-upsert pass. */
function linkConfigHash(entry: LinkPipeline, namespace: string): string {
  const payload = {
    linkType: entry.linkType,
    namespace,
    from: { entityType: entry.from.entityType, column: entry.from.column },
    to: { entityType: entry.to.entityType, column: entry.to.column },
    properties: Object.entries(entry.properties ?? {})
      .map(([url, a]) => [url, typeof a === "string" ? a : `fn:${a.toString()}`] as const)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
    propertyColumns: [...(entry.propertyColumns ?? [])].sort(),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function linkInputs(entry: LinkPipeline): Record<string, string> {
  if (entry.source && entry.inputs && Object.keys(entry.inputs).length > 0) throw new Error(`link pipeline "${entry.id}" cannot use both source and inputs`);
  if (entry.source) return { input: entry.source };
  const inputs = entry.inputs ?? {};
  if (Object.keys(inputs).length === 0) throw new Error(`link pipeline "${entry.id}" requires source or inputs`);
  if ("input" in inputs) throw new Error(`link pipeline "${entry.id}" input alias "input" is reserved`);
  return inputs;
}

/**
 * Diff current links against `_state/links/...` and stage upserts/archives for
 * the next flush. The diff lives entirely in DuckDB; rows are pulled into JS
 * in `syncWindow()`-sized slices so peak memory is bounded regardless of link
 * count (mirrors `diffAndSync` for entities).
 */
export async function processLinkPipeline(
  entry: LinkPipeline,
  connectorId: string,
  db: QueryableStore,
  storage: Storage,
  provenance: SourceProvenance,
  log?: Logger,
): Promise<SyncResult> {
  const start = Date.now();
  const namespace = entry.idNamespace ?? connectorId;
  const inputEntries = Object.entries(linkInputs(entry));
  const srcTables = inputEntries.map(([alias]) => ({ alias, table: `_link_src/${entry.id}/${alias}` }));
  const currentTable = qi(`_link_current/${entry.id}`);
  const diffTable = qi(`_link_diff/${entry.id}`);
  const upsertTable = qi(`_link_upsert/${entry.id}`);
  const stateTable = qi(`_state/links/${connectorId}/${entry.id}`);
  const nextStateTable = qi(`_state/links-next/${connectorId}/${entry.id}`);
  const fromCol = qi(entry.from.column);
  const toCol = qi(entry.to.column);

  for (const [alias, checkpointName] of inputEntries) {
    const cpUri = storage.uriFor(checkpointKey(checkpointName));
    await db.exec(`CREATE OR REPLACE TABLE ${qi(`_link_src/${entry.id}/${alias}`)} AS SELECT * FROM read_parquet(${escLiteral(cpUri)})`);
  }

  let dataTable = srcTables.length === 1 ? srcTables[0].table : null;
  if (!dataTable && (!entry.steps || entry.steps.length === 0)) throw new Error(`link pipeline "${entry.id}" with multiple inputs requires at least one sql step`);

  for (const step of entry.steps ?? []) {
    const out = `_link_step/${step.id}`;
    await executeSqlStep(step.sql, dataTable, out, db, { namedInputs: srcTables, keepViews: true });
    dataTable = out;
  }
  if (!dataTable) throw new Error(`link pipeline "${entry.id}" did not produce an output table`);

  // Current = ids + content hash + the property columns the ops will need, so
  // upserts never re-scan the data table. The ids are the diff join key and stay
  // out of the hash; property columns are sorted so declaration order is irrelevant.
  const propColumns = [...new Set(
    entry.propertyColumns
      ?? Object.values(entry.properties ?? {}).filter((accessor): accessor is string => typeof accessor === "string"),
  )];
  const propSelect = propColumns.map((col) => `, ${qi(col)}`).join("");
  const hashExpr = structHashExpr(
    [...propColumns].sort(),
    await columnTypesOf(db, dataTable),
    (col) => log?.warn(`link pipeline "${entry.id}": property column "${col}" not in output; hashed as NULL`),
  );

  await db.exec(`CREATE OR REPLACE TABLE ${currentTable} AS
    SELECT *, ${hashExpr} AS _content_hash FROM (
      SELECT
        CAST(${fromCol} AS VARCHAR) AS _source_id,
        CAST(${toCol} AS VARCHAR) AS _target_id${propSelect}
      FROM ${qi(dataTable)}
      WHERE ${fromCol} IS NOT NULL AND ${toCol} IS NOT NULL
    )`);

  const duplicatePairs = await db.query(
    `SELECT _source_id, _target_id, COUNT(*) AS rows
     FROM ${currentTable}
     GROUP BY _source_id, _target_id
     HAVING COUNT(*) > 1
     LIMIT 5`,
  );
  if (duplicatePairs.rows.length > 0) {
    const bad = duplicatePairs.rows.map((r) => `${r._source_id}::${r._target_id} (${r.rows} rows)`).join(", ");
    throw new Error(`link pipeline "${entry.id}" produced duplicate source-target pairs: ${bad}`);
  }

  let hasPrevious = true;
  try {
    await db.schemaOf(`_state/links/${connectorId}/${entry.id}`);
  } catch {
    hasPrevious = false;
    await db.exec(`CREATE TABLE ${stateTable} (_source_id VARCHAR, _target_id VARCHAR, _content_hash VARCHAR)`);
  }

  {
    const scope = { scope: "link" as const, connectorId, sinkId: entry.id };
    const configHash = linkConfigHash(entry, namespace);
    const meta = await readMeta(db, scope);
    if (meta?.hashVersion !== HASH_VERSION || meta?.configHash !== configHash) {
      if (hasPrevious) {
        log?.info(`link pipeline "${entry.id}": content-hash algorithm or config changed; pairs with old-style hashes re-upsert once`);
      }
      await writeMeta(db, scope, {
        hashVersion: HASH_VERSION, configHash,
        graphIdentity: meta?.graphIdentity ?? null,
        webId: meta?.webId ?? null,
        namespace: meta?.namespace ?? null,
      });
    }
  }

  await db.exec(`CREATE OR REPLACE TABLE ${diffTable} AS
    SELECT
      COALESCE(c._source_id, p._source_id) AS _source_id,
      COALESCE(c._target_id, p._target_id) AS _target_id,
      CASE
        WHEN p._source_id IS NULL THEN 'insert'
        WHEN c._source_id IS NULL THEN 'delete'
        WHEN c._content_hash = p._content_hash THEN 'unchanged'
        ELSE 'update'
      END AS _diff_op
    FROM ${currentTable} c
    FULL OUTER JOIN ${stateTable} p ON c._source_id = p._source_id AND c._target_id = p._target_id`);

  const counts = await db.query(`SELECT _diff_op, COUNT(*)::BIGINT AS n FROM ${diffTable} GROUP BY _diff_op`);
  let changed = 0, deletes = 0, unchanged = 0;
  for (const r of counts.rows) {
    const n = Number(r.n);
    if (r._diff_op === "delete") deletes = n;
    else if (r._diff_op === "unchanged") unchanged = n;
    else changed += n;
  }

  const window = syncWindow();
  const propSources: PropertyProvenance = { sources: [provenance] };

  if (changed > 0) {
    await db.exec(`CREATE OR REPLACE TABLE ${upsertTable} AS
      SELECT c.*, row_number() OVER () - 1 AS "__rn"
      FROM ${currentTable} c
      JOIN ${diffTable} d ON c._source_id = d._source_id AND c._target_id = d._target_id
      WHERE d._diff_op IN ('insert', 'update')`);

    for (let offset = 0; offset < changed; offset += window) {
      const { rows } = await db.query(
        `SELECT * EXCLUDE ("__rn") FROM ${upsertTable} WHERE "__rn" >= ${offset} AND "__rn" < ${offset + window}`,
      );
      if (rows.length === 0) break;

      const linkOps: GraphLinkOp[] = rows.map((row) => {
        const sourceId = String(row._source_id);
        const targetId = String(row._target_id);
        const op: GraphLinkOp = {
          opId: linkOpId(namespace, entry.webId, entry.linkType, sourceId, targetId),
          namespace,
          webId: entry.webId,
          sourceEntityType: entry.from.entityType,
          sourceEntityId: sourceId,
          linkType: entry.linkType,
          targetEntityType: entry.to.entityType,
          targetId,
          provenance,
        };
        if (entry.properties) {
          op.properties = {};
          op.propertyProvenance = {};
          for (const [url, accessor] of Object.entries(entry.properties)) {
            op.properties[url] = trimmed(resolve(accessor, row));
            op.propertyProvenance[url] = propSources;
          }
        }
        return op;
      });
      await stageGraphLinks(db, connectorId, entry.id, linkOps, [], log);
    }
    await db.exec(`DROP TABLE IF EXISTS ${upsertTable}`);
  }

  if (deletes > 0) {
    let cursor: [string, string] | null = null;
    for (;;) {
      const after = cursor ? ` AND (_source_id, _target_id) > (${escLiteral(cursor[0])}, ${escLiteral(cursor[1])})` : "";
      const { rows } = await db.query(
        `SELECT _source_id, _target_id FROM ${diffTable}
         WHERE _diff_op = 'delete'${after}
         ORDER BY _source_id, _target_id LIMIT ${window}`,
      );
      if (rows.length === 0) break;
      const last = rows[rows.length - 1];
      cursor = [String(last._source_id), String(last._target_id)];

      const archiveOps: Extract<GraphOp, { kind: "archive" }>[] = rows.map((r) => ({
        kind: "archive" as const,
        namespace,
        entityType: entry.linkType,
        entityId: `${entry.from.entityType}::${r._source_id}::${entry.to.entityType}::${r._target_id}`,
        provenance,
        webId: entry.webId,
      }));
      await stageGraphLinks(db, connectorId, entry.id, [], archiveOps, log);
    }
  }

  // Stage the intended next state with each row's flush op id; flushGraphLinks
  // commits only the rows whose op actually left the pending table (succeeded),
  // so a failed flush never records phantom links as synced.
  const idPrefix = `${escLiteral(namespace)}, ${escLiteral(entry.webId)}, ${escLiteral(entry.linkType)}`;
  const upsertOpId = (src: string, tgt: string) => `CONCAT_WS('::', 'upsert', ${idPrefix}, ${src}, ${tgt})`;
  const archiveOpId = (src: string, tgt: string) =>
    `CONCAT_WS('::', 'archive', ${idPrefix}, ${escLiteral(entry.from.entityType)}, ${src}, ${escLiteral(entry.to.entityType)}, ${tgt})`;
  await db.exec(`CREATE OR REPLACE TABLE ${nextStateTable} AS
    SELECT _source_id, _target_id, _content_hash, 'upsert' AS _op_kind, ${upsertOpId("_source_id", "_target_id")} AS _op_id
    FROM ${currentTable}
    UNION ALL
    SELECT p._source_id, p._target_id, p._content_hash, 'archive' AS _op_kind, ${archiveOpId("p._source_id", "p._target_id")} AS _op_id
    FROM ${stateTable} p
    LEFT JOIN ${currentTable} c ON c._source_id = p._source_id AND c._target_id = p._target_id
    WHERE c._source_id IS NULL`);

  await db.exec(`DROP TABLE IF EXISTS ${currentTable}`);
  await db.exec(`DROP TABLE IF EXISTS ${diffTable}`);
  for (const { alias, table } of srcTables) {
    await db.exec(`DROP VIEW IF EXISTS ${qi(alias)}`);
    await db.exec(`DROP TABLE IF EXISTS ${qi(table)}`);
  }
  await db.exec(`DROP VIEW IF EXISTS "input"`);
  for (const step of entry.steps ?? []) {
    await db.exec(`DROP TABLE IF EXISTS ${qi(`_link_step/${step.id}`)}`);
  }

  const durationMs = Date.now() - start;
  log?.info(`link pipeline "${entry.id}": ${changed} upserts, ${deletes} archives, ${unchanged} unchanged (${durationMs}ms)`);

  // Staged ops surface their errors at flush time; nothing can fail here short of a thrown SQL error.
  return { inserts: changed, updates: 0, deletes, unchanged, errors: [], durationMs };
}
