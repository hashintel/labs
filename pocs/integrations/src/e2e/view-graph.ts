/**
 * Queries and prints all entities in the graph.
 *
 * Usage: npx tsx src/e2e/view-graph.ts
 */
import { queryEntities, type GraphClientConfig } from "../graph/client.js";

const GRAPH_URL = process.env.HASH_GRAPH_URL ?? "http://localhost:4000";
const ACTOR_ID = process.env.HASH_ACTOR_ID;

if (!ACTOR_ID) {
  console.error("HASH_ACTOR_ID required");
  process.exit(1);
}

const config: GraphClientConfig = { baseUrl: GRAPH_URL, actorId: ACTOR_ID };
const entities = await queryEntities(config);

const typeSlug = (url: string) => url.split("/entity-type/")[1] ?? url;
const propSlug = (url: string) => url.split("/property-type/")[1]?.replace(/\/$/, "") ?? url;

console.log(`${entities.length} entities\n`);

for (const e of entities) {
  const type = e.metadata.entityTypeIds.map(typeSlug).join(", ");
  const id = e.metadata.recordId.entityId.split("~")[1]?.slice(0, 8) ?? e.metadata.recordId.entityId;
  const archived = e.metadata.archived ? " [ARCHIVED]" : "";
  const link = e.linkData
    ? ` -> ${e.linkData.rightEntityId.split("~")[1]?.slice(0, 8)}`
    : "";

  const props = Object.entries(e.properties)
    .map(([k, v]) => `${propSlug(k)}=${v}`)
    .join(", ");

  const source = e.metadata.provenance.edition.sources?.[0]?.location?.name;

  console.log(`  ${type}${archived}${link}  ${id}`);
  if (props) console.log(`    ${props}`);
  if (source) console.log(`    source: ${source}`);
}
