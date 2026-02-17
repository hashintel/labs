import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import type { Option } from '@clack/prompts';
import { readRegistry } from '../lib/registry.js';
import { getRepoStatus } from '../lib/git.js';
import { getRepoPath } from '../lib/config.js';
import { showBatchActions, type RepoInfo } from '../lib/browse/batch-actions.js';
import { ExitRequestedError } from '../lib/browse/errors.js';
import { showSingleRepoActions } from '../lib/browse/single-actions.js';
import { openDb, closeDb } from '../lib/db.js';
import { ensureSearchTables, sanitizeFtsQuery, rankReposByQuery } from '../lib/db-search.js';
import { rankedAutocompleteMultiselect } from '../lib/ranked-autocomplete.js';
import type { Registry } from '../types/index.js';
import type Database from 'better-sqlite3';

function requestExit(): never {
  throw new ExitRequestedError();
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
    const registry = await readRegistry();
    if (registry.repos.length === 0) {
      p.log.info('No repositories in registry.');
      p.log.info("Use 'clones add <url>' to add a repository.");
      p.outro('Goodbye!');
      return;
    }

    while (true) {
      await browseRepos(await readRegistry());
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

async function browseRepos(registry: Registry): Promise<void> {
  // Load status for all repos
  const s = p.spinner();
  s.start('Loading repositories...');

  const repos: RepoInfo[] = await Promise.all(
    registry.repos.map(async (entry) => {
      const localPath = getRepoPath(entry.owner, entry.repo);
      const status = await getRepoStatus(localPath);
      return { entry, status, localPath };
    })
  );

  s.stop(`${repos.length} repositories loaded`);

  // Build options for autocomplete multiselect
  const options: Option<RepoInfo>[] = repos.map((r) => {
    const hints: string[] = [];
    if (!r.status.exists) {
      hints.push('missing');
    } else if (r.status.isDirty) {
      hints.push('dirty');
    }

    return {
      value: r,
      label: `${r.entry.owner}/${r.entry.repo}`,
      hint: hints.length > 0 ? hints.join(', ') : undefined,
    };
  });

  // Open DB for ranking (graceful degradation if unavailable)
  let db: Database.Database | null = null;
  try {
    db = await openDb();
    ensureSearchTables(db);
  } catch {
    // DB not available, will use unranked fallback
  }

  try {
    // Create rankFn closure that uses the DB
    const rankFn = db
      ? (searchText: string) => {
          const ftsQuery = sanitizeFtsQuery(searchText);
          return rankReposByQuery(db!, ftsQuery);
        }
      : undefined;

    // Create getOptionId closure
    const getOptionId = (r: RepoInfo) => r.entry.id;

    // Create metadataFilter that searches label, tags, and description
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

    if (p.isCancel(selected) || !selected) {
      requestExit();
    }

    if (selected!.length === 0) {
      p.log.info('No repositories selected.');
      return;
    }

    // Branch based on selection count
    if (selected!.length === 1) {
      const result = await showSingleRepoActions(selected![0], 'browse');
      if (result === 'browse') {
        return;
      }
      requestExit();
    } else {
      await showBatchActions(selected!);
    }
  } finally {
    if (db) {
      closeDb();
    }
  }
}
