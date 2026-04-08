import type { GraphClient } from "./types.js";

export function createStubGraphClient(): GraphClient {
  return {
    async upsertEntity(op) {
      const propCount = Object.keys(op.properties).length;
      const linkCount = op.links.length;
      console.log(`[graph] UPSERT ${short(op.entityType)} id=${op.entityId} (${propCount} props, ${linkCount} links)`);
      for (const [url, val] of Object.entries(op.properties)) {
        console.log(`  ${short(url)} = ${JSON.stringify(val)}`);
      }
      for (const link of op.links) {
        console.log(`  -> ${short(link.linkType)} -> ${short(link.targetEntityType)} id=${link.targetId}`);
      }
      if (op.provenance.location?.name) console.log(`  source: ${op.provenance.location.name}`);
    },
    async archiveEntity(op) {
      console.log(`[graph] ARCHIVE ${short(op.entityType)} id=${op.entityId}`);
    },
  };
}

function short(url: string): string {
  return url.split("/entity-type/")[1] ?? url.split("/property-type/")[1] ?? url;
}
