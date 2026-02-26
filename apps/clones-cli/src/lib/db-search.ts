import type { SqlDatabase } from './sql-database.js';

export interface SearchResult {
  repoId: string;
  owner: string;
  repo: string;
  snippet: string;
  score: number;
}

export type SearchMode = 'bm25' | 'vector' | 'hybrid';

export interface RepoSearchOptions {
  mode?: SearchMode;
  limit?: number;
  blend?: number;
  candidateLimit?: number;
  rrfK?: number;
  rerankTop?: number;
}

export interface RepoSearchExplain {
  bm25Rank?: number;
  bm25RawScore?: number;
  vectorRank?: number;
  vectorScore?: number;
  rrfScore: number;
  rerankScore?: number;
}

export interface RepoSearchResult {
  repoId: string;
  owner: string;
  repo: string;
  snippet: string;
  score: number;
  explain: RepoSearchExplain;
}

interface RankedSignal {
  rank: number;
  rawScore: number;
}

interface FusedCandidate {
  repoId: string;
  score: number;
  explain: RepoSearchExplain;
}

const DEFAULT_CANDIDATE_LIMIT = 100;
const DEFAULT_RRF_K = 60;
const EMBEDDING_DIMENSIONS = 128;
const TOKEN_PATTERN = /[\p{L}\p{N}_-]+/gu;
const STEM_SUFFIXES = ['ments', 'ment', 'ation', 'ations', 'ing', 'ed', 'ies', 's'];

/**
 * Create the readme_chunks and FTS4 virtual table if they don't exist.
 * Assumes the repos table already exists.
 */
