export {};

/**
 * Discovers actor ID, web ID, and type base URL from a live HASH graph.
 * Optionally creates missing entity types needed by the demo pipeline.
 *
 * Usage:
 *   npx tsx src/e2e/discover-graph.ts
 *   npx tsx src/e2e/discover-graph.ts --web <shortname>
 *   npx tsx src/e2e/discover-graph.ts --create
 *
 * eval "$(npx tsx src/e2e/discover-graph.ts 2>&1 | grep '^export HASH_')"
 */

const GRAPH_URL = process.env.GRAPH_URL ?? "http://localhost:4000";
const shouldCreate = process.argv.includes("--create");
const webArg = (() => {
  const idx = process.argv.indexOf("--web");
  return idx >= 0 ? process.argv[idx + 1] : undefined;
})();

const actorId = await fetch(`${GRAPH_URL}/actors/machine/identifier/system/graph`)
  .then((r) => {
    if (!r.ok) throw new Error(`Failed to get system actor (${r.status})`);
    return r.json() as Promise<string>;
  });

console.error(`[discover] actor: ${actorId}`);

const headers = { "Content-Type": "application/json", "X-Authenticated-User-Actor-Id": actorId };
const temporalAxes = { pinned: { axis: "transactionTime", timestamp: null }, variable: { axis: "decisionTime", interval: { start: null, end: null } } };

const { entityTypes } = await fetch(`${GRAPH_URL}/entity-types/query`, {
  method: "POST", headers,
  body: JSON.stringify({ filter: { all: [] }, temporalAxes, limit: 200 }),
}).then((r) => r.json() as Promise<{ entityTypes: { schema: { $id: string; title: string } }[] }>);

const customTypes = entityTypes.filter((et) => !et.schema.$id.includes("blockprotocol.org"));
if (customTypes.length === 0) {
  console.error("[discover] no custom entity types");
  process.exit(1);
}

