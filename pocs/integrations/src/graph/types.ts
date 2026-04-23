import type { VersionedUrl } from "../transform/pipeline.js";

export type ResolvedLink = {
  linkType: VersionedUrl;
  targetEntityType: VersionedUrl;
  targetId: unknown;
  properties?: Record<VersionedUrl, unknown>;
  propertyProvenance?: Record<VersionedUrl, PropertyProvenance>;
};

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
      entityType: VersionedUrl;
      entityId: unknown;
      properties: Record<VersionedUrl, unknown>;
      propertyProvenance?: Record<VersionedUrl, PropertyProvenance>;
      links: ResolvedLink[];
      staleLinks: ResolvedLink[];
      provenance: SourceProvenance;
      webId: string;
    }
  | { kind: "archive"; entityType: VersionedUrl; entityId: unknown; provenance: SourceProvenance; webId: string };

export type BulkUpsertFailure = { op: Extract<GraphOp, { kind: "upsert" }>; error: Error };
export type BulkUpsertResult = {
  ok: string[];
  failed: BulkUpsertFailure[];
  batches: number;
  fellBackBatches: number;
  durationMs: number;
};

export type BulkUpsertOptions = {
  onProgress?: (done: number, total: number) => void;
  onBatchOk?: (entityIds: string[]) => Promise<void>;
};

export type GraphClient = {
  upsertEntity(op: Extract<GraphOp, { kind: "upsert" }>): Promise<void>;
  /** Chunks into `HASH_GRAPH_BULK_SIZE` batches (default 128); failing batches drop to per-entity upsert. */
  bulkUpsertEntities(ops: Extract<GraphOp, { kind: "upsert" }>[], options?: BulkUpsertOptions): Promise<BulkUpsertResult>;
  archiveEntity(op: Extract<GraphOp, { kind: "archive" }>): Promise<void>;
};
