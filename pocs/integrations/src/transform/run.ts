import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { QueryableStore } from "../staging/types.js";
import { META_COLUMNS } from "../staging/types.js";
import type { Pipeline, TransformFn, TransformResolver, SchemaDecl, Row, Envelope, SideEffectHandler } from "./pipeline.js";
import { toEffectSchema, assertSchemaDeclColumns } from "./pipeline.js";
import { decodeRows } from "./schema.js";
import type { Logger } from "../log.js";

export async function validatePipeline(
  pipeline: Pipeline,
  db: QueryableStore,
  opts?: { log?: Logger; resolveTransform?: TransformResolver },
): Promise<void> {
  const log = opts?.log ? (msg: string) => opts.log!.debug(msg) : () => {};

  let currentTable = pipeline.source;
  let columns = await db.schemaOf(currentTable);
  let previousStepId = currentTable;

  log(`source "${currentTable}": ${stripMeta(columns).join(", ")}`);

  for (const step of pipeline.steps) {
    const dataColumns = stripMeta(columns);

    if (step.kind === "graph-sink") {
      const stringAccessors = [
        ...(typeof step.config.entityId === "string" ? [step.config.entityId] : []),
        ...Object.values(step.config.properties).filter((a): a is string => typeof a === "string"),
        ...(step.config.links ?? []).map((l) => l.column),
      ];
      const available = new Set(dataColumns);
      const missing = stringAccessors.filter((c) => !available.has(c));
      if (missing.length > 0) throw new Error(`GraphSinkStep "${step.id}" references columns [${missing.join(", ")}] not in pipeline output`);
      log(`graph-sink "${step.id}": ${Object.keys(step.config.properties).length} properties, ${step.config.links?.length ?? 0} links`);
      continue;
    }

    if (step.kind === "sql") {
      const tmpTable = `_validate/${step.id}`;
      await execSql(step.sql, currentTable, tmpTable, db, "LIMIT 0");

      columns = await db.schemaOf(tmpTable);
      assertMeta(columns, step.id);

      const outData = stripMeta(columns);
      log(`sql "${step.id}": ${outData.join(", ")}`);

      if (step.output) {
        assertSchemaDeclColumns(step.output, new Set(outData), step.id);
        log(`  output schema: ok`);
      }

      currentTable = tmpTable;
    }

    if (step.kind === "fn") {
      if (typeof step.transform === "string" && opts?.resolveTransform) opts.resolveTransform(step.transform);
      assertColumnsCompatible(dataColumns, step.input, previousStepId, step.id);
      log(`fn "${step.id}": input compatible with "${previousStepId}" (${dataColumns.join(", ")})`);
    }

    if (step.kind === "branch") {
      log(`branch "${step.id}": ${step.branches.length} branches`);
      for (const branchSteps of step.branches) {
        let branchTable = currentTable;
        let branchCols = columns;
        for (const s of branchSteps) {
          const branchData = stripMeta(branchCols);
          if (s.kind === "sql") {
            const tmpTable = `_validate/${s.id}`;
            await execSql(s.sql, branchTable, tmpTable, db, "LIMIT 0");
            branchCols = await db.schemaOf(tmpTable);
            assertMeta(branchCols, s.id);
            log(`  sql "${s.id}": ${stripMeta(branchCols).join(", ")}`);
            branchTable = tmpTable;
          } else if (s.kind === "graph-sink") {
            const stringAccessors = [
              ...(typeof s.config.entityId === "string" ? [s.config.entityId] : []),
              ...Object.values(s.config.properties).filter((a): a is string => typeof a === "string"),
              ...(s.config.links ?? []).map((l) => l.column),
            ];
            const available = new Set(branchData);
            const missing = stringAccessors.filter((c) => !available.has(c));
            if (missing.length > 0) throw new Error(`GraphSinkStep "${s.id}" references columns [${missing.join(", ")}] not in branch output`);
            log(`  graph-sink "${s.id}": ${Object.keys(s.config.properties).length} properties, ${s.config.links?.length ?? 0} links`);
          }
        }
      }
    }

    previousStepId = step.id;
  }

  log(`validated ${pipeline.steps.length} steps`);
}

export async function runPipeline(
  pipeline: Pipeline,
  db: QueryableStore,
  resolveTransform?: TransformResolver,
  onSideEffect?: SideEffectHandler,
): Promise<string> {
  let currentTable = pipeline.source;

  for (const step of pipeline.steps) {
    if (step.kind === "sql") {
      const outputTable = `_step/${step.id}`;
      await execSql(step.sql, currentTable, outputTable, db);
      assertMeta(await db.schemaOf(outputTable), step.id);
      currentTable = outputTable;
    } else if (step.kind === "fn") {
      const outputTable = `_step/${step.id}`;
      const transform = typeof step.transform === "string"
        ? resolveOrThrow(step.id, step.transform, resolveTransform)
        : step.transform;
      await execTransform(step, transform, currentTable, outputTable, db);
      assertMeta(await db.schemaOf(outputTable), step.id);
      currentTable = outputTable;
    } else if (step.kind === "branch") {
      for (const branchSteps of step.branches) {
        let branchTable = currentTable;
        for (const s of branchSteps) {
          if (s.kind === "sql") {
            const out = `_step/${s.id}`;
            await execSql(s.sql, branchTable, out, db);
            assertMeta(await db.schemaOf(out), s.id);
            branchTable = out;
          } else if (s.kind === "fn") {
            const out = `_step/${s.id}`;
            const tf = typeof s.transform === "string"
              ? resolveOrThrow(s.id, s.transform, resolveTransform)
              : s.transform;
            await execTransform(s, tf, branchTable, out, db);
            assertMeta(await db.schemaOf(out), s.id);
            branchTable = out;
          } else if (s.kind === "graph-sink") {
            await onSideEffect?.(s, branchTable);
          } else if (s.kind === "branch") {
            throw new Error("Nested branches are not supported");
          }
        }
      }
    } else {
      await onSideEffect?.(step, currentTable);
    }
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

function stripMeta(columns: string[]): string[] {
  return columns.filter((c) => c !== META_COLUMNS.op && c !== META_COLUMNS.key && c !== META_COLUMNS.before);
}

function assertMeta(columns: string[], stepId: string): void {
  const names = new Set(columns);
  const absent = [META_COLUMNS.op, META_COLUMNS.key].filter((c) => !names.has(c));
  if (absent.length > 0) {
    throw new Error(`Step "${stepId}" output is missing ${absent.join(", ")}. Include _op and _key in your output.`);
  }
}

function assertColumnsCompatible(
  producerColumns: string[],
  consumerSchema: SchemaDecl | undefined,
  producerStepId: string,
  consumerStepId: string,
): void {
  if (!consumerSchema) return;
  const available = new Set(producerColumns);
  const missing = Object.keys(consumerSchema).filter((k) => !available.has(k));
  if (missing.length > 0) {
    throw new Error(`Pipeline type error: step "${consumerStepId}" expects columns [${missing.join(", ")}] not produced by step "${producerStepId}"`);
  }
}

function validateSchema(schema: SchemaDecl | undefined, rows: Record<string, unknown>[], stepId: string): void {
  if (!schema) return;
  const payloads = rows.filter((r) => r._op !== "delete").map(({ _op, _key, ...rest }) => rest);
  decodeRows(toEffectSchema(schema), payloads, stepId);
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
