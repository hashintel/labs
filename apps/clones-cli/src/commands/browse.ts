import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import type { Option } from '@clack/prompts';
import type Database from 'better-sqlite3';
import { readRegistry } from '../lib/registry.js';
import { getRepoStatus } from '../lib/git.js';
import { getRepoPath } from '../lib/config.js';
import { showBatchActions, type RepoInfo } from '../lib/browse/batch-actions.js';
import { ExitRequestedError } from '../lib/browse/errors.js';
import { showSingleRepoActions } from '../lib/browse/single-actions.js';
import { openDb, closeDb, getAllRepos, updateRepoStatusCache } from '../lib/db.js';
import { syncRegistryToDb } from '../lib/db-sync.js';
import { ensureSearchTables, sanitizeFtsQuery, rankReposByQuery } from '../lib/db-search.js';
import { rankedAutocompleteMultiselect } from '../lib/ranked-autocomplete.js';
import type { DbRepoRow, RepoStatus } from '../types/index.js';

const STATUS_CACHE_STALE_MS = 15 * 60 * 1000;

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

async function ensureBrowseReposInDb(db: Database.Database): Promise<DbRepoRow[]> {
  let repos = getAllRepos();
  if (repos.length > 0) {
    return repos;
  }

  // One-time bootstrap path for users with a populated registry but empty DB.
  const registry = await readRegistry();
  if (registry.repos.length === 0) {
    return [];
  }

  syncRegistryToDb(db, registry);
  repos = getAllRepos();
  return repos;
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

  let db: Database.Database | null = null;

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
      const hints: string[] = [];
      if (!repo.status.exists) {
        hints.push('missing');
      } else if (repo.status.isDirty) {
        hints.push('dirty');
      }
      if (staleStatusRepoIds.has(repo.entry.id)) {
        hints.push('stale');
      }

      return {
        value: repo,
        label: `${repo.entry.owner}/${repo.entry.repo}`,
        hint: hints.length > 0 ? hints.join(', ') : undefined,
      };
    });

    const rankFn = (searchText: string) => {
      const ftsQuery = sanitizeFtsQuery(searchText);
      return rankReposByQuery(db!, ftsQuery);
    };

    const getOptionId = (repo: RepoInfo) => repo.entry.id;

    const metadataFilter = (searchText: string, option: Option<RepoInfo>): boolean => {
      if (!searchText) return true;
      const term = searchText.toLowerCase();
      const entry = option.value.entry;
      const label = `${entry.owner}/${entry.repo}`.toLowerCase();
      const tags = entry.tags?.join(' ').toLowerCase() ?? '';
      const desc = entry.description?.toLowerCase() ?? '';
      return label.includes(term) || tags.includes(term) || desc.includes(term);
    };

    const selected = await rankedAutocompleteMultiselect({
      message: 'Select repositories (type to filter, Tab to select)',
      options,
      placeholder: 'Type to search...',
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
