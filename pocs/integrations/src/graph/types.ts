import type { VersionedUrl } from "../transform/pipeline.js";

/** `entityId` reserved for File-entity opt-in; v1 never sets it. Runtime mtime / CDC-ts capture is deferred. */
export type SourceProvenance = {
  type: "integration";
  entityId?: string;
  authors?: string[];
  location?: {
    name?: string;
    uri?: string;
    description?: string;
  };
  firstPublished?: string;
  lastUpdated?: string;
  loadedAt?: string;
};

export type PropertyProvenance = { sources: SourceProvenance[] };

export type GraphOp =
  | {
      kind: "upsert";
      namespace: string;
      entityType: VersionedUrl;
      entityId: unknown;
      properties: Record<VersionedUrl, unknown>;
      propertyProvenance?: Record<VersionedUrl, PropertyProvenance>;
      provenance: SourceProvenance;
      webId: string;
    }
  | { kind: "archive"; namespace: string; entityType: VersionedUrl; entityId: unknown; provenance: SourceProvenance; webId: string };

export type GraphLinkOp = {
  opId: string;
  namespace: string;
  webId: string;
  sourceEntityType: VersionedUrl;
  sourceEntityId: unknown;
  linkType: VersionedUrl;
  targetEntityType: VersionedUrl;
  targetId: unknown;
  properties?: Record<VersionedUrl, unknown>;
  propertyProvenance?: Record<VersionedUrl, PropertyProvenance>;
  provenance: SourceProvenance;
};

export type BulkUpsertFailure = { op: Extract<GraphOp, { kind: "upsert" }>; error: Error };
export type BulkUpsertResult = {
  ok: string[];
  failed: BulkUpsertFailure[];
  batches: number;
  fellBackBatches: number;
  durationMs: number;
};

export type BulkLinkFailure = { op: GraphLinkOp; error: Error };
export type BulkLinkResult = {
  ok: string[];
  failed: BulkLinkFailure[];
  batches: number;
  fellBackBatches: number;
  durationMs: number;
};

export type BulkUpsertOptions = {
  onProgress?: (done: number, total: number) => void;
  onBatchOk?: (entityIds: string[]) => Promise<void>;
};

export type BulkLinkOptions = {
  onProgress?: (done: number, total: number) => void;
  onBatchOk?: (opIds: string[]) => Promise<void>;
};

export type GraphClient = {
  upsertEntity(op: Extract<GraphOp, { kind: "upsert" }>): Promise<void>;
  bulkUpsertEntities(ops: Extract<GraphOp, { kind: "upsert" }>[], options?: BulkUpsertOptions): Promise<BulkUpsertResult>;
  upsertLink(op: GraphLinkOp): Promise<"ok">;
  bulkUpsertLinks(ops: GraphLinkOp[], options?: BulkLinkOptions): Promise<BulkLinkResult>;
  archiveEntity(op: Extract<GraphOp, { kind: "archive" }>): Promise<void>;
};
