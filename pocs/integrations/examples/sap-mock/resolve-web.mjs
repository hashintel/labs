#!/usr/bin/env node
// Resolve a HASH web shortname to seeding env, and verify the target graph has
// the supply-chain ontology. Prints `export HASH_*` lines on stdout (eval'd by
// seed-mock.sh); everything else goes to stderr.
//
//   node resolve-web.mjs <shortname>          # graph from HASH_GRAPH_URL, default localhost:4000

const GRAPH_URL = process.env.HASH_GRAPH_URL ?? "http://localhost:4000";
const shortname = process.argv[2];
if (!shortname) {
  console.error("usage: resolve-web.mjs <web-shortname>");
  process.exit(2);
}

const die = (msg) => { console.error(`[resolve-web] ${msg}`); process.exit(1); };

const systemActor = await fetch(`${GRAPH_URL}/actors/machine/identifier/system/graph`)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
  .catch((e) => die(`graph unreachable at ${GRAPH_URL} (${e.message}) -- is it running? Set HASH_GRAPH_URL to override.`));

const headers = { "Content-Type": "application/json", "X-Authenticated-User-Actor-Id": systemActor };
const temporalAxes = { pinned: { axis: "transactionTime", timestamp: null }, variable: { axis: "decisionTime", interval: { start: null, end: null } } };
const query = (path, body) =>
  fetch(`${GRAPH_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${path} ${r.status}`))));

// The pipeline's ontology must exist before anything is written.
const SENTINEL_TYPES = [
  "https://hash.ai/@h/types/entity-type/material/v/1",
  "https://hash.ai/@h/types/entity-type/has-line-item/v/1",
];
const { entityTypes } = await query("/entity-types/query", { filter: { all: [] }, temporalAxes, limit: 500 });
const typeIds = new Set(entityTypes.map((et) => et.schema.$id));
const missing = SENTINEL_TYPES.filter((t) => !typeIds.has(t));
if (missing.length > 0) {
  die(`graph at ${GRAPH_URL} lacks the supply-chain ontology (missing ${missing.join(", ")}). Seed the ontology first.`);
}

const { entities } = await query("/entities/query", {
  filter: { all: [] }, temporalAxes, includeDrafts: false, includePermissions: false, limit: 500,
});

const SHORTNAME_PROP = "https://hash.ai/@h/types/property-type/shortname/";
const webShortnames = new Map();
const webMachine = new Map();
const webOwner = new Map();
for (const e of entities) {
  const webId = e.metadata.recordId.entityId.split("~")[0];
  const raw = e.properties?.[SHORTNAME_PROP];
  const name = typeof raw === "string" ? raw : raw?.value;
  if (name) {
    if (!webShortnames.has(webId)) webShortnames.set(webId, new Set());
    webShortnames.get(webId).add(name);
  }
  // The web's machine bot is the actor with full write AND update rights; a
  // user actor can create entities in a shared web but not always update them.
  if (!webMachine.has(webId) && e.metadata.entityTypeIds.some((t) => t.includes("/entity-type/machine/"))) {
    webMachine.set(webId, e.metadata.recordId.entityId.split("~")[1]);
  }
  if (!webOwner.has(webId) && e.metadata.provenance.createdById) {
    webOwner.set(webId, e.metadata.provenance.createdById);
  }
}

const webId = [...webShortnames.keys()].find((wid) => webShortnames.get(wid).has(shortname))
  ?? [...new Set(entities.map((e) => e.metadata.recordId.entityId.split("~")[0]))].find((wid) => wid.startsWith(shortname));
if (!webId) {
  const known = [...webShortnames.values()].flatMap((s) => [...s]).sort();
  die(`no web named "${shortname}" at ${GRAPH_URL}. Known shortnames: ${known.join(", ") || "(none)"}`);
}

const actorId = webMachine.get(webId) ?? webOwner.get(webId) ?? systemActor;
console.error(`[resolve-web] ${shortname} -> web ${webId}, actor ${actorId}`);

console.log(`export HASH_GRAPH_URL=${GRAPH_URL}`);
console.log(`export HASH_WEB_ID=${webId}`);
console.log(`export HASH_ACTOR_ID=${actorId}`);
