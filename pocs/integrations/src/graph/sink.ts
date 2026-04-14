import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { QueryableStore } from "../staging/types.js";
import type { ChangeEvent } from "../connector/types.js";
import type { Accessor, GraphSinkConfig, Row, Envelope } from "../transform/pipeline.js";
import type { GraphOp, ResolvedLink, SourceProvenance, GraphClient } from "./types.js";
import type { Logger } from "../log.js";

function resolve(accessor: Accessor, data: Row): unknown {
  return typeof accessor === "string" ? data[accessor] : accessor(data);
}

function typeSlug(url: string): string {
  return url.split("/entity-type/")[1] ?? url;
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
): Promise<string[]> {
  const provenance = buildProvenance(config);
  const { rows } = await db.query(`SELECT * FROM ${qi(inputTable)}`);
  const syncedIds: string[] = [];

  for (const row of rows) {
    const op = rowToGraphOp(row as Row & Envelope, config, provenance);
    switch (op.kind) {
      case "upsert":
        log?.info(`upsert ${typeSlug(op.entityType)} id=${String(op.entityId)} links=${op.links.length}${op.staleLinks.length ? ` stale=${op.staleLinks.length}` : ""}`);
        await client.upsertEntity(op);
        syncedIds.push(String(op.entityId));
        break;
      case "archive":
        log?.info(`archive ${typeSlug(op.entityType)} id=${String(op.entityId)}`);
        await client.archiveEntity(op);
        break;
    }
  }

  return syncedIds;
}

export type SyncResult = {
  inserts: number;
  updates: number;
  deletes: number;
  unchanged: number;
  durationMs: number;
};

export async function diffAndSync(
  sinkId: string,
  config: GraphSinkConfig,
  inputTable: string | null,
  connectorId: string,
  db: QueryableStore,
  client: GraphClient,
  log?: Logger,
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
  } else {
    const linkColDefs = linkCols.map((c) => `${qi("_lk_" + c)} VARCHAR`).join(", ");
    await db.exec(`CREATE OR REPLACE TABLE ${currentTable} (_entity_id VARCHAR, _content_hash VARCHAR${linkColDefs ? ", " + linkColDefs : ""})`);
  }

  let hasPrevious = false;
  try {
    await db.schemaOf(`_state/sync/${connectorId}/${sinkId}`);
    hasPrevious = true;
  } catch {}

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

  const changedIds = [...inserts, ...updates];
  if (changedIds.length > 0 && inputTable) {
    const idList = changedIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
    const { rows } = await db.query(
      `SELECT * FROM ${qi(inputTable)} WHERE CAST(${qi(entityIdCol)} AS VARCHAR) IN (${idList})`,
    );
    for (const row of rows) {
      const op = rowToGraphOp(row as Row & Envelope, config, provenance);
      if (op.kind === "upsert") {
        log?.info(`upsert ${typeSlug(op.entityType)} id=${String(op.entityId)} links=${op.links.length}`);
        await client.upsertEntity(op);
      }
    }
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
        await client.archiveEntity({
          kind: "archive",
          entityType: l.linkType,
          entityId: staleLinkId,
          provenance,
          webId: config.webId,
        });
      }
    }
  }

  for (const entityId of deletes) {
    log?.info(`archive ${typeSlug(config.entityType)} id=${entityId} (removed)`);
    await client.archiveEntity({
      kind: "archive",
      entityType: config.entityType,
      entityId,
      provenance,
      webId: config.webId,
    });
  }

  await db.exec(`CREATE OR REPLACE TABLE ${stateTable} AS SELECT * FROM ${currentTable}`);
  await db.exec(`DROP TABLE IF EXISTS ${currentTable}`);

  const durationMs = Date.now() - start;
  log?.info(`sync: ${inserts.length} inserts, ${updates.length} updates, ${deletes.length} deletes, ${unchanged} unchanged (${durationMs}ms)`);

  return { inserts: inserts.length, updates: updates.length, deletes: deletes.length, unchanged, durationMs };
}

function entityIdFromKey(key: Record<string, unknown>): unknown {
  const vals = Object.values(key);
  return vals.length === 1 ? vals[0] : vals.join("::");
}

export async function archiveDeletes(
  deletes: ChangeEvent[],
  config: GraphSinkConfig,
  client: GraphClient,
  log?: Logger,
): Promise<void> {
  if (deletes.length === 0) return;
  const provenance = buildProvenance(config);

  for (const del of deletes) {
    const entityId = entityIdFromKey(del.key);
    log?.info(`archive ${typeSlug(config.entityType)} id=${String(entityId)}`);
    await client.archiveEntity({
      kind: "archive",
      entityType: config.entityType,
      entityId,
      provenance,
      webId: config.webId,
    });
  }
}
