import type { IntegrationYaml, StepYaml, GraphSinkYaml, ProvenanceYaml } from "./schema.js";
import { resolveAccessor } from "./coerce.js";
import type { DuckdbSource } from "@integrations/connector/duckdb-batch.js";
import type { RestApiEndpoint, RestApiBatchConfig } from "@integrations/connector/rest-api.js";
import type { ConnectorDef } from "@integrations/connector/create.js";
import type { TablePipeline, LinkPipeline, Step, Pipeline, GraphSinkConfig, Accessor, ProvenanceConfig } from "@integrations/transform/pipeline.js";
import { sqlStep, fnStep, graphSinkStep, checkpoint, branch } from "@integrations/transform/pipeline.js";

function toProvenance(yaml: ProvenanceYaml | undefined): ProvenanceConfig | undefined {
  if (!yaml) return undefined;
  return { location: yaml.location, authors: yaml.authors, firstPublished: yaml.firstPublished, lastUpdated: yaml.lastUpdated };
}

function buildSource(yaml: NonNullable<IntegrationYaml["sources"]>[string]): DuckdbSource {
  switch (yaml.kind) {
    case "sql":
      return {
        kind: "sql", sql: yaml.sql, primaryKey: yaml.primaryKey,
        extensions: yaml.extensions, headerRows: yaml.headerRows, forwardFill: yaml.forwardFill,
        unfilledHeaderRows: yaml.unfilledHeaderRows, dropHeaderTokens: yaml.dropHeaderTokens,
        partial: yaml.partial, archiveOnEmpty: yaml.archiveOnEmpty, provenance: toProvenance(yaml.provenance),
      };
    case "checkpoint":
      return { kind: "checkpoint", name: yaml.name, partial: yaml.partial, archiveOnEmpty: yaml.archiveOnEmpty, provenance: toProvenance(yaml.provenance) };
    case "external":
      return { kind: "external", key: yaml.key, primaryKey: yaml.primaryKey, partial: yaml.partial, archiveOnEmpty: yaml.archiveOnEmpty, provenance: toProvenance(yaml.provenance) };
  }
}

function toAccessors(props: Record<string, string | { column: string; coerce: string }>): Record<string, Accessor> {
  return Object.fromEntries(Object.entries(props).map(([url, val]) => [url, resolveAccessor(val)]));
}

/** Source field per property: the column a string/coerce accessor reads. Lets the engine stamp `location.name = <source>/<FIELD>` per value. */
function toPropertyFields(props: Record<string, string | { column: string; coerce: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [url, val] of Object.entries(props)) {
    const column = typeof val === "string" ? val : val.column;
    if (column) out[url] = column;
  }
  return out;
}

function toGraphSinkConfig(yaml: GraphSinkYaml, idNamespace: string): GraphSinkConfig {
  const entityId: Accessor = Array.isArray(yaml.entityId)
    ? ((cols) => (row: Record<string, unknown>) => cols.map((c) => String(row[c] ?? "")).join("|"))(yaml.entityId)
    : yaml.entityId;

  return {
    entityType: yaml.entityType, entityId, webId: yaml.webId, idNamespace,
    properties: toAccessors(yaml.properties), propertyFields: toPropertyFields(yaml.properties),
    provenance: toProvenance(yaml.provenance),
  };
}

function toStep(yaml: StepYaml, idNamespace: string): Step {
  const deps = yaml.dependsOn;
  switch (yaml.kind) {
    case "sql":
      return deps ? sqlStep({ id: yaml.id, query: yaml.sql, dependsOn: deps }) : sqlStep({ id: yaml.id, query: yaml.sql });
    case "fn":
      return deps ? fnStep({ id: yaml.id, transform: yaml.transform, dependsOn: deps }) : fnStep({ id: yaml.id, transform: yaml.transform });
    case "graph-sink": {
      const config = toGraphSinkConfig(yaml.config, idNamespace);
      return deps ? graphSinkStep({ id: yaml.id, ...config, dependsOn: deps }) : graphSinkStep({ id: yaml.id, ...config });
    }
    case "checkpoint":
      return deps ? checkpoint({ id: yaml.id, name: yaml.name, dependsOn: deps }) : checkpoint({ id: yaml.id, name: yaml.name });
    case "branch":
      return branch(yaml.id, ...yaml.branches.map((b) => b.map((s) => toStep(s, idNamespace))));
  }
}

export function buildConnectorDef(yaml: IntegrationYaml): ConnectorDef {
  const conn = yaml.connector;
  if (conn.mode === "rest-api") {
    const endpoints: Record<string, RestApiEndpoint> = {};
    for (const [name, ep] of Object.entries(conn.endpoints)) {
      endpoints[name] = {
        url: ep.url, primaryKey: ep.primaryKey,
        pagination: ep.pagination as RestApiEndpoint["pagination"],
        resultsField: ep.resultsField, partial: ep.partial, maxPages: ep.maxPages,
        params: ep.params, provenance: toProvenance(ep.provenance),
      };
    }
    return {
      id: conn.id, mode: "rest-api", endpoints,
      auth: conn.auth as RestApiBatchConfig["auth"],
      rateLimitMs: conn.rateLimitMs, pageSize: conn.pageSize,
      provenance: toProvenance(conn.provenance),
    };
  }
  const sources: Record<string, DuckdbSource> = {};
  for (const [name, srcYaml] of Object.entries(yaml.sources ?? {})) sources[name] = buildSource(srcYaml);
  return { id: conn.id, mode: "batch", sources, provenance: toProvenance(conn.provenance) };
}

export function buildPipelines(yaml: IntegrationYaml): TablePipeline[] {
  const connectorId = yaml.connector.id;
  const idNamespace = yaml.connector.idNamespace ?? connectorId;
  return yaml.pipelines.entities.map((p) => ({
    source: p.source,
    pipeline: { source: `${connectorId}/${p.source}`, steps: p.steps.map((s) => toStep(s, idNamespace)) } as Pipeline,
    dependsOn: p.dependsOn,
  }));
}

export function buildLinkPipelines(yaml: IntegrationYaml, webId: string): LinkPipeline[] {
  const connectorId = yaml.connector.id;
  const idNamespace = yaml.connector.idNamespace ?? connectorId;
  return (yaml.pipelines.links ?? []).map((l) => ({
    id: l.id,
    source: l.source,
    inputs: l.inputs,
    steps: l.steps?.map((s) => ({ kind: "sql" as const, id: s.id, sql: s.sql, dependsOn: s.dependsOn })),
    from: { entityType: l.from.entityType, column: l.from.column },
    to: { entityType: l.to.entityType, column: l.to.column },
    linkType: l.linkType,
    webId,
    idNamespace,
    properties: l.properties,
    provenance: toProvenance(l.provenance),
  }));
}
