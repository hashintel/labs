import type { BatchConnector, ChangeEvent, TableConfig } from "./types.js";
import { extractKey } from "./types.js";

export type RestApiEndpoint = {
  url: string;
  primaryKey: string | string[];
  pagination?: { type: "next-link"; field: string } | { type: "offset" } | { type: "none" };
  resultsField?: string;
  params?: Record<string, string>;
};

export type RestApiBatchConfig = {
  id: string;
  endpoints: Record<string, RestApiEndpoint>;
  auth?: { type: "header"; name: string; value: string } | { type: "bearer"; token: string };
  rateLimitMs?: number;
  pageSize?: number;
};

function interpolateEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
}

function getNestedField(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function createRestApiBatchConnector(config: RestApiBatchConfig): BatchConnector {
  const pageSize = config.pageSize ?? 100;
  const rateLimitMs = config.rateLimitMs ?? 0;

  function buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.auth?.type === "header") {
      headers[config.auth.name] = interpolateEnv(config.auth.value);
    } else if (config.auth?.type === "bearer") {
      headers["Authorization"] = `Bearer ${interpolateEnv(config.auth.token)}`;
    }
    return headers;
  }

  async function fetchPage(url: string, headers: Record<string, string>): Promise<unknown> {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`REST API ${res.status}: ${url} -- ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  async function delay(ms: number): Promise<void> {
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  return {
    id: config.id,
    mode: "batch" as const,
    pageSize,

    async introspect() {
      const result: Record<string, TableConfig> = {};
      for (const [name, ep] of Object.entries(config.endpoints)) {
        result[name] = { primaryKey: ep.primaryKey };
      }
      return result;
    },

    async pull(table, onPage) {
      const ep = config.endpoints[table];
      if (!ep) throw new Error(`Endpoint "${table}" not configured on connector "${config.id}"`);

      const headers = buildHeaders();
      const pagination = ep.pagination ?? { type: "none" };
      let url = ep.url;

      if (ep.params) {
        const qs = new URLSearchParams(ep.params).toString();
        url += (url.includes("?") ? "&" : "?") + qs;
      }

      let pageNum = 0;

      while (url) {
        if (pageNum > 0) await delay(rateLimitMs);

        const body = await fetchPage(url, headers);
        const results = ep.resultsField ? getNestedField(body, ep.resultsField) : body;

        if (!Array.isArray(results) || results.length === 0) break;

        const events: ChangeEvent[] = results.map((row: Record<string, unknown>) => ({
          table,
          op: "snapshot" as const,
          key: extractKey(row, ep.primaryKey),
          row,
        }));

        await onPage({ events, cursor: undefined });

        pageNum++;

        if (pagination.type === "next-link") {
          const next = getNestedField(body, pagination.field);
          url = typeof next === "string" ? next : "";
        } else if (pagination.type === "offset") {
          if (results.length < pageSize) break;
          const u = new URL(url);
          const offset = Number(u.searchParams.get("offset") ?? "0") + results.length;
          u.searchParams.set("offset", String(offset));
          url = u.toString();
        } else {
          break;
        }
      }
    },

    async close() {},
  };
}
