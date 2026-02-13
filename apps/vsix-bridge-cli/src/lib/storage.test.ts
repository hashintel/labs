import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  getConfigDir,
  getCacheDir,
  getVsixCacheDir,
  getConfigPath,
  getStatePath,
} from './storage.js';

describe('storage', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getConfigDir', () => {
    it('uses XDG_CONFIG_HOME when set', () => {
      process.env.XDG_CONFIG_HOME = '/custom/config';
      expect(getConfigDir()).toBe('/custom/config/vsix-bridge');
    });

    it('falls back to ~/.config when XDG_CONFIG_HOME is not set', () => {
      delete process.env.XDG_CONFIG_HOME;
      expect(getConfigDir()).toBe(`${homedir()}/.config/vsix-bridge`);
    });
  });

  describe('getCacheDir', () => {
    beforeEach(() => {
      // Ensure no config exists so getCacheDir uses XDG default
      process.env.XDG_CONFIG_HOME = '/nonexistent-config';
    });

    it('uses XDG_CACHE_HOME when set', () => {
      process.env.XDG_CACHE_HOME = '/custom/cache';
      expect(getCacheDir()).toBe('/custom/cache/vsix-bridge');
    });

    it('falls back to ~/.cache when XDG_CACHE_HOME is not set', () => {
      delete process.env.XDG_CACHE_HOME;
      expect(getCacheDir()).toBe(`${homedir()}/.cache/vsix-bridge`);
    });

    it('uses cacheDir from config when present', () => {
      const tmpConfig = join(tmpdir(), `vsix-bridge-test-${Date.now()}`);
      const configDir = join(tmpConfig, 'vsix-bridge');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.json'),
        JSON.stringify({ cacheDir: '/custom/cache/from-config', version: 1 })
      );
      const orig = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = tmpConfig;
      try {
        expect(getCacheDir()).toBe('/custom/cache/from-config');
      } finally {
        process.env.XDG_CONFIG_HOME = orig;
      }
    });
  });

  describe('getVsixCacheDir', () => {
    it('returns IDE-specific cache directory', () => {
      process.env.XDG_CONFIG_HOME = '/nonexistent-config';
      process.env.XDG_CACHE_HOME = '/cache';
      expect(getVsixCacheDir('cursor')).toBe('/cache/vsix-bridge/cursor');
      expect(getVsixCacheDir('antigravity')).toBe('/cache/vsix-bridge/antigravity');
    });
  });

  describe('config and state paths', () => {
    it('returns correct config path', () => {
      process.env.XDG_CONFIG_HOME = '/config';
      expect(getConfigPath()).toBe('/config/vsix-bridge/config.json');
    });

    it('returns correct state path', () => {
      process.env.XDG_CONFIG_HOME = '/config';
      expect(getStatePath()).toBe('/config/vsix-bridge/state.json');
    });
  });
});
