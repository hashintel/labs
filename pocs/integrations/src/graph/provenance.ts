import type { ProvenanceConfig } from "../transform/pipeline.js";
import type { SourceProvenance } from "./types.js";

/** Per-field precedence: source ⋙ connector ⋙ sink ⋙ defaults. `entityId` is never set in v1. */
export function composeProvenance(args: {
  connectorId: string;
  source: string;
  connector?: ProvenanceConfig;
  sourceLevel?: ProvenanceConfig;
  sink?: ProvenanceConfig;
  loadedAt: string;
}): SourceProvenance {
  const { connectorId, source, connector, sourceLevel, sink, loadedAt } = args;
  const pick = <T>(f: (c: ProvenanceConfig) => T | undefined) =>
    [sourceLevel, connector, sink].map((c) => c && f(c)).find((v) => v != null && v !== "") as T | undefined;

  const name = pick((c) => c.location?.name) ?? `${connectorId}/${source}`;
  const uri = pick((c) => c.location?.uri);
  const description = pick((c) => c.location?.description);
  const authors = pick((c) => c.authors?.length ? [...c.authors] : undefined);
  const firstPublished = pick((c) => c.firstPublished);
  const lastUpdated = pick((c) => c.lastUpdated);

  const location = prune({ name, uri, description });
  return prune({
    type: "integration" as const,
    authors,
    location: Object.keys(location).length ? location : undefined,
    firstPublished,
    lastUpdated,
    loadedAt,
  }) as SourceProvenance;
}

function prune<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}
