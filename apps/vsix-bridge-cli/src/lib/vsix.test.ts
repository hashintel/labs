import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseVsixFilename, getVsixPath } from './vsix.js';

vi.mock('./storage.js', () => ({
  getVsixCacheDir: vi.fn((ideId: string) => `/mock/cache/${ideId}`),
  ensureDir: vi.fn(),
}));

vi.mock('./marketplace.js', () => ({
  getVsixFilename: vi.fn(
    (extensionId: string, version: string) => `${extensionId.toLowerCase()}-${version}.vsix`
  ),
}));

describe('vsix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseVsixFilename', () => {
    it('parses standard vsix filename', () => {
      const result = parseVsixFilename('esbenp.prettier-vscode-10.1.0.vsix');
      expect(result).toEqual({
        extensionId: 'esbenp.prettier-vscode',
        version: '10.1.0',
      });
    });

    it('handles versions with prerelease tags', () => {
      const result = parseVsixFilename('test.ext-1.0.0-beta.1.vsix');
      expect(result).toEqual({
        extensionId: 'test.ext',
        version: '1.0.0-beta.1',
      });
    });

    it('returns null for invalid filename', () => {
      expect(parseVsixFilename('invalid-file.txt')).toBeNull();
      expect(parseVsixFilename('no-version.vsix')).toBeNull();
    });

    it('handles extension IDs with multiple dots', () => {
      const result = parseVsixFilename('ms-python.vscode-pylance-2024.1.1.vsix');
      expect(result).toEqual({
        extensionId: 'ms-python.vscode-pylance',
        version: '2024.1.1',
      });
    });
  });

  describe('getVsixPath', () => {
    it('constructs correct path', () => {
      const path = getVsixPath('cursor', 'esbenp.prettier-vscode', '10.1.0');
      expect(path).toBe('/mock/cache/cursor/esbenp.prettier-vscode-10.1.0.vsix');
    });
  });
});
