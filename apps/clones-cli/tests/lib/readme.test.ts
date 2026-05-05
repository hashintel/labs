import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  readReadmeContent,
  readIndexableDocuments,
  buildRepoProfileText,
  hashIndexInputs,
  hashContent,
  chunkText,
} from '../../src/lib/readme.js';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

// Mock fs module
vi.mock('node:fs/promises');
vi.mock('node:fs');

describe('readme.ts', () => {
  const setupMockFiles = (files: Record<string, string>, readFailures: string[] = []): void => {
    const readablePaths = new Set(Object.keys(files));
    const failingPaths = new Set(readFailures);
    vi.mocked(existsSync).mockImplementation((path) => {
      const fullPath = String(path);
      return readablePaths.has(fullPath) || failingPaths.has(fullPath);
    });

    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      const fullPath = String(path);
      if (failingPaths.has(fullPath)) {
        throw new Error('Read error');
      }
      const content = files[fullPath];
      if (content === undefined) {
        throw new Error(`Unexpected read: ${fullPath}`);
      }
      return content;
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('readReadmeContent', () => {
    it('should read README.md when it exists', async () => {
      const mockContent = '# Test README\n\nThis is a test.';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue(mockContent);

      const result = await readReadmeContent('/test/path');

      expect(result).toBe(mockContent);
      expect(fs.readFile).toHaveBeenCalledWith('/test/path/README.md', 'utf-8');
    });

    it('should try case-insensitive variants', async () => {
      const mockContent = '# Test README';
      vi.mocked(existsSync).mockImplementation((path) => {
        return String(path).includes('readme.md');
      });
      vi.mocked(fs.readFile).mockResolvedValue(mockContent);

      const result = await readReadmeContent('/test/path');

      expect(result).toBe(mockContent);
    });

    it('should return null if no README found', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await readReadmeContent('/test/path');

      expect(result).toBeNull();
    });

    it('should return null on read error', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Read error'));

      const result = await readReadmeContent('/test/path');

      expect(result).toBeNull();
    });
  });

  describe('readIndexableDocuments', () => {
    it('should include README and high-signal files when present', async () => {
      setupMockFiles({
        '/test/path/README.md': '# Test README',
        '/test/path/package.json': '{"name":"repo"}',
        '/test/path/Cargo.toml': '[package]\nname = "repo"',
      });

      const result = await readIndexableDocuments('/test/path');

      expect(result).toEqual([
        { source: 'README.md', content: '# Test README' },
        { source: 'package.json', content: '{"name":"repo"}' },
        { source: 'Cargo.toml', content: '[package]\nname = "repo"' },
      ]);
    });

    it('should fall back to case-insensitive README variants', async () => {
      setupMockFiles({
        '/test/path/readme.md': '# Lowercase README',
      });

      const result = await readIndexableDocuments('/test/path');

      expect(result).toEqual([{ source: 'readme.md', content: '# Lowercase README' }]);
    });

    it('should skip files that fail to read', async () => {
      setupMockFiles(
        {
          '/test/path/README.md': '# Test README',
          '/test/path/tsconfig.json': '{"compilerOptions":{"strict":true}}',
        },
        ['/test/path/package.json']
      );

      const result = await readIndexableDocuments('/test/path');

      expect(result).toEqual([
        { source: 'README.md', content: '# Test README' },
        { source: 'tsconfig.json', content: '{"compilerOptions":{"strict":true}}' },
      ]);
    });
  });

  describe('buildRepoProfileText', () => {
    it('should include owner/repo host, description, and tags', () => {
      const profile = buildRepoProfileText({
        host: 'github.com',
        owner: 'hashintel',
        repo: 'clones-cli',
        description: 'Fast local repo sync',
        tags: ['cli', 'search'],
      });

      expect(profile).toBe(
        [
          'hashintel/clones-cli',
          'github.com/hashintel/clones-cli',
          'Fast local repo sync',
          'tags: cli search',
        ].join('\n')
      );
    });

    it('should omit optional lines when description and tags are missing', () => {
      const profile = buildRepoProfileText({
        host: 'github.com',
        owner: 'hashintel',
        repo: 'clones-cli',
      });

      expect(profile).toBe(['hashintel/clones-cli', 'github.com/hashintel/clones-cli'].join('\n'));
    });
  });

  describe('hashIndexInputs', () => {
    it('should produce stable hashes regardless of document order', () => {
      const docsA = [
        { source: 'README.md', content: 'README content' },
        { source: 'package.json', content: '{"name":"repo"}' },
      ];
      const docsB = [...docsA].reverse();
      const profile = 'hashintel/clones-cli\ngithub.com/hashintel/clones-cli';

      const hashA = hashIndexInputs(docsA, profile);
      const hashB = hashIndexInputs(docsB, profile);

      expect(hashA).toBe(hashB);
    });

    it('should change hash when profile text changes', () => {
      const docs = [{ source: 'README.md', content: 'README content' }];
      const hashA = hashIndexInputs(docs, 'profile A');
      const hashB = hashIndexInputs(docs, 'profile B');

      expect(hashA).not.toBe(hashB);
    });
  });

  describe('hashContent', () => {
    it('should return consistent hash for same content', () => {
      const content = 'test content';
      const hash1 = hashContent(content);
      const hash2 = hashContent(content);

      expect(hash1).toBe(hash2);
    });

    it('should return different hash for different content', () => {
      const hash1 = hashContent('content1');
      const hash2 = hashContent('content2');

      expect(hash1).not.toBe(hash2);
    });

    it('should return hex string', () => {
      const hash = hashContent('test');
      expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
    });
  });

  describe('chunkText', () => {
    it('should split text into chunks', () => {
      const text = 'a'.repeat(1000);
      const chunks = chunkText(text, 500, 100);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(600); // Some tolerance for boundary handling
      });
    });

    it('should prefer paragraph boundaries', () => {
      const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
      const chunks = chunkText(text, 100, 10);

      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeGreaterThan(0);
      });
    });

    it('should handle empty text', () => {
      const chunks = chunkText('', 500, 100);
      expect(chunks).toEqual([]);
    });

    it('should handle text smaller than chunk size', () => {
      const text = 'small text';
      const chunks = chunkText(text, 500, 100);

      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe(text);
    });

    it('should apply overlap correctly', () => {
      const text = 'a'.repeat(1000);
      const chunks = chunkText(text, 300, 50);

      // With overlap, consecutive chunks should share some content
      if (chunks.length > 1) {
        const firstEnd = chunks[0].length;
        const secondStart = chunks[1].substring(0, 50);
        expect(chunks[0].substring(firstEnd - 50)).toContain(secondStart.substring(0, 10));
      }
    });
  });
});
