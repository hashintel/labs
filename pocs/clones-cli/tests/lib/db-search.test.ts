import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  ensureSearchTables,
  indexReadme,
  searchReadmes,
  clearAllChunks,
} from '../../src/lib/db-search.js';
import { chunkText, hashContent } from '../../src/lib/readme.js';

describe('db-search.ts', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');

    // Create repos table matching db.ts schema exactly
    db.exec(`
      CREATE TABLE repos (
        id TEXT PRIMARY KEY,
        host TEXT NOT NULL,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        cloneUrl TEXT NOT NULL,
        description TEXT,
        tags TEXT,
        defaultRemoteName TEXT NOT NULL,
        updateStrategy TEXT NOT NULL,
        submodules TEXT NOT NULL,
        lfs TEXT NOT NULL,
        managed INTEGER NOT NULL,
        contentHash TEXT,
        readmeIndexedAt TEXT
      )
    `);

    // Create search tables
    ensureSearchTables(db);
  });

  describe('ensureSearchTables', () => {
    it('should create readme_chunks table', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='readme_chunks'")
        .all();
      expect(tables.length).toBe(1);
    });

    it('should create readme_fts virtual table', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='readme_fts'")
        .all();
      expect(tables.length).toBe(1);
    });

    it('should be idempotent', () => {
      ensureSearchTables(db);
      ensureSearchTables(db);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='readme_chunks'")
        .all();
      expect(tables.length).toBe(1);
    });
  });

  describe('indexReadme', () => {
    it('should insert chunks for a repository', () => {
      const repoId = 'test-repo';
      const content = 'Test content for indexing';
      const hash = hashContent(content);
      const chunks = chunkText(content, 100, 10);

      // Insert test repo
      db.prepare(
        'INSERT INTO repos (id, host, owner, repo, cloneUrl, defaultRemoteName, updateStrategy, submodules, lfs, managed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        repoId,
        'github.com',
        'owner',
        'repo',
        'https://github.com/owner/repo.git',
        'origin',
        'hard-reset',
        'none',
        'auto',
        1
      );

      indexReadme(db, repoId, content, hash, chunks);

      const stored = db.prepare('SELECT * FROM readme_chunks WHERE repo_id = ?').all(repoId);
      expect(stored.length).toBe(chunks.length);
    });

    it('should skip indexing if content hash matches', () => {
      const repoId = 'test-repo';
      const content = 'Test content';
      const hash = hashContent(content);
      const chunks = chunkText(content, 100, 10);

      db.prepare(
        'INSERT INTO repos (id, host, owner, repo, cloneUrl, defaultRemoteName, updateStrategy, submodules, lfs, managed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        repoId,
        'github.com',
        'owner',
        'repo',
        'https://github.com/owner/repo.git',
        'origin',
        'hard-reset',
        'none',
        'auto',
        1
      );

      // Index once
      indexReadme(db, repoId, content, hash, chunks);
      const firstCount = db
        .prepare('SELECT COUNT(*) as count FROM readme_chunks WHERE repo_id = ?')
        .get(repoId) as { count: number };

      // Index again with same hash
      indexReadme(db, repoId, content, hash, chunks);
      const secondCount = db
        .prepare('SELECT COUNT(*) as count FROM readme_chunks WHERE repo_id = ?')
        .get(repoId) as { count: number };

      expect(firstCount.count).toBe(secondCount.count);
    });

    it('should replace chunks on content change', () => {
      const repoId = 'test-repo';
      const content1 = 'First content';
      const content2 = 'Second content with more text';
      const hash1 = hashContent(content1);
      const hash2 = hashContent(content2);
      const chunks1 = chunkText(content1, 100, 10);
      const chunks2 = chunkText(content2, 100, 10);

      db.prepare(
        'INSERT INTO repos (id, host, owner, repo, cloneUrl, defaultRemoteName, updateStrategy, submodules, lfs, managed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        repoId,
        'github.com',
        'owner',
        'repo',
        'https://github.com/owner/repo.git',
        'origin',
        'hard-reset',
        'none',
        'auto',
        1
      );

      indexReadme(db, repoId, content1, hash1, chunks1);
      indexReadme(db, repoId, content2, hash2, chunks2);

      const stored = db.prepare('SELECT * FROM readme_chunks WHERE repo_id = ?').all(repoId);
      expect(stored.length).toBe(chunks2.length);
    });
  });

  describe('searchReadmes', () => {
    it('should search indexed content', () => {
      const repoId = 'test-repo';
      const content = 'This is a test README with important information';
      const hash = hashContent(content);
      const chunks = chunkText(content, 100, 10);

      db.prepare(
        'INSERT INTO repos (id, host, owner, repo, cloneUrl, defaultRemoteName, updateStrategy, submodules, lfs, managed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        repoId,
        'github.com',
        'owner',
        'repo',
        'https://github.com/owner/repo.git',
        'origin',
        'hard-reset',
        'none',
        'auto',
        1
      );

      indexReadme(db, repoId, content, hash, chunks);

      const results = searchReadmes(db, 'test', 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].repoId).toBe(repoId);
    });

    it('should return empty results for no matches', () => {
      const results = searchReadmes(db, 'nonexistent', 10);
      expect(results).toEqual([]);
    });

    it('should respect limit parameter', () => {
      const repoId = 'test-repo';
      const content = 'test content test content test content';
      const hash = hashContent(content);
      const chunks = chunkText(content, 50, 10);

      db.prepare(
        'INSERT INTO repos (id, host, owner, repo, cloneUrl, defaultRemoteName, updateStrategy, submodules, lfs, managed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        repoId,
        'github.com',
        'owner',
        'repo',
        'https://github.com/owner/repo.git',
        'origin',
        'hard-reset',
        'none',
        'auto',
        1
      );

      indexReadme(db, repoId, content, hash, chunks);

      const results = searchReadmes(db, 'test', 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  describe('clearAllChunks', () => {
    it('should delete all chunks', () => {
      const repoId = 'test-repo';
      const content = 'Test content';
      const hash = hashContent(content);
      const chunks = chunkText(content, 100, 10);

      db.prepare(
        'INSERT INTO repos (id, host, owner, repo, cloneUrl, defaultRemoteName, updateStrategy, submodules, lfs, managed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        repoId,
        'github.com',
        'owner',
        'repo',
        'https://github.com/owner/repo.git',
        'origin',
        'hard-reset',
        'none',
        'auto',
        1
      );

      indexReadme(db, repoId, content, hash, chunks);

      clearAllChunks(db);

      const count = db.prepare('SELECT COUNT(*) as count FROM readme_chunks').get() as {
        count: number;
      };
      expect(count.count).toBe(0);
    });
  });
});
