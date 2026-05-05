import { describe, it, expect } from 'vitest';
import { parseVersion, satisfiesEngineSpec, compareVersions, isNewerVersion } from './semver.js';

describe('semver', () => {
  describe('parseVersion', () => {
    it('parses valid semver strings', () => {
      const v = parseVersion('1.2.3');
      expect(v).not.toBeNull();
      expect(v?.major).toBe(1);
      expect(v?.minor).toBe(2);
      expect(v?.patch).toBe(3);
    });

    it('returns null for invalid semver', () => {
      expect(parseVersion('not-a-version')).toBeNull();
    });
  });

  describe('satisfiesEngineSpec', () => {
    it('returns true for wildcard spec', () => {
      expect(satisfiesEngineSpec('1.105.0', '*')).toBe(true);
    });

    it('handles caret range (^1.104.0)', () => {
      expect(satisfiesEngineSpec('1.104.0', '^1.104.0')).toBe(true);
      expect(satisfiesEngineSpec('1.105.0', '^1.104.0')).toBe(true);
      expect(satisfiesEngineSpec('1.103.0', '^1.104.0')).toBe(false);
      expect(satisfiesEngineSpec('2.0.0', '^1.104.0')).toBe(false);
    });

    it('handles exact version spec', () => {
      expect(satisfiesEngineSpec('1.104.0', '1.104.0')).toBe(true);
      expect(satisfiesEngineSpec('1.105.0', '1.104.0')).toBe(false);
    });

    it('handles range specs', () => {
      expect(satisfiesEngineSpec('1.105.0', '>=1.104.0')).toBe(true);
      expect(satisfiesEngineSpec('1.103.0', '>=1.104.0')).toBe(false);
    });

    it('returns false for invalid specs', () => {
      expect(satisfiesEngineSpec('1.104.0', 'invalid-spec!!')).toBe(false);
    });
  });

  describe('compareVersions', () => {
    it('compares versions correctly', () => {
      expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
      expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    });

    it('handles minor and patch differences', () => {
      expect(compareVersions('1.1.0', '1.2.0')).toBeLessThan(0);
      expect(compareVersions('1.1.1', '1.1.2')).toBeLessThan(0);
    });

    it('falls back to string comparison for invalid versions', () => {
      expect(compareVersions('abc', 'def')).toBeLessThan(0);
    });
  });

  describe('isNewerVersion', () => {
    it('returns true when candidate is newer', () => {
      expect(isNewerVersion('2.0.0', '1.0.0')).toBe(true);
      expect(isNewerVersion('1.1.0', '1.0.0')).toBe(true);
    });

    it('returns false when candidate is older or equal', () => {
      expect(isNewerVersion('1.0.0', '2.0.0')).toBe(false);
      expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    });
  });
});
