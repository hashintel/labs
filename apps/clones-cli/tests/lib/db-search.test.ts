import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  ensureSearchTables,
  indexReadme,
  searchReadmes,
  searchRepos,
  clearAllChunks,
  sanitizeFtsQuery,
  rankReposByQuery,
  rankReposByVector,
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

  const insertRepo = (repoId: string, owner = 'owner', repo = 'repo') => {
    db.prepare(
      'INSERT INTO repos (id, host, owner, repo, cloneUrl, defaultRemoteName, updateStrategy, submodules, lfs, managed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      repoId,
      'github.com',
      owner,
      repo,
      `https://github.com/${owner}/${repo}.git`,
      'origin',
      'hard-reset',
      'none',
      'auto',
      1
    );
  };

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

    it('should create readme_embeddings table', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='readme_embeddings'")
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

    it('should insert semantic embeddings for each chunk', () => {
      const repoId = 'test-repo';
      const content = 'Build terminal tools with ergonomic prompts';
      const hash = hashContent(content);
      const chunks = chunkText(content, 20, 0);

      insertRepo(repoId);

      indexReadme(db, repoId, content, hash, chunks);

      const rows = db
        .prepare('SELECT chunk_index, embedding_json FROM readme_embeddings WHERE repo_id = ?')
        .all(repoId) as { chunk_index: number; embedding_json: string }[];

      expect(rows.length).toBe(chunks.length);
      rows.forEach((row) => {
        const parsed = JSON.parse(row.embedding_json);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBe(128);
      });
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

      const embeddingCount = db
        .prepare('SELECT COUNT(*) as count FROM readme_embeddings')
        .get() as {
        count: number;
      };
      expect(embeddingCount.count).toBe(0);
    });
  });

  describe('sanitizeFtsQuery', () => {
    it('should return empty string for empty input', () => {
      expect(sanitizeFtsQuery('')).toBe('');
    });

    it('should return empty string for whitespace-only input', () => {
      expect(sanitizeFtsQuery('   ')).toBe('');
    });

    it('should return empty string for falsy input', () => {
      expect(sanitizeFtsQuery(undefined as any)).toBe('');
    });

    it('should quote and add prefix * to single word', () => {
      expect(sanitizeFtsQuery('kubernetes')).toBe('"kubernetes"*');
    });

    it('should quote multiple words and add * only to last word', () => {
      expect(sanitizeFtsQuery('kubernetes deployment')).toBe('"kubernetes" "deployment"*');
    });

    it('should treat FTS5 keyword OR as literal when quoted', () => {
      expect(sanitizeFtsQuery('OR')).toBe('"OR"*');
    });

    it('should treat FTS5 keyword AND as literal when quoted', () => {
      expect(sanitizeFtsQuery('AND')).toBe('"AND"*');
    });

    it('should treat FTS5 keyword NOT as literal when quoted', () => {
      expect(sanitizeFtsQuery('NOT')).toBe('"NOT"*');
    });

    it('should treat FTS5 keyword NEAR as literal when quoted', () => {
      expect(sanitizeFtsQuery('NEAR')).toBe('"NEAR"*');
    });

    it('should escape embedded double quotes by doubling them', () => {
      expect(sanitizeFtsQuery('say "hello"')).toBe('"say" """hello"""*');
    });

    it('should keep tokens containing letters even with punctuation like c++', () => {
      expect(sanitizeFtsQuery('c++')).toBe('"c++"*');
    });

    it('should return empty string for pure punctuation input', () => {
      expect(sanitizeFtsQuery('++')).toBe('');
      expect(sanitizeFtsQuery('( )')).toBe('');
      expect(sanitizeFtsQuery(':')).toBe('');
    });

    it('should strip user-supplied asterisks', () => {
      expect(sanitizeFtsQuery('test*')).toBe('"test"*');
      expect(sanitizeFtsQuery('te*st')).toBe('"test"*');
    });

    it('should preserve dashes inside quotes', () => {
      expect(sanitizeFtsQuery('my-repo')).toBe('"my-repo"*');
    });

    it('should preserve caret with letters inside quotes', () => {
      expect(sanitizeFtsQuery('^prefix')).toBe('"^prefix"*');
    });

    it('should trim leading and trailing whitespace', () => {
      expect(sanitizeFtsQuery('  hello  world  ')).toBe('"hello" "world"*');
    });

    it('should handle single character input', () => {
      expect(sanitizeFtsQuery('a')).toBe('"a"*');
    });

    it('should have prefix * outside quotes (regression guard)', () => {
      const result = sanitizeFtsQuery('test');
      expect(result).toMatch(/"test"\*/);
      expect(result).not.toMatch(/"test\*"/);
    });
  });

  describe('rankReposByVector', () => {
    it('should return empty Map for empty query', () => {
      const result = rankReposByVector(db, '');
      expect(result).toEqual(new Map());
    });

    it('should return vector scores for semantically similar content', () => {
      const repoA = 'repo-a';
      const repoB = 'repo-b';
      insertRepo(repoA, 'owner', 'prompts');
      insertRepo(repoB, 'owner', 'vision');

      const contentA = 'Interactive terminal prompt toolkit for command line applications';
      const contentB = 'Computer vision dataset and model training guide';

      indexReadme(db, repoA, contentA, hashContent(contentA), chunkText(contentA, 200, 0));
      indexReadme(db, repoB, contentB, hashContent(contentB), chunkText(contentB, 200, 0));

      const result = rankReposByVector(db, 'terminal prompts for cli', 10);
      const ranked = [...result.entries()];

      expect(ranked.length).toBeGreaterThan(0);
      expect(ranked[0][0]).toBe(repoA);
      expect(ranked[0][1]).toBeGreaterThan(0);
    });
  });

  describe('searchRepos', () => {
    it('should support bm25 mode with explain metadata', () => {
      const repoId = 'repo-bm25';
      insertRepo(repoId, 'owner', 'bm25');

      const content = 'A kubernetes deployment checklist for production rollouts';
      indexReadme(db, repoId, content, hashContent(content), chunkText(content, 200, 0));

      const results = searchRepos(db, 'kubernetes deployment', {
        mode: 'bm25',
        limit: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].repoId).toBe(repoId);
      expect(results[0].explain.bm25Rank).toBeDefined();
      expect(results[0].explain.vectorRank).toBeUndefined();
    });

    it('should support vector mode with explain metadata', () => {
      const repoId = 'repo-vector';
      insertRepo(repoId, 'owner', 'vector');

      const content = 'Build polished terminal prompts and command line flows';
      indexReadme(db, repoId, content, hashContent(content), chunkText(content, 200, 0));

      const results = searchRepos(db, 'terminal prompts', {
        mode: 'vector',
        limit: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].repoId).toBe(repoId);
      expect(results[0].explain.vectorRank).toBeDefined();
      expect(results[0].explain.bm25Rank).toBeUndefined();
    });

    it('should support hybrid mode with optional rerank', () => {
      const repoA = 'repo-hybrid-a';
      const repoB = 'repo-hybrid-b';
      insertRepo(repoA, 'owner', 'hybrid-a');
      insertRepo(repoB, 'owner', 'hybrid-b');

      const contentA = 'Command line prompts and terminal interface recipes';
      const contentB = 'Prompt engineering notes for language models';

      indexReadme(db, repoA, contentA, hashContent(contentA), chunkText(contentA, 200, 0));
      indexReadme(db, repoB, contentB, hashContent(contentB), chunkText(contentB, 200, 0));

      const results = searchRepos(db, 'prompt terminal', {
        mode: 'hybrid',
        blend: 0.6,
        rerankTop: 5,
        limit: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].explain.rrfScore).toBeGreaterThan(0);
      expect(results[0].explain.rerankScore).toBeDefined();
    });
  });

  describe('rankReposByQuery', () => {
    it('should return empty Map for empty query', () => {
      const result = rankReposByQuery(db, '');
      expect(result).toEqual(new Map());
    });

    it('should return empty Map for whitespace-only query', () => {
      const result = rankReposByQuery(db, '   ');
      expect(result).toEqual(new Map());
    });

    it('should return empty Map for no matches', () => {
      const repoId = 'test-repo';
      const content = 'This is test content about kubernetes';
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

      const result = rankReposByQuery(db, 'nonexistent');
      expect(result).toEqual(new Map());
    });

    it('should return Map with repo ID and negative rank for matching query', () => {
      const repoId = 'test-repo';
      const content = 'This is test content about kubernetes deployment';
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

      const result = rankReposByQuery(db, 'kubernetes');
      expect(result.has(repoId)).toBe(true);
      expect(result.get(repoId)).toBeLessThan(0);
    });

    it('should handle invalid FTS5 syntax without throwing', () => {
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

      const result = rankReposByQuery(db, '""');
      expect(result).toEqual(new Map());
    });

    it('should handle unclosed quotes without throwing', () => {
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

      const result = rankReposByQuery(db, '"unclosed');
      expect(result).toEqual(new Map());
    });
  });
});
