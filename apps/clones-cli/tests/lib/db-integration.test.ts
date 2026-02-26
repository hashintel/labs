import { describe, it, expect, beforeEach } from 'vitest';
import { SqlDatabase } from '../../src/lib/sql-database.js';
import { syncRegistryToDb } from '../../src/lib/db-sync.js';
import { ensureSearchTables, indexReadme, searchReadmes } from '../../src/lib/db-search.js';
import { chunkText, hashContent } from '../../src/lib/readme.js';
import type { Registry, RegistryEntry } from '../../src/types/index.js';

/**
 * Integration test: db-sync + db-search working together
 * Verifies that the three modules work correctly when integrated
 */
describe('db-sync + db-search integration', () => {
  let db: SqlDatabase;

  beforeEach(async () => {
    db = await SqlDatabase.open(':memory:');

    // Create repos table using the exact schema from db.ts
    db.exec(`
      CREATE TABLE IF NOT EXISTS repos (
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

    // Create search tables
    ensureSearchTables(db);
  });

  it('should sync registry, then index and search READMEs', () => {
    // Step 1: Create a registry entry
    const entry: RegistryEntry = {
      id: 'github.com:test/repo',
      host: 'github.com',
      owner: 'test',
      repo: 'repo',
      cloneUrl: 'https://github.com/test/repo.git',
      description: 'Test repository',
      tags: ['test', 'integration'],
      defaultRemoteName: 'origin',
      updateStrategy: 'hard-reset',
      submodules: 'none',
      lfs: 'auto',
      managed: true,
    };

    const registry: Registry = {
      version: '1.0.0',
      repos: [entry],
      tombstones: [],
    };

    // Step 2: Sync registry to DB
    syncRegistryToDb(db, registry);

    // Verify row is readable
    const row = db.prepare('SELECT * FROM repos WHERE id = ?').get('github.com:test/repo');
    expect(row).toBeDefined();
    expect(row?.owner).toBe('test');
    expect(row?.repo).toBe('repo');
    expect(row?.contentHash).toBeNull();
    expect(row?.readmeIndexedAt).toBeNull();

    // Step 3: Index a README
    const readmeContent = 'This is a test README with important information about the project';
    const contentHash = hashContent(readmeContent);
    const chunks = chunkText(readmeContent, 100, 10);

    indexReadme(db, 'github.com:test/repo', readmeContent, contentHash, chunks);

    // Verify chunks were inserted
    const chunkCount = db
      .prepare('SELECT COUNT(*) as count FROM readme_chunks WHERE repo_id = ?')
      .get('github.com:test/repo') as { count: number };
    expect(chunkCount.count).toBe(chunks.length);

    // Step 4: Search READMEs
    const results = searchReadmes(db, 'important', 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].repoId).toBe('github.com:test/repo');
    expect(results[0].owner).toBe('test');
    expect(results[0].repo).toBe('repo');

    // Step 5: Verify contentHash/readmeIndexedAt preservation on re-sync
    // Re-sync the registry (should NOT wipe out contentHash/readmeIndexedAt)
    syncRegistryToDb(db, registry);

    const rowAfterResync = db
      .prepare('SELECT * FROM repos WHERE id = ?')
      .get('github.com:test/repo');
    expect(rowAfterResync?.contentHash).toBeNull(); // Still null (not set by sync)
    expect(rowAfterResync?.readmeIndexedAt).toBeNull(); // Still null (not set by sync)
  });
});
