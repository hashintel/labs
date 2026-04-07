import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { Batch, PollConnector, StreamConnector } from "./connector/types.js";
import { createConnector, type ConnectorDef } from "./connector/create.js";
import type { EventStore, QueryableStore } from "./staging/types.js";
import type { Pipeline, TransformFn, TransformResolver } from "./transform/pipeline.js";
import { validatePipeline, runPipeline } from "./transform/run.js";

export type StoreDef = { kind: "duckdb" } | { kind: "ref"; fn: string };

export type IntegrationSpec = {
  connector: ConnectorDef;
  table: string;
  store: StoreDef;
  pipeline: Pipeline;
  validate?: boolean;
  debug?: boolean;
};

export type StoreFactory = () => Promise<{ eventStore: EventStore; queryStore: QueryableStore }>;

export type RuntimeBindings = {
  transforms?: Record<string, TransformFn>;
  stores?: Record<string, StoreFactory>;
};

export type Integration = { run(): Promise<void>; stop(): Promise<void> };

function resolve<T>(registry: Record<string, T> | undefined, key: string, label: string): T {
  const val = registry?.[key];
  if (!val) throw new Error(`${label} "${key}" not found in runtime bindings`);
  return val;
}

export function integrate(spec: IntegrationSpec, bindings: RuntimeBindings = {}): Integration {
  const { pipeline, table } = spec;
  let stopped = false;

  const resolveTransform: TransformResolver = (name) => resolve(bindings.transforms, name, "Transform");
  const storeKey = spec.store.kind === "duckdb" ? "duckdb" : spec.store.fn;

  for (const step of pipeline.steps) {
    if (step.kind === "ref") resolveTransform(step.fn);
  }

  return {
    async run() {
      const connector = createConnector(spec.connector);
      const { eventStore, queryStore } = await resolve(bindings.stores, storeKey, "Store")();

      try {
        switch (connector.mode) {
          case "poll": await runPoll(connector); break;
          case "stream": await runStream(connector); break;
        }
      } finally {
        await connector.close();
        queryStore.close();
      }

      async function processBatch(batch: Batch, validated: { done: boolean }) {
        const relevant = batch.events.filter((e) => e.table === table);
        if (relevant.length === 0) return;
        await eventStore.append(connector.id, table, relevant);
        const { events } = await eventStore.read(connector.id, table);
        await queryStore.materialize(connector.id, table, events);

        if (!validated.done && spec.validate !== false) {
          await validatePipeline(pipeline, queryStore, { debug: spec.debug, resolveTransform });
          validated.done = true;
        }

        await runPipeline(pipeline, queryStore, resolveTransform);
        await queryStore.exec(`DROP TABLE IF EXISTS ${qi(`${connector.id}/${table}`)}`);
      }

      async function runPoll(c: PollConnector) {
        const intervalMs = c.pollIntervalMs ?? 5000;
        let cursor: unknown;
        const validated = { done: false };

        while (!stopped) {
          const batch = await c.pull(table, cursor);
          if (stopped) break;

          if (batch.events.length > 0) {
            await processBatch(batch, validated);
            cursor = batch.cursor;
          } else if (intervalMs > 0) {
            await sleep(intervalMs);
          } else {
            break;
          }
        }
      }

      async function runStream(c: StreamConnector) {
        const validated = { done: false };

        const sub = await c.subscribe(table, undefined, async (batch) => {
          if (stopped) return;
          await processBatch(batch, validated);
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
