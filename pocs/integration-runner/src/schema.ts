export type ScalarAccessorYaml = string | { column: string; coerce: string };

export type AccessorYaml =
  | ScalarAccessorYaml
  // `amount` typed by the data type the `unit` code resolves to in the named `measure` map.
  | { amount: string; unit: string; measure: string };

export type ProvenanceYaml = {
  location?: { name?: string; uri?: string; description?: string };
  authors?: string[];
  firstPublished?: string;
  lastUpdated?: string;
};

export type GraphSinkYaml = {
  entityType: string;
  entityId: string | string[];
  webId: string;
  properties: Record<string, AccessorYaml>;
  provenance?: ProvenanceYaml;
  // Audit columns routed to provenance instead of properties.
  provenanceFields?: {
    authors?: ScalarAccessorYaml;
    firstPublished?: ScalarAccessorYaml;
    lastUpdated?: ScalarAccessorYaml;
  };
};

export type BranchYaml = {
  kind: "branch";
  id: string;
  branches: StepYaml[][];
  dependsOn?: string[];
};

export type SqlStepYaml = { kind: "sql"; id: string; sql: string; dependsOn?: string[] };

export type StepYaml =
  | SqlStepYaml
  | { kind: "fn"; id: string; transform: string; dependsOn?: string[] }
  | { kind: "graph-sink"; id: string; config: GraphSinkYaml; dependsOn?: string[] }
  | { kind: "checkpoint"; id: string; name: string; dependsOn?: string[] }
  | BranchYaml;

export type SourceYaml = {
  kind: "sql";
  sql: string;
  primaryKey: string | string[];
  extensions?: string[];
  headerRows?: number[];
  forwardFill?: boolean;
  unfilledHeaderRows?: number[];
  dropHeaderTokens?: string[];
  partial?: boolean;
  archiveOnEmpty?: boolean;
  provenance?: ProvenanceYaml;
} | {
  kind: "checkpoint";
  name: string;
  partial?: boolean;
  archiveOnEmpty?: boolean;
  provenance?: ProvenanceYaml;
} | {
  kind: "external";
  key: string;
  primaryKey: string | string[];
  partial?: boolean;
  archiveOnEmpty?: boolean;
  provenance?: ProvenanceYaml;
};

export type PipelineYaml = {
  source: string;
  dependsOn?: string[];
  steps: StepYaml[];
};

export type LinkPipelineYaml = {
  id: string;
  source?: string;
  inputs?: Record<string, string>;
  steps?: SqlStepYaml[];
  from: { entityType: string; column: string };
  to: { entityType: string; column: string };
  linkType: string;
  properties?: Record<string, string>;
  provenance?: ProvenanceYaml;
};

export type OrchestrationYaml = {
  maxRetries?: number;
  retryIntervalSeconds?: number;
  backoffRate?: number;
};

export type RestEndpointYaml = {
  url: string;
  primaryKey: string | string[];
  pagination?: { type: string; field: string };
  resultsField?: string;
  partial?: boolean;
  maxPages?: number;
  params?: Record<string, string>;
  provenance?: ProvenanceYaml;
};

export type ConnectorYaml =
  | { id: string; mode: "batch"; idNamespace?: string; provenance?: ProvenanceYaml }
  | {
      id: string;
      mode: "rest-api";
      idNamespace?: string;
      auth?: { type: string; name: string; value: string };
      rateLimitMs?: number;
      pageSize?: number;
      endpoints: Record<string, RestEndpointYaml>;
      provenance?: ProvenanceYaml;
    };

export type IntegrationYaml = {
  connector: ConnectorYaml;
  sources?: Record<string, SourceYaml>;
  pipelines: {
    entities: PipelineYaml[];
    links?: LinkPipelineYaml[];
  };
  orchestration?: OrchestrationYaml;
  // Maps a unit/currency code to a data-type id, keyed by map name; `"*"` is the fallback.
  unitMaps?: Record<string, Record<string, string>>;
};

export function interpolateEnv(raw: string, env: Record<string, string | undefined>): string {
  return raw.replace(/\$\{([^}]+)}/g, (_, key: string) => {
    const val = env[key];
    if (val === undefined) throw new Error(`Missing env var: ${key}`);
    return val;
  });
}

function walkStrings(obj: unknown, fn: (s: string) => string): unknown {
  if (typeof obj === "string") return fn(obj);
  if (Array.isArray(obj)) return obj.map((v) => walkStrings(v, fn));
  if (obj !== null && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[fn(k)] = walkStrings(v, fn);
    }
    return out;
  }
  return obj;
}

export function resolveEnvVars(yaml: unknown, env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): IntegrationYaml {
  return walkStrings(yaml, (s) => interpolateEnv(s, env)) as IntegrationYaml;
}
