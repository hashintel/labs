import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { QueryableStore } from "../staging/types.js";
import type { Accessor, GraphSinkConfig, Row, Envelope } from "../transform/pipeline.js";
import type { GraphOp, ResolvedLink, SourceProvenance, GraphClient } from "./types.js";
import type { Logger } from "../log.js";

function resolve(accessor: Accessor, data: Row): unknown {
  return typeof accessor === "string" ? data[accessor] : accessor(data);
}

function typeSlug(url: string): string {
  return url.split("/entity-type/")[1] ?? url;
}

function buildProvenance(config: GraphSinkConfig): SourceProvenance {
  return {
    type: "integration",
    location: config.provenance?.location,
    authors: config.provenance?.authors,
    loadedAt: new Date().toISOString(),
  };
}

export function rowToGraphOp(row: Row & Envelope, config: GraphSinkConfig, provenance: SourceProvenance): GraphOp {
  const { _op, _key, ...data } = row;

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
    .map((l) => ({ linkType: l.linkType, targetEntityType: l.targetEntityType, targetId: data[l.column] }));

  return { kind: "upsert", entityType: config.entityType, entityId, properties, links, provenance, webId: config.webId };
}

export async function processGraphSink(
  config: GraphSinkConfig,
  inputTable: string,
  db: QueryableStore,
  client: GraphClient,
  log?: Logger,
): Promise<void> {
  const provenance = buildProvenance(config);
  const { rows } = await db.query(`SELECT * FROM ${qi(inputTable)}`);

  for (const row of rows) {
    const op = rowToGraphOp(row as Row & Envelope, config, provenance);
    switch (op.kind) {
      case "upsert":
        log?.info(`upsert ${typeSlug(op.entityType)} id=${String(op.entityId)} links=${op.links.length}`);
        await client.upsertEntity(op);
        break;
      case "archive":
        log?.info(`archive ${typeSlug(op.entityType)} id=${String(op.entityId)}`);
        await client.archiveEntity(op);
        break;
    }
  }
}
