import type { IntegrationYaml, StepYaml, GraphSinkYaml, AccessorYaml } from "./schema.js";
import { registry as coercionRegistry } from "./coerce.js";

const COERCION_NAMES = new Set(Object.keys(coercionRegistry));

export type ValidationError = { path: string; message: string };

export function validateYaml(yaml: IntegrationYaml): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!yaml.connector?.id) errors.push({ path: "connector.id", message: "required" });
  if (!yaml.connector?.mode) errors.push({ path: "connector.mode", message: "required" });

  const conn = yaml.connector;
  if (conn.mode === "batch") {
    if (!yaml.sources || Object.keys(yaml.sources).length === 0) {
      errors.push({ path: "sources", message: "batch connector requires at least one source" });
    }
    for (const [name, src] of Object.entries(yaml.sources ?? {})) {
      if (!src.kind) errors.push({ path: `sources.${name}.kind`, message: "required" });
      if (src.kind === "sql" && !src.sql) errors.push({ path: `sources.${name}.sql`, message: "required" });
      if (src.kind === "sql" && !src.primaryKey) errors.push({ path: `sources.${name}.primaryKey`, message: "required" });
      if (src.kind === "checkpoint" && !src.name) errors.push({ path: `sources.${name}.name`, message: "required" });
      if (src.kind === "external" && !src.key) errors.push({ path: `sources.${name}.key`, message: "required" });
    }
  } else if (conn.mode === "rest-api") {
    if (!conn.endpoints || Object.keys(conn.endpoints).length === 0) {
      errors.push({ path: "connector.endpoints", message: "rest-api connector requires at least one endpoint" });
    }
    for (const [name, ep] of Object.entries(conn.endpoints ?? {})) {
      if (!ep.url) errors.push({ path: `connector.endpoints.${name}.url`, message: "required" });
      if (!ep.primaryKey) errors.push({ path: `connector.endpoints.${name}.primaryKey`, message: "required" });
    }
  }

  if (!yaml.pipelines || yaml.pipelines.length === 0) {
    errors.push({ path: "pipelines", message: "at least one pipeline required" });
  }

  const declaredSources = new Set<string>();
  if (conn.mode === "batch") for (const name of Object.keys(yaml.sources ?? {})) declaredSources.add(name);
  if (conn.mode === "rest-api") for (const name of Object.keys(conn.endpoints ?? {})) declaredSources.add(name);

  const allStepIds = new Set<string>();
  const checkpointNames = new Set<string>();

  for (let pi = 0; pi < (yaml.pipelines ?? []).length; pi++) {
    const p = yaml.pipelines[pi];
    const prefix = `pipelines[${pi}]`;

    if (!p.source) errors.push({ path: `${prefix}.source`, message: "required" });
    else if (!declaredSources.has(p.source)) {
      errors.push({ path: `${prefix}.source`, message: `"${p.source}" not declared in sources/endpoints` });
    }

    for (const dep of p.dependsOn ?? []) {
      if (!declaredSources.has(dep)) {
        errors.push({ path: `${prefix}.dependsOn`, message: `"${dep}" is not a declared source` });
      }
    }

    if (!p.steps || p.steps.length === 0) {
      errors.push({ path: `${prefix}.steps`, message: "at least one step required" });
    }

    validateSteps(p.steps ?? [], prefix, errors, allStepIds, checkpointNames);
  }

  return errors;
}

function validateSteps(
  steps: StepYaml[],
  prefix: string,
  errors: ValidationError[],
  allStepIds: Set<string>,
  checkpointNames: Set<string>,
) {
  for (let si = 0; si < steps.length; si++) {
    const s = steps[si];
    const sp = `${prefix}.steps[${si}]`;

    if (!s.id) errors.push({ path: `${sp}.id`, message: "required" });
    else if (allStepIds.has(s.id)) errors.push({ path: `${sp}.id`, message: `duplicate step id "${s.id}"` });
    else allStepIds.add(s.id);

    switch (s.kind) {
      case "sql":
        if (!s.sql) errors.push({ path: `${sp}.sql`, message: "required" });
        break;
      case "fn":
        if (!s.transform) errors.push({ path: `${sp}.transform`, message: "required" });
        break;
      case "graph-sink":
        validateGraphSink(s.config, `${sp}.config`, errors);
        break;
      case "checkpoint":
        if (!s.name) errors.push({ path: `${sp}.name`, message: "required" });
        else if (checkpointNames.has(s.name)) errors.push({ path: `${sp}.name`, message: `duplicate checkpoint name "${s.name}"` });
        else checkpointNames.add(s.name);
        break;
      case "branch":
        if (!s.branches || s.branches.length === 0) {
          errors.push({ path: `${sp}.branches`, message: "at least one branch required" });
        }
        for (let bi = 0; bi < (s.branches ?? []).length; bi++) {
          validateSteps(s.branches[bi], `${sp}.branches[${bi}]`, errors, allStepIds, checkpointNames);
        }
        break;
      default:
        errors.push({ path: sp, message: `unknown step kind "${(s as { kind: string }).kind}"` });
    }
  }
}

function validateGraphSink(config: GraphSinkYaml | undefined, prefix: string, errors: ValidationError[]) {
  if (!config) { errors.push({ path: prefix, message: "required" }); return; }
  if (!config.entityType) errors.push({ path: `${prefix}.entityType`, message: "required" });
  if (!config.entityId) errors.push({ path: `${prefix}.entityId`, message: "required" });
  if (!config.webId) errors.push({ path: `${prefix}.webId`, message: "required" });
  if (!config.properties || Object.keys(config.properties).length === 0) {
    errors.push({ path: `${prefix}.properties`, message: "at least one property required" });
  }
  for (const [url, acc] of Object.entries(config.properties ?? {})) {
    validateAccessor(acc, `${prefix}.properties["${url}"]`, errors);
  }
  for (let li = 0; li < (config.links ?? []).length; li++) {
    const link = config.links![li];
    const lp = `${prefix}.links[${li}]`;
    if (!link.column) errors.push({ path: `${lp}.column`, message: "required" });
    if (!link.linkType) errors.push({ path: `${lp}.linkType`, message: "required" });
    if (!link.targetEntityType) errors.push({ path: `${lp}.targetEntityType`, message: "required" });
    for (const [url, acc] of Object.entries(link.properties ?? {})) {
      validateAccessor(acc, `${lp}.properties["${url}"]`, errors);
    }
  }
}

function validateAccessor(acc: AccessorYaml, path: string, errors: ValidationError[]) {
  if (typeof acc === "object" && acc !== null) {
    if (!acc.column) errors.push({ path: `${path}.column`, message: "required" });
    if (!acc.coerce) errors.push({ path: `${path}.coerce`, message: "required" });
    else if (!COERCION_NAMES.has(acc.coerce)) {
      errors.push({ path: `${path}.coerce`, message: `unknown coercion "${acc.coerce}". Available: ${[...COERCION_NAMES].join(", ")}` });
    }
  }
}
