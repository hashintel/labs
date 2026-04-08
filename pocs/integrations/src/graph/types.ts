import type { VersionedUrl } from "../transform/pipeline.js";

export type ResolvedLink = {
  linkType: VersionedUrl;
  targetEntityType: VersionedUrl;
  targetId: unknown;
};

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

export type GraphOp =
  | { kind: "upsert"; entityType: VersionedUrl; entityId: unknown; properties: Record<VersionedUrl, unknown>; links: ResolvedLink[]; provenance: SourceProvenance; webId: string }
  | { kind: "archive"; entityType: VersionedUrl; entityId: unknown; provenance: SourceProvenance; webId: string };

export type GraphClient = {
  upsertEntity(op: Extract<GraphOp, { kind: "upsert" }>): Promise<void>;
  archiveEntity(op: Extract<GraphOp, { kind: "archive" }>): Promise<void>;
};
