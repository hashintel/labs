import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { Schema } from "effect";
import type { StagingDb } from "../staging/db.js";
import { META_COLUMNS } from "../staging/db.js";
import { decodeRows, assertSchemaColumns, type DuckSchema } from "./schema.js";

export type Row = Record<string, unknown>;

export type SqlStep = {
  id: string;
  sql: string;
  key: string;
  output?: Schema.Schema<any, any>;
};

export type TsStep = {
  id: string;
  input?: Schema.Schema<any, any>;
  output?: Schema.Schema<any, any>;
  transform: (rows: any[]) => any[] | Promise<any[]>;
};

export type Step = SqlStep | TsStep;

export type Pipeline = {
  source: string;
  steps: Step[];
};

export type StepResult = {
  table: string;
  duckSchema: DuckSchema;
};

export type PipelineResult = {
  outputTable: string;
  stepResults: Record<string, StepResult>;
};

export function sql<O>(opts: { id: string; query: string; key: string; output?: Schema.Schema<O, any> }): SqlStep {
  return { id: opts.id, sql: opts.query, key: opts.key, output: opts.output };
}

export function ts<I, O>(opts: {
  id: string;
  transform: (rows: I[]) => O[] | Promise<O[]>;
  input?: Schema.Schema<I, any>;
  output?: Schema.Schema<O, any>;
}): TsStep {
  return { id: opts.id, transform: opts.transform, input: opts.input, output: opts.output };
}

export function pipe(source: string, ...steps: Step[]): Pipeline {
  return { source, steps };
}

function hasDataColumns(schema: DuckSchema): boolean {
  return schema.some((c) => c.name !== "_op" && c.name !== "_key");
}

function stripMetaColumns(schema: DuckSchema): DuckSchema {
  return schema.filter((c) => c.name !== "_op" && c.name !== "_key");
}

function envelopeSql(userSql: string, keyCol: string): string {
  const qk = qi(keyCol);
  const rewritten = userSql.replace(/"input"/g, "_data").replace(/\binput\b/g, "_data");
  return `
    WITH _data AS (
      SELECT COLUMNS(c -> c NOT IN ('_op', '_key')) FROM "input"
    ),
    _meta AS (
      SELECT "_op", "_key", ${qk} AS _join_key, row_number() OVER () AS _rn FROM "input"
    ),
    _transformed AS (${rewritten})
    SELECT _meta."_op", _meta."_key", _transformed.*
    FROM _meta
    LEFT JOIN _transformed ON _transformed.${qk} IS NOT DISTINCT FROM _meta._join_key
  `;
}

async function execSqlStep(step: SqlStep, inputTable: string, outputTable: string, db: StagingDb): Promise<void> {
  const schema = await db.schemaOf(inputTable);
  await db.exec(`CREATE OR REPLACE VIEW "input" AS SELECT * FROM ${qi(inputTable)}`);

  if (hasDataColumns(schema)) {
    await db.exec(`CREATE OR REPLACE TABLE ${qi(outputTable)} AS ${envelopeSql(step.sql, step.key)}`);
  } else {
    await db.exec(`CREATE OR REPLACE TABLE ${qi(outputTable)} AS SELECT * FROM "input"`);
  }

  await db.exec(`DROP VIEW IF EXISTS "input"`);
}

export async function validatePipeline(pipeline: Pipeline, db: StagingDb): Promise<void> {
  let currentTable = pipeline.source;

  for (const step of pipeline.steps) {
    if (!("sql" in step)) continue;

    const tmpTable = `_validate/${step.id}`;
    const srcSchema = await db.schemaOf(currentTable);

    await db.exec(`CREATE OR REPLACE VIEW "input" AS SELECT * FROM ${qi(currentTable)} LIMIT 0`);
    if (hasDataColumns(srcSchema)) {
      await db.exec(`CREATE OR REPLACE TABLE ${qi(tmpTable)} AS ${envelopeSql(step.sql, step.key)} LIMIT 0`);
    } else {
      await db.exec(`CREATE OR REPLACE TABLE ${qi(tmpTable)} AS SELECT * FROM "input" LIMIT 0`);
    }
    await db.exec(`DROP VIEW IF EXISTS "input"`);

    if (step.output) {
      assertSchemaColumns(step.output, stripMetaColumns(await db.schemaOf(tmpTable)), step.id);
    }

    currentTable = tmpTable;
  }
}

export async function runPipeline(pipeline: Pipeline, db: StagingDb): Promise<PipelineResult> {
  const stepResults: Record<string, StepResult> = {};
  const validated = new Set<string>();
  let currentTable = pipeline.source;

  for (const step of pipeline.steps) {
    const outputTable = `_step/${step.id}`;

    if ("sql" in step) {
      await execSqlStep(step, currentTable, outputTable, db);
    } else if ("transform" in step) {
      await execTsStep(step, currentTable, outputTable, db, validated);
    }

    const duckSchema = await db.schemaOf(outputTable);
    stepResults[step.id] = { table: outputTable, duckSchema };
    currentTable = outputTable;
  }

  return { outputTable: currentTable, stepResults };
}

async function execTsStep(
  step: TsStep,
  inputTable: string,
  outputTable: string,
  db: StagingDb,
  validated: Set<string>,
): Promise<void> {
  const { rows: envelopedRows } = await db.query(`SELECT * FROM ${qi(inputTable)}`);

  const stripped: Row[] = [];
  const metas: { _op: unknown; _key: unknown }[] = [];
  for (const { _op, _key, ...data } of envelopedRows) {
    metas.push({ _op, _key });
    stripped.push(data);
  }

  const nonDeleteIndices = metas.reduce<number[]>((acc, m, i) => {
    if (m._op !== "delete") acc.push(i);
    return acc;
  }, []);

  if (step.input && !validated.has(`${step.id}/in`)) {
    decodeRows(step.input, nonDeleteIndices.map((i) => stripped[i]), step.id);
    validated.add(`${step.id}/in`);
  }

  const transformed = await step.transform(stripped);

  if (step.output && !validated.has(`${step.id}/out`)) {
    decodeRows(step.output, nonDeleteIndices.map((i) => transformed[i]), step.id);
    validated.add(`${step.id}/out`);
  }

  const result = transformed.map((row, i) => ({ ...metas[i], ...row }));
  await writeRows(result, outputTable, db);
}

async function writeRows(rows: Row[], table: string, db: StagingDb): Promise<void> {
  if (rows.length === 0) {
    await db.exec(`CREATE OR REPLACE TABLE ${qi(table)} AS SELECT 1 WHERE false`);
    return;
  }

  const columns = Object.keys(rows[0]);
  const colDefs = columns.map((c) => `${qi(c)} VARCHAR`).join(", ");
  await db.exec(`CREATE OR REPLACE TABLE ${qi(table)} (${colDefs})`);

  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const insertSql = `INSERT INTO ${qi(table)} VALUES (${placeholders})`;

  for (const row of rows) {
    const vals = columns.map((c) => row[c] == null ? null : String(row[c]));
    await db.exec(insertSql, vals);
  }
}
