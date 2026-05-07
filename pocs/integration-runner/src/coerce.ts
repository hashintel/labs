import type { Accessor, Row } from "@integrations/transform/pipeline.js";

export type CoercionFn = (column: string) => Accessor;

function parseSapDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s || s === "00000000" || s === "00.00.0000") return null;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s;
}

function parseSapTime(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s || s === "000000") return null;
  if (/^\d{6}$/.test(s)) return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
  return s;
}

function parseEuNumber(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

export const registry: Record<string, CoercionFn> = {
  date: (col) => (r: Row) => parseSapDate(r[col]),
  time: (col) => (r: Row) => parseSapTime(r[col]),
  boolean: (col) => (r: Row) => {
    const s = String(r[col] ?? "").trim().toUpperCase();
    return s === "X" || s === "TRUE" || s === "1";
  },
  number: (col) => (r: Row) => parseEuNumber(r[col]),
  integer: (col) => (r: Row) => {
    const n = parseEuNumber(r[col]);
    return n === null ? null : Math.trunc(n);
  },
  year: (col) => (r: Row) => {
    const s = String(r[col] ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isNaN(n) ? null : n;
  },
  nullable_number: (col) => (r: Row) => {
    const v = r[col];
    if (v == null) return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  },
  trim: (col) => (r: Row) => {
    const v = r[col];
    return typeof v === "string" ? v.trim() : v;
  },
};

export function resolveCoercion(name: string): CoercionFn {
  const fn = registry[name];
  if (!fn) throw new Error(`Unknown coercion "${name}". Available: ${Object.keys(registry).join(", ")}`);
  return fn;
}

export function resolveAccessor(yaml: string | { column: string; coerce: string }): Accessor {
  if (typeof yaml === "string") return yaml;
  return resolveCoercion(yaml.coerce)(yaml.column);
}
