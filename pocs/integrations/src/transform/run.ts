import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { QueryableStore } from "../staging/types.js";
import { META_COLUMNS } from "../staging/types.js";
import type { Pipeline, TransformFn, TransformResolver, SchemaDecl, FieldType, Row, Envelope, SideEffectHandler } from "./pipeline.js";
import { decodeRows, toEffectSchema, assertSchemaDeclColumns } from "./schema.js";
import type { Logger } from "../log.js";

export type SqlInputView = { alias: string; table: string };

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
      const available = new Set(dataColumns);
      if (typeof step.config.entityId === "string" && !available.has(step.config.entityId)) {
        throw new Error(`GraphSinkStep "${step.id}" entityId column "${step.config.entityId}" not in pipeline output`);
      }
      const missingProps = Object.values(step.config.properties).filter((a): a is string => typeof a === "string").filter((c) => !available.has(c));
      if (missingProps.length > 0) log(`graph-sink "${step.id}": ${missingProps.length} column(s) missing, will skip: ${missingProps.join(", ")}`);
      log(`graph-sink "${step.id}": ${Object.keys(step.config.properties).length} properties`);
      continue;
    }

    if (step.kind === "checkpoint") {
      log(`checkpoint "${step.id}" -> "${step.name}": ${dataColumns.join(", ")}`);
      previousStepId = step.id;
      continue;
    }

    if (step.kind === "sql") {
      const tmpTable = `_validate/${step.id}`;
      await executeSqlStep(step.sql, currentTable, tmpTable, db, { suffix: "LIMIT 0" });

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
          if (s.kind === "branch") {
            throw new Error(
              `Nested branch "${s.id}" inside "${step.id}" is not supported. ` +
              `Flatten your pipeline, or lift the inner branches to sibling branches on the outer branch step.`,
            );
          }
          if (s.kind === "sql") {
            const tmpTable = `_validate/${s.id}`;
            await executeSqlStep(s.sql, branchTable, tmpTable, db, { suffix: "LIMIT 0" });
            branchCols = await db.schemaOf(tmpTable);
            assertMeta(branchCols, s.id);
            log(`  sql "${s.id}": ${stripMeta(branchCols).join(", ")}`);
            branchTable = tmpTable;
          } else if (s.kind === "graph-sink") {
            const available = new Set(branchData);
            if (typeof s.config.entityId === "string" && !available.has(s.config.entityId)) {
              throw new Error(`GraphSinkStep "${s.id}" entityId column "${s.config.entityId}" not in branch output`);
            }
            const missingProps = Object.values(s.config.properties).filter((a): a is string => typeof a === "string").filter((c) => !available.has(c));
            if (missingProps.length > 0) log(`  graph-sink "${s.id}": ${missingProps.length} column(s) missing, will skip: ${missingProps.join(", ")}`);
            log(`  graph-sink "${s.id}": ${Object.keys(s.config.properties).length} properties`);
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
      await executeSqlStep(step.sql, currentTable, outputTable, db);
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
            await executeSqlStep(s.sql, branchTable, out, db);
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
          } else if (s.kind === "graph-sink" || s.kind === "checkpoint") {
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

export async function executeSqlStep(
  sql: string,
  inputTable: string | null,
  outputTable: string,
  db: QueryableStore,
  opts: { suffix?: string; namedInputs?: readonly SqlInputView[]; keepViews?: boolean } = {},
): Promise<void> {
  const suffix = opts.suffix ?? "";
  if (inputTable) await db.exec(`CREATE OR REPLACE VIEW "input" AS SELECT * FROM ${qi(inputTable)} ${suffix}`);
  for (const input of opts.namedInputs ?? []) {
    await db.exec(`CREATE OR REPLACE VIEW ${qi(input.alias)} AS SELECT * FROM ${qi(input.table)}`);
  }
  await db.exec(`CREATE OR REPLACE TABLE ${qi(outputTable)} AS ${sql} ${suffix}`);
  if (!opts.keepViews) {
    await db.exec(`DROP VIEW IF EXISTS "input"`);
    for (const input of opts.namedInputs ?? []) await db.exec(`DROP VIEW IF EXISTS ${qi(input.alias)}`);
  }
}

function stripMeta(columns: string[]): string[] {
  return columns.filter((c) => c !== META_COLUMNS.op && c !== META_COLUMNS.key && c !== META_COLUMNS.before);
}

function assertMeta(columns: string[], stepId: string): void {
  const names = new Set(columns);
  const absent = [META_COLUMNS.op, META_COLUMNS.key, META_COLUMNS.before].filter((c) => !names.has(c));
  if (absent.length > 0) {
    throw new Error(
      `Step "${stepId}" output is missing ${absent.join(", ")}. ` +
      `SELECT _op, _key, _before (may be NULL) from input.`,
    );
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
  const payloads = rows.filter((r) => r._op !== "delete").map(({ _op, _key, _before, ...rest }) => rest);
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

  if (transformed.length === 0) {
    // Clone input shape so downstream still sees _op/_key/_before + declared data cols.
    await db.exec(`CREATE OR REPLACE TABLE ${qi(outputTable)} AS SELECT * FROM ${qi(inputTable)} LIMIT 0`);
    return;
  }

  await writeRows(transformed, outputTable, db, step.output);
}

type ColEncoder = { ddl: string; serialize: (v: unknown) => string | null };

const asVarchar = (v: unknown) => v == null ? null : String(v);
const asJson = (v: unknown) => v == null ? null : typeof v === "string" ? v : JSON.stringify(v);

function encoderFor(col: string, decl: FieldType | undefined, probe: unknown): ColEncoder {
  if (col === "_op" || col === "_key") return { ddl: "VARCHAR", serialize: asVarchar };
  if (col === "_before")                return { ddl: "JSON",    serialize: asJson };

  const scalar = decl ? (decl.endsWith("?") ? decl.slice(0, -1) : decl) : undefined;
  switch (scalar) {
    case "number":  return { ddl: "DOUBLE",  serialize: asVarchar };
    case "boolean": return { ddl: "BOOLEAN", serialize: (v) => v == null ? null : String(Boolean(v)) };
    case "json":    return { ddl: "JSON",    serialize: asJson };
    case "string":  return { ddl: "VARCHAR", serialize: asVarchar };
    default:
      // Undeclared objects go to JSON; otherwise String() yields "[object Object]".
      if (probe != null && typeof probe === "object") return { ddl: "JSON", serialize: asJson };
      return { ddl: "VARCHAR", serialize: asVarchar };
  }
}

async function writeRows(rows: Row[], table: string, db: QueryableStore, output?: SchemaDecl): Promise<void> {
  const columns = Object.keys(rows[0]);
  const width = columns.length;
  const encoders: ColEncoder[] = columns.map((c) => encoderFor(c, output?.[c], rows[0][c]));
  const colDefs = encoders.map((e, i) => `${qi(columns[i])} ${e.ddl}`).join(", ");
  const qiTable = qi(table);
  await db.exec(`CREATE OR REPLACE TABLE ${qiTable} (${colDefs})`);

  const ROWS_PER_INSERT = 500;
  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
    const chunk = rows.slice(start, start + ROWS_PER_INSERT);
    const params: (string | null)[] = new Array(chunk.length * width);
    const rowPlaceholders: string[] = new Array(chunk.length);

    for (let i = 0; i < chunk.length; i++) {
      const row = chunk[i];
      const base = i * width;
      const slots: string[] = new Array(width);
      for (let c = 0; c < width; c++) {
        slots[c] = `$${base + c + 1}`;
        params[base + c] = encoders[c].serialize(row[columns[c]]);
      }
      rowPlaceholders[i] = `(${slots.join(", ")})`;
    }

    await db.exec(`INSERT INTO ${qiTable} VALUES ${rowPlaceholders.join(", ")}`, params);
  }
}
