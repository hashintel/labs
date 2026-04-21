import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { Batch, ChangeEvent, Connector, StreamConnector } from "./connector/types.js";
import { createConnector, type ConnectorDef } from "./connector/create.js";
import type { EventStore, QueryableStore } from "./staging/types.js";
import type { Pipeline, Step, TablePipeline, TransformFn, TransformResolver, SideEffectHandler } from "./transform/pipeline.js";
import { validatePipeline, runPipeline } from "./transform/run.js";
import { sortPipelines } from "./transform/topology.js";
import type { GraphClient } from "./graph/types.js";
import { processGraphSink, archiveDeletes, diffAndSync, emptySyncResult, mergeSyncResults, type SyncResult, type SyncError } from "./graph/sink.js";
import { writeCheckpoint } from "./transform/checkpoint.js";
import { nullStorage } from "./storage/null.js";
import type { Storage } from "./storage/types.js";
import { materialize as materializeSnapshot } from "./connector/snapshot.js";
import type { HydrateContext } from "./connector/types.js";
import { createLogger, type LogLevel, type Logger } from "./log.js";

export type { TablePipeline };

/**
 * `graphClient` required iff any pipeline has a `graph-sink`.
 * `transforms` required iff any `fnStep.transform` is a string name.
 * `syncIntervalMs` loops batch-mode `run()`; omit for one-shot.
 * `connectorFactory` is a test seam -- source-declaration checks still run against `spec.connector`.
 */
export type IntegrationSpec = {
  connector: ConnectorDef;
  pipelines: TablePipeline[];
  eventStore: EventStore;
  queryStore: QueryableStore;
  /** Durable artefact storage. Required if any pipeline uses `checkpoint` or a `checkpoint` source. Defaults to a null storage that throws on use. */
  storage?: Storage;
  transforms?: Record<string, TransformFn>;
  graphClient?: GraphClient;
  validate?: boolean;
  logLevel?: LogLevel;
  syncIntervalMs?: number;
  connectorFactory?: (def: ConnectorDef, log?: Logger) => Connector;
};

/** `sync()` is batch-only (throws on streaming). `run()` subscribes (stream) or syncs once/loops (batch). */
export type Integration = {
  run(): Promise<void>;
  stop(): Promise<void>;
  sync(): Promise<SyncResult>;
};

export { type SyncResult, type SyncError, emptySyncResult, mergeSyncResults };

