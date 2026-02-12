import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchExtensionMetadata, parseExtensionId, getVsixFilename } from './marketplace.js';

describe('marketplace', () => {
  describe('parseExtensionId', () => {
    it('parses publisher.name format', () => {
      const result = parseExtensionId('esbenp.prettier-vscode');
      expect(result.publisher).toBe('esbenp');
      expect(result.name).toBe('prettier-vscode');
    });
  });

  describe('getVsixFilename', () => {
    it('generates correct filename', () => {
      expect(getVsixFilename('esbenp.prettier-vscode', '10.1.0')).toBe(
        'esbenp.prettier-vscode-10.1.0.vsix'
      );
    });

    it('lowercases extension ID', () => {
      expect(getVsixFilename('EsbenP.Prettier-VSCode', '10.1.0')).toBe(
        'esbenp.prettier-vscode-10.1.0.vsix'
      );
    });
  });

  describe('fetchExtensionMetadata', () => {
    const mockFetch = vi.fn();
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      globalThis.fetch = mockFetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      mockFetch.mockReset();
    });

    it('returns null on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      const result = await fetchExtensionMetadata('test.extension');
      expect(result).toBeNull();
    });

    it('returns null on non-ok response', async () => {
      mockFetch.mockResolvedValue({ ok: false });
      const result = await fetchExtensionMetadata('test.extension');
      expect(result).toBeNull();
    });

    it('returns null when no extensions in response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [{ extensions: [] }] }),
      });
      const result = await fetchExtensionMetadata('test.extension');
      expect(result).toBeNull();
    });

    it('parses extension metadata correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              extensions: [
                {
                  publisher: { publisherName: 'testpub' },
                  extensionName: 'testname',
                  versions: [
                    {
                      version: '1.0.0',
                      properties: [
                        {
                          key: 'Microsoft.VisualStudio.Code.Engine',
                          value: '^1.104.0',
                        },
                      ],
                      files: [
                        {
                          assetType: 'Microsoft.VisualStudio.Services.VSIXPackage',
                          source: 'https://example.com/test.vsix',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      });

      const result = await fetchExtensionMetadata('testpub.testname');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('testpub.testname');
      expect(result?.publisher).toBe('testpub');
      expect(result?.name).toBe('testname');
      expect(result?.versions).toHaveLength(1);
      expect(result?.versions[0]?.version).toBe('1.0.0');
      expect(result?.versions[0]?.engineSpec).toBe('^1.104.0');
      expect(result?.versions[0]?.vsixUrl).toBe('https://example.com/test.vsix');
    });

    it('uses fallback URL when no VSIX file in response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              extensions: [
                {
                  publisher: { publisherName: 'testpub' },
                  extensionName: 'testname',
                  versions: [
                    {
                      version: '1.0.0',
                      properties: [],
                      files: [],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      });

      const result = await fetchExtensionMetadata('testpub.testname');
      expect(result?.versions[0]?.vsixUrl).toContain('testpub');
      expect(result?.versions[0]?.vsixUrl).toContain('testname');
      expect(result?.versions[0]?.vsixUrl).toContain('1.0.0');
    });

    it('defaults to * engine spec when property missing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              extensions: [
                {
                  publisher: { publisherName: 'testpub' },
                  extensionName: 'testname',
                  versions: [
                    {
                      version: '1.0.0',
                      properties: [],
                      files: [],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      });

      const result = await fetchExtensionMetadata('testpub.testname');
      expect(result?.versions[0]?.engineSpec).toBe('*');
    });
  });
});
