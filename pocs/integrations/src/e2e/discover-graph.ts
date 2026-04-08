export {};

/**
 * Discovers actor ID, web ID, and type base URL from a live HASH graph.
 * Optionally creates missing entity types needed by the demo pipeline.
 *
 * Usage:
 *   npx tsx src/e2e/discover-graph.ts                    # discover, auto-pick first web
 *   npx tsx src/e2e/discover-graph.ts --web <shortname>   # pick a specific web
 *   npx tsx src/e2e/discover-graph.ts --create            # create missing types
 *
 * Outputs export lines: eval "$(npx tsx src/e2e/discover-graph.ts 2>&1 | grep '^export HASH_')"
 */

const GRAPH_URL = process.env.GRAPH_URL ?? "http://localhost:4000";
const shouldCreate = process.argv.includes("--create");
const webArg = (() => {
  const idx = process.argv.indexOf("--web");
  return idx >= 0 ? process.argv[idx + 1] : undefined;
})();

// 1. Discover actor
const actorId = await fetch(`${GRAPH_URL}/actors/machine/identifier/system/graph`)
  .then((r) => {
    if (!r.ok) throw new Error(`Failed to get system actor (${r.status})`);
    return r.json() as Promise<string>;
  });

console.error(`[discover] actor: ${actorId}`);

const headers = { "Content-Type": "application/json", "X-Authenticated-User-Actor-Id": actorId };

// 2. Discover entity types
const { entityTypes } = await fetch(`${GRAPH_URL}/entity-types/query`, {
  method: "POST", headers,
  body: JSON.stringify({
    filter: { all: [] },
    temporalAxes: { pinned: { axis: "transactionTime", timestamp: null }, variable: { axis: "decisionTime", interval: { start: null, end: null } } },
    limit: 200,
  }),
}).then((r) => r.json() as Promise<{ entityTypes: { schema: { $id: string; title: string } }[] }>);

// 3. Derive type base
const customTypes = entityTypes.filter((et) => !et.schema.$id.includes("blockprotocol.org"));
if (customTypes.length === 0) {
  console.error("[discover] no custom entity types — graph may not be seeded");
  process.exit(1);
}

const typeBaseUrls = [...new Set(
  customTypes.map((et) => et.schema.$id.match(/^(.+?)\/entity-type\//)?.[1]).filter((b): b is string => b != null),
)];
// Prefer the type base matching the --web shortname
const typeBase = (webArg && typeBaseUrls.find((b) => b.includes(`@${webArg}/`))) ?? typeBaseUrls[0];

// 4. Discover webs — query entities and collect distinct web IDs + resolve shortnames
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
  body: JSON.stringify({
    filter: { all: [] },
    temporalAxes: { pinned: { axis: "transactionTime", timestamp: null }, variable: { axis: "decisionTime", interval: { start: null, end: null } } },
    includeDrafts: false, includePermissions: false, limit: 500,
  }),
}).then((r) => r.json() as Promise<{ entities: Entity[] }>);

// Collect unique web IDs
const webIds = [...new Set(entities.map((e) => e.metadata.recordId.entityId.split("~")[0]))];

// Resolve shortnames and web owner actors
const shortnameBase = "https://hash.ai/@h/types/property-type/shortname/";
const webShortnames = new Map<string, Set<string>>(); // webId → all shortnames
const webOwner = new Map<string, string>(); // webId → actor who created entities there

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

// Select web
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

// Use the web owner's actor for entity creation (system actor may lack permission)
const selectedActorId = webOwner.get(webId) ?? actorId;

const selectedNames = webShortnames.get(webId);
console.error(`\n[discover] selected web: ${webId}${selectedNames ? ` (${[...selectedNames].join(", ")})` : ""}`);
console.error(`[discover] actor for web: ${selectedActorId}`);
console.error(`[discover] type base: ${typeBase}`);

// 5. Check required types
const entityTypeIndex = new Map<string, string>();
for (const et of entityTypes) {
  const slug = et.schema.$id.match(/\/entity-type\/([^/]+)\//)?.[1];
  if (slug) entityTypeIndex.set(slug, et.schema.$id);
}

const { propertyTypes } = await fetch(`${GRAPH_URL}/property-types/query`, {
  method: "POST", headers,
  body: JSON.stringify({
    filter: { all: [] },
    temporalAxes: { pinned: { axis: "transactionTime", timestamp: null }, variable: { axis: "decisionTime", interval: { start: null, end: null } } },
    limit: 200,
  }),
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

// 6. Create missing types if --create
const hasMissing = missing.entityTypes.length + missing.linkTypes.length + missing.propertyTypes.length > 0;

if (hasMissing && !shouldCreate) {
  console.error(`\n[discover] missing types — re-run with --create to create them`);
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
    console.error(`  property-type/${slug} must already exist — cannot auto-create`);
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

// Output
console.log(`\nexport HASH_GRAPH_URL=${GRAPH_URL}`);
console.log(`export HASH_ACTOR_ID=${selectedActorId}`);
console.log(`export HASH_WEB_ID=${webId}`);
console.log(`export HASH_TYPE_BASE=${typeBase}`);
