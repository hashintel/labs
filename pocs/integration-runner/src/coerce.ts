import type { Accessor, Row, VersionedUrl } from "@integrations/transform/pipeline.js";
import { typedValue } from "@integrations/graph/types.js";

export type CoercionFn = (column: string) => Accessor;

const RE_ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const RE_DMY = /^(\d{2})[./](\d{2})[./](\d{4})$/;
const RE_MDY = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const RE_PACKED8 = /^\d{8}$/;
const RE_YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const RE_PACKED6 = /^\d{6}$/;
const RE_HMS = /^\d{2}:\d{2}:\d{2}$/;
const RE_HMS_FRAC = /^\d{2}:\d{2}:\d{2}\.\d+$/;
const RE_TZ_SUFFIX = /[Zz+\-]/;
const RE_EU_NUMBER = /,/;
const RE_DOT_G = /\./g;

function coerceDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;

  let result: string | null = null;

  if (RE_ISO_DATE.test(s)) result = s.slice(0, 10);

  if (!result) {
    const dmy = RE_DMY.exec(s);
    if (dmy) {
      if (dmy[1] === "00" || dmy[2] === "00" || dmy[3] === "0000") return null;
      result = `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    }
  }

  if (!result) {
    const mdy = RE_MDY.exec(s);
    if (mdy) {
      if (mdy[1] === "00" || mdy[2] === "00" || mdy[3] === "0000") return null;
      result = `${mdy[3]}-${mdy[1]}-${mdy[2]}`;
    }
  }

  if (!result && RE_PACKED8.test(s)) {
    if (s === "00000000") return null;
    result = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }

  if (!result || !RE_YYYY_MM_DD.test(result)) return null;
  return result;
}

function coerceTime(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s || s === "000000") return null;

  let t = s;
  if (RE_PACKED6.test(t)) t = `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
  if (RE_HMS.test(t)) t += "+00:00";
  else if (RE_HMS_FRAC.test(t) && !RE_TZ_SUFFIX.test(t.slice(-6))) t += "+00:00";

  return t;
}

function coerceNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return null;

  if (RE_EU_NUMBER.test(s) && s.indexOf(",") > s.lastIndexOf(".")) {
    const n = Number(s.replace(RE_DOT_G, "").replace(",", "."));
    return Number.isNaN(n) ? null : n;
  }

  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

function coerceBoolean(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toUpperCase();
  return s === "X" || s === "TRUE" || s === "1" || s === "YES" || s === "Y";
}

export const registry: Record<string, CoercionFn> = {
  date: (col) => (r: Row) => coerceDate(r[col]),
  time: (col) => (r: Row) => coerceTime(r[col]),
  boolean: (col) => (r: Row) => coerceBoolean(r[col]),
  number: (col) => (r: Row) => coerceNumber(r[col]),
  integer: (col) => (r: Row) => {
    const n = coerceNumber(r[col]);
    return n === null ? null : Math.trunc(n);
  },
  year: (col) => (r: Row) => {
    const s = String(r[col] ?? "").trim();
    if (!s) return null;
    const n = Number(s);
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

export function measureAccessor(amount: string, unit: string, unitMap: Record<string, string>): Accessor {
  return (r: Row) => {
    const n = coerceNumber(r[amount]);
    if (n === null) return null;
    const code = String(r[unit] ?? "").trim();
    const dataTypeId = unitMap[code] ?? unitMap["*"];
    return dataTypeId ? typedValue(n, dataTypeId as VersionedUrl) : n;
  };
}
