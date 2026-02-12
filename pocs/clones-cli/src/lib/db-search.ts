import type Database from 'better-sqlite3';

export interface SearchResult {
  repoId: string;
  owner: string;
  repo: string;
  snippet: string;
  score: number;
}

/**
 * Create the readme_chunks and FTS5 virtual table if they don't exist.
 * Assumes the repos table already exists (created by Task 1).
 */
export function ensureSearchTables(db: Database.Database): void {
  // Create readme_chunks table with explicit rowid
  db.exec(`
    CREATE TABLE IF NOT EXISTS readme_chunks (
      rowid INTEGER PRIMARY KEY,
      repo_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      UNIQUE(repo_id, chunk_index),
      FOREIGN KEY (repo_id) REFERENCES repos(id)
    )
  `);

  // Create FTS5 virtual table for full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS readme_fts USING fts5(
      chunk_text,
      content='readme_chunks',
      content_rowid='rowid'
    )
  `);
}

/**
 * Index a README for a repository.
 * Checks if content_hash matches existing; if so, skips.
 * Otherwise, deletes old chunks and inserts new ones.
 */
export function indexReadme(
  db: Database.Database,
  repoId: string,
  content: string,
  contentHash: string,
  chunks: string[]
): void {
  // Check if we already have this content indexed
  const existing = db
    .prepare('SELECT content_hash FROM readme_chunks WHERE repo_id = ? LIMIT 1')
    .get(repoId) as { content_hash: string } | undefined;

  if (existing && existing.content_hash === contentHash) {
    // Content hasn't changed, skip indexing
    return;
  }

  // Delete old FTS entries BEFORE deleting chunks (need rowids to reference)
  db.prepare(
    "INSERT INTO readme_fts(readme_fts, rowid, chunk_text) SELECT 'delete', rowid, chunk_text FROM readme_chunks WHERE repo_id = ?"
  ).run(repoId);

  // Now delete old chunks
  db.prepare('DELETE FROM readme_chunks WHERE repo_id = ?').run(repoId);

  // Insert new chunks
  const insertChunk = db.prepare(
    'INSERT INTO readme_chunks (repo_id, chunk_index, chunk_text, content_hash) VALUES (?, ?, ?, ?)'
  );

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    insertChunk.run(repoId, i, chunk, contentHash);
  }

  // Rebuild FTS index by inserting all chunks for this repo
  const ftsInsert = db.prepare(
    'INSERT INTO readme_fts(rowid, chunk_text) SELECT rowid, chunk_text FROM readme_chunks WHERE repo_id = ?'
  );
  ftsInsert.run(repoId);
}

/**
 * Search READMEs using FTS5 with BM25 ranking.
 * Returns results joined with repos table to get owner/repo.
 */
export function searchReadmes(db: Database.Database, query: string, limit = 10): SearchResult[] {
  const results = db
    .prepare(
      `
    SELECT
      rc.repo_id as repoId,
      r.owner,
      r.repo,
      rc.chunk_text as snippet,
      rf.rank as score
    FROM readme_fts rf
    INNER JOIN readme_chunks rc ON rf.rowid = rc.rowid
    INNER JOIN repos r ON rc.repo_id = r.id
    WHERE rf.chunk_text MATCH ?
    ORDER BY rf.rank ASC
    LIMIT ?
  `
    )
    .all(query, limit) as SearchResult[];

  return results;
}

/**
 * Delete all chunks and FTS entries (for rebuild).
 */
export function clearAllChunks(db: Database.Database): void {
  db.prepare('DELETE FROM readme_chunks').run();
  db.exec('DELETE FROM readme_fts');
}
