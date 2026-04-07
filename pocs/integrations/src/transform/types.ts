import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { Schema } from "effect";
import type { QueryableStore } from "../staging/types.js";
import { META_COLUMNS } from "../staging/types.js";
import { decodeRows, assertSchemaColumns, type DuckSchema } from "./schema.js";

export type Row = Record<string, unknown>;
export type Envelope = { _op: string; _key: string };

export type SqlStep = {
  kind: "sql";
  id: string;
  sql: string;
  output?: Schema.Schema<any, any>;
};

export type TsStep = {
  kind: "ts";
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

export function sql<O>(opts: { id: string; query: string; output?: Schema.Schema<O, any> }): SqlStep {
  return { kind: "sql", id: opts.id, sql: opts.query, output: opts.output };
}

export function ts<I extends Row = Row, O extends Row = Row>(opts: {
  id: string;
  transform: (rows: (I & Envelope)[]) => (O & Envelope)[] | Promise<(O & Envelope)[]>;
  input?: Schema.Schema<I, any>;
  output?: Schema.Schema<O, any>;
}): TsStep {
  return { kind: "ts", id: opts.id, transform: opts.transform, input: opts.input, output: opts.output };
}

export function pipe(source: string | Pipeline, ...steps: Step[]): Pipeline {
  if (typeof source === "string") return { source, steps };
  return { source: source.source, steps: [...source.steps, ...steps] };
}

function stripMetaColumns(schema: DuckSchema): DuckSchema {
  return schema.filter((c) => c.name !== "_op" && c.name !== "_key");
}

function assertMeta(schema: DuckSchema, stepId: string): void {
  const names = new Set(schema.map((c) => c.name));
  const missing = [META_COLUMNS.op, META_COLUMNS.key].filter((c) => !names.has(c));
  if (missing.length > 0) {
    throw new Error(`Step "${stepId}" output is missing ${missing.join(", ")}. Include _op and _key in your output.`);
  }
}

export async function validatePipeline(pipeline: Pipeline, db: QueryableStore): Promise<void> {
  let currentTable = pipeline.source;

  for (const step of pipeline.steps) {
    if (step.kind !== "sql") continue;

    const tmpTable = `_validate/${step.id}`;
    await db.exec(`CREATE OR REPLACE VIEW "input" AS SELECT * FROM ${qi(currentTable)} LIMIT 0`);
    await db.exec(`CREATE OR REPLACE TABLE ${qi(tmpTable)} AS ${step.sql} LIMIT 0`);
    await db.exec(`DROP VIEW IF EXISTS "input"`);

    const outSchema = await db.schemaOf(tmpTable);
    assertMeta(outSchema, step.id);

    if (step.output) {
      assertSchemaColumns(step.output, stripMetaColumns(outSchema), step.id);
    }

    currentTable = tmpTable;
  }
}

export async function runPipeline(pipeline: Pipeline, db: QueryableStore): Promise<PipelineResult> {
  const stepResults: Record<string, StepResult> = {};
  const validated = new Set<string>();
  let currentTable = pipeline.source;

  for (const step of pipeline.steps) {
    const outputTable = `_step/${step.id}`;

    switch (step.kind) {
      case "sql":
        await execSqlStep(step, currentTable, outputTable, db);
        break;
      case "ts":
        await execTsStep(step, currentTable, outputTable, db, validated);
        break;
    }

    const duckSchema = await db.schemaOf(outputTable);
    assertMeta(duckSchema, step.id);
    stepResults[step.id] = { table: outputTable, duckSchema };
    currentTable = outputTable;
  }

  return { outputTable: currentTable, stepResults };
}

async function execSqlStep(step: SqlStep, inputTable: string, outputTable: string, db: QueryableStore): Promise<void> {
  await db.exec(`CREATE OR REPLACE VIEW "input" AS SELECT * FROM ${qi(inputTable)}`);
  await db.exec(`CREATE OR REPLACE TABLE ${qi(outputTable)} AS ${step.sql}`);
  await db.exec(`DROP VIEW IF EXISTS "input"`);
}

async function execTsStep(
  step: TsStep,
  inputTable: string,
  outputTable: string,
  db: QueryableStore,
  validated: Set<string>,
): Promise<void> {
  const { rows } = await db.query(`SELECT * FROM ${qi(inputTable)}`);

  if (step.input && !validated.has(`${step.id}/in`)) {
    const nonDelete = rows.filter((r) => r._op !== "delete");
    decodeRows(step.input, nonDelete.map(({ _op, _key, ...data }) => data), step.id);
    validated.add(`${step.id}/in`);
  }

  const transformed = await step.transform(rows);

  if (step.output && !validated.has(`${step.id}/out`)) {
    const nonDelete = transformed.filter((r) => r._op !== "delete");
    decodeRows(step.output, nonDelete.map(({ _op, _key, ...data }) => data), step.id);
    validated.add(`${step.id}/out`);
  }

  await writeRows(transformed, outputTable, db);
}

async function writeRows(rows: Row[], table: string, db: QueryableStore): Promise<void> {
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
