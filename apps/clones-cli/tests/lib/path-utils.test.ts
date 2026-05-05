import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertPathInsideBase,
  assertSafePathSegment,
  isSafePathSegment,
} from '../../src/lib/path-utils.js';

describe('path-utils', () => {
  describe('isSafePathSegment', () => {
    it('accepts common safe segments', () => {
      expect(isSafePathSegment('owner')).toBe(true);
      expect(isSafePathSegment('repo-name')).toBe(true);
      expect(isSafePathSegment('repo.name')).toBe(true);
    });

    it('rejects empty, dot, and dot-dot segments', () => {
      expect(isSafePathSegment('')).toBe(false);
      expect(isSafePathSegment('.')).toBe(false);
      expect(isSafePathSegment('..')).toBe(false);
    });

    it('rejects path separators and control characters', () => {
      expect(isSafePathSegment('owner/repo')).toBe(false);
      expect(isSafePathSegment('owner\\repo')).toBe(false);
      expect(isSafePathSegment('bad\nname')).toBe(false);
      expect(isSafePathSegment(`bad\u0000name`)).toBe(false);
    });
  });

  describe('assertSafePathSegment', () => {
    it('throws on unsafe segments', () => {
      expect(() => assertSafePathSegment('..', 'owner')).toThrow(/unsafe path segment/);
    });
  });

  describe('assertPathInsideBase', () => {
    it('accepts targets inside the base', () => {
      const base = join(tmpdir(), 'clones-base');
      const target = join(base, 'owner', 'repo');
      expect(() => assertPathInsideBase(base, target)).not.toThrow();
    });

    it('rejects targets outside the base', () => {
      const base = join(tmpdir(), 'clones-base');
      const target = join(tmpdir(), 'other');
      expect(() => assertPathInsideBase(base, target)).toThrow(/escapes base/);
    });
  });
});
