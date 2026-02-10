import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { syncRegistryToDb } from '../../src/lib/db-sync.js';
import type { Registry, RegistryEntry } from '../../src/types/index.js';

function createTestEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: 'github.com:owner/repo',
    host: 'github.com',
    owner: 'owner',
    repo: 'repo',
    cloneUrl: 'https://github.com/owner/repo.git',
    description: 'Test repo',
    tags: ['test'],
    defaultRemoteName: 'origin',
    updateStrategy: 'hard-reset',
    submodules: 'none',
    lfs: 'auto',
    managed: true,
    ...overrides,
  };
}

function createTestRegistry(entries: RegistryEntry[] = []): Registry {
  return {
    version: '1.0.0',
    repos: entries,
    tombstones: [],
  };
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE repos (
      id TEXT PRIMARY KEY,
      host TEXT NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      clone_url TEXT NOT NULL,
      description TEXT,
      tags TEXT NOT NULL,
      default_remote_name TEXT NOT NULL,
      update_strategy TEXT NOT NULL,
      submodules TEXT NOT NULL,
      lfs TEXT NOT NULL,
      managed INTEGER NOT NULL,
      content_hash TEXT,
      readme_indexed_at TEXT
    )
  `);
  return db;
}

describe('syncRegistryToDb', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  it('inserts new repos', () => {
    const entry = createTestEntry({
      id: 'github.com:user/repo1',
      owner: 'user',
      repo: 'repo1',
    });
    const registry = createTestRegistry([entry]);

    syncRegistryToDb(db, registry);

    const row = db.prepare('SELECT * FROM repos WHERE id = ?').get('github.com:user/repo1');
    expect(row).toBeDefined();
    expect(row?.host).toBe('github.com');
    expect(row?.owner).toBe('user');
    expect(row?.repo).toBe('repo1');
    expect(row?.managed).toBe(1);
    expect(JSON.parse(row?.tags as string)).toEqual(['test']);
  });

  it('updates existing repos', () => {
    const entry1 = createTestEntry({ id: 'github.com:user/repo1', description: 'Old desc' });
    const registry1 = createTestRegistry([entry1]);
    syncRegistryToDb(db, registry1);

    const entry2 = createTestEntry({
      id: 'github.com:user/repo1',
      description: 'New desc',
      tags: ['updated', 'test'],
    });
    const registry2 = createTestRegistry([entry2]);
    syncRegistryToDb(db, registry2);

    const row = db.prepare('SELECT * FROM repos WHERE id = ?').get('github.com:user/repo1');
    expect(row?.description).toBe('New desc');
    expect(JSON.parse(row?.tags as string)).toEqual(['updated', 'test']);
  });

  it('deletes stale repos', () => {
    const entry1 = createTestEntry({ id: 'github.com:user/repo1' });
    const entry2 = createTestEntry({ id: 'github.com:user/repo2' });
    const registry1 = createTestRegistry([entry1, entry2]);
    syncRegistryToDb(db, registry1);

    const registry2 = createTestRegistry([entry1]);
    syncRegistryToDb(db, registry2);

    const row2 = db.prepare('SELECT * FROM repos WHERE id = ?').get('github.com:user/repo2');
    expect(row2).toBeUndefined();

    const row1 = db.prepare('SELECT * FROM repos WHERE id = ?').get('github.com:user/repo1');
    expect(row1).toBeDefined();
  });

  it('is idempotent', () => {
    const entry = createTestEntry({ id: 'github.com:user/repo1' });
    const registry = createTestRegistry([entry]);

    syncRegistryToDb(db, registry);
    const row1 = db.prepare('SELECT * FROM repos WHERE id = ?').get('github.com:user/repo1');

    syncRegistryToDb(db, registry);
    const row2 = db.prepare('SELECT * FROM repos WHERE id = ?').get('github.com:user/repo1');

    expect(row1).toEqual(row2);
  });

  it('handles empty registry', () => {
    const entry = createTestEntry({ id: 'github.com:user/repo1' });
    const registry1 = createTestRegistry([entry]);
    syncRegistryToDb(db, registry1);

    const registry2 = createTestRegistry([]);
    syncRegistryToDb(db, registry2);

    const count = db.prepare('SELECT COUNT(*) as count FROM repos').get() as { count: number };
    expect(count.count).toBe(0);
  });

  it('stores managed as integer', () => {
    const entry1 = createTestEntry({ id: 'github.com:user/repo1', managed: true });
    const entry2 = createTestEntry({ id: 'github.com:user/repo2', managed: false });
    const registry = createTestRegistry([entry1, entry2]);

    syncRegistryToDb(db, registry);

    const row1 = db.prepare('SELECT managed FROM repos WHERE id = ?').get('github.com:user/repo1');
    const row2 = db.prepare('SELECT managed FROM repos WHERE id = ?').get('github.com:user/repo2');

    expect(row1?.managed).toBe(1);
    expect(row2?.managed).toBe(0);
  });
});
