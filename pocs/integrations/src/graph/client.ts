import { createHash } from "node:crypto";
import type { BulkLinkFailure, BulkLinkOptions, BulkLinkResult, BulkUpsertFailure, BulkUpsertOptions, BulkUpsertResult, GraphClient, GraphLinkOp, GraphOp, PropertyProvenance, SourceProvenance } from "./types.js";
import { isTypedValue } from "./types.js";
import type { VersionedUrl } from "../transform/pipeline.js";
import { parallel } from "../parallel.js";
import { with429Retry } from "../http-retry.js";

const BULK_SIZE = Math.max(1, Number(process.env.HASH_GRAPH_BULK_SIZE ?? 128));
const BULK_CONCURRENCY = Math.max(1, Number(process.env.HASH_GRAPH_CONCURRENCY ?? 16));
// Consecutive all-failed batches that abort a bulk call (fail fast on systemic errors).
function maxFailedBatchStreak(): number {
  return Math.max(1, Number(process.env.HASH_GRAPH_MAX_FAILED_BATCHES ?? 5));
}

/**
 * Op-weighted write budget. `acquire` is awaited before each write request with
 * the number of graph ops it carries (bulk chunk = chunk length, single op = 1);
 * a slow acquire back-pressures the windowed sink loops upstream. What backs it
 * (a local or orchestrator-coordinated token bucket) is the runner's concern; the
 * engine only awaits.
 */
export type GraphLimiter = { acquire(ops: number): Promise<void> };

export type GraphClientConfig = {
  baseUrl: string;
  actorId: string;
  limiter?: GraphLimiter;
};

type ValueMetadata = { dataTypeId: VersionedUrl | null; provenance?: PropertyProvenance };
type PropertyValueWithMetadata = { value: unknown; metadata: ValueMetadata };
type PropertyObjectWithMetadata = { value: Record<string, PropertyValueWithMetadata> };

type HASHSourceProvenance = {
  type: "integration";
  entityId?: string;
  authors?: string[];
  location?: { name?: string; uri?: string; description?: string };
  firstPublished?: string;
  lastUpdated?: string;
  loadedAt?: string;
};

type HASHProvenance = {
  actorType: "machine";
  origin: { type: "api"; id?: string };
  sources?: HASHSourceProvenance[];
};

type CreateEntityParams = {
  webId: string;
  entityTypeIds: string[];
  properties: PropertyObjectWithMetadata;
  draft: boolean;
  provenance: HASHProvenance;
  entityUuid?: string;
  linkData?: { leftEntityId: string; rightEntityId: string };
  readOnly?: boolean;
};

type PatchEntityParams = {
  entityId: string;
  provenance: HASHProvenance;
  archived?: boolean;
  entityTypeIds?: string[];
  properties?: { op: "add" | "replace"; path: string[]; property: PropertyValueWithMetadata }[];
};

// UUID v5: sha1(namespace || name) with RFC 4122 version/variant bits.
// Fixed namespace prevents collisions with other UUID v5 users.
const NAMESPACE = Buffer.from("d6e2c7a1f84b4e3a9c0d5b7f1e3a2d4c", "hex"); // 16 bytes

export function deterministicUuid(ns: string, entityType: string, entityId: unknown): string {
  const hash = createHash("sha1")
    .update(NAMESPACE)
    .update(`${ns}::${entityType}::${String(entityId)}`)
    .digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    "5" + hash.slice(13, 16),
    ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join("-");
}

export function compositeEntityId(webId: string, entityUuid: string): string {
  return `${webId}~${entityUuid}`;
}

function toBaseUrl(versionedUrl: string): string {
  return versionedUrl.replace(/v\/\d+$/, "");
}

function metadataFor(
  url: VersionedUrl,
  prov: Record<VersionedUrl, PropertyProvenance> | undefined,
  dataTypeId: VersionedUrl | null,
): ValueMetadata {
  const p = prov?.[url];
  return p ? { dataTypeId, provenance: p } : { dataTypeId };
}

/** Unwrap a typed value to its (value, dataTypeId); a plain value keeps dataTypeId null. */
function unwrap(raw: unknown): { value: unknown; dataTypeId: VersionedUrl | null } {
  return isTypedValue(raw) ? { value: raw.value, dataTypeId: raw.dataTypeId } : { value: raw, dataTypeId: null };
}

