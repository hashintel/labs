import { quotedIdentifier as qi } from "@duckdb/node-api";
import type { Batch, ChangeEvent, Connector, StreamConnector } from "./connector/types.js";
import { createConnector, type ConnectorDef } from "./connector/create.js";
import type { EventStore, QueryableStore } from "./staging/types.js";
import type { Pipeline, ProvenanceConfig, Step, TablePipeline, LinkPipeline, TransformFn, TransformResolver, SideEffectHandler } from "./transform/pipeline.js";
import { validatePipeline, runPipeline } from "./transform/run.js";
import { sortPipelines } from "./transform/topology.js";
import type { GraphClient, SourceProvenance } from "./graph/types.js";
import { processGraphSink, archiveDeletes, diffAndSync, flushGraphLinks as flushPendingGraphLinks, emptySyncResult, mergeSyncResults, type SyncResult, type SyncError } from "./graph/sink.js";
import { processLinkPipeline } from "./graph/link-pipeline.js";
import { composeProvenance } from "./graph/provenance.js";
import { writeCheckpoint, checkpointKey } from "./transform/checkpoint.js";
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
  linkPipelines?: LinkPipeline[];
  eventStore: EventStore;
  queryStore: QueryableStore;
  storage?: Storage;
  transforms?: Record<string, TransformFn>;
  graphClient?: GraphClient;
  validate?: boolean;
  logLevel?: LogLevel;
  syncIntervalMs?: number;
  connectorFactory?: (def: ConnectorDef, log?: Logger) => Connector;
};

export type Integration = {
  run(): Promise<void>;
  stop(): Promise<void>;
  sync(): Promise<SyncResult>;
  syncSources(filter?: string[], options?: SyncOptions): Promise<SyncResult>;
  flushGraphLinks(): Promise<SyncResult>;
  getSourceOrder(): string[];
};

export { type SyncResult, type SyncError, emptySyncResult, mergeSyncResults };

export type SyncOptions = {
  deferGraphLinks?: boolean;
};

