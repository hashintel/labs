import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { listInstalledExtensions, getDisabledExtensions } from './extensions.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('./ide-registry.js', () => ({
  getSettingsPath: vi.fn((name: string) => `/mock/path/${name}/settings.json`),
}));

describe('extensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listInstalledExtensions', () => {
    it('parses CLI output correctly', () => {
      vi.mocked(execSync).mockReturnValue(
        'esbenp.prettier-vscode@10.1.0\nms-python.python@2024.0.1\n'
      );

      const extensions = listInstalledExtensions('code');
      expect(extensions).toHaveLength(2);
      expect(extensions[0]).toEqual({
        id: 'esbenp.prettier-vscode',
        version: '10.1.0',
        disabled: false,
      });
      expect(extensions[1]).toEqual({
        id: 'ms-python.python',
        version: '2024.0.1',
        disabled: false,
      });
    });

    it('lowercases extension IDs', () => {
      vi.mocked(execSync).mockReturnValue('EsbenP.Prettier-VSCode@10.1.0\n');

      const extensions = listInstalledExtensions('code');
      expect(extensions[0]?.id).toBe('esbenp.prettier-vscode');
    });

    it('skips lines without @', () => {
      vi.mocked(execSync).mockReturnValue('some-header\nesbenp.prettier-vscode@10.1.0\n');

      const extensions = listInstalledExtensions('code');
      expect(extensions).toHaveLength(1);
    });

    it('returns empty array on CLI error', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('CLI not found');
      });

      const extensions = listInstalledExtensions('nonexistent');
      expect(extensions).toEqual([]);
    });
  });

  describe('getDisabledExtensions', () => {
    it('returns empty set when settings file does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const disabled = getDisabledExtensions('Code');
      expect(disabled.size).toBe(0);
    });

    it('parses disabled extensions from settings', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          'extensions.disabled': ['esbenp.prettier-vscode', 'ms-python.python'],
        })
      );

      const disabled = getDisabledExtensions('Code');
      expect(disabled.size).toBe(2);
      expect(disabled.has('esbenp.prettier-vscode')).toBe(true);
      expect(disabled.has('ms-python.python')).toBe(true);
    });

    it('lowercases extension IDs', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          'extensions.disabled': ['EsbenP.Prettier-VSCode'],
        })
      );

      const disabled = getDisabledExtensions('Code');
      expect(disabled.has('esbenp.prettier-vscode')).toBe(true);
    });

    it('returns empty set on parse error', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('invalid json');

      const disabled = getDisabledExtensions('Code');
      expect(disabled.size).toBe(0);
    });

    it('returns empty set when extensions.disabled is missing', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({}));

      const disabled = getDisabledExtensions('Code');
      expect(disabled.size).toBe(0);
    });
  });
});
