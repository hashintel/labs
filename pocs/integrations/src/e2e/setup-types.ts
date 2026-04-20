import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { postgresPipelines, mongoPipelines, type PipelineEnv } from "../pipelines.js";
import { aviationPipelines } from "../pipelines/aviation.js";
import type { TablePipeline } from "../engine.js";
import type { Step, LinkMapping } from "../transform/pipeline.js";

const BP_LINK = "https://blockprotocol.org/@blockprotocol/types/entity-type/link/v/1";
const BP_TEXT = "https://blockprotocol.org/@blockprotocol/types/data-type/text/v/1";

type Sink = {
  entityType: string;
  properties: string[];
  links: LinkMapping[];
};

export async function setupTypes(
  tablePipelines: readonly TablePipeline[],
  env: { graphUrl: string; actorId: string; typeBase: string },
): Promise<{ created: number; skipped: number }> {
  const headers = { "Content-Type": "application/json", "X-Authenticated-User-Actor-Id": env.actorId };
  const isOurs = (url: string) => url.startsWith(env.typeBase + "/");

  const sinks: Sink[] = [];
  for (const tp of tablePipelines) collectSinks(tp.pipeline.steps, sinks);

  const existing = await queryExisting(env.graphUrl, headers);

  const propertyUrls = new Set<string>();
  for (const sink of sinks) {
    for (const p of sink.properties) propertyUrls.add(p);
    for (const l of sink.links) for (const p of Object.keys(l.properties ?? {})) propertyUrls.add(p);
  }

  const linkTypeProps = new Map<string, Set<string>>();
  for (const sink of sinks) {
    for (const l of sink.links) {
      if (!linkTypeProps.has(l.linkType)) linkTypeProps.set(l.linkType, new Set());
      for (const p of Object.keys(l.properties ?? {})) linkTypeProps.get(l.linkType)!.add(p);
    }
  }

  let created = 0, skipped = 0;

  for (const url of propertyUrls) {
    if (!isOurs(url)) { if (!existing.has(url)) warnMissing("property-type", url); skipped++; continue; }
    if (existing.has(url)) { skipped++; continue; }
    await createPropertyType(env.graphUrl, headers, url);
    existing.add(url);
    created++;
  }

  for (const [linkType, props] of linkTypeProps) {
    if (!isOurs(linkType)) { if (!existing.has(linkType)) warnMissing("link-type", linkType); skipped++; continue; }
    if (existing.has(linkType)) { skipped++; continue; }
    await createLinkType(env.graphUrl, headers, linkType, [...props]);
    existing.add(linkType);
    created++;
  }

  const seenEntity = new Set<string>();
  for (const sink of sinks) {
    if (seenEntity.has(sink.entityType)) continue;
    seenEntity.add(sink.entityType);
    if (!isOurs(sink.entityType)) { if (!existing.has(sink.entityType)) warnMissing("entity-type", sink.entityType); skipped++; continue; }
    if (existing.has(sink.entityType)) { skipped++; continue; }
    await createEntityType(env.graphUrl, headers, sink);
    existing.add(sink.entityType);
    created++;
  }

  return { created, skipped };
}

function collectSinks(steps: readonly Step[], out: Sink[]): void {
  for (const s of steps) {
    if (s.kind === "graph-sink") {
      out.push({
        entityType: s.config.entityType,
        properties: Object.keys(s.config.properties),
        links: s.config.links ?? [],
      });
    } else if (s.kind === "branch") {
      for (const branch of s.branches) collectSinks(branch, out);
    }
  }
}

async function queryExisting(graphUrl: string, headers: Record<string, string>): Promise<Set<string>> {
  const temporalAxes = {
    pinned: { axis: "transactionTime", timestamp: null },
    variable: { axis: "decisionTime", interval: { start: null, end: null } },
  };
  const body = JSON.stringify({ filter: { all: [] }, temporalAxes, limit: 1000 });

  const [entity, property] = await Promise.all([
    fetch(`${graphUrl}/entity-types/query`, { method: "POST", headers, body }).then((r) => r.json() as Promise<{ entityTypes: { schema: { $id: string } }[] }>),
    fetch(`${graphUrl}/property-types/query`, { method: "POST", headers, body }).then((r) => r.json() as Promise<{ propertyTypes: { schema: { $id: string } }[] }>),
  ]);

  const set = new Set<string>();
  for (const t of entity.entityTypes) set.add(t.schema.$id);
  for (const t of property.propertyTypes) set.add(t.schema.$id);
  return set;
}

function slugOf(url: string, kind: "entity-type" | "property-type"): string {
  const m = url.match(new RegExp(`/${kind}/([^/]+)/v/\\d+$`));
  if (!m) throw new Error(`Cannot extract slug from ${url}`);
  return m[1];
}

