import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  hasCacheDirs,
  agentsWithCacheDirs,
  inspectAgentCacheDirs,
  clearCacheDirs,
  formatBytes,
} from '../src/lib/cache.js';

function snapshotEnv(keys: string[]) {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of keys) snapshot[key] = process.env[key];
  return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('cache utilities', () => {
  const ENV_KEYS = ['HOME'];
  let envSnapshot: Record<string, string | undefined>;
  let tmpHome: string;

  beforeEach(async () => {
    envSnapshot = snapshotEnv(ENV_KEYS);
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agentprofiles-cache-test-'));
    process.env.HOME = tmpHome;
  });

  afterEach(async () => {
    restoreEnv(envSnapshot);
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  describe('hasCacheDirs', () => {
    it('returns true for opencode', () => {
      expect(hasCacheDirs('opencode')).toBe(true);
    });

    it('returns true for amp', () => {
      expect(hasCacheDirs('amp')).toBe(true);
    });

    it('returns false for claude', () => {
      expect(hasCacheDirs('claude')).toBe(false);
    });

    it('returns false for unknown agent', () => {
      expect(hasCacheDirs('nonexistent')).toBe(false);
    });
  });

  describe('agentsWithCacheDirs', () => {
    it('returns amp and opencode', () => {
      const agents = agentsWithCacheDirs();
      expect(agents).toContain('amp');
      expect(agents).toContain('opencode');
      expect(agents).not.toContain('claude');
      expect(agents).not.toContain('codex');
    });
  });

  describe('inspectAgentCacheDirs', () => {
    it('returns null for agent without cacheDirs', async () => {
      const result = await inspectAgentCacheDirs('claude');
      expect(result).toBeNull();
    });

    it('reports missing dirs correctly', async () => {
      const result = await inspectAgentCacheDirs('opencode');
      expect(result).not.toBeNull();
      expect(result!.safe[0]!.exists).toBe(false);
      expect(result!.safe[0]!.sizeBytes).toBe(0);
      expect(result!.optional[0]!.exists).toBe(false);
    });

    it('reports existing dirs with correct size', async () => {
      // Create the cache dir with some content
      const cacheDir = path.join(tmpHome, '.cache', 'opencode');
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(path.join(cacheDir, 'data.json'), '{"key":"value"}');

      const result = await inspectAgentCacheDirs('opencode');
      expect(result).not.toBeNull();
      expect(result!.safe[0]!.exists).toBe(true);
      expect(result!.safe[0]!.sizeBytes).toBeGreaterThan(0);
    });
  });

  describe('clearCacheDirs', () => {
    it('removes existing directories', async () => {
      const cacheDir = path.join(tmpHome, '.cache', 'opencode');
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(path.join(cacheDir, 'data.json'), 'test');

      const info = await inspectAgentCacheDirs('opencode');
      const results = await clearCacheDirs(info!.safe);

      expect(results[0]!.cleared).toBe(true);

      // Verify directory is gone
      await expect(fs.access(cacheDir)).rejects.toThrow();
    });

    it('handles missing directories gracefully', async () => {
      const info = await inspectAgentCacheDirs('opencode');
      const results = await clearCacheDirs(info!.safe);

      expect(results[0]!.cleared).toBe(false);
      expect(results[0]!.error).toBeUndefined();
    });
  });

  describe('formatBytes', () => {
    it('formats 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('formats bytes', () => {
      expect(formatBytes(500)).toBe('500 B');
    });

    it('formats kilobytes', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
    });

    it('formats megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    });

    it('formats gigabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    });

    it('formats fractional values', () => {
      expect(formatBytes(1536)).toBe('1.5 KB');
    });
  });

  describe('end-to-end: clear safe only, optional untouched', () => {
    it('clears safe dirs but leaves optional dirs intact', async () => {
      // Create both safe and optional dirs for opencode
      const safeDir = path.join(tmpHome, '.cache', 'opencode');
      const optionalDir = path.join(tmpHome, '.local', 'state', 'opencode');
      await fs.mkdir(safeDir, { recursive: true });
      await fs.mkdir(optionalDir, { recursive: true });
      await fs.writeFile(path.join(safeDir, 'cache.db'), 'cached');
      await fs.writeFile(path.join(optionalDir, 'history.json'), 'history');

      // Inspect
      const info = await inspectAgentCacheDirs('opencode');
      expect(info!.safe[0]!.exists).toBe(true);
      expect(info!.optional[0]!.exists).toBe(true);

      // Clear only safe dirs
      const results = await clearCacheDirs(info!.safe);
      expect(results[0]!.cleared).toBe(true);

      // Verify safe dir gone, optional still present
      await expect(fs.access(safeDir)).rejects.toThrow();
      const optionalContent = await fs.readFile(path.join(optionalDir, 'history.json'), 'utf-8');
      expect(optionalContent).toBe('history');
    });
  });
});
