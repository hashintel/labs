import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { Batch, PollConnector, StreamConnector } from "./connector/types.js";
import { createConnector, type ConnectorDef } from "./connector/create.js";
import type { EventStore, QueryableStore } from "./staging/types.js";
import type { Pipeline, TransformFn, TransformResolver, SideEffectHandler } from "./transform/pipeline.js";
import { validatePipeline, runPipeline } from "./transform/run.js";
import type { GraphClient } from "./graph/types.js";
import { processGraphSink } from "./graph/sink.js";
import { createLogger, type LogLevel, type Logger } from "./log.js";

export type IntegrationSpec = {
  connector: ConnectorDef;
  table: string;
  eventStore: EventStore;
  queryStore: QueryableStore;
  pipeline: Pipeline;
  transforms?: Record<string, TransformFn>;
  graphClient?: GraphClient;
  validate?: boolean;
  logLevel?: LogLevel;
  /** @deprecated Use logLevel instead */
  debug?: boolean;
};

export type Integration = { run(): Promise<void>; stop(): Promise<void> };

export function integrate(spec: IntegrationSpec): Integration {
  const { pipeline, table, eventStore, queryStore } = spec;
  const log = createLogger("engine", spec.logLevel ?? (spec.debug ? "debug" : "info"));
  let stopped = false;

  const resolveTransform: TransformResolver | undefined = spec.transforms
    ? (name) => {
        const fn = spec.transforms![name];
        if (!fn) throw new Error(`Transform "${name}" not found`);
        return fn;
      }
    : undefined;

  const hasGraphSink = pipeline.steps.some((s) => s.kind === "graph-sink");
  if (hasGraphSink && !spec.graphClient) throw new Error("Pipeline has graph-sink steps but no graphClient was provided");

  const sinkLog = log.child({ component: "graph-sink" });
  const onSideEffect: SideEffectHandler = async (step, currentTable) => {
    if (step.kind === "graph-sink") {
      await processGraphSink(step.config, currentTable, queryStore, spec.graphClient!, sinkLog);
    }
  };

  for (const step of pipeline.steps) {
    if (step.kind === "fn" && typeof step.transform === "string") {
      if (!resolveTransform) throw new Error(`FnStep "${step.id}" references transform "${step.transform}" but no transforms were provided`);
      resolveTransform(step.transform);
    }
  }

  return {
    async run() {
      const connector = createConnector(spec.connector);
      log.info(`connector "${connector.id}" mode=${connector.mode}`);

      try {
        switch (connector.mode) {
          case "poll": await runPoll(connector); break;
          case "stream": await runStream(connector); break;
        }
      } finally {
        await connector.close();
        queryStore.close();
      }

      async function processBatch(batch: Batch, seq: number, validated: { done: boolean }): Promise<number> {
        const relevant = batch.events.filter((e) => e.table === table);
        if (relevant.length === 0) return seq;

        log.debug(`batch: ${relevant.length} events for "${table}"`);

        await eventStore.append(connector.id, table, relevant);
        const { events, nextSeq } = await eventStore.read(connector.id, table, seq);
        await queryStore.materialize(connector.id, table, events);
        eventStore.trim(connector.id, table, nextSeq);

        if (!validated.done && spec.validate !== false) {
          await validatePipeline(pipeline, queryStore, { log: log.child({ component: "validate" }), resolveTransform });
          validated.done = true;
        }

        await runPipeline(pipeline, queryStore, resolveTransform, onSideEffect);

        await cleanup();
        return nextSeq;
      }

      async function cleanup() {
        await queryStore.exec(`DROP TABLE IF EXISTS ${qi(`${connector.id}/${table}`)}`);
        for (const step of pipeline.steps) {
          if (step.kind === "graph-sink") continue;
          await queryStore.exec(`DROP TABLE IF EXISTS ${qi(`_step/${step.id}`)}`);
          await queryStore.exec(`DROP TABLE IF EXISTS ${qi(`_validate/${step.id}`)}`);
        }
        await queryStore.exec(`DROP VIEW IF EXISTS "input"`);
      }

      async function runPoll(c: PollConnector) {
        const intervalMs = c.pollIntervalMs ?? 5000;
        let cursor: unknown;
        let seq = 0;
        const validated = { done: false };

        while (!stopped) {
          const batch = await c.pull(table, cursor);
          if (stopped) break;

          if (batch.events.length > 0) {
            seq = await processBatch(batch, seq, validated);
            cursor = batch.cursor;
          } else if (intervalMs > 0) {
            await sleep(intervalMs);
          } else {
            break;
          }
        }
      }

      async function runStream(c: StreamConnector) {
        let seq = 0;
        const validated = { done: false };

        const sub = await c.subscribe(table, undefined, async (batch) => {
          if (stopped) return;
          seq = await processBatch(batch, seq, validated);
        });

        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (stopped) { clearInterval(check); resolve(); }
          }, 100);
        });

        await sub.stop();
      }
    },

    async stop() { stopped = true; },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
