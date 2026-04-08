import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { QueryableStore } from "../staging/types.js";
import { META_COLUMNS } from "../staging/types.js";
import type { Pipeline, TransformFn, TransformResolver, SchemaDecl, Row, Envelope } from "./pipeline.js";
import { toEffectSchema, assertSchemaDeclColumns } from "./pipeline.js";
import { decodeRows, assertSchemasCompatible, effectSchemaFromDuck, formatDuckSchema, type DuckSchema } from "./schema.js";

export async function validatePipeline(
  pipeline: Pipeline,
  db: QueryableStore,
  opts?: { debug?: boolean; resolveTransform?: TransformResolver },
): Promise<void> {
  const log = opts?.debug ? (msg: string) => console.log(`[validate] ${msg}`) : () => {};

  let currentTable = pipeline.source;
  let currentSchema = await db.schemaOf(currentTable);
  let previousStepId = currentTable;

  log(`source "${currentTable}": ${formatDuckSchema(stripMeta(currentSchema))}`);

  for (const step of pipeline.steps) {
    const dataColumns = stripMeta(currentSchema);

    if (step.kind === "sql") {
      const tmpTable = `_validate/${step.id}`;
      await execSql(step.sql, currentTable, tmpTable, db, "LIMIT 0");

      currentSchema = await db.schemaOf(tmpTable);
      assertMeta(currentSchema, step.id);

      const outData = stripMeta(currentSchema);
      log(`sql "${step.id}": ${formatDuckSchema(outData)}`);

      if (step.output) {
        assertSchemaDeclColumns(step.output, new Set(outData.map((c) => c.name)), step.id);
        log(`  output schema: ok`);
      }

      currentTable = tmpTable;
    }

    if (step.kind === "fn") {
      if (typeof step.transform === "string" && opts?.resolveTransform) opts.resolveTransform(step.transform);
      const inputSchema = step.input ? toEffectSchema(step.input) : effectSchemaFromDuck(dataColumns);
      assertSchemasCompatible(dataColumns, inputSchema, previousStepId, step.id);
      log(`fn "${step.id}": input compatible with "${previousStepId}" (${dataColumns.map((c) => c.name).join(", ")})`);
    }

    previousStepId = step.id;
  }

  log(`validated ${pipeline.steps.length} steps`);
}

export async function runPipeline(
  pipeline: Pipeline,
  db: QueryableStore,
  resolveTransform?: TransformResolver,
): Promise<string> {
  let currentTable = pipeline.source;

  for (const step of pipeline.steps) {
    const outputTable = `_step/${step.id}`;

    if (step.kind === "sql") {
      await execSql(step.sql, currentTable, outputTable, db);
    } else {
      const transform = typeof step.transform === "string"
        ? resolveOrThrow(step.id, step.transform, resolveTransform)
        : step.transform;
      await execTransform(step, transform, currentTable, outputTable, db);
    }

    assertMeta(await db.schemaOf(outputTable), step.id);
    currentTable = outputTable;
  }

  return currentTable;
}

function resolveOrThrow(stepId: string, name: string, resolver?: TransformResolver): TransformFn {
  if (!resolver) throw new Error(`FnStep "${stepId}" references transform "${name}" but no resolver was provided`);
  return resolver(name);
}

async function execSql(sql: string, inputTable: string, outputTable: string, db: QueryableStore, suffix = ""): Promise<void> {
  await db.exec(`CREATE OR REPLACE VIEW "input" AS SELECT * FROM ${qi(inputTable)} ${suffix}`);
  await db.exec(`CREATE OR REPLACE TABLE ${qi(outputTable)} AS ${sql} ${suffix}`);
  await db.exec(`DROP VIEW IF EXISTS "input"`);
}

function stripMeta(schema: DuckSchema): DuckSchema {
  return schema.filter((c) => c.name !== "_op" && c.name !== "_key");
}

function assertMeta(schema: DuckSchema, stepId: string): void {
  const names = new Set(schema.map((c) => c.name));
  const absent = [META_COLUMNS.op, META_COLUMNS.key].filter((c) => !names.has(c));
  if (absent.length > 0) {
    throw new Error(`Step "${stepId}" output is missing ${absent.join(", ")}. Include _op and _key in your output.`);
  }
}

function validateSchema(schema: SchemaDecl | undefined, rows: Record<string, unknown>[], stepId: string): void {
  if (!schema) return;
  const data = rows.filter((r) => r._op !== "delete").map(({ _op, _key, ...rest }) => rest);
  decodeRows(toEffectSchema(schema), data, stepId);
}

async function execTransform(
  step: { id: string; input?: SchemaDecl; output?: SchemaDecl },
  transform: TransformFn,
  inputTable: string,
  outputTable: string,
  db: QueryableStore,
): Promise<void> {
  const { rows } = await db.query(`SELECT * FROM ${qi(inputTable)}`);
  validateSchema(step.input, rows, step.id);

  const transformed = await transform(rows as (Row & Envelope)[]);
  validateSchema(step.output, transformed, step.id);

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
