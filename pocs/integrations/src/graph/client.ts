import { createHash } from "node:crypto";
import type { GraphClient, GraphOp, ResolvedLink, SourceProvenance } from "./types.js";
import type { VersionedUrl } from "../transform/pipeline.js";

export type GraphClientConfig = {
  baseUrl: string;
  actorId: string;
};

type PropertyValueWithMetadata = { value: unknown; metadata: { dataTypeId: null } };
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
  properties?: { op: "replace"; path: string[]; property: PropertyValueWithMetadata }[];
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

function mapProperties(props: Record<VersionedUrl, unknown>): PropertyObjectWithMetadata {
  const value: Record<string, PropertyValueWithMetadata> = {};
  for (const [url, val] of Object.entries(props)) {
    value[toBaseUrl(url)] = { value: val, metadata: { dataTypeId: null } };
  }
  return { value };
}

function mapPropertiesAsPatch(props: Record<VersionedUrl, unknown>): PatchEntityParams["properties"] {
  return Object.entries(props).map(([url, val]) => ({
    op: "replace" as const,
    path: [toBaseUrl(url)],
    property: { value: val, metadata: { dataTypeId: null } },
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
  const result = await request<{ entities: GraphEntity[] }>("POST", config, "/entities/query", body);
  return result.entities;
}

export function createGraphClient(config: GraphClientConfig): GraphClient {
  return {
    async upsertEntity(op) {
      const entityUuid = deterministicUuid(op.entityType, op.entityId);
      const fullEntityId = compositeEntityId(op.webId, entityUuid);
      const provenance = mapProvenance(op.provenance);

      try {
        await request("POST", config, "/entities", {
          webId: op.webId,
          entityTypeIds: [op.entityType],
          properties: mapProperties(op.properties),
          draft: false,
          provenance,
          entityUuid,
        } satisfies CreateEntityParams);
      } catch (e) {
        if (e instanceof GraphApiError && (e.status === 409 || isDuplicate(e))) {
          await request("PATCH", config, "/entities", {
            entityId: fullEntityId,
            provenance,
            entityTypeIds: [op.entityType],
            properties: mapPropertiesAsPatch(op.properties),
          } satisfies PatchEntityParams);
        } else {
          throw e;
        }
      }

      for (const link of op.links) {
        await upsertLink(config, op, link, provenance, fullEntityId);
      }
    },

    async archiveEntity(op) {
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
    },
  };
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

  const createLink = () => request("POST", config, "/entities", {
    webId: op.webId,
    entityTypeIds: [link.linkType],
    properties: { value: {} },
    draft: false,
    provenance,
    entityUuid: linkUuid,
    linkData: { leftEntityId, rightEntityId },
  } satisfies CreateEntityParams);

  try {
    await createLink();
  } catch (e) {
    if (e instanceof GraphApiError && (e.status === 409 || isDuplicate(e))) return;
    if (e instanceof GraphApiError && isFkViolation(e)) {
      await ensureEntity(config, link.targetEntityType, link.targetId, op.webId, provenance);
      try { await createLink(); } catch (e2) {
        if (e2 instanceof GraphApiError && (e2.status === 409 || isDuplicate(e2))) return;
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
