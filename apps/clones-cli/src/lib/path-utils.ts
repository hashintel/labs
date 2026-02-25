import { relative, resolve } from 'node:path';

function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code !== undefined && (code < 32 || code === 127)) {
      return true;
    }
  }
  return false;
}

export function isSafePathSegment(segment: string): boolean {
  if (!segment) return false;
  if (segment === '.' || segment === '..') return false;
  if (segment.includes('/') || segment.includes('\\')) return false;
  if (hasControlChars(segment)) return false;
  return true;
}

export function assertSafePathSegment(segment: string, label: string): void {
  if (isSafePathSegment(segment)) return;
  throw new Error(`Invalid ${label}: unsafe path segment`);
}

export function assertPathInsideBase(base: string, target: string): void {
  const resolvedBase = resolve(base);
  const resolvedTarget = resolve(target);
  const rel = relative(resolvedBase, resolvedTarget);

  if (!rel || (!rel.startsWith('..') && rel !== '..')) {
    return;
  }

  throw new Error(`Invalid path: target escapes base directory`);
}
