import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { QueryableStore } from "../staging/types.js";

export const META_TABLE = "_state/meta";

// Version of the content-hash algorithm for newly written hashes. Bump when the
// hash input or serialization changes; old-hash rows reclassify as updates once
// (PATCH-idempotent) and converge.
export const HASH_VERSION = 2;

export type MetaScope = {
  scope: "entity" | "link";
  connectorId: string;
  sinkId: string;
};

export type SinkMeta = {
  hashVersion: number | null;
  configHash: string | null;
  graphIdentity: string | null;
  webId: string | null;
  namespace: string | null;
};

export async function ensureMetaTable(db: QueryableStore): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS ${qi(META_TABLE)} (
    scope VARCHAR,
    connector_id VARCHAR,
    sink_id VARCHAR,
    hash_version INTEGER,
    config_hash VARCHAR,
    graph_identity VARCHAR,
    web_id VARCHAR,
    namespace VARCHAR,
    updated_at TIMESTAMP
  )`);
}

export async function readMeta(db: QueryableStore, s: MetaScope): Promise<SinkMeta | null> {
  await ensureMetaTable(db);
  const { rows } = await db.query(
    `SELECT hash_version, config_hash, graph_identity, web_id, namespace
     FROM ${qi(META_TABLE)}
     WHERE scope = ${esc(s.scope)} AND connector_id = ${esc(s.connectorId)} AND sink_id = ${esc(s.sinkId)}`,
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    hashVersion: r.hash_version == null ? null : Number(r.hash_version),
    configHash: str(r.config_hash),
    graphIdentity: str(r.graph_identity),
    webId: str(r.web_id),
    namespace: str(r.namespace),
  };
}

export async function writeMeta(db: QueryableStore, s: MetaScope, meta: SinkMeta): Promise<void> {
  await ensureMetaTable(db);
  await db.exec(
    `DELETE FROM ${qi(META_TABLE)}
     WHERE scope = ${esc(s.scope)} AND connector_id = ${esc(s.connectorId)} AND sink_id = ${esc(s.sinkId)}`,
  );
  await db.exec(
    `INSERT INTO ${qi(META_TABLE)} VALUES ($1, $2, $3, $4::INTEGER, $5, $6, $7, $8, now())`,
    [
      s.scope,
      s.connectorId,
      s.sinkId,
      meta.hashVersion == null ? null : String(meta.hashVersion),
      meta.configHash,
      meta.graphIdentity,
      meta.webId,
      meta.namespace,
    ],
  );
}

function esc(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function str(v: unknown): string | null {
  return v == null ? null : String(v);
}
