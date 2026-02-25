import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import { readRegistry, filterByTags, filterByPattern } from '../lib/registry.js';
import { getRepoStatus } from '../lib/git.js';
import { getRepoPath } from '../lib/config.js';
import { readLocalState, getLastSyncedAt } from '../lib/local-state.js';
import type { RegistryEntry, RepoStatus } from '../types/index.js';

interface ListItem {
  entry: RegistryEntry;
  status: RepoStatus;
  localPath: string;
  lastSyncedAt?: string;
}

export default defineCommand({
  meta: {
    name: 'list',
    description: 'List all tracked repositories',
  },
  args: {
    json: {
      type: 'boolean',
      description: 'Output as JSON',
    },
    tags: {
      type: 'string',
      description: 'Filter by tags (comma-separated)',
    },
    filter: {
      type: 'string',
      description: 'Filter by owner/repo pattern (supports wildcards)',
    },
  },
  async run({ args }) {
    const registry = await readRegistry();
    const localState = await readLocalState();

    if (registry.repos.length === 0) {
      if (args.json) {
        console.log(JSON.stringify({ version: '1.0.0', repos: [] }, null, 2));
      } else {
        p.log.info('No repositories in registry.');
        p.log.info("Use 'clones add <url>' to add a repository.");
      }
      return;
    }

    // Apply filters
    let repos = registry.repos;

    if (args.tags) {
      const tags = args.tags.split(',').map((t: string) => t.trim());
      repos = filterByTags(registry, tags);
    }

    if (args.filter) {
      const filtered = filterByPattern({ ...registry, repos }, args.filter);
      repos = filtered;
    }

    if (repos.length === 0) {
      if (args.json) {
        console.log(JSON.stringify({ version: '1.0.0', repos: [] }, null, 2));
      } else {
        p.log.info('No repositories match the filter.');
      }
      return;
    }

    // Gather status for each repo
    const items: ListItem[] = await Promise.all(
      repos.map(async (entry) => {
        const localPath = getRepoPath(entry.owner, entry.repo);
        const status = await getRepoStatus(localPath);
        const lastSyncedAt = getLastSyncedAt(localState, entry.id);
        return { entry, status, localPath, lastSyncedAt };
      })
    );

    if (args.json) {
      outputJson(items);
    } else {
      outputPretty(items, localState.lastSyncRun);
    }
  },
});

function outputJson(items: ListItem[]): void {
  const output = {
    version: '1.0.0',
    repos: items.map(({ entry, status, localPath, lastSyncedAt }) => ({
      id: entry.id,
      owner: entry.owner,
      repo: entry.repo,
      localPath,
      cloneUrl: entry.cloneUrl,
      branch: status.currentBranch,
      tracking: status.tracking,
      behindCount: status.behind,
      aheadCount: status.ahead,
      isDirty: status.isDirty,
      isDetached: status.isDetached,
      hasUpstream: !!status.tracking,
      exists: status.exists,
      isGitRepo: status.isGitRepo,
      lastSyncedAt,
      tags: entry.tags,
      description: entry.description,
    })),
  };

  console.log(JSON.stringify(output, null, 2));
}

function outputPretty(items: ListItem[], lastSyncRun?: string): void {
  const lastSyncLabel = lastSyncRun ? formatDate(lastSyncRun) : 'never';

  console.log();
  console.log(`Clones Registry (${items.length} repos, last sync ${lastSyncLabel})`);
  console.log();

  for (const { entry, status, localPath, lastSyncedAt } of items) {
    const shortPath = localPath.replace(process.env.HOME || '', '~');

    console.log(`${entry.owner}/${entry.repo}`);
    console.log(`  Path: ${shortPath}`);
    console.log(`  URL: ${entry.cloneUrl}`);

    if (entry.tags && entry.tags.length > 0) {
      console.log(`  Tags: ${entry.tags.join(', ')}`);
    }

    if (entry.description) {
      console.log(`  Description: ${entry.description}`);
    }

    // Status line
    if (!status.exists) {
      console.log(`  Status: \u2717 Missing (not cloned)`);
    } else if (!status.isGitRepo) {
      console.log(`  Status: \u2717 Not a Git repository`);
    } else if (status.isDetached) {
      console.log(`  Branch: (detached HEAD)`);
      console.log(`  Status: \u26A0 Detached HEAD`);
    } else if (!status.tracking) {
      console.log(`  Branch: ${status.currentBranch} (no upstream)`);
      console.log(`  Status: \u26A0 No upstream tracking`);
    } else {
      const syncStatus = getSyncStatus(status, lastSyncedAt);
      console.log(`  Branch: ${status.currentBranch} \u2192 ${status.tracking}`);
      console.log(`  Status: ${syncStatus}`);
    }

    console.log();
  }
}

function getSyncStatus(status: RepoStatus, lastSyncedAt?: string): string {
  const parts: string[] = [];

  if (status.isDirty) {
    parts.push('\u2717 Dirty');
  }

  if (status.behind > 0) {
    parts.push(`${status.behind} behind`);
  }

  if (status.ahead > 0) {
    parts.push(`${status.ahead} ahead`);
  }

  if (parts.length === 0) {
    parts.push('\u2713 Clean');
  }

  if (lastSyncedAt) {
    parts.push(`(synced ${formatRelativeTime(lastSyncedAt)})`);
  }

  return parts.join(', ');
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return formatDate(isoString);
}