function titleFrom(slug: string): string {
  return slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function versionedToBase(url: string): string {
  return url.replace(/v\/\d+$/, "");
}

const PROVENANCE = { actorType: "machine" as const, origin: { type: "api" as const } };

async function createPropertyType(graphUrl: string, headers: Record<string, string>, url: string): Promise<void> {
  const slug = slugOf(url, "property-type");
  const title = titleFrom(slug);
  const schema = {
    $schema: "https://blockprotocol.org/types/modules/graph/0.3/schema/property-type",
    kind: "propertyType",
    $id: url,
    title,
    description: title,
    oneOf: [{ $ref: BP_TEXT }],
  };
  await postType(graphUrl, headers, "property-types", schema, `property-type/${slug}`);
}

async function createLinkType(graphUrl: string, headers: Record<string, string>, url: string, propertyUrls: string[]): Promise<void> {
  const slug = slugOf(url, "entity-type");
  const title = titleFrom(slug);
  const properties: Record<string, { $ref: string }> = {};
  for (const p of propertyUrls) properties[versionedToBase(p)] = { $ref: p };
  const schema = {
    $schema: "https://blockprotocol.org/types/modules/graph/0.3/schema/entity-type",
    kind: "entityType",
    $id: url,
    type: "object",
    title,
    description: title,
    properties,
    allOf: [{ $ref: BP_LINK }],
  };
  await postType(graphUrl, headers, "entity-types", schema, `link-type/${slug}`);
}

async function createEntityType(graphUrl: string, headers: Record<string, string>, sink: Sink): Promise<void> {
  const slug = slugOf(sink.entityType, "entity-type");
  const title = titleFrom(slug);
  const properties: Record<string, { $ref: string }> = {};
  for (const p of sink.properties) properties[versionedToBase(p)] = { $ref: p };

  const links: Record<string, { type: "array"; items: { oneOf: { $ref: string }[] } }> = {};
  for (const link of sink.links) {
    links[link.linkType] = {
      type: "array",
      items: { oneOf: [{ $ref: link.targetEntityType }] },
    };
  }

  const schema: Record<string, unknown> = {
    $schema: "https://blockprotocol.org/types/modules/graph/0.3/schema/entity-type",
    kind: "entityType",
    $id: sink.entityType,
    type: "object",
    title,
    description: title,
    properties,
  };
  if (Object.keys(links).length > 0) schema.links = links;

  await postType(graphUrl, headers, "entity-types", schema, `entity-type/${slug}`);
}

async function postType(
  graphUrl: string,
  headers: Record<string, string>,
  resource: "entity-types" | "property-types",
  schema: Record<string, unknown>,
  label: string,
): Promise<void> {
  const res = await fetch(`${graphUrl}/${resource}`, {
    method: "POST", headers,
    body: JSON.stringify({ schema, provenance: PROVENANCE }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[setup-types] ${label}: POST /${resource} failed (${res.status}) ${body.slice(0, 300)}`);
  }
  console.error(`[setup-types] created ${label}`);
}

function warnMissing(kind: string, url: string): void {
  console.error(`[setup-types] WARNING: ${kind} "${url}" is not under HASH_TYPE_BASE and does not exist on the graph -- the pipeline will fail unless this type is created elsewhere.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (existsSync(".env")) process.loadEnvFile(".env");

  const graphUrl = process.env.HASH_GRAPH_URL ?? "http://localhost:4000";
  const actorId = process.env.HASH_ACTOR_ID;
  const webId = process.env.HASH_WEB_ID;
  const typeBase = process.env.HASH_TYPE_BASE;

  if (!actorId || !webId || !typeBase) {
    console.error(`[setup-types] missing env. Run:\n  eval "$(npx tsx src/e2e/discover-graph.ts --web <shortname> 2>&1 | grep '^export HASH_')"`);
    process.exit(1);
  }

  const configPath = process.argv[2];
  if (!configPath) {
    console.error("Usage: npx tsx src/e2e/setup-types.ts <integration.json>");
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(resolve(configPath), "utf-8"));
  const env: PipelineEnv = { typeBase, webId };

  const factories: Record<string, () => TablePipeline[]> = {
    batch: () => postgresPipelines(env),
    cdc: () => postgresPipelines(env),
    "mongo-stream": () => mongoPipelines(env),
    "rest-api": () => aviationPipelines({ webId }),
  };
  const factory = factories[config.mode as string];
  if (!factory) {
    console.error(`[setup-types] no pipeline factory for mode "${config.mode}"`);
    process.exit(1);
  }

  const tablePipelines = factory();
  const { created, skipped } = await setupTypes(tablePipelines, { graphUrl, actorId, typeBase });
  console.error(`[setup-types] done: ${created} created, ${skipped} skipped/existing`);
}
