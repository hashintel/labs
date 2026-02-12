import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import {
  getIDEConfigs,
  getVSCodeConfig,
  getProductJsonPath,
  getSettingsPath,
} from './ide-registry.js';

describe('ide-registry', () => {
  describe('getIDEConfigs', () => {
    it('returns array of IDE configurations', () => {
      const configs = getIDEConfigs();
      expect(Array.isArray(configs)).toBe(true);
      expect(configs.length).toBeGreaterThan(0);
    });

    it('includes expected IDEs', () => {
      const configs = getIDEConfigs();
      const ids = configs.map((c) => c.id);
      expect(ids).toContain('cursor');
      expect(ids).toContain('antigravity');
      expect(ids).toContain('windsurf');
    });

    it('has correct structure for each IDE', () => {
      const configs = getIDEConfigs();
      for (const config of configs) {
        expect(config).toHaveProperty('id');
        expect(config).toHaveProperty('name');
        expect(config).toHaveProperty('cli');
        expect(config).toHaveProperty('appPath');
        expect(config).toHaveProperty('engineVersionKey');
        expect(config).toHaveProperty('dataFolderName');
      }
    });
  });

  describe('getVSCodeConfig', () => {
    it('returns VS Code configuration', () => {
      const config = getVSCodeConfig();
      expect(config.id).toBe('vscode');
      expect(config.cli).toBe('code');
    });
  });

  describe('getProductJsonPath', () => {
    it('returns correct path for macOS app bundle', () => {
      const path = getProductJsonPath('/Applications/Cursor.app');
      expect(path).toBe('/Applications/Cursor.app/Contents/Resources/app/product.json');
    });
  });

  describe('getSettingsPath', () => {
    it('returns correct settings path for IDE', () => {
      const path = getSettingsPath('Cursor');
      expect(path).toBe(`${homedir()}/Library/Application Support/Cursor/User/settings.json`);
    });

    it('handles VS Code data folder name', () => {
      const path = getSettingsPath('Code');
      expect(path).toBe(`${homedir()}/Library/Application Support/Code/User/settings.json`);
    });
  });

  describe('IDE config correctness', () => {
    it('cursor uses vscodeVersion key', () => {
      const configs = getIDEConfigs();
      const cursor = configs.find((c) => c.id === 'cursor');
      expect(cursor?.engineVersionKey).toBe('vscodeVersion');
    });

    it('antigravity uses version key', () => {
      const configs = getIDEConfigs();
      const agy = configs.find((c) => c.id === 'antigravity');
      expect(agy?.engineVersionKey).toBe('version');
    });

    it('windsurf uses version key and surf CLI', () => {
      const configs = getIDEConfigs();
      const windsurf = configs.find((c) => c.id === 'windsurf');
      expect(windsurf?.engineVersionKey).toBe('version');
      expect(windsurf?.cli).toBe('surf');
    });
  });
});
