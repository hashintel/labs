import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqlDatabase } from '../../src/lib/sql-database.js';
import type { DbRepoRow } from '../../src/types/index.js';

// Mock the config module to use in-memory database for tests
vi.mock('../../src/lib/config.js', () => ({
  getDbPath: () => ':memory:',
  ensureConfigDir: vi.fn(),
}));

const {
  openDb,
  closeDb,
  getDb,
  upsertRepo,
  getRepo,
  getAllRepos,
  deleteRepo,
  updateRepoStatusCache,
} = await import('../../src/lib/db.js');

describe('Database Layer', () => {
  beforeEach(async () => {
    // Open a fresh in-memory database for each test
    await openDb();
  });

  afterEach(() => {
    closeDb();
  });

  describe('openDb and closeDb', () => {
    it('opens a database connection', async () => {
      const db = getDb();
      expect(db).toBeDefined();
      expect(db).toBeInstanceOf(SqlDatabase);
    });

    it('returns the same connection on subsequent calls', async () => {
      const db1 = getDb();
      const db2 = getDb();
      expect(db1).toBe(db2);
    });

    it('closes the database connection', () => {
      closeDb();
      expect(() => getDb()).toThrow('Database not open');
    });
  });

  describe('migrations', () => {
    it('creates the repos table', () => {
      const db = getDb();
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='repos'")
        .all();
      expect(tables).toHaveLength(1);
    });

    it('repos table has correct columns', () => {
      const db = getDb();
      const columns = db.prepare('PRAGMA table_info(repos)').all() as any[];
      const columnNames = columns.map((c) => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('host');
      expect(columnNames).toContain('owner');
      expect(columnNames).toContain('repo');
      expect(columnNames).toContain('cloneUrl');
      expect(columnNames).toContain('description');
      expect(columnNames).toContain('tags');
      expect(columnNames).toContain('defaultRemoteName');
      expect(columnNames).toContain('updateStrategy');
      expect(columnNames).toContain('submodules');
      expect(columnNames).toContain('lfs');
      expect(columnNames).toContain('managed');
      expect(columnNames).toContain('contentHash');
      expect(columnNames).toContain('readmeIndexedAt');
      expect(columnNames).toContain('statusExists');
      expect(columnNames).toContain('statusIsDirty');
      expect(columnNames).toContain('statusCheckedAt');
    });
  });

  describe('CRUD operations', () => {
    const testRepo: DbRepoRow = {
      id: 'github.com:test/repo',
      host: 'github.com',
      owner: 'test',
      repo: 'repo',
      cloneUrl: 'https://github.com/test/repo.git',
      description: 'A test repository',
      tags: ['test', 'example'],
      defaultRemoteName: 'origin',
      updateStrategy: 'hard-reset',
      submodules: 'none',
      lfs: 'auto',
      managed: true,
      contentHash: 'abc123',
      readmeIndexedAt: '2024-01-01T00:00:00Z',
    };

    it('inserts a repository', () => {
      upsertRepo(testRepo);
      const retrieved = getRepo(testRepo.id);
      expect(retrieved).toEqual(testRepo);
    });

    it('updates an existing repository', () => {
      upsertRepo(testRepo);
      const updated = { ...testRepo, description: 'Updated description' };
      upsertRepo(updated);
      const retrieved = getRepo(testRepo.id);
      expect(retrieved?.description).toBe('Updated description');
    });

    it('retrieves all repositories', () => {
      const repo1 = { ...testRepo, id: 'repo1' };
      const repo2 = { ...testRepo, id: 'repo2' };
      upsertRepo(repo1);
      upsertRepo(repo2);
      const all = getAllRepos();
      expect(all).toHaveLength(2);
      expect(all.map((r) => r.id)).toContain('repo1');
      expect(all.map((r) => r.id)).toContain('repo2');
    });

    it('deletes a repository', () => {
      upsertRepo(testRepo);
      deleteRepo(testRepo.id);
      const retrieved = getRepo(testRepo.id);
      expect(retrieved).toBeUndefined();
    });

    it('handles optional fields correctly', () => {
      const minimalRepo: DbRepoRow = {
        id: 'minimal',
        host: 'github.com',
        owner: 'test',
        repo: 'minimal',
        cloneUrl: 'https://github.com/test/minimal.git',
        defaultRemoteName: 'origin',
        updateStrategy: 'hard-reset',
        submodules: 'none',
        lfs: 'auto',
        managed: false,
      };
      upsertRepo(minimalRepo);
      const retrieved = getRepo('minimal');
      expect(retrieved).toEqual(minimalRepo);
      expect(retrieved?.description).toBeUndefined();
      expect(retrieved?.tags).toBeUndefined();
      expect(retrieved?.contentHash).toBeUndefined();
      expect(retrieved?.readmeIndexedAt).toBeUndefined();
      expect(retrieved?.statusExists).toBeUndefined();
      expect(retrieved?.statusIsDirty).toBeUndefined();
      expect(retrieved?.statusCheckedAt).toBeUndefined();
    });

    it('updates cached status fields', () => {
      upsertRepo(testRepo);
      updateRepoStatusCache(testRepo.id, { exists: true, isDirty: true }, '2026-02-22T12:00:00Z');
      const retrieved = getRepo(testRepo.id);
      expect(retrieved?.statusExists).toBe(true);
      expect(retrieved?.statusIsDirty).toBe(true);
      expect(retrieved?.statusCheckedAt).toBe('2026-02-22T12:00:00Z');
    });
  });
});
