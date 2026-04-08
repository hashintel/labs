import {
  LogicalReplicationService,
  Pgoutput,
  PgoutputPlugin,
} from "pg-logical-replication";
import type { BatchHandler, ChangeEvent, ChangeOp, Connector, Subscription, TableConfig } from "./types.js";
import { extractKey } from "./types.js";
import { introspectTables } from "./pg-introspect.js";

export type PostgresCdcConfig = {
  id: string;
  url: string;
  publication: string;
  slot: string;
  tables: Record<string, TableConfig>;
  pollTimeoutMs?: number;
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

function toChangeEvent(msg: Pgoutput.Message, tables: Record<string, TableConfig>): ChangeEvent | null {
  const op = DML_OPS[msg.tag];
  if (!op) return null;

  const dml = msg as Pgoutput.MessageInsert | Pgoutput.MessageUpdate | Pgoutput.MessageDelete;
  const after = "new" in dml ? (dml.new as Record<string, unknown>) : null;
  const before = "old" in dml ? (dml.old as Record<string, unknown> | undefined) : undefined;
  const tc = tables[dml.relation.name];

  return {
    table: dml.relation.name,
    op,
    key: extractKey(after ?? before, tc?.primaryKey ?? []),
    row: after,
    before: before ?? undefined,
  };
}

export function createPostgresCdcConnector(config: PostgresCdcConfig): Connector {
  const connParams = parsePostgresUrl(config.url);
  let service: LogicalReplicationService | null = null;
  const handlers = new Map<string, BatchHandler>();

  return {
    id: config.id,
    mode: "stream",

    async introspect() {
      return introspectTables(config.url, config.tables);
    },

    async subscribe(table: string, cursor: unknown, onBatch: BatchHandler): Promise<Subscription> {
      handlers.set(table, onBatch);

      if (!service) {
        service = new LogicalReplicationService(connParams, { acknowledge: { auto: false, timeoutSeconds: 0 } });
        let lsn = (cursor as string) ?? "0/0";
        let events: ChangeEvent[] = [];

        service.on("data", async (msgLsn: string, msg: Pgoutput.Message) => {
          lsn = msgLsn;
          const ev = toChangeEvent(msg, config.tables);
          if (ev) events.push(ev);

          if (msg.tag === "commit") {
            await service!.acknowledge(msgLsn);
            const batch = events;
            events = [];

            const byTable = new Map<string, ChangeEvent[]>();
            for (const ev of batch) {
              const list = byTable.get(ev.table) ?? [];
              list.push(ev);
              byTable.set(ev.table, list);
            }
            for (const [tbl, evts] of byTable) {
              const handler = handlers.get(tbl);
              if (handler) await handler({ events: evts, cursor: lsn });
            }
          }
        });

        service.on("heartbeat", async (hbLsn: string, _ts: unknown, shouldRespond: boolean) => {
          if (shouldRespond) await service!.acknowledge(hbLsn);
        });

        service.on("error", (err: Error) => {
          console.error("CDC stream error:", err);
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
