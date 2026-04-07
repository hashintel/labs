import type { Connector, Batch, PollConnector, StreamConnector } from "./connector/types.js";
import type { EventStore, QueryableStore } from "./staging/types.js";
import type { Pipeline, PipelineResult } from "./transform/types.js";
import { validatePipeline, runPipeline, type ValidateOptions } from "./transform/types.js";

export type IntegrationDef = {
  /** The connector to pull/stream data from. */
  connector: Connector;
  /** Which table or collection to watch. */
  table: string;
  /** Durable event log. Events are appended here and read back for materialization. */
  eventStore: EventStore;
  /** DuckDB (or compatible) store for materializing events and running SQL transforms. */
  queryStore: QueryableStore;
  /** The transform pipeline to run on each batch. */
  pipeline: Pipeline;
  /** Pipeline options. { debug: true } enables validation logging. forEach: per-row callback (omit to skip deserialization). */
  opts?: ValidateOptions & { forEach?: (row: Record<string, unknown>) => void | Promise<void> };
};

export type Integration = {
  run(): Promise<void>;
  stop(): Promise<void>;
};

export function integrate(def: IntegrationDef): Integration {
  const { connector, table, eventStore, queryStore, pipeline, opts } = def;
  const forEach = opts?.forEach;
  let stopped = false;

  return {
    async run() {
      let validated = false;
      let seq = 0;

      for await (const batch of open(connector, table)) {
        if (stopped) break;

        await eventStore.append(connector.id, table, batch.events);
        const { events, nextSeq } = await eventStore.read(connector.id, table, seq);
        seq = nextSeq;

        await queryStore.materialize(connector.id, table, events);

        if (!validated) {
          await validatePipeline(pipeline, queryStore, opts);
          validated = true;
        }

        const result = await runPipeline(pipeline, queryStore);

        if (forEach) {
          const { rows } = await queryStore.query(`SELECT * FROM "${result.outputTable}"`);
          for (const row of rows) await forEach(row);
        }

        await queryStore.exec(`DROP TABLE IF EXISTS "${connector.id}/${table}"`);
      }
    },

    async stop() {
      stopped = true;
      await connector.close();
    },
  };
}

export async function* open(connector: Connector, table: string): AsyncGenerator<Batch> {
  switch (connector.mode) {
    case "poll": yield* poll(connector, table); break;
    case "stream": yield* stream(connector, table); break;
  }
}

async function* poll(connector: PollConnector, table: string): AsyncGenerator<Batch> {
  const intervalMs = connector.pollIntervalMs ?? 5000;
  let cursor: unknown;
  while (true) {
    const result = await connector.pull(table, cursor);
    if (result.events.length > 0) {
      yield result;
      cursor = result.cursor;
    } else if (intervalMs > 0) {
      await new Promise((r) => setTimeout(r, intervalMs));
    } else {
      return;
    }
  }
}

async function* stream(connector: StreamConnector, table: string): AsyncGenerator<Batch> {
  const queue: Batch[] = [];
  let wake: (() => void) | null = null;

  const sub = await connector.subscribe(table, undefined, async (batch) => {
    queue.push(batch);
    if (wake) { wake(); wake = null; }
  });

  try {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else {
        await new Promise<void>((r) => { wake = r; });
      }
    }
  } finally {
    await sub.stop();
  }
}
