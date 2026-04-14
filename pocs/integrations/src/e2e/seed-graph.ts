/**
 * Seeds the HASH graph with the minimum types needed for e2e testing.
 * DESTRUCTIVE --wipes all state before restoring.
 *
 * Usage: npx tsx src/e2e/seed-graph.ts [--graph-url URL] [--admin-url URL]
 *
 * Defaults to ports 14000/14001 (test graph) to avoid wiping the live graph on 4000/4001.
 */
import { randomUUID } from "node:crypto";

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const GRAPH_URL = arg("--graph-url", process.env.GRAPH_URL ?? "http://localhost:14000");
const ADMIN_URL = arg("--admin-url", process.env.ADMIN_URL ?? "http://localhost:14001");

// Wipe --purge entities first (accounts DELETE fails on FK constraints otherwise)
console.log("[seed] wiping...");

const systemActor = await fetch(`${GRAPH_URL}/actors/machine/identifier/system/graph`)
  .then((r) => r.ok ? r.json() as Promise<string> : null)
  .catch(() => null);

if (systemActor) {
  await fetch(`${ADMIN_URL}/entities/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Authenticated-User-Actor-Id": systemActor },
    body: JSON.stringify({
      filter: { all: [] },
      temporalAxes: { pinned: { axis: "transactionTime", timestamp: null }, variable: { axis: "decisionTime", interval: { start: null, end: null } } },
      includeDrafts: true, includePermissions: false,
      scope: "purge", linkBehavior: "ignore",
    }),
  });
}

for (const resource of ["accounts", "entity-types", "property-types", "data-types"]) {
  await fetch(`${ADMIN_URL}/${resource}`, { method: "DELETE" });
}

// Build snapshot
const ACTOR_ID = randomUUID();
const WEB_ID = randomUUID();
const ADMIN_ROLE_ID = randomUUID();
const MEMBER_ROLE_ID = randomUUID();
const now = new Date().toISOString();

// Data types: must use blockprotocol.org URLs (hardcoded in type-system validation)
const BP = "https://blockprotocol.org/@blockprotocol/types";
// Entity/property types: must match --allowed-url-domain (default: localhost:3000)
const BASE = "http://localhost:3000/@e2e/types";

const prov = {
  edition: { createdById: ACTOR_ID, actorType: "machine", origin: { type: "api" } },
};
const temporal = {
  transactionTime: { start: { kind: "inclusive", limit: now }, end: { kind: "unbounded" } },
};

function dataType(slug: string, title: string, schema: Record<string, unknown>) {
  return {
    type: "dataType",
    schema: {
      $schema: "https://blockprotocol.org/types/modules/graph/0.3/schema/data-type",
      kind: "dataType",
      $id: `${BP}/data-type/${slug}/v/1`,
      title,
      description: title,
      abstract: false,
      ...schema,
    },
    metadata: {
      recordId: { baseUrl: `${BP}/data-type/${slug}/`, version: "1" },
      provenance: prov,
      ownedById: WEB_ID,
      temporalVersioning: temporal,
      fetchedAt: now,
    },
  };
}

function propertyType(slug: string, title: string, dataTypeSlug: string) {
  return {
    type: "propertyType",
    schema: {
      $schema: "https://blockprotocol.org/types/modules/graph/0.3/schema/property-type",
      kind: "propertyType",
      $id: `${BASE}/property-type/${slug}/v/1`,
      title,
      description: title,
      oneOf: [{ $ref: `${BP}/data-type/${dataTypeSlug}/v/1` }],
    },
    metadata: {
      recordId: { baseUrl: `${BASE}/property-type/${slug}/`, version: "1" },
      provenance: prov,
      ownedById: WEB_ID,
      temporalVersioning: temporal,
      fetchedAt: now,
    },
  };
}

function entityType(slug: string, title: string, props: string[], linkDefs?: Record<string, string>, allOf?: string[]) {
  const properties: Record<string, { $ref: string }> = {};
  for (const propSlug of props) {
    properties[`${BASE}/property-type/${propSlug}/`] = { $ref: `${BASE}/property-type/${propSlug}/v/1` };
  }
  const links: Record<string, object> | undefined = linkDefs
    ? Object.fromEntries(
        Object.entries(linkDefs).map(([linkSlug, targetSlug]) => [
          `${BASE}/entity-type/${linkSlug}/v/1`,
          { type: "array", items: { oneOf: [{ $ref: `${BASE}/entity-type/${targetSlug}/v/1` }] } },
        ]),
      )
    : undefined;

  return {
    type: "entityType",
    schema: {
      $schema: "https://blockprotocol.org/types/modules/graph/0.3/schema/entity-type",
      kind: "entityType",
      $id: `${BASE}/entity-type/${slug}/v/1`,
      type: "object",
      title,
      description: title,
      properties,
      ...(links ? { links } : {}),
      ...(allOf?.length ? { allOf: allOf.map((ref) => ({ $ref: ref })) } : {}),
    },
    metadata: {
      recordId: { baseUrl: `${BASE}/entity-type/${slug}/`, version: "1" },
      provenance: prov,
      ownedById: WEB_ID,
      temporalVersioning: temporal,
      fetchedAt: now,
    },
  };
}

const BP_LINK = "https://blockprotocol.org/@blockprotocol/types/entity-type/link";

const entries = [
  { type: "snapshot", blockProtocolModuleVersions: { graph: "0.3.0" } },

  // Principals
  { type: "principal", principalType: "actor", actorType: "machine", id: ACTOR_ID, identifier: "e2e-integration", roles: [{ roleType: "web", id: ADMIN_ROLE_ID }] },
  { type: "principal", principalType: "actorGroup", actorGroupType: "web", id: WEB_ID, shortname: "e2e", roles: [ADMIN_ROLE_ID, MEMBER_ROLE_ID] },
  { type: "principal", principalType: "role", roleType: "web", id: ADMIN_ROLE_ID, webId: WEB_ID, name: "administrator" },
  { type: "principal", principalType: "role", roleType: "web", id: MEMBER_ROLE_ID, webId: WEB_ID, name: "member" },

  // Data types --"value" is the root, text/number extend it
  dataType("value", "Value", {
    anyOf: [
      { type: "null" }, { type: "boolean" }, { type: "number" },
      { type: "string" }, { type: "array" }, { type: "object" },
    ],
  }),
  dataType("text", "Text", { type: "string", allOf: [{ $ref: `${BP}/data-type/value/v/1` }] }),

  // Property types
  propertyType("email", "Email", "text"),
  propertyType("display-name", "Display Name", "text"),
  propertyType("city", "City", "text"),
  propertyType("organization-name", "Organization Name", "text"),

  // Entity types --base link type must exist for link entity types
  {
    type: "entityType",
    schema: {
      $schema: "https://blockprotocol.org/types/modules/graph/0.3/schema/entity-type",
      kind: "entityType", $id: `${BP_LINK}/v/1`, type: "object",
      title: "Link", description: "Base link entity type", properties: {},
    },
    metadata: {
      recordId: { baseUrl: `${BP_LINK}/`, version: "1" },
      provenance: prov, ownedById: WEB_ID, temporalVersioning: temporal, fetchedAt: now,
    },
  },
  entityType("organization", "Organization", ["organization-name"]),
  entityType("is-member-of", "Is Member Of", [], undefined, [`${BP_LINK}/v/1`]),
  entityType("user", "User", ["email", "display-name", "city"], { "is-member-of": "organization" }),
];

// Restore
const ndjson = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
console.log(`[seed] restoring ${entries.length} snapshot entries...`);

const res = await fetch(`${ADMIN_URL}/snapshot`, {
  method: "POST",
  headers: { "Content-Type": "application/x-ndjson" },
  body: ndjson,
});

if (!res.ok) {
  const body = await res.text();
  console.error(`[seed] snapshot failed (${res.status}): ${body.slice(0, 500)}`);
  process.exit(1);
}
console.log("[seed] snapshot restored");

// System policies must be seeded after snapshot restore
await fetch(`${GRAPH_URL}/policies/seed`, {
  headers: { "X-Authenticated-User-Actor-Id": ACTOR_ID },
});
console.log("[seed] policies seeded");

// Verify
const entityTypes = await fetch(`${GRAPH_URL}/entity-types/query`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Authenticated-User-Actor-Id": ACTOR_ID },
  body: JSON.stringify({
    filter: { all: [] },
    temporalAxes: {
      pinned: { axis: "transactionTime", timestamp: null },
      variable: { axis: "decisionTime", interval: { start: null, end: null } },
    },
    limit: 10,
  }),
}).then((r) => r.json() as Promise<{ entityTypes: unknown[] }>);

console.log(`[seed] ${entityTypes.entityTypes.length} entity types`);
console.log(`\nexport HASH_GRAPH_URL=${GRAPH_URL}`);
console.log(`export HASH_ACTOR_ID=${ACTOR_ID}`);
console.log(`export HASH_WEB_ID=${WEB_ID}`);
console.log(`export HASH_TYPE_BASE=${BASE}`);