const typeBaseUrls = [...new Set(
  customTypes.map((et) => et.schema.$id.match(/^(.+?)\/entity-type\//)?.[1]).filter((b): b is string => b != null),
)];
const domain = typeBaseUrls[0]?.match(/^(https?:\/\/[^/]+)/)?.[1] ?? "https://hash.ai";

type Entity = {
  metadata: {
    recordId: { entityId: string };
    entityTypeIds: string[];
    provenance: { createdById: string };
  };
  properties: Record<string, unknown>;
};

const { entities } = await fetch(`${GRAPH_URL}/entities/query`, {
  method: "POST", headers,
  body: JSON.stringify({ filter: { all: [] }, temporalAxes, includeDrafts: false, includePermissions: false, limit: 500 }),
}).then((r) => r.json() as Promise<{ entities: Entity[] }>);

const webIds = [...new Set(entities.map((e) => e.metadata.recordId.entityId.split("~")[0]))];

const shortnameBase = "https://hash.ai/@h/types/property-type/shortname/";
const webShortnames = new Map<string, Set<string>>();
const webOwner = new Map<string, string>();

for (const e of entities) {
  const wid = e.metadata.recordId.entityId.split("~")[0];
  const raw = e.properties?.[shortnameBase];
  const shortname = typeof raw === "string" ? raw : (raw as { value?: string })?.value;
  if (shortname) {
    if (!webShortnames.has(wid)) webShortnames.set(wid, new Set());
    webShortnames.get(wid)!.add(shortname);
  }
  if (!webOwner.has(wid) && e.metadata.provenance.createdById) {
    webOwner.set(wid, e.metadata.provenance.createdById);
  }
}

console.error(`\n[discover] available webs:`);
for (const wid of webIds) {
  const names = webShortnames.get(wid);
  console.error(`  ${wid}${names ? ` (${[...names].join(", ")})` : ""}`);
}

let webId: string;
if (webArg) {
  const match = webIds.find((wid) => webShortnames.get(wid)?.has(webArg) || wid.startsWith(webArg));
  if (!match) {
    console.error(`\n[discover] no web matching "${webArg}"`);
    process.exit(1);
  }
  webId = match;
} else {
  webId = webIds[0];
}

const selectedActorId = webOwner.get(webId) ?? actorId;

const selectedNames = webShortnames.get(webId);
const shortname = webArg ?? [...(selectedNames ?? [])][0];
if (!shortname) {
  console.error(`\n[discover] selected web has no shortname; pass --web <shortname>`);
  process.exit(1);
}
const typeBase = `${domain}/@${shortname}/types`;

console.error(`\n[discover] selected web: ${webId}${selectedNames ? ` (${[...selectedNames].join(", ")})` : ""}`);
console.error(`[discover] actor for web: ${selectedActorId}`);
console.error(`[discover] type base: ${typeBase}`);

const entityTypeIndex = new Map<string, string>();
for (const et of entityTypes) {
  const slug = et.schema.$id.match(/\/entity-type\/([^/]+)\//)?.[1];
  if (slug) entityTypeIndex.set(slug, et.schema.$id);
}

const { propertyTypes } = await fetch(`${GRAPH_URL}/property-types/query`, {
  method: "POST", headers,
  body: JSON.stringify({ filter: { all: [] }, temporalAxes, limit: 200 }),
}).then((r) => r.json() as Promise<{ propertyTypes: { schema: { $id: string } }[] }>);

const propertyTypeIndex = new Map<string, string>();
for (const pt of propertyTypes) {
  const slug = pt.schema.$id.match(/\/property-type\/([^/]+)\//)?.[1];
  if (slug) propertyTypeIndex.set(slug, pt.schema.$id);
}

const needed = {
  entityTypes: ["user", "organization"],
  linkTypes: ["is-member-of"],
  propertyTypes: ["email", "display-name", "city"],
};

const missing: { entityTypes: string[]; linkTypes: string[]; propertyTypes: string[] } = {
  entityTypes: [], linkTypes: [], propertyTypes: [],
};

console.error(`\n[discover] required types:`);
for (const name of needed.entityTypes) {
  const found = entityTypeIndex.has(name);
  console.error(`  entity-type/${name}: ${found ? "ok" : "MISSING"}`);
  if (!found) missing.entityTypes.push(name);
}
for (const name of needed.linkTypes) {
  const found = entityTypeIndex.has(name);
  console.error(`  link-type/${name}: ${found ? "ok" : "MISSING"}`);
  if (!found) missing.linkTypes.push(name);
}
for (const name of needed.propertyTypes) {
  const found = propertyTypeIndex.has(name);
  console.error(`  property-type/${name}: ${found ? "ok" : "MISSING"}`);
  if (!found) missing.propertyTypes.push(name);
}

const hasMissing = missing.entityTypes.length + missing.linkTypes.length + missing.propertyTypes.length > 0;

if (hasMissing && !shouldCreate) {
  console.error(`\n[discover] missing types -- re-run with --create to create them`);
}

if (hasMissing && shouldCreate) {
  console.error(`\n[discover] creating missing types...`);

  const BP_LINK = "https://blockprotocol.org/@blockprotocol/types/entity-type/link/v/1";

  const propRef = (slug: string) => {
    const url = propertyTypeIndex.get(slug);
    if (!url) throw new Error(`Property type "${slug}" not found`);
    const base = url.replace(/v\/\d+$/, "");
    return { base, versioned: url };
  };

  for (const slug of missing.propertyTypes) {
    console.error(`  property-type/${slug} must already exist`);
    process.exit(1);
  }

  for (const slug of missing.entityTypes) {
    const title = slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
    const props: Record<string, { $ref: string }> = {};
    if (slug === "user") {
      for (const p of ["email", "display-name", "city"]) {
        const { base, versioned } = propRef(p);
        props[base] = { $ref: versioned };
      }
    }

    const res = await fetch(`${GRAPH_URL}/entity-types`, {
      method: "POST", headers,
      body: JSON.stringify({
        ownedById: webId,
        schema: {
          $schema: "https://blockprotocol.org/types/modules/graph/0.3/schema/entity-type",
          kind: "entityType",
          $id: `${typeBase}/entity-type/${slug}/v/1`,
          type: "object",
          title,
          properties: props,
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`  FAILED entity-type/${slug}: ${body.slice(0, 300)}`);
    } else {
      console.error(`  created entity-type/${slug}`);
    }
  }

  for (const slug of missing.linkTypes) {
    const title = slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
    const res = await fetch(`${GRAPH_URL}/entity-types`, {
      method: "POST", headers,
      body: JSON.stringify({
        ownedById: webId,
        schema: {
          $schema: "https://blockprotocol.org/types/modules/graph/0.3/schema/entity-type",
          kind: "entityType",
          $id: `${typeBase}/entity-type/${slug}/v/1`,
          type: "object",
          title,
          properties: {},
          allOf: [{ $ref: BP_LINK }],
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`  FAILED link-type/${slug}: ${body.slice(0, 300)}`);
    } else {
      console.error(`  created link-type/${slug}`);
    }
  }
}

console.log(`\nexport HASH_GRAPH_URL=${GRAPH_URL}`);
console.log(`export HASH_ACTOR_ID=${selectedActorId}`);
console.log(`export HASH_WEB_ID=${webId}`);
console.log(`export HASH_TYPE_BASE=${typeBase}`);
