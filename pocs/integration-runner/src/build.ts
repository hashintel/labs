import type { IntegrationYaml, StepYaml, GraphSinkYaml, LinkYaml } from "./schema.js";
import { resolveAccessor } from "./coerce.js";
import type { DuckdbSource } from "@integrations/connector/duckdb-batch.js";
import type { ConnectorDef } from "@integrations/connector/create.js";
import type { TablePipeline, Step, Pipeline, GraphSinkConfig, LinkMapping, Accessor, ProvenanceConfig } from "@integrations/transform/pipeline.js";
import { sqlStep, fnStep, graphSinkStep, checkpoint } from "@integrations/transform/pipeline.js";

function buildProvenance(yaml: IntegrationYaml["connector"]["provenance"]): ProvenanceConfig | undefined {
  if (!yaml) return undefined;
  return {
    location: yaml.location,
    authors: yaml.authors,
    firstPublished: yaml.firstPublished,
    lastUpdated: yaml.lastUpdated,
  };
}

function buildSource(yaml: IntegrationYaml["sources"][string]): DuckdbSource {
  switch (yaml.kind) {
    case "sql":
      return {
        kind: "sql",
        sql: yaml.sql,
        primaryKey: yaml.primaryKey,
        extensions: yaml.extensions,
        headerRows: yaml.headerRows,
        forwardFill: yaml.forwardFill,
        unfilledHeaderRows: yaml.unfilledHeaderRows,
        dropHeaderTokens: yaml.dropHeaderTokens,
        partial: yaml.partial,
        archiveOnEmpty: yaml.archiveOnEmpty,
        provenance: buildProvenance(yaml.provenance),
      };
    case "checkpoint":
      return {
        kind: "checkpoint",
        name: yaml.name,
        partial: yaml.partial,
        archiveOnEmpty: yaml.archiveOnEmpty,
        provenance: buildProvenance(yaml.provenance),
      };
    case "external":
      return {
        kind: "external",
        key: yaml.key,
        primaryKey: yaml.primaryKey,
        partial: yaml.partial,
        archiveOnEmpty: yaml.archiveOnEmpty,
        provenance: buildProvenance(yaml.provenance),
      };
  }
}

function buildAccessors(props: Record<string, string | { column: string; coerce: string }>): Record<string, Accessor> {
  const out: Record<string, Accessor> = {};
  for (const [url, val] of Object.entries(props)) {
    out[url] = resolveAccessor(val);
  }
  return out;
}

function buildLinks(yaml: LinkYaml[] | undefined): LinkMapping[] | undefined {
  if (!yaml) return undefined;
  return yaml.map((l) => ({
    column: l.column,
    sourceColumn: l.sourceColumn,
    linkType: l.linkType,
    targetEntityType: l.targetEntityType,
    properties: l.properties ? buildAccessors(l.properties) : undefined,
  }));
}

function buildGraphSinkConfig(yaml: GraphSinkYaml): GraphSinkConfig {
  let entityId: Accessor;
  if (Array.isArray(yaml.entityId)) {
    const cols = yaml.entityId;
    entityId = (row) => cols.map((c) => String(row[c] ?? "")).join("|");
  } else {
    entityId = yaml.entityId;
  }

  return {
    entityType: yaml.entityType,
    entityId,
    webId: yaml.webId,
    properties: buildAccessors(yaml.properties),
    links: buildLinks(yaml.links),
    provenance: buildProvenance(yaml.provenance),
  };
}

function buildStep(yaml: StepYaml): Step {
  switch (yaml.kind) {
    case "sql":
      return yaml.dependsOn
        ? sqlStep({ id: yaml.id, query: yaml.sql, dependsOn: yaml.dependsOn })
        : sqlStep({ id: yaml.id, query: yaml.sql });
    case "fn":
      return yaml.dependsOn
        ? fnStep({ id: yaml.id, transform: yaml.transform, dependsOn: yaml.dependsOn })
        : fnStep({ id: yaml.id, transform: yaml.transform });
    case "graph-sink": {
      const config = buildGraphSinkConfig(yaml.config);
      return yaml.dependsOn
        ? graphSinkStep({ id: yaml.id, ...config, dependsOn: yaml.dependsOn })
        : graphSinkStep({ id: yaml.id, ...config });
    }
    case "checkpoint":
      return yaml.dependsOn
        ? checkpoint({ id: yaml.id, name: yaml.name, dependsOn: yaml.dependsOn })
        : checkpoint({ id: yaml.id, name: yaml.name });
  }
}

export function buildConnectorDef(yaml: IntegrationYaml): ConnectorDef {
  const sources: Record<string, DuckdbSource> = {};
  for (const [name, srcYaml] of Object.entries(yaml.sources)) {
    sources[name] = buildSource(srcYaml);
  }
  return {
    id: yaml.connector.id,
    mode: "batch",
    sources,
    provenance: buildProvenance(yaml.connector.provenance),
  };
}

export function buildPipelines(yaml: IntegrationYaml): TablePipeline[] {
  const connectorId = yaml.connector.id;
  return yaml.pipelines.map((p) => {
    const steps = p.steps.map(buildStep);
    const pipeline: Pipeline = { source: `${connectorId}/${p.source}`, steps };
    return { source: p.source, pipeline, dependsOn: p.dependsOn };
  });
}
