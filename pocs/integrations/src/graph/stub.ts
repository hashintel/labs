import type { GraphClient } from "./types.js";

export function createStubGraphClient(): GraphClient {
  async function upsertEntity(op: Parameters<GraphClient["upsertEntity"]>[0]): Promise<void> {
    const propCount = Object.keys(op.properties).length;
    console.log(`[graph] UPSERT ${short(op.entityType)} id=${op.entityId} (${propCount} props)`);
    for (const [url, val] of Object.entries(op.properties)) {
      console.log(`  ${short(url)} = ${JSON.stringify(val)}`);
    }
    if (op.provenance.location?.name) console.log(`  source: ${op.provenance.location.name}`);
  }

  async function upsertLink(op: Parameters<GraphClient["upsertLink"]>[0]): Promise<"ok"> {
    console.log(`[graph] LINK ${short(op.linkType)} ${op.sourceEntityId} -> ${short(op.targetEntityType)} id=${op.targetId}`);
    return "ok";
  }

  return {
    upsertEntity,
    async bulkUpsertEntities(ops) {
      const start = Date.now();
      const ok: string[] = [];
      for (const op of ops) { await upsertEntity(op); ok.push(String(op.entityId)); }
      return { ok, failed: [], batches: 1, fellBackBatches: 0, durationMs: Date.now() - start };
    },
    upsertLink,
    async bulkUpsertLinks(ops, opts) {
      const start = Date.now();
      const ok: string[] = [];
      for (const op of ops) {
        await upsertLink(op);
        ok.push(op.opId);
      }
      if (opts?.onBatchOk) await opts.onBatchOk(ok);
      return { ok, failed: [], batches: 1, fellBackBatches: 0, durationMs: Date.now() - start };
    },
    async archiveEntity(op) {
      console.log(`[graph] ARCHIVE ${short(op.entityType)} id=${op.entityId}`);
    },
    identity: () => "stub:local",
    async hasEntity() {
      return true;
    },
  };
}

function short(url: string): string {
  return url.split("/entity-type/")[1] ?? url.split("/property-type/")[1] ?? url;
}
