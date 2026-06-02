import type { IntegrationYaml, StepYaml, GraphSinkYaml, LinkPipelineYaml, AccessorYaml } from "./schema.js";
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

  const pipelines = yaml.pipelines;
  if (!pipelines?.entities || pipelines.entities.length === 0) {
    errors.push({ path: "pipelines.entities", message: "at least one entity pipeline required" });
  }

  const declaredSources = new Set<string>();
  if (conn.mode === "batch") for (const name of Object.keys(yaml.sources ?? {})) declaredSources.add(name);
  if (conn.mode === "rest-api") for (const name of Object.keys(conn.endpoints ?? {})) declaredSources.add(name);

  const allStepIds = new Set<string>();
  const checkpointNames = new Set<string>();

  for (let pi = 0; pi < (pipelines?.entities ?? []).length; pi++) {
    const p = pipelines.entities[pi];
    const prefix = `pipelines.entities[${pi}]`;

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

  const linkIds = new Set<string>();
  for (let li = 0; li < (pipelines?.links ?? []).length; li++) {
    validateLinkPipeline(pipelines.links![li], `pipelines.links[${li}]`, errors, linkIds, allStepIds, checkpointNames);
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
  if ("links" in config) errors.push({ path: `${prefix}.links`, message: "graph-sink links moved to pipelines.links" });
  for (const [url, acc] of Object.entries(config.properties ?? {})) {
    validateAccessor(acc, `${prefix}.properties["${url}"]`, errors);
  }
}

function validateLinkPipeline(
  link: LinkPipelineYaml,
  prefix: string,
  errors: ValidationError[],
  linkIds: Set<string>,
  allStepIds: Set<string>,
  checkpointNames: Set<string>,
) {
  if (!link.id) errors.push({ path: `${prefix}.id`, message: "required" });
  else if (linkIds.has(link.id)) errors.push({ path: `${prefix}.id`, message: `duplicate link pipeline id "${link.id}"` });
  else if (allStepIds.has(link.id)) errors.push({ path: `${prefix}.id`, message: `link pipeline id "${link.id}" duplicates a step id` });
  else linkIds.add(link.id);

  const hasSource = typeof link.source === "string" && link.source.length > 0;
  const inputEntries = Object.entries(link.inputs ?? {});
  if (hasSource && inputEntries.length > 0) {
    errors.push({ path: `${prefix}.inputs`, message: "use either source or inputs, not both" });
  } else if (hasSource) {
    if (!checkpointNames.has(link.source!)) errors.push({ path: `${prefix}.source`, message: `checkpoint "${link.source}" is not produced by an entity pipeline` });
  } else if (inputEntries.length > 0) {
    for (const [alias, checkpointName] of inputEntries) {
      if (!alias) errors.push({ path: `${prefix}.inputs`, message: "input alias cannot be empty" });
      else if (alias === "input") errors.push({ path: `${prefix}.inputs.input`, message: "input alias \"input\" is reserved for the rolling step input" });
      if (!checkpointName) errors.push({ path: `${prefix}.inputs.${alias}`, message: "required" });
      else if (!checkpointNames.has(checkpointName)) errors.push({ path: `${prefix}.inputs.${alias}`, message: `checkpoint "${checkpointName}" is not produced by an entity pipeline` });
    }
    if (inputEntries.length > 1 && (!link.steps || link.steps.length === 0)) {
      errors.push({ path: `${prefix}.steps`, message: "multi-input link pipelines require at least one sql step" });
    }
  } else {
    errors.push({ path: `${prefix}.source`, message: "source or inputs required" });
  }

  if (!link.linkType) errors.push({ path: `${prefix}.linkType`, message: "required" });
  if (!link.from?.entityType) errors.push({ path: `${prefix}.from.entityType`, message: "required" });
  if (!link.from?.column) errors.push({ path: `${prefix}.from.column`, message: "required" });
  if (!link.to?.entityType) errors.push({ path: `${prefix}.to.entityType`, message: "required" });
  if (!link.to?.column) errors.push({ path: `${prefix}.to.column`, message: "required" });

  for (let si = 0; si < (link.steps ?? []).length; si++) {
    const step = link.steps![si];
    const sp = `${prefix}.steps[${si}]`;
    if (step.kind !== "sql") errors.push({ path: `${sp}.kind`, message: "link pipeline steps only support sql" });
    if (!step.id) errors.push({ path: `${sp}.id`, message: "required" });
    else if (allStepIds.has(step.id)) errors.push({ path: `${sp}.id`, message: `duplicate step id "${step.id}"` });
    else allStepIds.add(step.id);
    if (!step.sql) errors.push({ path: `${sp}.sql`, message: "required" });
  }

  for (const [url, col] of Object.entries(link.properties ?? {})) {
    if (!col) errors.push({ path: `${prefix}.properties["${url}"]`, message: "required" });
    else if (typeof col !== "string") errors.push({ path: `${prefix}.properties["${url}"]`, message: "link properties must be column names" });
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