export function ensureSearchTables(db: SqlDatabase): void {
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

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS readme_fts USING fts4(
      chunk_text,
      tokenize=unicode61
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS readme_embeddings (
      repo_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      embedding_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      PRIMARY KEY (repo_id, chunk_index),
      FOREIGN KEY (repo_id) REFERENCES repos(id)
    )
  `);
}

/**
 * Index chunks for a repository.
 * Checks content hash first for incremental no-op behavior.
 */
export function indexReadme(
  db: SqlDatabase,
  repoId: string,
  _content: string,
  contentHash: string,
  chunks: string[]
): void {
  const existing = db
    .prepare('SELECT content_hash FROM readme_chunks WHERE repo_id = ? LIMIT 1')
    .get(repoId) as { content_hash: string } | undefined;

  if (existing && existing.content_hash === contentHash) {
    return;
  }

  db.prepare(
    'DELETE FROM readme_fts WHERE rowid IN (SELECT rowid FROM readme_chunks WHERE repo_id = ?)'
  ).run(repoId);

  db.prepare('DELETE FROM readme_chunks WHERE repo_id = ?').run(repoId);
  db.prepare('DELETE FROM readme_embeddings WHERE repo_id = ?').run(repoId);

  const insertChunk = db.prepare(
    'INSERT INTO readme_chunks (repo_id, chunk_index, chunk_text, content_hash) VALUES (?, ?, ?, ?)'
  );
  const insertEmbedding = db.prepare(
    'INSERT INTO readme_embeddings (repo_id, chunk_index, embedding_json, content_hash) VALUES (?, ?, ?, ?)'
  );

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    insertChunk.run(repoId, i, chunk, contentHash);

    const embedding = encodeEmbedding(buildTextEmbedding(chunk));
    insertEmbedding.run(repoId, i, embedding, contentHash);
  }

  db.prepare(
    'INSERT INTO readme_fts(rowid, chunk_text) SELECT rowid, chunk_text FROM readme_chunks WHERE repo_id = ?'
  ).run(repoId);
}

/**
 * Search chunks using FTS4 full-text matching.
 */
export function searchReadmes(db: SqlDatabase, query: string, limit = 10): SearchResult[] {
  if (!query || query.trim().length === 0) {
    return [];
  }

  try {
    const rows = db
      .prepare(
        `
      SELECT
        rc.repo_id as repoId,
        r.owner,
        r.repo,
        rc.chunk_text as snippet
      FROM readme_fts rf
      INNER JOIN readme_chunks rc ON rf.rowid = rc.rowid
      INNER JOIN repos r ON rc.repo_id = r.id
      WHERE rf.chunk_text MATCH ?
      LIMIT ?
    `
      )
      .all(query, limit) as unknown as Omit<SearchResult, 'score'>[];

    return rows.map((row, index) => ({ ...row, score: -(index + 1) }));
  } catch {
    return [];
  }
}

/**
 * Search repos with bm25, vector, or hybrid retrieval.
 */
export function searchRepos(
  db: SqlDatabase,
  query: string,
  options: RepoSearchOptions = {}
): RepoSearchResult[] {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return [];
  }

  const mode = options.mode ?? 'hybrid';
  const limit = normalizePositiveInt(options.limit, 10);
  const blend = clamp(options.blend ?? 0.5, 0, 1);
  const rerankTop = normalizeNonNegativeInt(options.rerankTop, 0);
  const rrfK = normalizePositiveInt(options.rrfK, DEFAULT_RRF_K);
  const candidateLimit = Math.max(
    limit,
    normalizePositiveInt(options.candidateLimit, Math.max(DEFAULT_CANDIDATE_LIMIT, limit * 5))
  );

  const ftsQuery = sanitizeFtsQuery(trimmedQuery);

  const bm25Scores =
    mode === 'vector' || ftsQuery.length === 0
      ? new Map<string, number>()
      : rankReposByQuery(db, ftsQuery, candidateLimit);
  const vectorScores =
    mode === 'bm25'
      ? new Map<string, number>()
      : rankReposByVector(db, trimmedQuery, candidateLimit);

  const fused = fuseCandidates(mode, bm25Scores, vectorScores, {
    blend,
    rerankTop,
    rrfK,
  });

  if (fused.length === 0) {
    return [];
  }

  const limited = fused.slice(0, limit);
  const repoIds = limited.map((candidate) => candidate.repoId);
  const repoMetadata = getRepoMetadata(db, repoIds);
  const snippets = getRepoSnippets(db, repoIds, ftsQuery);

  const results: RepoSearchResult[] = [];

  for (const candidate of limited) {
    const meta = repoMetadata.get(candidate.repoId);
    if (!meta) {
      continue;
    }

    results.push({
      repoId: candidate.repoId,
      owner: meta.owner,
      repo: meta.repo,
      snippet: snippets.get(candidate.repoId) ?? '',
      score: candidate.score,
      explain: candidate.explain,
    });
  }

  return results;
}

/**
 * Delete all chunks, FTS entries, and semantic embeddings (for rebuild).
 */
export function clearAllChunks(db: SqlDatabase): void {
  db.prepare('DELETE FROM readme_chunks').run();
  db.exec('DELETE FROM readme_fts');
  db.prepare('DELETE FROM readme_embeddings').run();
}

/**
 * Sanitize user input for FTS4 MATCH queries.
 * Wraps each word in double quotes, appends * to last word for prefix matching.
 * Returns empty string if no valid search terms.
 */
export function sanitizeFtsQuery(input: string): string {
  if (!input || input.trim().length === 0) {
    return '';
  }

  const tokens = input
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/\*/g, ''))
    .map((word) => word.replace(/"/g, '""'))
    .filter((word) => /[\p{L}\p{N}]/u.test(word));

  if (tokens.length === 0) {
    return '';
  }

  const quoted = tokens.map((token, index) => {
    return index === tokens.length - 1 ? `"${token}"*` : `"${token}"`;
  });

  return quoted.join(' ');
}

/**
 * Get matching repos for a search query via FTS4.
 * Returns a uniform score for all matches; ranking is handled
 * by the hybrid fusion layer (vector search provides gradient).
 */
export function rankReposByQuery(db: SqlDatabase, query: string, limit = 100): Map<string, number> {
  if (!query || query.trim().length === 0) {
    return new Map();
  }

  try {
    const results = db
      .prepare(
        `
      SELECT DISTINCT rc.repo_id
      FROM readme_fts rf
      INNER JOIN readme_chunks rc ON rf.rowid = rc.rowid
      WHERE rf.chunk_text MATCH ?
      LIMIT ?
    `
      )
      .all(query, limit) as { repo_id: string }[];

    const rankMap = new Map<string, number>();
    for (const row of results) {
      rankMap.set(row.repo_id, -1);
    }

    return rankMap;
  } catch {
    return new Map();
  }
}

/**
 * Get vector similarity scores per repo for a query.
 * Higher score is better.
 */
export function rankReposByVector(
  db: SqlDatabase,
  query: string,
  limit = 100
): Map<string, number> {
  if (!query || query.trim().length === 0) {
    return new Map();
  }

  const queryEmbedding = buildTextEmbedding(query);
  if (vectorMagnitude(queryEmbedding) === 0) {
    return new Map();
  }

  const rows = db.prepare('SELECT repo_id, embedding_json FROM readme_embeddings').all() as {
    repo_id: string;
    embedding_json: string;
  }[];

  const bestScoresByRepo = new Map<string, number>();

  for (const row of rows) {
    const embedding = decodeEmbedding(row.embedding_json);
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      continue;
    }

    const score = cosineSimilarity(queryEmbedding, embedding);
    if (!Number.isFinite(score) || score <= 0) {
      continue;
    }

    const previous = bestScoresByRepo.get(row.repo_id);
    if (previous === undefined || score > previous) {
      bestScoresByRepo.set(row.repo_id, score);
    }
  }

  const sorted = [...bestScoresByRepo.entries()]
    .sort((a, b) => {
      const scoreDelta = b[1] - a[1];
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit);

  return new Map(sorted);
}

function fuseCandidates(
  mode: SearchMode,
  bm25Scores: Map<string, number>,
  vectorScores: Map<string, number>,
  options: { blend: number; rerankTop: number; rrfK: number }
): FusedCandidate[] {
  const bm25Signals = buildRankedSignals(bm25Scores, 'asc');
  const vectorSignals = buildRankedSignals(vectorScores, 'desc');

  const lexicalWeight = mode === 'hybrid' ? options.blend : mode === 'bm25' ? 1 : 0;
  const semanticWeight = mode === 'hybrid' ? 1 - options.blend : mode === 'vector' ? 1 : 0;

  const repoIds = new Set<string>();
  if (mode !== 'vector') {
    for (const repoId of bm25Signals.keys()) {
      repoIds.add(repoId);
    }
  }
  if (mode !== 'bm25') {
    for (const repoId of vectorSignals.keys()) {
      repoIds.add(repoId);
    }
  }

  const candidates: FusedCandidate[] = [];

  for (const repoId of repoIds) {
    const bm25 = bm25Signals.get(repoId);
    const vector = vectorSignals.get(repoId);

    const bm25Rrf = bm25 ? 1 / (options.rrfK + bm25.rank) : 0;
    const vectorRrf = vector ? 1 / (options.rrfK + vector.rank) : 0;

    const rrfScore = lexicalWeight * bm25Rrf + semanticWeight * vectorRrf;
    if (rrfScore <= 0) {
      continue;
    }

    candidates.push({
      repoId,
      score: rrfScore,
      explain: {
        bm25Rank: bm25?.rank,
        bm25RawScore: bm25?.rawScore,
        vectorRank: vector?.rank,
        vectorScore: vector?.rawScore,
        rrfScore,
      },
    });
  }

  candidates.sort((a, b) => compareCandidates(a, b));

  if (mode === 'hybrid' && options.rerankTop > 0 && candidates.length > 1) {
    return applyHybridRerank(candidates, options.blend, options.rerankTop);
  }

  return candidates;
}

function applyHybridRerank(
  candidates: FusedCandidate[],
  blend: number,
  rerankTop: number
): FusedCandidate[] {
  const headSize = Math.min(rerankTop, candidates.length);
  if (headSize <= 1) {
    return candidates;
  }

  const head = candidates.slice(0, headSize).map((candidate) => ({
    ...candidate,
    explain: { ...candidate.explain },
  }));
  const tail = candidates.slice(headSize);

  const maxVectorScore = Math.max(
    ...head.map((candidate) => Math.max(candidate.explain.vectorScore ?? 0, 0)),
    1
  );

  for (const candidate of head) {
    const bm25RankScore = candidate.explain.bm25Rank ? 1 / candidate.explain.bm25Rank : 0;
    const vectorScoreRaw = Math.max(candidate.explain.vectorScore ?? 0, 0);
    const vectorScore = vectorScoreRaw / maxVectorScore;

    const rerankScore = blend * bm25RankScore + (1 - blend) * vectorScore;

    candidate.explain.rerankScore = rerankScore;
    candidate.score = rerankScore;
  }

  head.sort((a, b) => compareCandidates(a, b));

  return [...head, ...tail];
}

function compareCandidates(a: FusedCandidate, b: FusedCandidate): number {
  const scoreDelta = b.score - a.score;
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  const rrfDelta = b.explain.rrfScore - a.explain.rrfScore;
  if (rrfDelta !== 0) {
    return rrfDelta;
  }

  return a.repoId.localeCompare(b.repoId);
}

function buildRankedSignals(
  scores: Map<string, number>,
  direction: 'asc' | 'desc'
): Map<string, RankedSignal> {
  const sorted = [...scores.entries()].sort((a, b) => {
    const scoreDelta = direction === 'asc' ? a[1] - b[1] : b[1] - a[1];
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return a[0].localeCompare(b[0]);
  });

  const result = new Map<string, RankedSignal>();

  for (let index = 0; index < sorted.length; index++) {
    const [repoId, rawScore] = sorted[index];
    result.set(repoId, {
      rank: index + 1,
      rawScore,
    });
  }

  return result;
}

function getRepoMetadata(
  db: SqlDatabase,
  repoIds: string[]
): Map<string, { owner: string; repo: string }> {
  const metadata = new Map<string, { owner: string; repo: string }>();

  if (repoIds.length === 0) {
    return metadata;
  }

  const placeholders = repoIds.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT id, owner, repo FROM repos WHERE id IN (${placeholders})`)
    .all(...repoIds) as { id: string; owner: string; repo: string }[];

  for (const row of rows) {
    metadata.set(row.id, {
      owner: row.owner,
      repo: row.repo,
    });
  }

  return metadata;
}

