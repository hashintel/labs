import type { BatchConnector, ChangeEvent, TableConfig } from "./types.js";
import { compileKeyExtractor, type KeyExtractor } from "./types.js";

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

type PathAccessor = (obj: unknown) => unknown;

function compilePath(path: string): PathAccessor {
  const parts = path.split(".");
  if (parts.length === 1) {
    const key = parts[0];
    return (obj) => (obj != null && typeof obj === "object") ? (obj as Record<string, unknown>)[key] : undefined;
  }
  return (obj) => {
    let cur: unknown = obj;
    for (let i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[parts[i]];
    }
    return cur;
  };
}

function interpolateEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
}

function buildInitialUrl(base: string, params?: Record<string, string>): string {
  if (!params) return base;
  const qs = new URLSearchParams(params).toString();
  if (!qs) return base;
  return base + (base.includes("?") ? "&" : "?") + qs;
}

type CompiledEndpoint = {
  url: string;
  paginationType: "next-link" | "offset" | "none";
  getResults: PathAccessor;
  getNext: PathAccessor | null;
  keyFrom: KeyExtractor;
};

const identityAccessor: PathAccessor = (obj) => obj;

export function createRestApiBatchConnector(config: RestApiBatchConfig): BatchConnector {
  const pageSize = config.pageSize ?? 100;
  const rateLimitMs = config.rateLimitMs ?? 0;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.auth?.type === "header") {
    headers[config.auth.name] = interpolateEnv(config.auth.value);
  } else if (config.auth?.type === "bearer") {
    headers["Authorization"] = `Bearer ${interpolateEnv(config.auth.token)}`;
  }

  const endpoints = new Map<string, CompiledEndpoint>();
  for (const [name, ep] of Object.entries(config.endpoints)) {
    endpoints.set(name, {
      url: buildInitialUrl(ep.url, ep.params),
      paginationType: ep.pagination?.type ?? "none",
      getResults: ep.resultsField ? compilePath(ep.resultsField) : identityAccessor,
      getNext: ep.pagination?.type === "next-link" ? compilePath(ep.pagination.field) : null,
      keyFrom: compileKeyExtractor(ep.primaryKey),
    });
  }

  async function fetchPage(url: string): Promise<unknown> {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`REST API ${res.status}: ${url} -- ${body.slice(0, 200)}`);
    }
    return res.json();
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
      const ep = endpoints.get(table);
      if (!ep) throw new Error(`Endpoint "${table}" not configured on connector "${config.id}"`);

      let url = ep.url;
      let isFirstPage = true;

      while (url) {
        if (!isFirstPage && rateLimitMs > 0) {
          await new Promise((r) => setTimeout(r, rateLimitMs));
        }
        isFirstPage = false;

        const body = await fetchPage(url);
        const results = ep.getResults(body);
        if (!Array.isArray(results) || results.length === 0) break;

        const events: ChangeEvent[] = new Array(results.length);
        for (let i = 0; i < results.length; i++) {
          const row = results[i] as Record<string, unknown>;
          events[i] = { table, op: "snapshot", key: ep.keyFrom(row), row };
        }
        await onPage({ events, cursor: undefined });

        if (ep.paginationType === "next-link") {
          const next = ep.getNext!(body);
          url = typeof next === "string" ? next : "";
        } else if (ep.paginationType === "offset") {
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
