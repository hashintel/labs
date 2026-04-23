import { createHash } from "node:crypto";
import type { BulkUpsertFailure, BulkUpsertOptions, BulkUpsertResult, GraphClient, GraphOp, PropertyProvenance, ResolvedLink, SourceProvenance } from "./types.js";
import type { VersionedUrl } from "../transform/pipeline.js";

const BULK_SIZE = Math.max(1, Number(process.env.HASH_GRAPH_BULK_SIZE ?? 128));
const BULK_CONCURRENCY = Math.max(1, Number(process.env.HASH_GRAPH_CONCURRENCY ?? 16));

export type GraphClientConfig = {
  baseUrl: string;
  actorId: string;
};

type ValueMetadata = { dataTypeId: null; provenance?: PropertyProvenance };
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

function deterministicUuid(entityType: string, entityId: unknown): string {
  const hash = createHash("sha1")
    .update(NAMESPACE)
    .update(`${entityType}::${String(entityId)}`)
    .digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    "5" + hash.slice(13, 16),
    ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join("-");
}

function compositeEntityId(webId: string, entityUuid: string): string {
  return `${webId}~${entityUuid}`;
}

function toBaseUrl(versionedUrl: string): string {
  return versionedUrl.replace(/v\/\d+$/, "");
}

function metadataFor(url: VersionedUrl, prov: Record<VersionedUrl, PropertyProvenance> | undefined): ValueMetadata {
  const p = prov?.[url];
  return p ? { dataTypeId: null, provenance: p } : { dataTypeId: null };
}

function mapProperties(
  props: Record<VersionedUrl, unknown>,
  prov?: Record<VersionedUrl, PropertyProvenance>,
): PropertyObjectWithMetadata {
  const value: Record<string, PropertyValueWithMetadata> = {};
  for (const [url, val] of Object.entries(props)) {
    if (val != null) value[toBaseUrl(url)] = { value: val, metadata: metadataFor(url, prov) };
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
    .filter(([, val]) => val != null)
    .map(([url, val]) => ({
      op: "add" as const,
      path: [toBaseUrl(url)],
      property: { value: val, metadata: metadataFor(url, prov) },
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

/** Full response body is preserved on `.body` for branching (e.g. 409 / duplicate detection); only the first 200 chars appear in the error message. */
export class GraphApiError extends Error {
  constructor(public status: number, public operation: string, public body: string) {
    super(`Graph API ${operation} failed (${status}): ${body.slice(0, 200)}`);
  }
}

function isDuplicate(e: GraphApiError): boolean {
  return e.body.includes("duplicate key") || e.body.includes("ALREADY_EXISTS");
}

async function request<T>(method: string, config: GraphClientConfig, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Authenticated-User-Actor-Id": config.actorId,
    },
    body: JSON.stringify(body),
  });
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
  const { entities } = await request<{ entities: GraphEntity[] }>("POST", config, "/entities/query", body);
  return entities;
}

export function createGraphClient(config: GraphClientConfig): GraphClient {
  async function upsertMain(op: Extract<GraphOp, { kind: "upsert" }>): Promise<{ fullEntityId: string; provenance: HASHProvenance }> {
    const entityUuid = deterministicUuid(op.entityType, op.entityId);
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
      } satisfies CreateEntityParams);
    } catch (e) {
      if (e instanceof GraphApiError && (e.status === 409 || isDuplicate(e))) {
        await request("PATCH", config, "/entities", {
          entityId: fullEntityId,
          provenance,
          archived: false,
          entityTypeIds: [op.entityType],
          properties: mapPropertiesAsPatch(op.properties, op.propertyProvenance),
        } satisfies PatchEntityParams);
      } else {
        throw e;
      }
    }
    return { fullEntityId, provenance };
  }

  async function archiveStaleLinks(
    op: Extract<GraphOp, { kind: "upsert" }>,
    provenance: HASHProvenance,
  ): Promise<void> {
    for (const stale of op.staleLinks) {
      const staleLinkId = compositeEntityId(op.webId, deterministicUuid(stale.linkType, `${op.entityId}::${stale.targetId}`));
      try {
        await request("PATCH", config, "/entities", { entityId: staleLinkId, provenance, archived: true } satisfies PatchEntityParams);
      } catch (err) {
        if (err instanceof GraphApiError && err.status === 404) continue;
        throw err;
      }
    }
  }

  async function upsertEntity(op: Extract<GraphOp, { kind: "upsert" }>): Promise<void> {
    const { fullEntityId, provenance } = await upsertMain(op);
    for (const link of op.links) await upsertLink(config, op, link, provenance, fullEntityId);
    await archiveStaleLinks(op, provenance);
  }

  function linkCreateParams(
    op: Extract<GraphOp, { kind: "upsert" }>,
    link: ResolvedLink,
    provenance: HASHProvenance,
    leftEntityId: string,
  ): CreateEntityParams {
    const rightEntityId = compositeEntityId(op.webId, deterministicUuid(link.targetEntityType, link.targetId));
    const linkUuid = deterministicUuid(link.linkType, `${op.entityId}::${link.targetId}`);
    return {
      webId: op.webId,
      entityTypeIds: [link.linkType],
      properties: link.properties
        ? mapProperties(link.properties as Record<VersionedUrl, unknown>, link.propertyProvenance)
        : { value: {} },
      draft: false,
      provenance,
      entityUuid: linkUuid,
      linkData: { leftEntityId, rightEntityId },
    };
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

    await parallel(chunks, BULK_CONCURRENCY, async (chunk) => {
      const payload: CreateEntityParams[] = [];
      for (const op of chunk) {
        const provenance = mapProvenance(op.provenance);
        const fullEntityId = compositeEntityId(op.webId, deterministicUuid(op.entityType, op.entityId));
        payload.push({
          webId: op.webId,
          entityTypeIds: [op.entityType],
          properties: mapProperties(op.properties, op.propertyProvenance),
          draft: false,
          provenance,
          entityUuid: deterministicUuid(op.entityType, op.entityId),
        });
        for (const link of op.links) payload.push(linkCreateParams(op, link, provenance, fullEntityId));
      }

      const chunkOk: string[] = [];
      try {
        await request("POST", config, "/entities/bulk", payload);
        await parallel(chunk, BULK_CONCURRENCY, async (op) => {
          try {
            await archiveStaleLinks(op, mapProvenance(op.provenance));
            chunkOk.push(String(op.entityId));
          } catch (err) {
            failed.push({ op, error: err as Error });
          }
        });
      } catch {
        // Batch rejected; retry individually so 409s become PATCHes.
        fellBackBatches++;
        for (const op of chunk) {
          try {
            await upsertEntity(op);
            chunkOk.push(String(op.entityId));
          } catch (err) {
            failed.push({ op, error: err as Error });
          }
        }
      }
      ok.push(...chunkOk);
      if (chunkOk.length > 0 && options?.onBatchOk) await options.onBatchOk(chunkOk);
      options?.onProgress?.(ok.length + failed.length, ops.length);
    });

    return { ok, failed, batches: chunks.length, fellBackBatches, durationMs: Date.now() - start };
  }

  async function archiveEntity(op: Extract<GraphOp, { kind: "archive" }>): Promise<void> {
    const entityUuid = deterministicUuid(op.entityType, op.entityId);
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

  return { upsertEntity, bulkUpsertEntities, archiveEntity };
}

