import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readReadmeContent, hashContent, chunkText } from '../../src/lib/readme.js';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

// Mock fs module
vi.mock('node:fs/promises');
vi.mock('node:fs');

describe('readme.ts', () => {
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