function getRepoSnippets(
  db: SqlDatabase,
  repoIds: string[],
  ftsQuery: string
): Map<string, string> {
  const snippets = new Map<string, string>();

  if (repoIds.length === 0) {
    return snippets;
  }

  if (ftsQuery.length > 0) {
    const placeholders = repoIds.map(() => '?').join(', ');

    try {
      const rows = db
        .prepare(
          `
          SELECT repo_id, chunk_text
          FROM (
            SELECT
              rc.repo_id as repo_id,
              rc.chunk_text as chunk_text,
              ROW_NUMBER() OVER (PARTITION BY rc.repo_id ORDER BY rc.chunk_index ASC) as row_num
            FROM readme_fts rf
            INNER JOIN readme_chunks rc ON rf.rowid = rc.rowid
            WHERE rf.chunk_text MATCH ? AND rc.repo_id IN (${placeholders})
          ) ranked
          WHERE row_num = 1
          `
        )
        .all(ftsQuery, ...repoIds) as { repo_id: string; chunk_text: string }[];

      for (const row of rows) {
        snippets.set(row.repo_id, row.chunk_text);
      }
    } catch {
      // fall back to first chunk below
    }
  }

  if (snippets.size < repoIds.length) {
    const missingRepoIds = repoIds.filter((repoId) => !snippets.has(repoId));

    if (missingRepoIds.length > 0) {
      const placeholders = missingRepoIds.map(() => '?').join(', ');
      const rows = db
        .prepare(
          `
          SELECT repo_id, chunk_text
          FROM readme_chunks
          WHERE repo_id IN (${placeholders})
          ORDER BY repo_id ASC, chunk_index ASC
          `
        )
        .all(...missingRepoIds) as { repo_id: string; chunk_text: string }[];

      for (const row of rows) {
        if (!snippets.has(row.repo_id)) {
          snippets.set(row.repo_id, row.chunk_text);
        }
      }
    }
  }

  return snippets;
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  const parsed = Math.floor(value);
  if (parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeNonNegativeInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  const parsed = Math.floor(value);
  if (parsed < 0) {
    return fallback;
  }

  return parsed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function tokenizeForEmbedding(text: string): string[] {
  const matches = text.toLowerCase().match(TOKEN_PATTERN);
  if (!matches) {
    return [];
  }

  const tokens: string[] = [];

  for (const match of matches) {
    const normalized = normalizeToken(match);
    if (normalized.length >= 2) {
      tokens.push(normalized);
    }
  }

  return tokens;
}

function normalizeToken(token: string): string {
  let normalized = token.replace(/^[_-]+|[_-]+$/g, '');

  for (const suffix of STEM_SUFFIXES) {
    if (normalized.endsWith(suffix) && normalized.length > suffix.length + 2) {
      if (suffix === 'ies') {
        normalized = `${normalized.slice(0, -3)}y`;
      } else {
        normalized = normalized.slice(0, -suffix.length);
      }
      break;
    }
  }

  return normalized;
}

function buildTextEmbedding(text: string): number[] {
  const tokens = tokenizeForEmbedding(text);

  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  if (tokens.length === 0) {
    return vector;
  }

  const weight = 1 / Math.sqrt(tokens.length);

  for (const token of tokens) {
    const indexHash = hashToken(token, 0);
    const signHash = hashToken(token, 1);
    const index = indexHash % EMBEDDING_DIMENSIONS;
    const sign = signHash % 2 === 0 ? 1 : -1;

    vector[index] += sign * weight;
  }

  const magnitude = vectorMagnitude(vector);
  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
}

function hashToken(token: string, seed: number): number {
  let hash = 2166136261 ^ seed;

  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function encodeEmbedding(vector: number[]): string {
  return JSON.stringify(vector);
}

function decodeEmbedding(encoded: string): number[] {
  try {
    const parsed = JSON.parse(encoded);
    if (!Array.isArray(parsed) || parsed.length !== EMBEDDING_DIMENSIONS) {
      return [];
    }

    const vector: number[] = [];
    for (const value of parsed) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return [];
      }
      vector.push(numeric);
    }

    return vector;
  } catch {
    return [];
  }
}

function vectorMagnitude(vector: number[]): number {
  let sum = 0;

  for (const value of vector) {
    sum += value * value;
  }

  return Math.sqrt(sum);
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let i = 0; i < left.length; i++) {
    const leftValue = left[i];
    const rightValue = right[i];

    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / Math.sqrt(leftNorm * rightNorm);
}
