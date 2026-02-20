import Database from 'better-sqlite3';
import { getDbPath, ensureConfigDir } from './config.js';
import type { DbRepoRow } from '../types/index.js';

let db: Database.Database | null = null;

/**
 * Open or create the SQLite database
 * Enables WAL mode and runs migrations
 */
export async function openDb(): Promise<Database.Database> {
  if (db) return db;

  await ensureConfigDir();
  const dbPath = getDbPath();

  db = new Database(dbPath);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

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
export function getDb(): Database.Database {
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
      readmeIndexedAt TEXT
    )
  `);
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
      contentHash, readmeIndexedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    repo.readmeIndexedAt ?? null
  );
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
  };
}
