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
      cloneUrl TEXT NOT NULL,
      description TEXT,
      tags TEXT,
      defaultRemoteName TEXT NOT NULL,
      updateStrategy TEXT NOT NULL,
      submodules TEXT NOT NULL,
      lfs TEXT NOT NULL,
      managed INTEGER NOT NULL,
      contentHash TEXT,
      readmeIndexedAt TEXT,
      statusExists INTEGER,
      statusIsDirty INTEGER,
      statusCheckedAt TEXT
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

  it('preserves cached status fields on re-sync', () => {
    const entry = createTestEntry({ id: 'github.com:user/repo1' });
    const registry = createTestRegistry([entry]);
    syncRegistryToDb(db, registry);

    db.prepare(
      `
        UPDATE repos
        SET statusExists = 1, statusIsDirty = 1, statusCheckedAt = '2026-02-22T12:00:00Z'
        WHERE id = ?
      `
    ).run('github.com:user/repo1');

    const updated = createTestEntry({ id: 'github.com:user/repo1', description: 'Updated desc' });
    syncRegistryToDb(db, createTestRegistry([updated]));

    const row = db.prepare('SELECT * FROM repos WHERE id = ?').get('github.com:user/repo1');
    expect(row?.description).toBe('Updated desc');
    expect(row?.statusExists).toBe(1);
    expect(row?.statusIsDirty).toBe(1);
    expect(row?.statusCheckedAt).toBe('2026-02-22T12:00:00Z');
  });
});
