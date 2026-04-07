import {
  LogicalReplicationService,
  Pgoutput,
  PgoutputPlugin,
} from "pg-logical-replication";
import type { Batch, BatchHandler, ChangeEvent, ChangeOp, Connector, PullResult, Subscription, TableConfig } from "./types.js";
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
  const timeoutMs = config.pollTimeoutMs ?? 5000;

  function createService() {
    return new LogicalReplicationService(connParams, { acknowledge: { auto: false, timeoutSeconds: 0 } });
  }

  function createPlugin() {
    return new PgoutputPlugin({ protoVersion: 1, publicationNames: [config.publication] });
  }

  return {
    id: config.id,
    mode: "stream",

    async introspect() {
      return introspectTables(config.url, config.tables);
    },

    async pull(_table: string, cursor: unknown): Promise<PullResult> {
      const service = createService();
      const lsn = (cursor as string) ?? "0/0";
      const events: ChangeEvent[] = [];
      let lastLsn = lsn;

      return new Promise<PullResult>((resolve, reject) => {
        const done = (err?: Error) => {
          clearTimeout(timer);
          service.removeAllListeners("data");
          service.removeAllListeners("heartbeat");
          service.removeAllListeners("error");
          if (err) reject(err);
          else service.stop().then(() => resolve({ events, cursor: lastLsn }));
        };

        const timer = setTimeout(() => done(), timeoutMs);

        service.on("data", async (msgLsn: string, msg: Pgoutput.Message) => {
          lastLsn = msgLsn;
          const ev = toChangeEvent(msg, config.tables);
          if (ev) events.push(ev);

          if (msg.tag === "commit") {
            await service.acknowledge(msgLsn);
            done();
          }
        });

        service.on("heartbeat", async (hbLsn: string, _ts: unknown, shouldRespond: boolean) => {
          if (shouldRespond) await service.acknowledge(hbLsn);
        });

        service.on("error", (err: Error) => done(err));
        service.subscribe(createPlugin(), config.slot, lsn).catch(reject);
      });
    },

    async subscribe(_table: string, cursor: unknown, onBatch: BatchHandler): Promise<Subscription> {
      const service = createService();
      let lsn = (cursor as string) ?? "0/0";
      let events: ChangeEvent[] = [];

      service.on("data", async (msgLsn: string, msg: Pgoutput.Message) => {
        lsn = msgLsn;
        const ev = toChangeEvent(msg, config.tables);
        if (ev) events.push(ev);

        if (msg.tag === "commit") {
          await service.acknowledge(msgLsn);
          const batch = events;
          events = [];
          await onBatch({ events: batch, cursor: lsn });
        }
      });

      service.on("heartbeat", async (hbLsn: string, _ts: unknown, shouldRespond: boolean) => {
        if (shouldRespond) await service.acknowledge(hbLsn);
      });

      service.on("error", (err: Error) => {
        console.error("CDC stream error:", err);
      });

      await service.subscribe(createPlugin(), config.slot, lsn);

      return {
        async stop() {
          await service.stop();
          try { (service as any).client?.end?.(); } catch {}
        },
      };
    },

    async close() {},
  };
}
