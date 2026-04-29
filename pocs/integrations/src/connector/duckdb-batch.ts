import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { BatchConnector, HydrateContext, HydrateResult } from "./types.js";
import { materialize } from "./snapshot.js";
import { readMultiRowHeaders } from "./headers.js";
import { checkpointKey } from "../transform/checkpoint.js";
import type { ProvenanceConfig } from "../transform/pipeline.js";

type SourceCommon = {
  primaryKey: string | string[];
  partial?: boolean;
  archiveOnEmpty?: boolean;
  provenance?: ProvenanceConfig;
};

export type DuckdbSqlSource = SourceCommon & {
  kind: "sql";
  sql: string;
  /** INSTALL+LOAD before running (DuckDB 1.x autoloads; list is a pre-warm hint). */
  extensions?: readonly string[];
  /** Derive column names from N data rows; use with `header=false` readers. */
  headerRows?: readonly number[];
  forwardFill?: boolean;
  /** Header rows excluded from `forwardFill`. */
  unfilledHeaderRows?: readonly number[];
  /** Case-insensitive tokens excluded from each combined column name. */
  dropHeaderTokens?: readonly string[];
};

export type DuckdbAttachSource = SourceCommon & {
  kind: "attach";
  type: "postgres" | "mysql" | "sqlite";
  url: string;
  table: string;
  query?: string;
};

export type DuckdbFnSource = SourceCommon & {
  kind: "fn";
  hydrate: (ctx: HydrateContext) => Promise<HydrateResult>;
};

/** Reads a checkpoint Parquet verbatim (meta columns already present). */
export type DuckdbCheckpointSource = {
  kind: "checkpoint";
  name: string;
  partial?: boolean;
  archiveOnEmpty?: boolean;
  provenance?: ProvenanceConfig;
};

/** Reads a plain Parquet from Storage and wraps it with snapshot meta columns. */
export type DuckdbExternalSource = SourceCommon & {
  kind: "external";
  key: string;
};

export type DuckdbSource =
  | DuckdbSqlSource
  | DuckdbAttachSource
  | DuckdbFnSource
  | DuckdbCheckpointSource
  | DuckdbExternalSource;

export type DuckdbBatchConfig = {
  id: string;
  sources: Record<string, DuckdbSource>;
  provenance?: ProvenanceConfig;
};

export function createDuckdbBatchConnector(config: DuckdbBatchConfig): BatchConnector {
  const loaded = new Set<string>();

  async function ensureExtension(ctx: HydrateContext, name: string): Promise<void> {
    if (loaded.has(name)) return;
    await ctx.store.exec(`INSTALL ${name}`);
    await ctx.store.exec(`LOAD ${name}`);
    loaded.add(name);
  }

  return {
    id: config.id,
    mode: "batch" as const,

    async hydrate(ctx): Promise<HydrateResult> {
      const spec = config.sources[ctx.source];
      if (!spec) throw new Error(`Unknown source "${ctx.source}" on connector "${config.id}"`);

      if (spec.kind === "fn") return await spec.hydrate(ctx);
      if (spec.kind === "checkpoint") return await readCheckpoint(ctx, spec.name);
      if (spec.kind === "external") return await readExternal(ctx, spec);

      if (spec.kind === "attach") await ensureExtension(ctx, spec.type);
      if (spec.kind === "sql" && spec.extensions) {
        for (const ext of spec.extensions) await ensureExtension(ctx, ext);
      }

      if (spec.kind === "attach") {
        const alias = attachAlias(ctx.connectorId, ctx.source);
        await ctx.store.exec(`ATTACH ${quoteLit(spec.url)} AS ${qi(alias)} (TYPE ${spec.type}, READ_ONLY)`);
        try {
          const readExpr = spec.query ?? `SELECT * FROM ${qi(alias)}.${qualifyTable(spec.table)}`;
          return await materialize(ctx, readExpr, spec.primaryKey);
        } finally {
          await ctx.store.exec(`DETACH ${qi(alias)}`);
        }
      }

      let readExpr = spec.sql;
      if (spec.headerRows && spec.headerRows.length > 0) {
        readExpr = await readMultiRowHeaders(ctx.store, readExpr, {
          rows: [...spec.headerRows],
          forwardFill: spec.forwardFill,
          unfilledRows: spec.unfilledHeaderRows,
          dropTokens: spec.dropHeaderTokens,
        });
      }
      return await materialize(ctx, readExpr, spec.primaryKey);
    },

    async close() {},
  };
}

async function readCheckpoint(ctx: HydrateContext, name: string): Promise<HydrateResult> {
  const key = checkpointKey(name);
  if (!(await ctx.storage.exists(key))) {
    throw new Error(`Checkpoint "${name}" not found at "${ctx.storage.uriFor(key)}". Did the producing pipeline run?`);
  }
  const uri = ctx.storage.uriFor(key);
  const qTable = qi(ctx.stagingTable);
  await ctx.store.exec(
    `CREATE OR REPLACE TABLE ${qTable} AS SELECT * FROM read_parquet('${uri.replace(/'/g, "''")}')`,
  );
  const { rows } = await ctx.store.query(`SELECT COUNT(*) AS n FROM ${qTable}`);
  return { rowCount: Number(rows[0].n) };
}

async function readExternal(ctx: HydrateContext, spec: DuckdbExternalSource): Promise<HydrateResult> {
  if (!(await ctx.storage.exists(spec.key))) {
    throw new Error(`External source "${spec.key}" not found at "${ctx.storage.uriFor(spec.key)}".`);
  }
  const uri = ctx.storage.uriFor(spec.key);
  const readExpr = `SELECT * FROM read_parquet('${uri.replace(/'/g, "''")}')`;
  return await materialize(ctx, readExpr, spec.primaryKey);
}

function attachAlias(connectorId: string, source: string): string {
  return `__src_${connectorId}_${source}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

function qualifyTable(table: string): string {
  return table.split(".").map(qi).join(".");
}

function quoteLit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
