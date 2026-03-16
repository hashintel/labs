import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import type { Option } from '@clack/prompts';
import type { SqlDatabase } from '../lib/sql-database.js';
import { readRegistry } from '../lib/registry.js';
import { getRepoStatus } from '../lib/git.js';
import { getRepoPath } from '../lib/config.js';
import { showBatchActions, type RepoInfo } from '../lib/browse/batch-actions.js';
import { ExitRequestedError } from '../lib/browse/errors.js';
import { showSingleRepoActions } from '../lib/browse/single-actions.js';
import { openDb, closeDb, getAllRepos, updateRepoStatusCache } from '../lib/db.js';
import { syncRegistryToDb } from '../lib/db-sync.js';
import {
  ensureSearchTables,
  sanitizeFtsQuery,
  rankReposByQuery,
  rankReposByVector,
  searchRepos,
} from '../lib/db-search.js';
import {
  rankedAutocompleteMultiselect,
  type RankedAutocompleteContext,
} from '../lib/ranked-autocomplete.js';
import type { DbRepoRow, RepoStatus } from '../types/index.js';

const STATUS_CACHE_STALE_MS = 15 * 60 * 1000;
const MAX_HINT_LENGTH = 96;

const BROWSE_SEARCH_MODES = [
  { id: 'metadata', label: 'Metadata', hint: 'name + description + tags' },
  { id: 'tags', label: 'Tags', hint: 'declared tags only' },
  { id: 'bm25', label: 'BM25', hint: 'lexical README/profile search' },
  { id: 'vector', label: 'Vector', hint: 'semantic embedding similarity' },
  { id: 'hybrid', label: 'Hybrid', hint: 'RRF blend of bm25 + vector' },
] as const;

type BrowseSearchModeId = (typeof BROWSE_SEARCH_MODES)[number]['id'];

function requestExit(): never {
  throw new ExitRequestedError();
}

function statusFromCache(repo: DbRepoRow): RepoStatus | null {
  if (repo.statusExists === undefined || repo.statusIsDirty === undefined) {
    return null;
  }

  return {
    exists: repo.statusExists,
    isGitRepo: repo.statusExists,
    currentBranch: null,
    isDetached: false,
    tracking: null,
    ahead: 0,
    behind: 0,
    isDirty: repo.statusExists ? repo.statusIsDirty : false,
  };
}

function isStatusCacheStale(repo: DbRepoRow): boolean {
  if (!repo.statusCheckedAt) {
    return true;
  }

  const checkedAt = Date.parse(repo.statusCheckedAt);
  if (Number.isNaN(checkedAt)) {
    return true;
  }

  return Date.now() - checkedAt > STATUS_CACHE_STALE_MS;
}

async function ensureBrowseReposInDb(db: SqlDatabase): Promise<DbRepoRow[]> {
  const registry = await readRegistry();
  if (registry.repos.length > 0) {
    syncRegistryToDb(db, registry);
  }
  return getAllRepos();
}

async function buildRepoInfos(
  rows: DbRepoRow[]
): Promise<{ repos: RepoInfo[]; staleStatusRepoIds: Set<string> }> {
  const staleStatusRepoIds = new Set<string>();

  const repos = await Promise.all(
    rows.map(async (entry) => {
      const localPath = getRepoPath(entry.owner, entry.repo);
      const cachedStatus = statusFromCache(entry);

      if (cachedStatus) {
        if (isStatusCacheStale(entry)) {
          staleStatusRepoIds.add(entry.id);
        }
        return {
          entry,
          status: cachedStatus,
          localPath,
        };
      }

      const freshStatus = await getRepoStatus(localPath);
      updateRepoStatusCache(entry.id, freshStatus);

      return {
        entry,
        status: freshStatus,
        localPath,
      };
    })
  );

  return { repos, staleStatusRepoIds };
}

async function refreshSelectedStatuses(selected: RepoInfo[]): Promise<RepoInfo[]> {
  return Promise.all(
    selected.map(async (repo) => {
      try {
        const freshStatus = await getRepoStatus(repo.localPath);
        updateRepoStatusCache(repo.entry.id, freshStatus);
        return { ...repo, status: freshStatus };
      } catch {
        return repo;
      }
    })
  );
}