/** Validates topology, source/connector alignment, and `pipe()` paths up front. */
export function integrate(spec: IntegrationSpec): Integration {
  const { eventStore, queryStore } = spec;
  const storage = spec.storage ?? nullStorage();
  const log = createLogger("engine", spec.logLevel ?? "info");
  const buildConnector = spec.connectorFactory ?? createConnector;
  let stopped = false;

  const topo = sortPipelines(spec.pipelines);
  const pipelines = topo.order;
  for (const hint of topo.hints) log.info(`topology: ${hint}`);

  assertSourcesDeclared(spec.connector, pipelines);
  assertPipelineSourcesMatch(spec.connector.id, pipelines);

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
    if (syncing) return emptySyncResult();
    syncing = true;
    const start = Date.now();
    let totals = emptySyncResult();

    await storage.prepare(queryStore);
    const connector = buildConnector(spec.connector, log.child({ component: "connector", connector: spec.connector.id }));
    if (connector.mode !== "batch") throw new Error(`sync() requires a batch connector, got "${connector.mode}"`);

    log.info(`sync: connector "${connector.id}" sources=[${pipelines.map((tp) => tp.source).join(", ")}]`);

    try {
      for (const { source, pipeline } of pipelines) {
        const sourceTable = `${connector.id}/${source}`;
        const partial = isPartialSource(spec.connector, source);
        const sinkLogForSource = sinkLog.child({ source });
        // Drop any residue from a prior (possibly crashed) cycle so we start
        // from a clean snapshot. Materialize appends, not replaces.
        await queryStore.exec(`DROP TABLE IF EXISTS ${qi(sourceTable)}`);

        // Isolate per-source failures so one bad source doesn't skip the rest.
        try {
          const hydrated = await connector.hydrate(
            buildHydrateContext({
              connectorId: connector.id,
              source,
              stagingTable: sourceTable,
              store: queryStore,
              storage,
              log: log.child({ component: "hydrate", source }),
            }),
          );

          if (hydrated.rowCount === 0) {
            const archiveOnEmpty = isArchiveOnEmpty(spec.connector, source);
            log.debug(`"${source}" is empty (partial=${partial}, archiveOnEmpty=${archiveOnEmpty})`);
            for (const step of pipeline.steps) {
              if (step.kind !== "graph-sink" || !spec.graphClient) continue;
              // Zero-row hydrates are usually transient source failures. Skip
              // archival unless the user opted in via `archiveOnEmpty` or the
              // source is partial (in which case diffAndSync preserves state).
              if (!partial && !archiveOnEmpty && await stateExists(queryStore, connector.id, step.id)) {
                sinkLogForSource.warn(
                  `"${source}": zero rows but prior state exists for sink "${step.id}"; skipping archival. Set archiveOnEmpty: true on the source config to opt into drain-on-empty.`,
                );
                continue;
              }
              totals = mergeSyncResults(
                totals,
                await diffAndSync(step.id, step.config, null, connector.id, queryStore, spec.graphClient, sinkLogForSource, partial),
              );
            }
            continue;
          }

          if (spec.validate !== false) {
            await validatePipeline(pipeline, queryStore, { log: log.child({ component: "validate" }), resolveTransform });
          }

          await runPipeline(pipeline, queryStore, resolveTransform, async (step, currentTable) => {
            if (step.kind === "graph-sink" && spec.graphClient) {
              totals = mergeSyncResults(
                totals,
                await diffAndSync(step.id, step.config, currentTable, connector.id, queryStore, spec.graphClient, sinkLogForSource, partial),
              );
            } else if (step.kind === "checkpoint") {
              await writeCheckpoint(step.name, currentTable, queryStore, storage);
            }
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          totals = mergeSyncResults(totals, {
            ...emptySyncResult(),
            errors: [{ kind: "table", entityType: "", entityId: source, message: msg }],
          });
          log.error(`source "${source}" failed: ${msg} (continuing with remaining sources)`);
        } finally {
          await queryStore.exec(`DROP TABLE IF EXISTS ${qi(sourceTable)}`);
          for (const id of allStepIds(pipeline.steps)) {
            await queryStore.exec(`DROP TABLE IF EXISTS ${qi(`_step/${id}`)}`);
            await queryStore.exec(`DROP TABLE IF EXISTS ${qi(`_validate/${id}`)}`);
          }
          await queryStore.exec(`DROP VIEW IF EXISTS "input"`);
        }
      }
    } finally {
      await connector.close();
      syncing = false;
    }

    const durationMs = Date.now() - start;
    const failureSummary = totals.errors.length > 0 ? `, ${totals.errors.length} FAILED` : "";
    log.info(`sync complete: ${totals.inserts} inserts, ${totals.updates} updates, ${totals.deletes} deletes, ${totals.unchanged} unchanged${failureSummary} (${durationMs}ms)`);
    return { ...totals, durationMs };
  }

  return {
    sync: doSync,

    async run() {
      const probe = buildConnector(spec.connector, log.child({ component: "connector", connector: spec.connector.id }));
      const mode = probe.mode;
      log.info(`connector "${probe.id}" mode=${mode} sources=[${pipelines.map((tp) => tp.source).join(", ")}]`);

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

      await storage.prepare(queryStore);

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
          const { source, pipeline } = pipelines[i];
          const s = state[i];

          const sub = await c.subscribe(source, undefined, (batch) => {
            lock = lock.then(async () => {
              if (stopped) return;
              try {
                const { nextSeq } = await processStreamBatch(source, pipeline, batch, s.seq, s.validated, c);
                s.seq = nextSeq;
              } catch (err) {
                // Catch per-batch errors so one bad batch doesn't halt the subscription.
                log.error(`stream batch for "${source}" failed: ${err instanceof Error ? err.message : String(err)} (continuing)`);
              }
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
        const deletes: ChangeEvent[] = [];
        const writes: ChangeEvent[] = [];
        for (const e of batch.events) {
          if (e.table !== table) continue;
          (e.op === "delete" ? deletes : writes).push(e);
        }
        if (deletes.length === 0 && writes.length === 0) return { nextSeq: seq };
        const sinkLogForSource = sinkLog.child({ source: table });

        if (deletes.length > 0 && spec.graphClient) {
          log.debug(`${deletes.length} deletes for "${table}"`);
          for (const step of pipeline.steps) {
            if (step.kind === "graph-sink") {
              await archiveDeletes(deletes, step.config, spec.graphClient, sinkLogForSource);
            }
          }
        }

        if (writes.length === 0) return { nextSeq: seq };

        log.debug(`batch: ${writes.length} events for "${table}"`);

        const sourceTable = `${connector.id}/${table}`;
        // Clean slate each batch -- materialize appends, not replaces.
        await queryStore.exec(`DROP TABLE IF EXISTS ${qi(sourceTable)}`);

        try {
          await eventStore.append(connector.id, table, writes);
          const { events, nextSeq } = await eventStore.read(connector.id, table, seq);
          await queryStore.materialize(connector.id, table, events);
          eventStore.trim(connector.id, table, nextSeq);

          if (!validated.done && spec.validate !== false) {
            await validatePipeline(pipeline, queryStore, { log: log.child({ component: "validate" }), resolveTransform });
            validated.done = true;
          }

          const onSideEffect: SideEffectHandler = async (step, currentTable) => {
            if (step.kind === "graph-sink") {
              await processGraphSink(step.config, currentTable, queryStore, spec.graphClient!, sinkLogForSource);
            } else if (step.kind === "checkpoint") {
              await writeCheckpoint(step.name, currentTable, queryStore, storage);
            }
          };

          await runPipeline(pipeline, queryStore, resolveTransform, onSideEffect);

          return { nextSeq };
        } finally {
          await queryStore.exec(`DROP TABLE IF EXISTS ${qi(sourceTable)}`);
          for (const id of allStepIds(pipeline.steps)) {
            await queryStore.exec(`DROP TABLE IF EXISTS ${qi(`_step/${id}`)}`);
            await queryStore.exec(`DROP TABLE IF EXISTS ${qi(`_validate/${id}`)}`);
          }
          await queryStore.exec(`DROP VIEW IF EXISTS "input"`);
        }
      }
    },

    async stop() { stopped = true; },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildHydrateContext(args: Omit<HydrateContext, "materialize">): HydrateContext {
  return {
    ...args,
    materialize: (readExpr, opts) => materializeSnapshot(args, readExpr, opts.primaryKey),
  };
}

function allStepIds(steps: readonly Step[]): string[] {
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

function declaredSources(def: ConnectorDef): string[] {
  switch (def.mode) {
    case "batch":        return Object.keys(def.sources);
    case "cdc":          return Object.keys(def.tables);
    case "rest-api":     return Object.keys(def.endpoints);
    case "mongo-stream": return Object.keys(def.collections);
  }
}

function isPartialSource(def: ConnectorDef, source: string): boolean {
  switch (def.mode) {
    case "batch":    return def.sources[source]?.partial ?? false;
    case "rest-api": return def.endpoints[source]?.partial ?? false;
    case "cdc":
    case "mongo-stream": return false;
  }
}

function isArchiveOnEmpty(def: ConnectorDef, source: string): boolean {
  switch (def.mode) {
    case "batch":    return def.sources[source]?.archiveOnEmpty ?? false;
    case "rest-api": return def.endpoints[source]?.archiveOnEmpty ?? false;
    case "cdc":
    case "mongo-stream": return false;
  }
}

async function stateExists(db: QueryableStore, connectorId: string, sinkId: string): Promise<boolean> {
  try {
    await db.schemaOf(`_state/sync/${connectorId}/${sinkId}`);
    return true;
  } catch {
    return false;
  }
}

function assertSourcesDeclared(def: ConnectorDef, pipelines: readonly TablePipeline[]): void {
  const declared = new Set(declaredSources(def));
  for (const tp of pipelines) {
    if (!declared.has(tp.source)) {
      throw new Error(
        `Pipeline source "${tp.source}" is not declared on connector "${def.id}". ` +
        `Declared sources: [${[...declared].join(", ")}]. ` +
        `Check the connector config ('tables' / 'endpoints' / 'collections') matches the source name.`,
      );
    }
  }
}

function assertPipelineSourcesMatch(connectorId: string, pipelines: readonly TablePipeline[]): void {
  for (const tp of pipelines) {
    const expected = `${connectorId}/${tp.source}`;
    if (tp.pipeline.source !== expected) {
      throw new Error(
        `Pipeline for source "${tp.source}" reads from "${tp.pipeline.source}" but expected "${expected}". ` +
        `The first argument to pipe(...) should be "${expected}".`,
      );
    }
  }
}
