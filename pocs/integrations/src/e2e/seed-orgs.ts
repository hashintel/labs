/**
 * Pre-creates organization entities in the graph.
 * Link targets must exist before link creation — run this after seed-graph.ts, before the demo.
 *
 * Usage: npx tsx src/e2e/seed-orgs.ts
 */
import { createGraphClient } from "../graph/client.js";
import { namespace } from "../transform/pipeline.js";

const GRAPH_URL = process.env.HASH_GRAPH_URL ?? "http://localhost:4000";
const ACTOR_ID = process.env.HASH_ACTOR_ID;
const WEB_ID = process.env.HASH_WEB_ID;
const TYPE_BASE = process.env.HASH_TYPE_BASE ?? "http://localhost:3000/@e2e/types";

if (!ACTOR_ID || !WEB_ID) {
  console.error("HASH_ACTOR_ID and HASH_WEB_ID required");
  process.exit(1);
}

const T = namespace(TYPE_BASE);
const client = createGraphClient({ baseUrl: GRAPH_URL, actorId: ACTOR_ID });
const prov = { type: "integration" as const, location: { name: "seed" }, loadedAt: new Date().toISOString() };

const orgIds = process.argv.slice(2);
if (orgIds.length === 0) orgIds.push("1", "2");

for (const id of orgIds) {
  await client.upsertEntity({
    kind: "upsert",
    entityType: T.entity("organization/v/1"),
    entityId: id,
    webId: WEB_ID,
    properties: {},
    links: [],
    provenance: prov,
  });
  console.log(`[seed-orgs] ${id}`);
}
