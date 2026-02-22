import type Database from 'better-sqlite3';
import type { Registry } from '../types/index.js';

/**
 * Sync registry entries to the SQLite database.
 * Upserts all repos by id, removes rows not in registry.
 * This is a one-way sync: registry.toml is the source of truth.
 */
export function syncRegistryToDb(db: Database.Database, registry: Registry): void {
  const stmt = db.prepare(`
    INSERT INTO repos (
      id, host, owner, repo, cloneUrl, description, tags,
      defaultRemoteName, updateStrategy, submodules, lfs, managed,
      contentHash, readmeIndexedAt, statusExists, statusIsDirty, statusCheckedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)
    ON CONFLICT(id) DO UPDATE SET
      host = excluded.host,
      owner = excluded.owner,
      repo = excluded.repo,
      cloneUrl = excluded.cloneUrl,
      description = excluded.description,
      tags = excluded.tags,
      defaultRemoteName = excluded.defaultRemoteName,
      updateStrategy = excluded.updateStrategy,
      submodules = excluded.submodules,
      lfs = excluded.lfs,
      managed = excluded.managed
  `);

  const transaction = db.transaction(() => {
    // Upsert all repos from registry
    for (const entry of registry.repos) {
      stmt.run(
        entry.id,
        entry.host,
        entry.owner,
        entry.repo,
        entry.cloneUrl,
        entry.description ?? null,
        entry.tags ? JSON.stringify(entry.tags) : JSON.stringify([]),
        entry.defaultRemoteName,
        entry.updateStrategy,
        entry.submodules,
        entry.lfs,
        entry.managed ? 1 : 0
      );
    }

    // Delete rows not in registry
    const registryIds = registry.repos.map((e) => e.id);
    if (registryIds.length > 0) {
      const placeholders = registryIds.map(() => '?').join(',');
      const deleteStmt = db.prepare(`DELETE FROM repos WHERE id NOT IN (${placeholders})`);
      deleteStmt.run(...registryIds);
    } else {
      // If registry is empty, delete all repos
      db.prepare('DELETE FROM repos').run();
    }
  });

  transaction();
}
