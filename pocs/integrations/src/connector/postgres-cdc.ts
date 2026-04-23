import pg from "pg";
import {
  LogicalReplicationService,
  Pgoutput,
  PgoutputPlugin,
} from "pg-logical-replication";
import type { BatchHandler, ChangeEvent, ChangeOp, Connector, KeyExtractor, Subscription, TableConfig } from "./types.js";
import { compileKeyExtractor } from "./types.js";
import type { Logger } from "../log.js";
import type { ProvenanceConfig } from "../transform/pipeline.js";

export type PostgresCdcConfig = {
  id: string;
  url: string;
  publication: string;
  slot: string;
  tables: Record<string, TableConfig>;
  provenance?: ProvenanceConfig;
};

const DML_OPS: Record<string, ChangeOp | undefined> = { insert: "insert", update: "update", delete: "delete" };

function parsePostgresUrl(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 5432,
    database: parsed.pathname.slice(1),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
  };
}

function toChangeEvent(
  msg: Pgoutput.Message,
  keyExtractors: Map<string, KeyExtractor>,
): ChangeEvent | null {
  const op = DML_OPS[msg.tag];
  if (!op) return null;

  const dml = msg as Pgoutput.MessageInsert | Pgoutput.MessageUpdate | Pgoutput.MessageDelete;
  const after = "new" in dml ? (dml.new as Record<string, unknown>) : null;
  const before = "old" in dml ? (dml.old as Record<string, unknown> | undefined) : undefined;
  const tableName = dml.relation.name;
  const keyFrom = keyExtractors.get(tableName);

  return {
    table: tableName,
    op,
    key: keyFrom ? keyFrom(after ?? before) : {},
    row: after,
    before: before ?? undefined,
  };
}

async function releaseStaleSlotHolder(url: string, slot: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `SELECT pg_terminate_backend(active_pid) FROM pg_replication_slots WHERE slot_name = $1 AND active`,
      [slot],
    );
  } finally {
    await client.end();
  }
}

export function createPostgresCdcConnector(config: PostgresCdcConfig, log?: Logger): Connector {
  const connParams = parsePostgresUrl(config.url);
  const keyExtractors = new Map<string, KeyExtractor>();
  for (const [name, tc] of Object.entries(config.tables)) {
    keyExtractors.set(name, compileKeyExtractor(tc.primaryKey));
  }

  let service: LogicalReplicationService | null = null;
  const handlers = new Map<string, BatchHandler>();

  return {
    id: config.id,
    mode: "stream",

    async subscribe(table: string, cursor: unknown, onBatch: BatchHandler): Promise<Subscription> {
      handlers.set(table, onBatch);

      if (!service) {
        await releaseStaleSlotHolder(config.url, config.slot);
        service = new LogicalReplicationService(connParams, { acknowledge: { auto: false, timeoutSeconds: 0 } });
        let lsn = (cursor as string) ?? "0/0";
        let events: ChangeEvent[] = [];

        service.on("data", async (msgLsn: string, msg: Pgoutput.Message) => {
          lsn = msgLsn;
          const ev = toChangeEvent(msg, keyExtractors);
          if (ev) events.push(ev);

          if (msg.tag === "commit") {
            await service!.acknowledge(msgLsn);
            const batch = events;
            events = [];

            const byTable = new Map<string, ChangeEvent[]>();
            for (let i = 0; i < batch.length; i++) {
              const ev = batch[i];
              let list = byTable.get(ev.table);
              if (!list) {
                list = [];
                byTable.set(ev.table, list);
              }
              list.push(ev);
            }
            // Dispatch in subscription order. The engine subscribes pipelines
            // in topologically-sorted order, so this iterates deps-before-dependents.
            for (const [tbl, handler] of handlers) {
              const evts = byTable.get(tbl);
              if (evts && evts.length > 0) {
                await handler({ events: evts, cursor: lsn });
              }
            }
          }
        });

        service.on("heartbeat", async (hbLsn: string, _ts: unknown, shouldRespond: boolean) => {
          if (shouldRespond) await service!.acknowledge(hbLsn);
        });

        service.on("error", (err: Error) => {
          log?.error(`cdc stream error: ${err.message}`);
        });

        const plugin = new PgoutputPlugin({ protoVersion: 1, publicationNames: [config.publication] });
        service.subscribe(plugin, config.slot, lsn);
      }

      return {
        async stop() {
          handlers.delete(table);
          if (handlers.size === 0 && service) {
            await service.stop();
            try { (service as unknown as { client?: { end?(): void } }).client?.end?.(); } catch {}
            service = null;
          }
        },
      };
    },

    async close() {
      if (service) {
        await service.stop();
        try { (service as unknown as { client?: { end?(): void } }).client?.end?.(); } catch {}
        service = null;
      }
      handlers.clear();
    },
  };
}
