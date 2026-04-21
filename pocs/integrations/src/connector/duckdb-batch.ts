import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { BatchConnector, HydrateContext, HydrateResult } from "./types.js";
import { pkColumns } from "./types.js";
import { META_COLUMNS } from "../staging/types.js";
import { checkpointKey } from "../transform/checkpoint.js";

const META_SET: ReadonlySet<string> = new Set([META_COLUMNS.op, META_COLUMNS.key, META_COLUMNS.before]);

type PathLike = string | readonly string[];

type SourceCommon = {
  primaryKey: string | string[];
  partial?: boolean;
  archiveOnEmpty?: boolean;
};

export type DuckdbCsvSource = SourceCommon & {
  kind: "csv";
  path: PathLike;
  delimiter?: string;
  skip?: number;
  header?: boolean;
  columns?: Record<string, string>;
  allVarchar?: boolean;
  decimalSeparator?: "." | ",";
  encoding?: string;
  nullPadding?: boolean;
  dateformat?: string;
  timestampformat?: string;
  quote?: string;
  escape?: string;
  ignoreErrors?: boolean;
  filename?: boolean;
  unionByName?: boolean;
};

export type DuckdbParquetSource = SourceCommon & {
  kind: "parquet";
  path: PathLike;
  unionByName?: boolean;
};

export type DuckdbJsonSource = SourceCommon & {
  kind: "json";
  path: PathLike;
  format?: "array" | "ndjson" | "auto";
};

export type DuckdbXlsxSource = SourceCommon & {
  kind: "xlsx";
  path: string;
  sheet?: string;
  range?: string;
  header?: boolean;
  allVarchar?: boolean;
};

export type DuckdbAttachSource = SourceCommon & {
  kind: "attach";
  type: "postgres" | "mysql" | "sqlite";
  url: string;
  table: string;
  query?: string;
};

export type DuckdbSqlSource = SourceCommon & {
  kind: "sql";
  sql: string;
};

/** Caller-provided hydrator. Responsible for populating `ctx.stagingTable` with meta + data columns. */
export type DuckdbFnSource = SourceCommon & {
  kind: "fn";
  hydrate: (ctx: HydrateContext) => Promise<HydrateResult>;
};

/** Reads a Parquet file produced by a `checkpoint` step in another pipeline. */
export type DuckdbCheckpointSource = {
  kind: "checkpoint";
  name: string;
  partial?: boolean;
  archiveOnEmpty?: boolean;
};

/** Reads a plain Parquet written by any external tool and wraps it with snapshot meta columns. */
export type DuckdbExternalSource = SourceCommon & {
  kind: "external";
  key: string;
};

export type DuckdbSource =
  | DuckdbCsvSource
  | DuckdbParquetSource
  | DuckdbJsonSource
  | DuckdbXlsxSource
  | DuckdbAttachSource
  | DuckdbSqlSource
  | DuckdbFnSource
  | DuckdbCheckpointSource
  | DuckdbExternalSource;

export type DuckdbBatchConfig = {
  id: string;
  sources: Record<string, DuckdbSource>;
};

/**
 * Universal batch connector. Reads whatever DuckDB can read (files, attached DBs,
 * arbitrary SQL) straight into the staging store via `CREATE OR REPLACE TABLE AS SELECT`,
 * skipping the ChangeEvent roundtrip. Types are preserved (not stringified).
 *
 * Meta columns (`_op='snapshot'`, `_key=to_json(pk)`, `_before=NULL`) are projected in SQL,
 * matching `QueryableStore.materialize`'s contract.
 */
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

      if (spec.kind === "xlsx") await ensureExtension(ctx, "excel");
      if (spec.kind === "attach") await ensureExtension(ctx, spec.type);

      const pk = pkColumns(spec.primaryKey);
      const qTable = qi(ctx.stagingTable);

      if (spec.kind === "attach") {
        const alias = attachAlias(ctx.connectorId, ctx.source);
        await ctx.store.exec(
          `ATTACH ${quoteLit(spec.url)} AS ${qi(alias)} (TYPE ${spec.type}, READ_ONLY)`,
        );
        try {
          const readExpr = spec.query ?? `SELECT * FROM ${qi(alias)}.${qualifyTable(spec.table)}`;
          return await writeSnapshot(ctx, qTable, readExpr, pk);
        } finally {
          await ctx.store.exec(`DETACH ${qi(alias)}`);
        }
      }

      return await writeSnapshot(ctx, qTable, buildReadExpr(spec), pk);
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
  return await writeSnapshot(ctx, qi(ctx.stagingTable), readExpr, pkColumns(spec.primaryKey));
}

/**
 * Wrap a read expression with snapshot meta columns (`_op`, `_key`, `_before`)
 * and materialise it into `ctx.stagingTable`. Usable from `fn` sources that
 * produce a read expression via other helpers (e.g. `readMultiRowHeaders`).
 */