function truncateInline(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function negateScores(scores: Map<string, number>): Map<string, number> {
  const negated = new Map<string, number>();

  for (const [repoId, score] of scores.entries()) {
    negated.set(repoId, -score);
  }

  return negated;
}

function getBrowseModeId(context?: RankedAutocompleteContext): BrowseSearchModeId {
  const modeId = context?.mode.id;
  if (
    modeId === 'metadata' ||
    modeId === 'tags' ||
    modeId === 'bm25' ||
    modeId === 'vector' ||
    modeId === 'hybrid'
  ) {
    return modeId;
  }

  return 'metadata';
}

export default defineCommand({
  meta: {
    name: 'browse',
    description: 'Interactively browse and manage clones',
  },
  args: {},
  async run() {
    await mainLoop();
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// MAIN LOOP
// ─────────────────────────────────────────────────────────────────────────────

async function mainLoop(): Promise<void> {
  p.intro('clones');

  try {
    while (true) {
      await browseRepos();
    }
  } catch (error) {
    if (error instanceof ExitRequestedError) {
      p.outro('Goodbye!');
      return;
    }
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BROWSE REPOS (with multiselect search)
// ─────────────────────────────────────────────────────────────────────────────

async function browseRepos(): Promise<void> {
  const s = p.spinner();
  s.start('Loading repositories...');

  let db: SqlDatabase | null = null;

  try {
    db = await openDb();
    ensureSearchTables(db);

    const rows = await ensureBrowseReposInDb(db);
    if (rows.length === 0) {
      s.stop('No repositories found');
      p.log.info('No repositories in registry.');
      p.log.info("Use 'clones add <url>' to add a repository.");
      requestExit();
    }

    const { repos, staleStatusRepoIds } = await buildRepoInfos(rows);
    s.stop(`${repos.length} repositories loaded`);

    const options: Option<RepoInfo>[] = repos.map((repo) => {
      const statusHints: string[] = [];
      if (!repo.status.exists) {
        statusHints.push('missing');
      } else if (repo.status.isDirty) {
        statusHints.push('dirty');
      }
      if (staleStatusRepoIds.has(repo.entry.id)) {
        statusHints.push('stale');
      }

      const detailHints: string[] = [];
      if (repo.entry.tags && repo.entry.tags.length > 0) {
        detailHints.push(`tags: ${repo.entry.tags.slice(0, 4).join(', ')}`);
      }
      if (repo.entry.description) {
        detailHints.push(`desc: ${truncateInline(repo.entry.description, MAX_HINT_LENGTH)}`);
      }
      if (statusHints.length > 0) {
        detailHints.push(`status: ${statusHints.join(', ')}`);
      }

      return {
        value: repo,
        label: `${repo.entry.owner}/${repo.entry.repo}`,
        hint: detailHints.length > 0 ? detailHints.join(' | ') : undefined,
      };
    });

    const rankFn = (searchText: string, context?: RankedAutocompleteContext) => {
      const mode = getBrowseModeId(context);

      if (mode === 'metadata' || mode === 'tags') {
        return new Map<string, number>();
      }

      if (mode === 'bm25') {
        const ftsQuery = sanitizeFtsQuery(searchText);
        return rankReposByQuery(db!, ftsQuery);
      }

      if (mode === 'vector') {
        const scores = rankReposByVector(db!, searchText);
        return negateScores(scores);
      }

      const limit = Math.max(100, repos.length);
      const results = searchRepos(db!, searchText, {
        mode: 'hybrid',
        limit,
        candidateLimit: Math.max(limit, repos.length * 4),
      });

      const scores = new Map<string, number>();
      for (const result of results) {
        scores.set(result.repoId, -result.score);
      }
      return scores;
    };

    const getOptionId = (repo: RepoInfo) => repo.entry.id;

    const metadataFilter = (
      searchText: string,
      option: Option<RepoInfo>,
      context?: RankedAutocompleteContext
    ): boolean => {
      if (!searchText) return true;

      const mode = getBrowseModeId(context);
      const term = searchText.toLowerCase();
      const entry = option.value.entry;
      const label = `${entry.owner}/${entry.repo}`.toLowerCase();
      const tags = entry.tags?.join(' ').toLowerCase() ?? '';
      const desc = entry.description?.toLowerCase() ?? '';

      if (mode === 'metadata') {
        return label.includes(term) || tags.includes(term) || desc.includes(term);
      }

      if (mode === 'tags') {
        return tags.includes(term);
      }

      return false;
    };

    const selected = await rankedAutocompleteMultiselect({
      message: 'Select repositories (type to search, F1..F5 mode, Tab to select)',
      options,
      placeholder: 'Type to search...',
      modes: [...BROWSE_SEARCH_MODES],
      initialModeId: 'hybrid',
      rankFn,
      getOptionId,
      metadataFilter,
    });

    if (p.isCancel(selected) || !Array.isArray(selected)) {
      requestExit();
    }

    if (selected.length === 0) {
      return;
    }

    const selectedWithFreshStatus = await refreshSelectedStatuses(selected);

    if (selectedWithFreshStatus.length === 1) {
      const result = await showSingleRepoActions(selectedWithFreshStatus[0], 'browse');
      if (result === 'browse') {
        return;
      }
      requestExit();
    } else {
      await showBatchActions(selectedWithFreshStatus);
    }
  } catch (error) {
    if (!(error instanceof ExitRequestedError)) {
      s.stop('Failed to load repositories');
    }
    throw error;
  } finally {
    if (db) {
      closeDb();
    }
  }
}
