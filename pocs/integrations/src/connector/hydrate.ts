import type { ChangeEvent, HydrateContext, HydrateResult } from "./types.js";

/**
 * Adapter for connectors that emit ChangeEvent[] pages (REST/HTTP, driver-based, etc.).
 * Each emitted batch is materialized into `ctx.stagingTable`; rowCount accumulates.
 *
 * Connectors that can land rows directly in the store (e.g. DuckDB-backed) should
 * implement `hydrate` without this helper and skip the event roundtrip.
 */
export async function hydrateFromEvents(
  ctx: HydrateContext,
  pull: (emit: (events: ChangeEvent[]) => Promise<void>) => Promise<unknown | void>,
): Promise<HydrateResult> {
  let rowCount = 0;
  const cursor = await pull(async (events) => {
    if (events.length === 0) return;
    await ctx.store.materialize(ctx.connectorId, ctx.source, events);
    rowCount += events.length;
  });
  return { rowCount, cursor: cursor ?? undefined };
}