export async function writeSnapshot(
  ctx: HydrateContext,
  qTable: string,
  readExpr: string,
  pk: string[],
): Promise<HydrateResult> {
  const cols = await describeColumns(ctx, readExpr);
  const collisions = cols.filter((c) => META_SET.has(c));
  if (collisions.length > 0) {
    throw new Error(
      `Source "${ctx.source}" has reserved column names [${collisions.join(", ")}]. ` +
      `Rename them at the source, or via a "sql" source that aliases them.`,
    );
  }
  const missingPk = pk.filter((c) => !cols.includes(c));
  if (missingPk.length > 0) {
    throw new Error(
      `Source "${ctx.source}" primaryKey references missing columns [${missingPk.join(", ")}]. ` +
      `Available: [${cols.join(", ")}]`,
    );
  }

  const dataCols = cols.map(qi).join(", ");
  const keyExpr = buildKeyExpr(pk);

  await ctx.store.exec(
    `CREATE OR REPLACE TABLE ${qTable} AS ` +
    `SELECT 'snapshot' AS ${qi(META_COLUMNS.op)}, ` +
    `${keyExpr} AS ${qi(META_COLUMNS.key)}, ` +
    `CAST(NULL AS JSON) AS ${qi(META_COLUMNS.before)}, ` +
    `${dataCols} FROM (${readExpr}) _src`,
  );

  const { rows } = await ctx.store.query(`SELECT COUNT(*) AS n FROM ${qTable}`);
  return { rowCount: Number(rows[0].n) };
}

async function describeColumns(ctx: HydrateContext, readExpr: string): Promise<string[]> {
  const { rows } = await ctx.store.query(`DESCRIBE (${readExpr})`);
  return rows.map((r) => String(r.column_name));
}

function buildKeyExpr(pk: string[]): string {
  const entries = pk.map((c) => `${quoteLit(c)}: ${qi(c)}`).join(", ");
  return `CAST(to_json({${entries}}) AS VARCHAR)`;
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

function pathArray(p: PathLike): string {
  const arr = Array.isArray(p) ? p : [p as string];
  return `[${arr.map(quoteLit).join(", ")}]`;
}

function buildReadExpr(
  spec: Exclude<DuckdbSource, DuckdbAttachSource | DuckdbCheckpointSource | DuckdbExternalSource | DuckdbFnSource>,
): string {
  switch (spec.kind) {
    case "csv":     return csvRead(spec);
    case "parquet": return parquetRead(spec);
    case "json":    return jsonRead(spec);
    case "xlsx":    return xlsxRead(spec);
    case "sql":     return spec.sql;
  }
}

function csvRead(spec: DuckdbCsvSource): string {
  const opts: string[] = [];
  if (spec.delimiter !== undefined) opts.push(`delim=${quoteLit(spec.delimiter)}`);
  if (spec.skip !== undefined) opts.push(`skip=${spec.skip}`);
  if (spec.header !== undefined) opts.push(`header=${spec.header}`);
  if (spec.allVarchar) opts.push(`all_varchar=true`);
  if (spec.decimalSeparator) opts.push(`decimal_separator=${quoteLit(spec.decimalSeparator)}`);
  if (spec.encoding) opts.push(`encoding=${quoteLit(spec.encoding)}`);
  if (spec.nullPadding) opts.push(`null_padding=true`);
  if (spec.dateformat) opts.push(`dateformat=${quoteLit(spec.dateformat)}`);
  if (spec.timestampformat) opts.push(`timestampformat=${quoteLit(spec.timestampformat)}`);
  if (spec.quote !== undefined) opts.push(`quote=${quoteLit(spec.quote)}`);
  if (spec.escape !== undefined) opts.push(`escape=${quoteLit(spec.escape)}`);
  if (spec.ignoreErrors) opts.push(`ignore_errors=true`);
  if (spec.filename) opts.push(`filename=true`);
  const paths = Array.isArray(spec.path) ? spec.path : [spec.path as string];
  if (spec.unionByName ?? paths.length > 1) opts.push(`union_by_name=true`);
  if (spec.columns) {
    const entries = Object.entries(spec.columns)
      .map(([k, v]) => `${quoteLit(k)}: ${quoteLit(v)}`).join(", ");
    opts.push(`columns={${entries}}`);
  }
  const tail = opts.length > 0 ? `, ${opts.join(", ")}` : "";
  return `SELECT * FROM read_csv(${pathArray(spec.path)}${tail})`;
}

function parquetRead(spec: DuckdbParquetSource): string {
  const paths = Array.isArray(spec.path) ? spec.path : [spec.path as string];
  const tail = (spec.unionByName ?? paths.length > 1) ? ", union_by_name=true" : "";
  return `SELECT * FROM read_parquet(${pathArray(spec.path)}${tail})`;
}

function jsonRead(spec: DuckdbJsonSource): string {
  const fmt = spec.format === "ndjson" ? "newline_delimited"
    : spec.format === "array" ? "array"
    : "auto";
  return `SELECT * FROM read_json(${pathArray(spec.path)}, format=${quoteLit(fmt)})`;
}

function xlsxRead(spec: DuckdbXlsxSource): string {
  const opts: string[] = [];
  if (spec.sheet) opts.push(`sheet=${quoteLit(spec.sheet)}`);
  if (spec.range) opts.push(`range=${quoteLit(spec.range)}`);
  if (spec.header !== undefined) opts.push(`header=${spec.header}`);
  if (spec.allVarchar) opts.push(`all_varchar=true`);
  const tail = opts.length > 0 ? `, ${opts.join(", ")}` : "";
  return `SELECT * FROM read_xlsx(${quoteLit(spec.path)}${tail})`;
}
