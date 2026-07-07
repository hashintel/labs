import type { BatchConnector, ChangeEvent } from "./types.js";
import { compileKeyExtractor, type KeyExtractor } from "./types.js";
import { hydrateFromEvents } from "./hydrate.js";
import { paceHost } from "./fetch-pacer.js";
import { with429Retry } from "../http-retry.js";
import type { Logger } from "../log.js";
import type { ProvenanceConfig } from "../transform/pipeline.js";

// A hung source must not hang the run; matches the graph client's default ceiling.
const FETCH_TIMEOUT_MS = 120_000;

export type RestApiEndpoint = {
  url: string;
  primaryKey: string | string[];
  pagination?: { type: "next-link"; field: string } | { type: "offset" } | { type: "none" };
  resultsField?: string;
  params?: Record<string, string>;
  /** Hard cap on pages the connector will follow, on top of any server-side limit. */
  maxPages?: number;
  /** Pull returns a subset (windowed / filtered); state for absent ids is preserved, not archived. */
  partial?: boolean;
  /** Trust an empty response as authoritative and archive all prior state. Default false (transient failures are more common than genuine empties). */
  archiveOnEmpty?: boolean;
  provenance?: ProvenanceConfig;
};

export type RestApiBatchConfig = {
  id: string;
  endpoints: Record<string, RestApiEndpoint>;
  auth?: { type: "header"; name: string; value: string } | { type: "bearer"; token: string };
  rateLimitMs?: number;
  pageSize?: number;
  provenance?: ProvenanceConfig;
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

// ${NOW}, ${NOW+1h}, ${NOW-30m}, ${NOW+2d} -- resolved each pull.
const NOW_TOKEN = /^NOW(?:([+-])(\d+)([mhd]))?$/;
const INTERPOLATE_TOKEN = /\$\{([^}]+)\}/g;
const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

function resolveToken(key: string): string | null {
  const m = NOW_TOKEN.exec(key);
  if (!m) return null;
  const offset = m[1] ? Number(m[2]) * UNIT_MS[m[3]] * (m[1] === "+" ? 1 : -1) : 0;
  // Minute precision -- some APIs (AeroAPI) reject fractional seconds, and
  // windowing queries don't need finer than a minute.
  const d = new Date(Date.now() + offset);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 19) + "Z";
}

export function interpolate(value: string): string {
  return value.replace(INTERPOLATE_TOKEN, (_, key) => {
    const t = resolveToken(key);
    if (t !== null) return t;
    return process.env[key] ?? "";
  });
}

function buildUrl(urlTemplate: string, params: Record<string, string> | undefined): string {
  const base = interpolate(urlTemplate);
  if (!params) return base;
  const resolved: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) resolved[k] = interpolate(v);
  const qs = new URLSearchParams(resolved).toString();
  return qs ? base + (base.includes("?") ? "&" : "?") + qs : base;
}

type CompiledEndpoint = {
  urlTemplate: string;
  params: Record<string, string> | undefined;
  paginationType: "next-link" | "offset" | "none";
  getResults: PathAccessor;
  getNext: PathAccessor | null;
  keyFrom: KeyExtractor;
  maxPages: number;
};

const identityAccessor: PathAccessor = (obj) => obj;

/** Returned object exposes `pullPages` for tests; callers via `createConnector` see only `BatchConnector`. */
export type RestApiBatchConnector = BatchConnector & {
  pullPages(table: string, emit: (events: ChangeEvent[]) => Promise<void>): Promise<void>;
};

export function createRestApiBatchConnector(config: RestApiBatchConfig, log?: Logger): RestApiBatchConnector {
  const pageSize = config.pageSize ?? 100;
  const rateLimitMs = config.rateLimitMs ?? 0;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.auth?.type === "header") {
    headers[config.auth.name] = interpolate(config.auth.value);
  } else if (config.auth?.type === "bearer") {
    headers["Authorization"] = `Bearer ${interpolate(config.auth.token)}`;
  }

  const endpoints = new Map<string, CompiledEndpoint>();
  for (const [name, ep] of Object.entries(config.endpoints)) {
    endpoints.set(name, {
      urlTemplate: ep.url,
      params: ep.params,
      paginationType: ep.pagination?.type ?? "none",
      getResults: ep.resultsField ? compilePath(ep.resultsField) : identityAccessor,
      getNext: ep.pagination?.type === "next-link" ? compilePath(ep.pagination.field) : null,
      keyFrom: compileKeyExtractor(ep.primaryKey),
      maxPages: ep.maxPages ?? Infinity,
    });
  }

  async function fetchPage(url: string): Promise<unknown> {
    log?.debug(`GET ${url}`);
    // 429s retry honoring Retry-After (same semantics as the graph client); a
    // hung source times out instead of hanging the run.
    const res = await with429Retry(() =>
      fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`REST API ${res.status}: ${url} -- ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  async function pullPages(table: string, emit: (events: ChangeEvent[]) => Promise<void>): Promise<void> {
    const ep = endpoints.get(table);
    if (!ep) throw new Error(`Endpoint "${table}" not configured on connector "${config.id}"`);

    let url = buildUrl(ep.urlTemplate, ep.params);
    let pagesSeen = 0;

    while (url) {
      // rateLimitMs paces through the process-wide per-host schedule: the first
      // request on an idle host is immediate (historical behavior), and
      // concurrent endpoints against the same API share one schedule.
      await paceHost(new URL(url).host, rateLimitMs);

      const body = await fetchPage(url);
      const results = ep.getResults(body);
      if (!Array.isArray(results) || results.length === 0) break;

      const events: ChangeEvent[] = new Array(results.length);
      for (let i = 0; i < results.length; i++) {
        const row = results[i] as Record<string, unknown>;
        events[i] = { table, op: "snapshot", key: ep.keyFrom(row), row };
      }
      await emit(events);
      pagesSeen++;

      if (pagesSeen >= ep.maxPages) break;

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
  }

  return {
    id: config.id,
    mode: "batch" as const,

    async hydrate(ctx) {
      return hydrateFromEvents(ctx, (emit) => pullPages(ctx.source, emit));
    },

    async close() {},
    pullPages,
  };
}