function mapProperties(
  props: Record<VersionedUrl, unknown>,
  prov?: Record<VersionedUrl, PropertyProvenance>,
): PropertyObjectWithMetadata {
  const value: Record<string, PropertyValueWithMetadata> = {};
  for (const [url, raw] of Object.entries(props)) {
    const { value: val, dataTypeId } = unwrap(raw);
    if (val != null) value[toBaseUrl(url)] = { value: val, metadata: metadataFor(url, prov, dataTypeId) };
  }
  return { value };
}

function mapPropertiesAsPatch(
  props: Record<VersionedUrl, unknown>,
  prov?: Record<VersionedUrl, PropertyProvenance>,
): PatchEntityParams["properties"] {
  // `add` upserts the property (RFC 6902: creates if missing, overwrites if present).
  // `replace` would require every property key to already exist on the record, which
  // fails for properties that were null on the initial write and are set on a resync.
  return Object.entries(props)
    .map(([url, raw]) => ({ url, ...unwrap(raw) }))
    .filter(({ value: val }) => val != null)
    .map(({ url, value: val, dataTypeId }) => ({
      op: "add" as const,
      path: [toBaseUrl(url)],
      property: { value: val, metadata: metadataFor(url as VersionedUrl, prov, dataTypeId) },
    }));
}

function mapProvenance(source: SourceProvenance): HASHProvenance {
  const prov: HASHProvenance = {
    actorType: "machine",
    origin: { type: "api" },
  };
  const src: HASHSourceProvenance = { type: "integration" };
  if (source.authors?.length)  src.authors = source.authors;
  if (source.location)         src.location = source.location;
  if (source.loadedAt)         src.loadedAt = source.loadedAt;
  if (source.firstPublished)   src.firstPublished = source.firstPublished;
  if (source.lastUpdated)      src.lastUpdated = source.lastUpdated;
  if (source.entityId)         src.entityId = source.entityId;
  prov.sources = [src];
  return prov;
}

// Full response body kept on `.body` for duplicate detection; message shows the first 200 chars.
export class GraphApiError extends Error {
  constructor(public status: number, public operation: string, public body: string) {
    super(`Graph API ${operation} failed (${status}): ${body.slice(0, 200)}`);
  }
}

function isDuplicate(e: GraphApiError): boolean {
  return e.body.includes("duplicate key") || e.body.includes("ALREADY_EXISTS");
}

// Per-request ceiling, so a wedged graph fails fast instead of hanging workers.
function requestTimeoutMs(): number {
  return Math.max(1000, Number(process.env.HASH_GRAPH_TIMEOUT_MS ?? 120_000));
}

