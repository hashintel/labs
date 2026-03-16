import { SqlDatabase } from './sql-database.js';
import { getDbPath, ensureConfigDir } from './config.js';
import type { DbRepoRow, RepoStatus } from '../types/index.js';

let db: SqlDatabase | null = null;

/**
 * Open or create the SQLite database
 * Runs migrations
 */
export async function openDb(): Promise<SqlDatabase> {
  if (db) return db;

  await ensureConfigDir();
  const dbPath = getDbPath();

  db = await SqlDatabase.open(dbPath);

  // Run migrations
  migrate();

  return db;
}

/**
 * Close the database connection
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Get the current database connection
 * Throws if database is not open
 */
export function getDb(): SqlDatabase {
  if (!db) {
    throw new Error('Database not open. Call openDb() first.');
  }
  return db;
}

/**
 * Run database migrations
 */
function migrate(): void {
  if (!db) throw new Error('Database not open');

  // Create repos table if it doesn't exist
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

  // Backfill columns for existing databases from older schema versions.
  ensureReposColumn('contentHash', 'TEXT');
  ensureReposColumn('readmeIndexedAt', 'TEXT');
  ensureReposColumn('statusExists', 'INTEGER');
  ensureReposColumn('statusIsDirty', 'INTEGER');
  ensureReposColumn('statusCheckedAt', 'TEXT');
}

function ensureReposColumn(columnName: string, columnType: string): void {
  if (!db) throw new Error('Database not open');

  const columns = db.prepare('PRAGMA table_info(repos)').all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE repos ADD COLUMN ${columnName} ${columnType}`);
}

/**
 * Insert or replace a repository in the database
 */
export function upsertRepo(repo: DbRepoRow): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO repos (
      id, host, owner, repo, cloneUrl, description, tags,
      defaultRemoteName, updateStrategy, submodules, lfs, managed,
      contentHash, readmeIndexedAt, statusExists, statusIsDirty, statusCheckedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    repo.id,
    repo.host,
    repo.owner,
    repo.repo,
    repo.cloneUrl,
    repo.description ?? null,
    repo.tags ? JSON.stringify(repo.tags) : null,
    repo.defaultRemoteName,
    repo.updateStrategy,
    repo.submodules,
    repo.lfs,
    repo.managed ? 1 : 0,
    repo.contentHash ?? null,
    repo.readmeIndexedAt ?? null,
    repo.statusExists === undefined ? null : repo.statusExists ? 1 : 0,
    repo.statusIsDirty === undefined ? null : repo.statusIsDirty ? 1 : 0,
    repo.statusCheckedAt ?? null
  );
}

/**
 * Update cached status fields for a repository.
 */
export function updateRepoStatusCache(
  repoId: string,
  status: Pick<RepoStatus, 'exists' | 'isDirty'>,
  checkedAt: string = new Date().toISOString()
): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE repos
    SET statusExists = ?, statusIsDirty = ?, statusCheckedAt = ?
    WHERE id = ?
  `);
  stmt.run(status.exists ? 1 : 0, status.isDirty ? 1 : 0, checkedAt, repoId);
}

/**
 * Get a repository by ID
 */
export function getRepo(id: string): DbRepoRow | undefined {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM repos WHERE id = ?');
  const row = stmt.get(id) as Record<string, unknown> | undefined;

  if (!row) return undefined;

  return parseRepoRow(row);
}

/**
 * Get all repositories
 */
export function getAllRepos(): DbRepoRow[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM repos');
  const rows = stmt.all() as Record<string, unknown>[];

  return rows.map(parseRepoRow);
}

/**
 * Delete a repository by ID
 */
export function deleteRepo(id: string): void {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM repos WHERE id = ?');
  stmt.run(id);
}

/**
 * Parse a database row into a DbRepoRow
 */
function parseRepoRow(row: Record<string, unknown>): DbRepoRow {
  return {
    id: row.id as string,
    host: row.host as string,
    owner: row.owner as string,
    repo: row.repo as string,
    cloneUrl: row.cloneUrl as string,
    description: (row.description as string | null | undefined) ?? undefined,
    tags: row.tags ? JSON.parse(row.tags as string) : undefined,
    defaultRemoteName: row.defaultRemoteName as string,
    updateStrategy: row.updateStrategy as 'hard-reset' | 'ff-only',
    submodules: row.submodules as 'none' | 'recursive',
    lfs: row.lfs as 'auto' | 'always' | 'never',
    managed: (row.managed as number) === 1,
    contentHash: (row.contentHash as string | null | undefined) ?? undefined,
    readmeIndexedAt: (row.readmeIndexedAt as string | null | undefined) ?? undefined,
    statusExists:
      row.statusExists === null || row.statusExists === undefined
        ? undefined
        : (row.statusExists as number) === 1,
    statusIsDirty:
      row.statusIsDirty === null || row.statusIsDirty === undefined
        ? undefined
        : (row.statusIsDirty as number) === 1,
    statusCheckedAt: (row.statusCheckedAt as string | null | undefined) ?? undefined,
  };
}
