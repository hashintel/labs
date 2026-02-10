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
import { ensureSearchTables } from '../lib/db-search.js';
import type { Registry } from '../types/index.js';

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

  // Load README content map for enhanced filtering
  const readmeMap: Map<string, string> = new Map();
  try {
    const db = await openDb();
    try {
      ensureSearchTables(db);
      // Get all chunks grouped by repo
      const chunks = db
        .prepare('SELECT repo_id, chunk_text FROM readme_chunks ORDER BY repo_id, chunk_index')
        .all() as { repo_id: string; chunk_text: string }[];
      for (const chunk of chunks) {
        const existing = readmeMap.get(chunk.repo_id) ?? '';
        readmeMap.set(chunk.repo_id, existing + ' ' + chunk.chunk_text);
      }
    } finally {
      closeDb();
    }
  } catch {
    // DB not available, readmeMap stays empty - graceful degradation
  }

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

  // Enhanced filter that searches owner/repo, tags, description, and README content
  const repoInfoFilter = (searchText: string, option: Option<RepoInfo>): boolean => {
    if (!searchText) return true;
    const term = searchText.toLowerCase();
    const entry = option.value.entry;
    const label = `${entry.owner}/${entry.repo}`.toLowerCase();
    const tags = entry.tags?.join(' ').toLowerCase() ?? '';
    const desc = entry.description?.toLowerCase() ?? '';
    const readme = readmeMap.get(entry.id)?.toLowerCase() ?? '';
    return (
      label.includes(term) || tags.includes(term) || desc.includes(term) || readme.includes(term)
    );
  };

  const selected = await p.autocompleteMultiselect({
    message: 'Select repositories (type to filter, Tab to select)',
    options,
    placeholder: 'Type to search...',
    filter: repoInfoFilter,
  });

  if (p.isCancel(selected)) {
    requestExit();
  }

  if (selected.length === 0) {
    p.log.info('No repositories selected.');
    return;
  }

  // Branch based on selection count
  if (selected.length === 1) {
    const result = await showSingleRepoActions(selected[0], 'browse');
    if (result === 'browse') {
      return;
    }
    requestExit();
  } else {
    await showBatchActions(selected);
  }
}
