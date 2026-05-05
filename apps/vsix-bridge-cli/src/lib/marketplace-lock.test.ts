import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  lockMarketplace,
  unlockMarketplace,
  getMarketplaceLockStatus,
  BLOCKED_URL,
} from './marketplace-lock.js';
import type { MarketplaceSettings } from '../types.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('./ide-registry.js', () => ({
  getSettingsPath: vi.fn((name: string) => `/mock/path/${name}/settings.json`),
}));

const fullSettings: MarketplaceSettings = {
  serviceUrlKey: 'windsurf.marketplaceExtensionGalleryServiceURL',
  itemUrlKey: 'windsurf.marketplaceGalleryItemURL',
};

const serviceOnlySettings: MarketplaceSettings = {
  serviceUrlKey: 'extensions.gallery.serviceUrl',
};

describe('marketplace-lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('lockMarketplace', () => {
    it('sets all marketplace keys for IDE with itemUrl', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ 'editor.fontSize': 14 }));

      lockMarketplace('Windsurf', fullSettings);

      expect(writeFileSync).toHaveBeenCalledOnce();
      const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0]![1] as string);
      expect(written['windsurf.marketplaceExtensionGalleryServiceURL']).toBe(BLOCKED_URL);
      expect(written['windsurf.marketplaceGalleryItemURL']).toBe(BLOCKED_URL);
      expect(written['extensions.autoCheckUpdates']).toBe(false);
      expect(written['extensions.autoUpdate']).toBe(false);
      expect(written['editor.fontSize']).toBe(14);
    });

    it('sets only serviceUrl for IDE without itemUrl', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({}));

      lockMarketplace('Cursor', serviceOnlySettings);

      const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0]![1] as string);
      expect(written['extensions.gallery.serviceUrl']).toBe(BLOCKED_URL);
      expect(written).not.toHaveProperty('windsurf.marketplaceGalleryItemURL');
      expect(written['extensions.autoCheckUpdates']).toBe(false);
      expect(written['extensions.autoUpdate']).toBe(false);
    });

    it('handles missing settings file', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      lockMarketplace('Windsurf', fullSettings);

      expect(writeFileSync).toHaveBeenCalledOnce();
      const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0]![1] as string);
      expect(written['windsurf.marketplaceExtensionGalleryServiceURL']).toBe(BLOCKED_URL);
    });
  });

  describe('unlockMarketplace', () => {
    it('removes all marketplace keys', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          'editor.fontSize': 14,
          'windsurf.marketplaceExtensionGalleryServiceURL': BLOCKED_URL,
          'windsurf.marketplaceGalleryItemURL': BLOCKED_URL,
          'extensions.autoCheckUpdates': false,
          'extensions.autoUpdate': false,
        })
      );

      unlockMarketplace('Windsurf', fullSettings);

      const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0]![1] as string);
      expect(written).not.toHaveProperty('windsurf.marketplaceExtensionGalleryServiceURL');
      expect(written).not.toHaveProperty('windsurf.marketplaceGalleryItemURL');
      expect(written).not.toHaveProperty('extensions.autoCheckUpdates');
      expect(written).not.toHaveProperty('extensions.autoUpdate');
      expect(written['editor.fontSize']).toBe(14);
    });

    it('removes only serviceUrl for IDE without itemUrl', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          'extensions.gallery.serviceUrl': BLOCKED_URL,
          'extensions.autoCheckUpdates': false,
          'extensions.autoUpdate': false,
        })
      );

      unlockMarketplace('Cursor', serviceOnlySettings);

      const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0]![1] as string);
      expect(written).not.toHaveProperty('extensions.gallery.serviceUrl');
      expect(written).not.toHaveProperty('extensions.autoCheckUpdates');
      expect(written).not.toHaveProperty('extensions.autoUpdate');
    });

    it('no-ops when settings file is missing', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      unlockMarketplace('Windsurf', fullSettings);

      expect(writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('getMarketplaceLockStatus', () => {
    it('returns locked when all conditions met (with itemUrl)', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          'windsurf.marketplaceExtensionGalleryServiceURL': BLOCKED_URL,
          'windsurf.marketplaceGalleryItemURL': BLOCKED_URL,
          'extensions.autoCheckUpdates': false,
          'extensions.autoUpdate': false,
        })
      );

      expect(getMarketplaceLockStatus('Windsurf', fullSettings)).toBe('locked');
    });

    it('returns locked when all conditions met (without itemUrl)', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          'extensions.gallery.serviceUrl': BLOCKED_URL,
          'extensions.autoCheckUpdates': false,
          'extensions.autoUpdate': false,
        })
      );

      expect(getMarketplaceLockStatus('Cursor', serviceOnlySettings)).toBe('locked');
    });

    it('returns unlocked when no conditions met', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ 'editor.fontSize': 14 }));

      expect(getMarketplaceLockStatus('Windsurf', fullSettings)).toBe('unlocked');
    });

    it('returns partial when some conditions met', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          'windsurf.marketplaceExtensionGalleryServiceURL': BLOCKED_URL,
          'extensions.autoUpdate': false,
        })
      );

      expect(getMarketplaceLockStatus('Windsurf', fullSettings)).toBe('partial');
    });

    it('returns unlocked when settings file is missing', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      expect(getMarketplaceLockStatus('Windsurf', fullSettings)).toBe('unlocked');
    });
  });
});