/** Validates topology, source/connector alignment, and `pipe()` paths up front. */
export function integrate(spec: IntegrationSpec): Integration {
  const { eventStore, queryStore } = spec;
  const storage = spec.storage ?? nullStorage();
  const log = createLogger("engine", spec.logLevel ?? "info");
  const buildConnector = spec.connectorFactory ?? createConnector;
  let stopped = false;

  const topo = sortPipelines(spec.pipelines);
  const pipelines = topo.order;
  const linkPipelines = spec.linkPipelines ?? [];
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

  type SourceCtx = {
    source: string;
    pipeline: Pipeline;
    connectorId: string;
    connectorDef: ConnectorDef;
    hydrate: (ctx: HydrateContext) => Promise<{ rowCount: number }>;
    loadedAt: string;
  };

  async function syncOneSource(ctx: SourceCtx): Promise<SyncResult> {
    const { source, pipeline, connectorId, connectorDef, loadedAt } = ctx;
    const sourceTable = `${connectorId}/${source}`;
    const partial = isPartialSource(connectorDef, source);
    const sinkLogForSource = sinkLog.child({ source });
    const sourceLevel = sourceLevelProvenance(connectorDef, source, storage);

    await queryStore.exec(`DROP TABLE IF EXISTS ${qi(sourceTable)}`);

    let result = emptySyncResult();
    try {
      const hydrated = await ctx.hydrate(
        buildHydrateContext({
          connectorId,
          source,
          stagingTable: sourceTable,
          store: queryStore,
          storage,
          log: log.child({ component: "hydrate", source }),
        }),
      );

      if (hydrated.rowCount === 0) {
        const archiveOnEmpty = isArchiveOnEmpty(connectorDef, source);
        log.debug(`"${source}" is empty (partial=${partial}, archiveOnEmpty=${archiveOnEmpty})`);
        for (const step of pipeline.steps) {
          if (step.kind !== "graph-sink" || !spec.graphClient) continue;
          if (!partial && !archiveOnEmpty && await stateExists(queryStore, connectorId, step.id)) {
            sinkLogForSource.warn(
              `"${source}": zero rows but prior state exists for sink "${step.id}"; skipping archival. Set archiveOnEmpty: true on the source config to opt into drain-on-empty.`,
            );
            continue;
          }
          const provenance = composeProvenance({
            connectorId, source,
            connector: connectorDef.provenance,
            sourceLevel,
            sink: step.config.provenance,
            loadedAt,
          });
          result = mergeSyncResults(
            result,
            await diffAndSync(step.id, step.config, null, connectorId, queryStore, spec.graphClient, provenance, sinkLogForSource, partial),
          );
        }
        return result;
      }

      if (spec.validate !== false) {
        await validatePipeline(pipeline, queryStore, { log: log.child({ component: "validate" }), resolveTransform });
      }

      await runPipeline(pipeline, queryStore, resolveTransform, async (step, currentTable) => {
        if (step.kind === "graph-sink" && spec.graphClient) {
          const provenance = composeProvenance({
            connectorId, source,
            connector: connectorDef.provenance,
            sourceLevel,
            sink: step.config.provenance,
            loadedAt,
          });
          result = mergeSyncResults(
            result,
            await diffAndSync(step.id, step.config, currentTable, connectorId, queryStore, spec.graphClient, provenance, sinkLogForSource, partial),
          );
        } else if (step.kind === "checkpoint") {
          await writeCheckpoint(step.name, currentTable, queryStore, storage);
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result = mergeSyncResults(result, {
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
    return result;
  }

  async function flushGraphLinks(connectorId: string): Promise<SyncResult> {
    if (!spec.graphClient) return emptySyncResult();
    return flushPendingGraphLinks(connectorId, queryStore, spec.graphClient, sinkLog);
  }

  async function batchSync(filter?: string[], options: SyncOptions = {}): Promise<SyncResult> {
    if (syncing) return emptySyncResult();
    syncing = true;
    const start = Date.now();
    let totals = emptySyncResult();

    await storage.prepare(queryStore);
    const connector = buildConnector(spec.connector, log.child({ component: "connector", connector: spec.connector.id }));
    if (connector.mode !== "batch") throw new Error(`sync() requires a batch connector, got "${connector.mode}"`);

    const loadedAt = new Date().toISOString();
    const targets = filter
      ? pipelines.filter((tp) => filter.includes(tp.source))
      : pipelines;

    log.info(`sync: connector "${connector.id}" sources=[${targets.map((tp) => tp.source).join(", ")}]`);

    try {
      for (const { source, pipeline } of targets) {
        totals = mergeSyncResults(totals, await syncOneSource({
          source, pipeline,
          connectorId: connector.id,
          connectorDef: spec.connector,
          hydrate: (ctx) => connector.hydrate(ctx),
          loadedAt,
        }));
      }
      if (!options.deferGraphLinks) {
        if (linkPipelines.length > 0) log.info(`link phase: ${linkPipelines.length} link pipeline(s) starting`);
        for (const lp of linkPipelines) {
          const lpProv = composeProvenance({ connectorId: connector.id, source: linkPipelineSourceLabel(lp), connector: spec.connector.provenance, loadedAt });
          totals = mergeSyncResults(totals, await processLinkPipeline(lp, connector.id, queryStore, storage, lpProv, sinkLog.child({ link: lp.id })));
        }
        if (linkPipelines.length > 0) {
          log.info(`link phase: all pipelines staged, flushing to graph`);
          totals = mergeSyncResults(totals, await flushGraphLinks(connector.id));
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
    sync: () => batchSync(),
    syncSources: (filter, options) => batchSync(filter, options),
    flushGraphLinks: async () => {
      let totals = emptySyncResult();
      const connectorId = spec.connector.id;
      const loadedAt = new Date().toISOString();
      for (const lp of linkPipelines) {
        const lpProv = composeProvenance({ connectorId, source: linkPipelineSourceLabel(lp), connector: spec.connector.provenance, loadedAt });
        totals = mergeSyncResults(totals, await processLinkPipeline(lp, connectorId, queryStore, storage, lpProv, sinkLog.child({ link: lp.id })));
      }
      totals = mergeSyncResults(totals, await flushGraphLinks(connectorId));
      return totals;
    },
    getSourceOrder: () => pipelines.map((tp) => tp.source),

    async run() {
      const probe = buildConnector(spec.connector, log.child({ component: "connector", connector: spec.connector.id }));
      const mode = probe.mode;
      log.info(`connector "${probe.id}" mode=${mode} sources=[${pipelines.map((tp) => tp.source).join(", ")}]`);

      if (mode === "batch") {
        await probe.close();
        await batchSync();
        const intervalMs = spec.syncIntervalMs;
        if (intervalMs && intervalMs > 0) {
          while (!stopped) {
            await sleep(intervalMs);
            if (stopped) break;
            if (syncing) { log.warn("sync still running, skipping"); continue; }
            await batchSync();
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

        const sourceLevel = sourceLevelProvenance(spec.connector, table, storage);
        const makeProvenance = (sink: ProvenanceConfig | undefined): SourceProvenance =>
          composeProvenance({
            connectorId: connector.id,
            source: table,
            connector: spec.connector.provenance,
            sourceLevel,
            sink,
            loadedAt: new Date().toISOString(),
          });

        if (deletes.length > 0 && spec.graphClient) {
          log.debug(`${deletes.length} deletes for "${table}"`);
          for (const step of pipeline.steps) {
            if (step.kind === "graph-sink") {
              await archiveDeletes(deletes, step.config, connector.id, spec.graphClient, makeProvenance(step.config.provenance), sinkLogForSource);
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
              await processGraphSink(step.id, step.config, currentTable, connector.id, queryStore, spec.graphClient!, makeProvenance(step.config.provenance), sinkLogForSource);
            } else if (step.kind === "checkpoint") {
              await writeCheckpoint(step.name, currentTable, queryStore, storage);
            }
          };

          await runPipeline(pipeline, queryStore, resolveTransform, onSideEffect);
          if (spec.graphClient) await flushGraphLinks(connector.id);

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

function linkPipelineSourceLabel(lp: LinkPipeline): string {
  if (lp.source) return lp.source;
  const checkpoints = Object.values(lp.inputs ?? {});
  return checkpoints.length > 0 ? checkpoints.join(",") : lp.id;
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

function sourceLevelProvenance(def: ConnectorDef, source: string, storage: Storage): ProvenanceConfig | undefined {
  switch (def.mode) {
    case "batch": {
      const s = def.sources[source];
      if (!s) return undefined;
      if (s.kind === "checkpoint") {
        return overlay(s.provenance, { location: { name: `checkpoint:${s.name}`, uri: storage.uriFor(checkpointKey(s.name)) } });
      }
      if (s.kind === "external") {
        return overlay(s.provenance, { location: { uri: storage.uriFor(s.key) } });
      }
      return s.provenance;
    }
    case "rest-api":     return def.endpoints[source]?.provenance;
    case "cdc":          return def.tables[source]?.provenance;
    case "mongo-stream": return def.collections[source]?.provenance;
  }
}

/** User-declared `user` wins over framework-derived `base` (e.g. checkpoint/external URIs). */
function overlay(user: ProvenanceConfig | undefined, base: ProvenanceConfig): ProvenanceConfig {
  if (!user) return base;
  return {
    authors: user.authors ?? base.authors,
    location: {
      name: user.location?.name ?? base.location?.name,
      uri: user.location?.uri ?? base.location?.uri,
      description: user.location?.description ?? base.location?.description,
    },
    firstPublished: user.firstPublished ?? base.firstPublished,
    lastUpdated: user.lastUpdated ?? base.lastUpdated,
  };
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
