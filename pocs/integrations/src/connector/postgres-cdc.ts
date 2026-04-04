import {
  LogicalReplicationService,
  Pgoutput,
  PgoutputPlugin,
} from "pg-logical-replication";
import type { ChangeEvent, ChangeOp, Connector, PullResult, TableConfig } from "./types.js";
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

const DML_TAGS = new Set<string>(["insert", "update", "delete"]);

function toDmlOp(tag: string): ChangeOp {
  if (tag === "insert" || tag === "update" || tag === "delete") return tag;
  throw new Error(`Unexpected DML tag: ${tag}`);
}

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

export function createPostgresCdcConnector(config: PostgresCdcConfig): Connector {
  const service = new LogicalReplicationService(
    parsePostgresUrl(config.url),
    { acknowledge: { auto: false, timeoutSeconds: 0 } },
  );

  const plugin = new PgoutputPlugin({
    protoVersion: 1,
    publicationNames: [config.publication],
  });

  const timeoutMs = config.pollTimeoutMs ?? 5000;

  return {
    id: config.id,

    async introspect() {
      return introspectTables(config.url, config.tables);
    },

    async pull(_table: string, cursor: unknown): Promise<PullResult> {
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

          if (DML_TAGS.has(msg.tag)) {
            const dml = msg as Pgoutput.MessageInsert | Pgoutput.MessageUpdate | Pgoutput.MessageDelete;
            const after = "new" in dml ? (dml.new as Record<string, unknown>) : null;
            const before = "old" in dml ? (dml.old as Record<string, unknown> | undefined) : undefined;
            const tc = config.tables[dml.relation.name];

            events.push({
              table: dml.relation.name,
              op: toDmlOp(msg.tag),
              key: extractKey(after ?? before, tc?.primaryKey ?? []),
              row: after,
              before: before ?? undefined,
            });
          }

          if (msg.tag === "commit") {
            await service.acknowledge(msgLsn);
            done();
          }
        });

        service.on("heartbeat", async (hbLsn: string, _ts: unknown, shouldRespond: boolean) => {
          if (shouldRespond) await service.acknowledge(hbLsn);
        });

        service.on("error", (err: Error) => done(err));

        service.subscribe(plugin, config.slot, lsn).catch(reject);
      });
    },

    async close() {
      await service.stop();
      try { (service as any).client?.end?.(); } catch {}
    },
  };
}
