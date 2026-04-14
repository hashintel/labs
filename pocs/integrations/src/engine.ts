import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { Batch, StreamConnector } from "./connector/types.js";
import { createConnector, type ConnectorDef } from "./connector/create.js";
import type { EventStore, QueryableStore } from "./staging/types.js";
import type { Pipeline, Step, TransformFn, TransformResolver, SideEffectHandler } from "./transform/pipeline.js";
import { validatePipeline, runPipeline } from "./transform/run.js";
import type { GraphClient } from "./graph/types.js";
import { processGraphSink, archiveDeletes, diffAndSync, type SyncResult } from "./graph/sink.js";
import { createLogger, type LogLevel } from "./log.js";

export type TablePipeline = { table: string; pipeline: Pipeline };

export type IntegrationSpec = {
  connector: ConnectorDef;
  pipelines: TablePipeline[];
  eventStore: EventStore;
  queryStore: QueryableStore;
  transforms?: Record<string, TransformFn>;
  graphClient?: GraphClient;
  validate?: boolean;
  logLevel?: LogLevel;
  syncIntervalMs?: number;
};

export type Integration = {
  run(): Promise<void>;
  stop(): Promise<void>;
  sync(): Promise<SyncResult>;
};

export { type SyncResult };

export function integrate(spec: IntegrationSpec): Integration {
  const { pipelines, eventStore, queryStore } = spec;
  const log = createLogger("engine", spec.logLevel ?? "info");
  let stopped = false;

  const resolveTransform: TransformResolver | undefined = spec.transforms
    ? (name) => {
        const fn = spec.transforms![name];
        if (!fn) throw new Error(`Transform "${name}" not found`);
        return fn;
      }
    : undefined;

  const hasGraphSink = pipelines.some((tp) => tp.pipeline.steps.some((s) => s.kind === "graph-sink"));
  if (hasGraphSink && !spec.graphClient) throw new Error("Pipeline has graph-sink steps but no graphClient was provided");

  const sinkLog = log.child({ component: "graph-sink" });

  for (const { pipeline } of pipelines) {
    for (const step of pipeline.steps) {
      if (step.kind === "fn" && typeof step.transform === "string") {
        if (!resolveTransform) throw new Error(`FnStep "${step.id}" references transform "${step.transform}" but no transforms were provided`);
        resolveTransform(step.transform);
      }
    }
  }

  let syncing = false;

  async function doSync(): Promise<SyncResult> {
    if (syncing) return { inserts: 0, updates: 0, deletes: 0, unchanged: 0, durationMs: 0 };
    syncing = true;
    const start = Date.now();
    const totals = { inserts: 0, updates: 0, deletes: 0, unchanged: 0 };

    const connector = createConnector(spec.connector);
    if (connector.mode !== "batch") throw new Error(`sync() requires a batch connector, got "${connector.mode}"`);

    log.info(`sync: connector "${connector.id}" tables=[${pipelines.map((tp) => tp.table).join(", ")}]`);

    try {
      for (const { table, pipeline } of pipelines) {
        let pageCount = 0;
        await connector.pull(table, async (page) => {
          await queryStore.materialize(connector.id, table, page.events);
          pageCount++;
        });

        const sourceTable = `${connector.id}/${table}`;

        if (pageCount === 0) {
          log.debug(`"${table}" is empty`);
          for (const step of pipeline.steps) {
            if (step.kind === "graph-sink" && spec.graphClient) {
              const result = await diffAndSync(step.id, step.config, null, connector.id, queryStore, spec.graphClient, sinkLog);
              totals.inserts += result.inserts;
              totals.updates += result.updates;
              totals.deletes += result.deletes;
              totals.unchanged += result.unchanged;
            }
          }
          continue;
        }

        if (spec.validate !== false) {
          await validatePipeline(pipeline, queryStore, { log: log.child({ component: "validate" }), resolveTransform });
        }

        await runPipeline(pipeline, queryStore, resolveTransform, async (step, currentTable) => {
          if (step.kind === "graph-sink" && spec.graphClient) {
            const result = await diffAndSync(step.id, step.config, currentTable, connector.id, queryStore, spec.graphClient, sinkLog);
            totals.inserts += result.inserts;
            totals.updates += result.updates;
            totals.deletes += result.deletes;
            totals.unchanged += result.unchanged;
          }
        });

        await queryStore.exec(`DROP TABLE IF EXISTS ${qi(sourceTable)}`);
        for (const id of allStepIds(pipeline.steps)) {
          await queryStore.exec(`DROP TABLE IF EXISTS ${qi(`_step/${id}`)}`);
          await queryStore.exec(`DROP TABLE IF EXISTS ${qi(`_validate/${id}`)}`);
        }
        await queryStore.exec(`DROP VIEW IF EXISTS "input"`);
      }
    } finally {
      await connector.close();
      syncing = false;
    }

    const durationMs = Date.now() - start;
    log.info(`sync complete: ${totals.inserts} inserts, ${totals.updates} updates, ${totals.deletes} deletes, ${totals.unchanged} unchanged (${durationMs}ms)`);
    return { ...totals, durationMs };
  }

  return {
    sync: doSync,

    async run() {
      const probe = createConnector(spec.connector);
      const mode = probe.mode;
      log.info(`connector "${probe.id}" mode=${mode} tables=[${pipelines.map((tp) => tp.table).join(", ")}]`);

      if (mode === "batch") {
        await probe.close();
        await doSync();
        const intervalMs = spec.syncIntervalMs;
        if (intervalMs && intervalMs > 0) {
          while (!stopped) {
            await sleep(intervalMs);
            if (stopped) break;
            if (syncing) { log.warn("sync still running, skipping"); continue; }
            await doSync();
          }
        }
        queryStore.close();
        return;
      }

      try {
        await runStream(probe as StreamConnector);
      } finally {
        await probe.close();
        queryStore.close();
      }

      async function runStream(c: StreamConnector) {
        const subs = [];
        const state = pipelines.map(() => ({ seq: 0, validated: { done: false } }));
        let lock = Promise.resolve();

        for (let i = 0; i < pipelines.length; i++) {
          const { table, pipeline } = pipelines[i];
          const s = state[i];

          const sub = await c.subscribe(table, undefined, (batch) => {
            lock = lock.then(async () => {
              if (stopped) return;
              const { nextSeq } = await processStreamBatch(table, pipeline, batch, s.seq, s.validated, c);
              s.seq = nextSeq;
            });
            return lock;
          });
          subs.push(sub);
        }

        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (stopped) { clearInterval(check); resolve(); }
          }, 100);
        });

        for (const sub of subs) await sub.stop();
      }

      async function processStreamBatch(
        table: string,
        pipeline: Pipeline,
        batch: Batch,
        seq: number,
        validated: { done: boolean },
        connector: StreamConnector,
      ): Promise<{ nextSeq: number }> {
        const relevant = batch.events.filter((e) => e.table === table);
        if (relevant.length === 0) return { nextSeq: seq };

        const deletes = relevant.filter((e) => e.op === "delete");
        const data = relevant.filter((e) => e.op !== "delete");

        if (deletes.length > 0 && spec.graphClient) {
          log.debug(`${deletes.length} deletes for "${table}"`);
          for (const step of pipeline.steps) {
            if (step.kind === "graph-sink") {
              await archiveDeletes(deletes, step.config, spec.graphClient, sinkLog);
            }
          }
        }

        if (data.length === 0) return { nextSeq: seq };

        log.debug(`batch: ${data.length} events for "${table}"`);

        await eventStore.append(connector.id, table, data);
        const { events, nextSeq } = await eventStore.read(connector.id, table, seq);
        await queryStore.materialize(connector.id, table, events);
        eventStore.trim(connector.id, table, nextSeq);

        if (!validated.done && spec.validate !== false) {
          await validatePipeline(pipeline, queryStore, { log: log.child({ component: "validate" }), resolveTransform });
          validated.done = true;
        }

        const onSideEffect: SideEffectHandler = async (step, currentTable) => {
          if (step.kind === "graph-sink") {
            await processGraphSink(step.config, currentTable, queryStore, spec.graphClient!, sinkLog);
          }
        };

        await runPipeline(pipeline, queryStore, resolveTransform, onSideEffect);

        await queryStore.exec(`DROP TABLE IF EXISTS ${qi(`${connector.id}/${table}`)}`);
        for (const id of allStepIds(pipeline.steps)) {
          await queryStore.exec(`DROP TABLE IF EXISTS ${qi(`_step/${id}`)}`);
          await queryStore.exec(`DROP TABLE IF EXISTS ${qi(`_validate/${id}`)}`);
        }
        await queryStore.exec(`DROP VIEW IF EXISTS "input"`);

        return { nextSeq };
      }
    },

    async stop() { stopped = true; },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function allStepIds(steps: Step[]): string[] {
  const ids: string[] = [];
  for (const s of steps) {
    if (s.kind === "branch") {
      for (const branch of s.branches) ids.push(...allStepIds(branch));
    } else if (s.kind !== "graph-sink") {
      ids.push(s.id);
    }
  }
  return ids;
}
