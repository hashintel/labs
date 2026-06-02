import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { QueryableStore } from "../staging/types.js";
import type { LinkPipeline } from "../transform/pipeline.js";
import type { GraphLinkOp, GraphOp, SourceProvenance, PropertyProvenance } from "./types.js";
import type { Storage } from "../storage/types.js";
import type { Logger } from "../log.js";
import { checkpointKey } from "../transform/checkpoint.js";
import { stageGraphLinks, type SyncResult, type SyncError } from "./sink.js";
import { executeSqlStep } from "../transform/run.js";

function linkOpId(namespace: string, webId: string, linkType: string, sourceId: string, targetId: string): string {
  return ["upsert", namespace, webId, linkType, sourceId, targetId].join("::");
}

function linkInputs(entry: LinkPipeline): Record<string, string> {
  if (entry.source && entry.inputs && Object.keys(entry.inputs).length > 0) throw new Error(`link pipeline "${entry.id}" cannot use both source and inputs`);
  if (entry.source) return { input: entry.source };
  const inputs = entry.inputs ?? {};
  if (Object.keys(inputs).length === 0) throw new Error(`link pipeline "${entry.id}" requires source or inputs`);
  if ("input" in inputs) throw new Error(`link pipeline "${entry.id}" input alias "input" is reserved`);
  return inputs;
}

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
  const inputs = linkInputs(entry);
  const inputEntries = Object.entries(inputs);
  const srcTables = inputEntries.map(([alias]) => ({ alias, table: `_link_src/${entry.id}/${alias}` }));
  const currentTable = `_link_current/${entry.id}`;
  const stateTable = `_state/links/${connectorId}/${entry.id}`;
  const fromCol = qi(entry.from.column);
  const toCol = qi(entry.to.column);

  for (const [alias, checkpointName] of inputEntries) {
    const cpUri = storage.uriFor(checkpointKey(checkpointName));
    const srcTable = `_link_src/${entry.id}/${alias}`;
    await db.exec(`CREATE OR REPLACE TABLE ${qi(srcTable)} AS SELECT * FROM read_parquet('${cpUri.replace(/'/g, "''")}')`);
  }

  let dataTable = srcTables.length === 1 ? srcTables[0].table : null;
  if (!dataTable && (!entry.steps || entry.steps.length === 0)) throw new Error(`link pipeline "${entry.id}" with multiple inputs requires at least one sql step`);

  if (entry.steps) {
    for (const step of entry.steps) {
      const out = `_link_step/${step.id}`;
      await executeSqlStep(step.sql, dataTable, out, db, { namedInputs: srcTables, keepViews: true });
      dataTable = out;
    }
  }
  if (!dataTable) throw new Error(`link pipeline "${entry.id}" did not produce an output table`);

  const hasPropCols = entry.properties && Object.keys(entry.properties).length > 0;
  const propColsSql = hasPropCols
    ? `, md5(CONCAT_WS('::', ${Object.values(entry.properties!).map((col) => qi(col)).join(", ")})) AS _prop_hash`
    : "";
  const hashExpr = hasPropCols ? `md5(CONCAT_WS('::', _source_id, _target_id, _prop_hash))` : `md5(CONCAT_WS('::', _source_id, _target_id))`;

  await db.exec(`CREATE OR REPLACE TABLE ${qi(currentTable)} AS
    SELECT
      CAST(${fromCol} AS VARCHAR) AS _source_id,
      CAST(${toCol} AS VARCHAR) AS _target_id${propColsSql},
      ${hashExpr} AS _content_hash
    FROM ${qi(dataTable)}
    WHERE ${fromCol} IS NOT NULL AND ${toCol} IS NOT NULL`);

  const duplicatePairs = await db.query(
    `SELECT _source_id, _target_id, COUNT(*) AS rows, COUNT(DISTINCT _content_hash) AS variants
     FROM ${qi(currentTable)}
     GROUP BY _source_id, _target_id
     HAVING COUNT(*) > 1
     LIMIT 5`,
  );
  if (duplicatePairs.rows.length > 0) {
    const bad = duplicatePairs.rows.map((r) => `${r._source_id}::${r._target_id} (${r.rows} rows)`).join(", ");
    throw new Error(`link pipeline "${entry.id}" produced duplicate source-target pairs: ${bad}`);
  }

  let hasPrevious = false;
  try {
    await db.schemaOf(stateTable);
    hasPrevious = true;
  } catch {}

  let newLinks: Array<{ sourceId: string; targetId: string }>;
  let staleLinks: Array<{ sourceId: string; targetId: string }>;
  let unchanged: number;

  if (!hasPrevious) {
    const { rows } = await db.query(`SELECT _source_id, _target_id FROM ${qi(currentTable)}`);
    newLinks = rows.map((r) => ({ sourceId: r._source_id as string, targetId: r._target_id as string }));
    staleLinks = [];
    unchanged = 0;
  } else {
    const { rows } = await db.query(
      `SELECT
         COALESCE(c._source_id, p._source_id) AS _source_id,
         COALESCE(c._target_id, p._target_id) AS _target_id,
         CASE
           WHEN p._source_id IS NULL OR p._target_id IS NULL THEN 'insert'
           WHEN c._source_id IS NULL OR c._target_id IS NULL THEN 'delete'
           WHEN c._content_hash = p._content_hash THEN 'unchanged'
           ELSE 'update'
         END AS op
       FROM ${qi(currentTable)} c
       FULL OUTER JOIN ${qi(stateTable)} p ON c._source_id = p._source_id AND c._target_id = p._target_id`,
    );

    newLinks = [];
    staleLinks = [];
    unchanged = 0;
    for (const r of rows) {
      switch (r.op) {
        case "insert":
        case "update":
          newLinks.push({ sourceId: r._source_id as string, targetId: r._target_id as string });
          break;
        case "delete":
          staleLinks.push({ sourceId: r._source_id as string, targetId: r._target_id as string });
          break;
        case "unchanged":
          unchanged++;
          break;
      }
    }
  }

  if (!hasPrevious) {
    await db.exec(`CREATE TABLE ${qi(stateTable)} AS SELECT _source_id, _target_id, _content_hash FROM ${qi(currentTable)} WHERE 1=0`);
  }

  const propSources: PropertyProvenance = { sources: [provenance] };
  const linkOps: GraphLinkOp[] = [];

  if (newLinks.length > 0) {
    const dataRows = entry.properties
      ? (await db.query(`SELECT * FROM ${qi(dataTable)} WHERE ${fromCol} IS NOT NULL AND ${toCol} IS NOT NULL`)).rows
      : null;

    const rowIndex = new Map<string, Record<string, unknown>>();
    if (dataRows) {
      for (const row of dataRows) {
        const key = `${String(row[entry.from.column])}::${String(row[entry.to.column])}`;
        rowIndex.set(key, row);
      }
    }

    for (const { sourceId, targetId } of newLinks) {
      const opId = linkOpId(namespace, entry.webId, entry.linkType, sourceId, targetId);
      const op: GraphLinkOp = {
        opId,
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
        const row = rowIndex?.get(`${sourceId}::${targetId}`);
        if (row) {
          op.properties = {};
          op.propertyProvenance = {};
          for (const [url, column] of Object.entries(entry.properties)) {
            op.properties[url] = row[column];
            op.propertyProvenance[url] = propSources;
          }
        }
      }
      linkOps.push(op);
    }
  }

  const archiveOps: Extract<GraphOp, { kind: "archive" }>[] = staleLinks.map(({ sourceId, targetId }) => ({
    kind: "archive" as const,
    namespace,
    entityType: entry.linkType,
    entityId: `${sourceId}::${targetId}`,
    provenance,
    webId: entry.webId,
  }));

  const errors: SyncError[] = [];

  await stageGraphLinks(db, connectorId, entry.id, linkOps, archiveOps, log);

  await db.exec(`DELETE FROM ${qi(stateTable)}`);
  await db.exec(`INSERT INTO ${qi(stateTable)} SELECT _source_id, _target_id, _content_hash FROM ${qi(currentTable)}`);

  await db.exec(`DROP TABLE IF EXISTS ${qi(currentTable)}`);
  for (const { alias, table } of srcTables) {
    await db.exec(`DROP VIEW IF EXISTS ${qi(alias)}`);
    await db.exec(`DROP TABLE IF EXISTS ${qi(table)}`);
  }
  await db.exec(`DROP VIEW IF EXISTS "input"`);
  if (entry.steps) {
    for (const step of entry.steps) {
      await db.exec(`DROP TABLE IF EXISTS ${qi(`_link_step/${step.id}`)}`);
    }
  }

  const durationMs = Date.now() - start;
  log?.info(`link pipeline "${entry.id}": ${newLinks.length} upserts, ${staleLinks.length} archives, ${unchanged} unchanged (${durationMs}ms)`);

  return {
    inserts: newLinks.length,
    updates: 0,
    deletes: staleLinks.length,
    unchanged,
    errors,
    durationMs,
  };
}