async function request<T>(method: string, config: GraphClientConfig, path: string, body: unknown, opWeight = 1): Promise<T> {
  const timeoutMs = requestTimeoutMs();
  if (opWeight > 0) await config.limiter?.acquire(opWeight);

  let res: Response;
  try {
    // Budget acquired once per intent; 429 retries are server pushback, not new spend.
    res = await with429Retry(() =>
      fetch(`${config.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Authenticated-User-Actor-Id": config.actorId,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      }),
    );
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new GraphApiError(0, `${method} ${path}`, `request timed out after ${timeoutMs}ms (graph overloaded or unreachable)`);
    }
    throw e;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GraphApiError(res.status, `${method} ${path}`, text);
  }
  return res.json() as Promise<T>;
}

export type GraphEntity = {
  properties: Record<string, unknown>;
  metadata: {
    recordId: { entityId: string; editionId: string };
    entityTypeIds: string[];
    archived: boolean;
    provenance: { edition: { sources?: { type: string; location?: { name?: string } }[] } };
  };
  linkData?: { leftEntityId: string; rightEntityId: string };
};

/** Test/debug helper: up to 100 non-draft entities at current time. */
export async function queryEntities(config: GraphClientConfig): Promise<GraphEntity[]> {
  const body = {
    filter: { all: [] },
    temporalAxes: {
      pinned: { axis: "transactionTime", timestamp: null },
      variable: { axis: "decisionTime", interval: { start: null, end: null } },
    },
    includeDrafts: false,
    includePermissions: false,
    limit: 100,
  };
  const { entities } = await request<{ entities: GraphEntity[] }>("POST", config, "/entities/query", body, 0);
  return entities;
}

export function createGraphClient(config: GraphClientConfig): GraphClient {
  /** Create-then-patch upsert. Returns whether the entity already existed. */
  async function upsertMain(op: Extract<GraphOp, { kind: "upsert" }>): Promise<boolean> {
    const entityUuid = deterministicUuid(op.namespace, op.entityType, op.entityId);
    const fullEntityId = compositeEntityId(op.webId, entityUuid);
    const provenance = mapProvenance(op.provenance);

    try {
      await request("POST", config, "/entities", {
        webId: op.webId,
        entityTypeIds: [op.entityType],
        properties: mapProperties(op.properties, op.propertyProvenance),
        draft: false,
        provenance,
        entityUuid,
        readOnly: true,
      } satisfies CreateEntityParams);
      return false;
    } catch (e) {
      if (e instanceof GraphApiError && (e.status === 409 || isDuplicate(e))) {
        await request("PATCH", config, "/entities", {
          entityId: fullEntityId,
          provenance,
          archived: false,
          entityTypeIds: [op.entityType],
          properties: mapPropertiesAsPatch(op.properties, op.propertyProvenance),
        } satisfies PatchEntityParams);
        return true;
      }
      throw e;
    }
  }

  async function upsertEntity(op: Extract<GraphOp, { kind: "upsert" }>): Promise<void> {
    await upsertMain(op);
  }

  function linkEntityIds(op: GraphLinkOp): { leftEntityId: string; rightEntityId: string; linkUuid: string; fullLinkId: string } {
    const leftEntityId = compositeEntityId(op.webId, deterministicUuid(op.namespace, op.sourceEntityType, op.sourceEntityId));
    const rightEntityId = compositeEntityId(op.webId, deterministicUuid(op.namespace, op.targetEntityType, op.targetId));
    const linkUuid = deterministicUuid(op.namespace, op.linkType, `${op.sourceEntityType}::${op.sourceEntityId}::${op.targetEntityType}::${op.targetId}`);
    return { leftEntityId, rightEntityId, linkUuid, fullLinkId: compositeEntityId(op.webId, linkUuid) };
  }

  function linkCreateParams(
    op: GraphLinkOp,
    provenance: HASHProvenance,
  ): CreateEntityParams {
    const { leftEntityId, rightEntityId, linkUuid } = linkEntityIds(op);
    return {
      webId: op.webId,
      entityTypeIds: [op.linkType],
      properties: op.properties
        ? mapProperties(op.properties as Record<VersionedUrl, unknown>, op.propertyProvenance)
        : { value: {} },
      draft: false,
      provenance,
      entityUuid: linkUuid,
      linkData: { leftEntityId, rightEntityId },
      readOnly: true,
    };
  }

  /** PATCH-first upsert for re-flushes where the entity is known to exist; falls back to create on 404. */
  async function upsertEntityPatchFirst(op: Extract<GraphOp, { kind: "upsert" }>): Promise<void> {
    const entityUuid = deterministicUuid(op.namespace, op.entityType, op.entityId);
    try {
      await request("PATCH", config, "/entities", {
        entityId: compositeEntityId(op.webId, entityUuid),
        provenance: mapProvenance(op.provenance),
        archived: false,
        entityTypeIds: [op.entityType],
        properties: mapPropertiesAsPatch(op.properties, op.propertyProvenance),
      } satisfies PatchEntityParams);
    } catch (e) {
      if (e instanceof GraphApiError && e.status === 404) return upsertEntity(op);
      throw e;
    }
  }

  async function bulkUpsertEntities(
    ops: Extract<GraphOp, { kind: "upsert" }>[],
    options?: BulkUpsertOptions,
  ): Promise<BulkUpsertResult> {
    const start = Date.now();
    const ok: string[] = [];
    const failed: BulkUpsertFailure[] = [];
    const chunks: (typeof ops)[] = [];
    for (let i = 0; i < ops.length; i += BULK_SIZE) chunks.push(ops.slice(i, i + BULK_SIZE));
    let fellBackBatches = 0;
    const maxStreak = maxFailedBatchStreak();
    let failedStreak = 0;
    let aborted = false;

    await parallel(chunks, BULK_CONCURRENCY, async (chunk) => {
      if (aborted) return;
      const payload: CreateEntityParams[] = [];
      for (const op of chunk) {
        const provenance = mapProvenance(op.provenance);
        const entityUuid = deterministicUuid(op.namespace, op.entityType, op.entityId);
        payload.push({
          webId: op.webId,
          entityTypeIds: [op.entityType],
          properties: mapProperties(op.properties, op.propertyProvenance),
          draft: false,
          provenance,
          entityUuid,
          readOnly: true,
        });
      }

      const chunkOk: string[] = [];
      // Commit successes incrementally so an interrupted slow flush keeps its progress.
      let notified = 0;
      const notify = async () => {
        if (chunkOk.length === notified) return;
        const fresh = chunkOk.slice(notified);
        notified = chunkOk.length;
        ok.push(...fresh);
        if (options?.onBatchOk) await options.onBatchOk(fresh);
        options?.onProgress?.(ok.length + failed.length, ops.length);
      };

      try {
        await request("POST", config, "/entities/bulk", payload, chunk.length);
        for (const op of chunk) chunkOk.push(String(op.entityId));
      } catch (batchErr) {
        // Fall back to per-op; if the first already existed, the rest go PATCH-first.
        fellBackBatches++;
        options?.onBatchFallback?.(batchErr as Error);
        const duplicate = batchErr instanceof GraphApiError && (batchErr.status === 409 || isDuplicate(batchErr));
        let patchFirst = false;
        for (let i = 0; i < chunk.length; i++) {
          const op = chunk[i];
          try {
            if (patchFirst) {
              await upsertEntityPatchFirst(op);
            } else {
              const existed = await upsertMain(op);
              if (i === 0 && existed && duplicate) patchFirst = true;
            }
            chunkOk.push(String(op.entityId));
            if (chunkOk.length - notified >= 16) await notify();
          } catch (err) {
            const failure = { op, error: err as Error };
            failed.push(failure);
            options?.onFailure?.(failure);
          }
        }
      }
      failedStreak = chunkOk.length > 0 ? 0 : failedStreak + 1;
      if (failedStreak >= maxStreak) aborted = true;
      await notify();
      options?.onProgress?.(ok.length + failed.length, ops.length);
    });

    return { ok, failed, batches: chunks.length, fellBackBatches, durationMs: Date.now() - start, aborted };
  }

  /** Create-then-patch link upsert. Returns whether the link already existed. */
  async function upsertLinkMain(op: GraphLinkOp): Promise<boolean> {
    const provenance = mapProvenance(op.provenance);
    const { fullLinkId } = linkEntityIds(op);

    try {
      await request("POST", config, "/entities", linkCreateParams(op, provenance));
      return false;
    } catch (e) {
      if (e instanceof GraphApiError && (e.status === 409 || isDuplicate(e))) {
        await request("PATCH", config, "/entities", {
          entityId: fullLinkId,
          provenance,
          archived: false,
          ...(op.properties
            ? { properties: mapPropertiesAsPatch(op.properties as Record<VersionedUrl, unknown>, op.propertyProvenance) }
            : {}),
        } satisfies PatchEntityParams);
        return true;
      }
      throw e;
    }
  }

  async function upsertLink(op: GraphLinkOp): Promise<"ok"> {
    await upsertLinkMain(op);
    return "ok";
  }

  async function upsertLinkPatchFirst(op: GraphLinkOp): Promise<void> {
    const { fullLinkId } = linkEntityIds(op);
    try {
      await request("PATCH", config, "/entities", {
        entityId: fullLinkId,
        provenance: mapProvenance(op.provenance),
        archived: false,
        ...(op.properties
          ? { properties: mapPropertiesAsPatch(op.properties as Record<VersionedUrl, unknown>, op.propertyProvenance) }
          : {}),
      } satisfies PatchEntityParams);
    } catch (e) {
      if (e instanceof GraphApiError && e.status === 404) { await upsertLink(op); return; }
      throw e;
    }
  }

  async function bulkUpsertLinks(ops: GraphLinkOp[], options?: BulkLinkOptions): Promise<BulkLinkResult> {
    const start = Date.now();
    const ok: string[] = [];
    const failed: BulkLinkFailure[] = [];
    const chunks: GraphLinkOp[][] = [];
    for (let i = 0; i < ops.length; i += BULK_SIZE) chunks.push(ops.slice(i, i + BULK_SIZE));
    let fellBackBatches = 0;
    const maxStreak = maxFailedBatchStreak();
    let failedStreak = 0;
    let aborted = false;

    await parallel(chunks, BULK_CONCURRENCY, async (chunk) => {
      if (aborted) return;
      const payload = chunk.map((op) => linkCreateParams(op, mapProvenance(op.provenance)));
      const chunkOk: string[] = [];
      let notified = 0;
      const notify = async () => {
        if (chunkOk.length === notified) return;
        const fresh = chunkOk.slice(notified);
        notified = chunkOk.length;
        ok.push(...fresh);
        if (options?.onBatchOk) await options.onBatchOk(fresh);
        options?.onProgress?.(ok.length + failed.length, ops.length);
      };

      try {
        await request("POST", config, "/entities/bulk", payload, chunk.length);
        for (const op of chunk) chunkOk.push(op.opId);
      } catch (batchErr) {
        // Sampled PATCH-first, as in bulkUpsertEntities.
        fellBackBatches++;
        options?.onBatchFallback?.(batchErr as Error);
        const duplicate = batchErr instanceof GraphApiError && (batchErr.status === 409 || isDuplicate(batchErr));
        let patchFirst = false;
        for (let i = 0; i < chunk.length; i++) {
          const op = chunk[i];
          try {
            if (patchFirst) {
              await upsertLinkPatchFirst(op);
            } else {
              const existed = await upsertLinkMain(op);
              if (i === 0 && existed && duplicate) patchFirst = true;
            }
            chunkOk.push(op.opId);
            if (chunkOk.length - notified >= 16) await notify();
          } catch (err) {
            const failure = { op, error: err as Error };
            failed.push(failure);
            options?.onFailure?.(failure);
          }
        }
      }
      failedStreak = chunkOk.length > 0 ? 0 : failedStreak + 1;
      if (failedStreak >= maxStreak) aborted = true;
      await notify();
      options?.onProgress?.(ok.length + failed.length, ops.length);
    });

    return { ok, failed, batches: chunks.length, fellBackBatches, durationMs: Date.now() - start, aborted };
  }

  async function archiveEntity(op: Extract<GraphOp, { kind: "archive" }>): Promise<void> {
    const entityUuid = deterministicUuid(op.namespace, op.entityType, op.entityId);
    const fullEntityId = compositeEntityId(op.webId, entityUuid);
    try {
      await request("PATCH", config, "/entities", {
        entityId: fullEntityId,
        provenance: mapProvenance(op.provenance),
        archived: true,
      } satisfies PatchEntityParams);
    } catch (err) {
      if (err instanceof GraphApiError && err.status === 404) return;
      throw err;
    }
  }

  function identity(): string {
    return config.baseUrl.replace(/\/+$/, "");
  }

  // Archived entities count as existing: the state row may legitimately outlive an
  // archive (user-archived in HASH, or our own crash between archive and state delete).
  async function hasEntity(fullEntityId: string): Promise<boolean> {
    const uuid = fullEntityId.split("~")[1] ?? fullEntityId;
    const body = {
      filter: { equal: [{ path: ["uuid"] }, { parameter: uuid }] },
      temporalAxes: {
        pinned: { axis: "transactionTime", timestamp: null },
        variable: { axis: "decisionTime", interval: { start: null, end: null } },
      },
      includeDrafts: false,
      includePermissions: false,
      limit: 1,
    };
    const { entities } = await request<{ entities?: GraphEntity[] }>("POST", config, "/entities/query", body, 0);
    // Deterministic UUIDs are web-independent; require the composite id to match so an
    // identical entity in another web does not satisfy the probe. A malformed response
    // reads as absent -- the all-absent sentinel check then hard-errors before any write.
    return (entities ?? []).some((e) => e.metadata.recordId.entityId === fullEntityId);
  }

  return { upsertEntity, bulkUpsertEntities, upsertLink, bulkUpsertLinks, archiveEntity, identity, hasEntity };
}

