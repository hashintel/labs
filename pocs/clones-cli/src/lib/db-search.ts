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

/**
 * Sanitize user input for FTS5 MATCH queries.
 * Wraps each word in double quotes, appends * to last word for prefix matching.
 * Returns empty string if no valid search terms.
 */
export function sanitizeFtsQuery(input: string): string {
  if (!input || input.trim().length === 0) {
    return '';
  }

  // Split on whitespace and filter out empty strings
  const words = input
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (words.length === 0) {
    return '';
  }

  // Wrap each word in double quotes to treat as phrase
  // Append * to last word for prefix matching (OUTSIDE the quotes)
  const quoted = words.map((w, i) => {
    // Escape any double quotes in the word
    const escaped = w.replace(/"/g, '""');
    // Add * to last word for prefix matching (outside quotes for FTS5)
    return i === words.length - 1 ? `"${escaped}"*` : `"${escaped}"`;
  });

  return quoted.join(' ');
}

/**
 * Get BM25 scores per repo for a search query.
 * Returns Map<repoId, bestRank> sorted by relevance (lower rank = better).
 */
export function rankReposByQuery(
  db: Database.Database,
  query: string,
  limit = 100
): Map<string, number> {
  if (!query || query.trim().length === 0) {
    return new Map();
  }

  try {
    const results = db
      .prepare(
        `
      SELECT rc.repo_id, MIN(rf.rank) as best_rank
      FROM readme_fts rf
      INNER JOIN readme_chunks rc ON rf.rowid = rc.rowid
      WHERE rf.chunk_text MATCH ?
      GROUP BY rc.repo_id
      ORDER BY best_rank ASC
      LIMIT ?
    `
      )
      .all(query, limit) as { repo_id: string; best_rank: number }[];

    const rankMap = new Map<string, number>();
    for (const row of results) {
      rankMap.set(row.repo_id, row.best_rank);
    }
    return rankMap;
  } catch {
    // If FTS query fails (invalid syntax, etc.), return empty map
    return new Map();
  }
}
