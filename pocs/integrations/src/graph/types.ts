import type { VersionedUrl } from "../transform/pipeline.js";

// A value carrying its data type id, so the client can emit metadata.dataTypeId.
// Symbol-branded to distinguish from a plain { value, dataTypeId } object; never serialized.
export const TYPED_VALUE = Symbol.for("@hash/integrations/typed-value");

export type TypedValue = {
  readonly [TYPED_VALUE]: true;
  value: unknown;
  dataTypeId: VersionedUrl;
};

export function typedValue(value: unknown, dataTypeId: VersionedUrl): TypedValue {
  return { [TYPED_VALUE]: true, value, dataTypeId };
}

export function isTypedValue(v: unknown): v is TypedValue {
  return typeof v === "object" && v !== null && (v as Record<PropertyKey, unknown>)[TYPED_VALUE] === true;
}

// The Symbol brand is lost across JSON (e.g. staging link ops in DuckDB). These translate
// typed values to/from a string-keyed tag so the data type id survives a stringify/parse round-trip.
const TYPED_VALUE_TAG = "$typedValue";

export function typedValueReplacer(_key: string, value: unknown): unknown {
  return isTypedValue(value)
    ? { [TYPED_VALUE_TAG]: true, value: value.value, dataTypeId: value.dataTypeId }
    : value;
}

export function typedValueReviver(_key: string, value: unknown): unknown {
  if (typeof value === "object" && value !== null && (value as Record<string, unknown>)[TYPED_VALUE_TAG] === true) {
    const tagged = value as { value: unknown; dataTypeId: VersionedUrl };
    return typedValue(tagged.value, tagged.dataTypeId);
  }
  return value;
}

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
  /** Circuit breaker tripped: consecutive wholly-failed batches; remaining ops were not attempted. */
  aborted?: boolean;
};

export type BulkLinkFailure = { op: GraphLinkOp; error: Error };
export type BulkLinkResult = {
  ok: string[];
  failed: BulkLinkFailure[];
  batches: number;
  fellBackBatches: number;
  durationMs: number;
  aborted?: boolean;
};

export type BulkUpsertOptions = {
  onProgress?: (done: number, total: number) => void;
  onBatchOk?: (entityIds: string[]) => Promise<void>;
  /** Called as each failure happens, not after the bulk call returns. */
  onFailure?: (failure: BulkUpsertFailure) => void;
  /** Called when a bulk batch is rejected and falls back to per-op upserts. */
  onBatchFallback?: (error: Error) => void;
};

export type BulkLinkOptions = {
  onProgress?: (done: number, total: number) => void;
  onBatchOk?: (opIds: string[]) => Promise<void>;
  onFailure?: (failure: BulkLinkFailure) => void;
  onBatchFallback?: (error: Error) => void;
};

export type GraphClient = {
  upsertEntity(op: Extract<GraphOp, { kind: "upsert" }>): Promise<void>;
  bulkUpsertEntities(ops: Extract<GraphOp, { kind: "upsert" }>[], options?: BulkUpsertOptions): Promise<BulkUpsertResult>;
  upsertLink(op: GraphLinkOp): Promise<"ok">;
  bulkUpsertLinks(ops: GraphLinkOp[], options?: BulkLinkOptions): Promise<BulkLinkResult>;
  archiveEntity(op: Extract<GraphOp, { kind: "archive" }>): Promise<void>;
};