async function parallel<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

async function ensureEntity(
  config: GraphClientConfig,
  entityType: string,
  entityId: unknown,
  webId: string,
  provenance: HASHProvenance,
): Promise<void> {
  const uuid = deterministicUuid(entityType, entityId);
  try {
    await request("POST", config, "/entities", {
      webId,
      entityTypeIds: [entityType],
      properties: { value: {} },
      draft: false,
      provenance,
      entityUuid: uuid,
    } satisfies CreateEntityParams);
  } catch (e) {
    if (e instanceof GraphApiError && (e.status === 409 || isDuplicate(e))) return;
    throw e;
  }
}

async function upsertLink(
  config: GraphClientConfig,
  op: Extract<GraphOp, { kind: "upsert" }>,
  link: ResolvedLink,
  provenance: HASHProvenance,
  leftEntityId: string,
): Promise<void> {
  const targetUuid = deterministicUuid(link.targetEntityType, link.targetId);
  const rightEntityId = compositeEntityId(op.webId, targetUuid);
  const linkUuid = deterministicUuid(link.linkType, `${op.entityId}::${link.targetId}`);

  const linkProps = link.properties
    ? mapProperties(link.properties as Record<VersionedUrl, unknown>, link.propertyProvenance)
    : { value: {} };

  const createLink = () => request("POST", config, "/entities", {
    webId: op.webId,
    entityTypeIds: [link.linkType],
    properties: linkProps,
    draft: false,
    provenance,
    entityUuid: linkUuid,
    linkData: { leftEntityId, rightEntityId },
  } satisfies CreateEntityParams);

  const reviveLink = () => request("PATCH", config, "/entities", {
    entityId: compositeEntityId(op.webId, linkUuid),
    provenance,
    archived: false,
    ...(link.properties
      ? { properties: mapPropertiesAsPatch(link.properties as Record<VersionedUrl, unknown>, link.propertyProvenance) }
      : {}),
  } satisfies PatchEntityParams);

  try {
    await createLink();
  } catch (e) {
    if (e instanceof GraphApiError && (e.status === 409 || isDuplicate(e))) {
      await reviveLink();
      return;
    }
    if (e instanceof GraphApiError && isFkViolation(e)) {
      await ensureEntity(config, link.targetEntityType, link.targetId, op.webId, provenance);
      try { await createLink(); } catch (e2) {
        if (e2 instanceof GraphApiError && (e2.status === 409 || isDuplicate(e2))) {
          await reviveLink();
          return;
        }
        throw e2;
      }
      return;
    }
    throw e;
  }
}

function isFkViolation(e: GraphApiError): boolean {
  return e.body.includes("foreign key constraint") || e.body.includes("entity_edge");
}
