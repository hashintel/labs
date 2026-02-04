import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import type { Option } from '@clack/prompts';
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  readRegistry,
  writeRegistry,
  removeEntry,
  findEntryByOwnerRepo,
  addTombstone,
} from '../lib/registry.js';
import { readLocalState, writeLocalState, removeRepoLocalState } from '../lib/local-state.js';
import { getRepoPath } from '../lib/config.js';
import type { RegistryEntry } from '../types/index.js';

export default defineCommand({
  meta: {
    name: 'rm',
    description: 'Remove a repository from the registry (and optionally from disk)',
  },
  args: {
    repo: {
      type: 'positional',
      description: 'Repository identifier (owner/repo)',
      required: false,
    },
    'keep-disk': {
      type: 'boolean',
      description: 'Keep the local directory (only remove from registry)',
      default: false,
    },
    yes: {
      type: 'boolean',
      alias: 'y',
      description: 'Skip confirmation prompt',
      default: false,
    },
  },
  async run({ args }) {
    p.intro('clones rm');

    if (!args.repo) {
      await interactiveRemove(args);
      return;
    }

    // Parse owner/repo from argument
    const parts = args.repo.split('/');
    if (parts.length !== 2) {
      p.log.error(`Invalid format: ${args.repo}`);
      p.log.info('Expected format: owner/repo');
      process.exit(1);
    }

    const [owner, repo] = parts;

    // Load registry
    const registry = await readRegistry();

    // Find entry
    const entry = findEntryByOwnerRepo(registry, owner, repo);

    if (!entry) {
      p.log.error(`Repository not found in registry: ${owner}/${repo}`);
      p.log.info("Use 'clones list' to see all tracked repositories.");
      process.exit(1);
    }

    // Check if local directory exists
    const localPath = getRepoPath(owner, repo);
    const diskExists = existsSync(localPath);

    // Show what will happen
    p.log.info(`Repository: ${owner}/${repo}`);
    p.log.info(`Registry ID: ${entry.id}`);
    p.log.info(`Local path: ${localPath}`);
    p.log.info(`On disk: ${diskExists ? 'Yes' : 'No (already deleted)'}`);

    // Determine actions
    const willDeleteFromDisk = diskExists && !args['keep-disk'];

    p.log.step('\nActions to perform:');
    p.log.message(`   ✓ Remove from registry`);
    if (willDeleteFromDisk) {
      p.log.message(`   ✓ Delete local directory`);
    } else if (diskExists && args['keep-disk']) {
      p.log.message(`   ○ Keep local directory (--keep-disk)`);
    } else if (!diskExists) {
      p.log.message(`   ○ Local directory doesn't exist`);
    }

    // Confirm
    if (!args.yes) {
      const message = willDeleteFromDisk
        ? `Remove ${owner}/${repo} from registry AND delete from disk?`
        : `Remove ${owner}/${repo} from registry?`;

      const shouldContinue = await p.confirm({
        message,
      });

      if (p.isCancel(shouldContinue) || !shouldContinue) {
        p.cancel('Cancelled');
        return;
      }
    }

    // Delete from disk first (if needed)
    if (willDeleteFromDisk) {
      const s = p.spinner();
      s.start(`Deleting ${localPath}...`);

      try {
        await rm(localPath, { recursive: true, force: true });
        s.stop(`Deleted ${localPath}`);
      } catch (error) {
        s.stop('Failed to delete directory');
        p.log.error(error instanceof Error ? error.message : String(error));
        p.log.info('Registry entry was NOT removed. Fix the issue and try again.');
        process.exit(1);
      }
    }

    // Remove from registry
    try {
      let updatedRegistry = removeEntry(registry, entry.id);
      updatedRegistry = addTombstone(updatedRegistry, entry.id);
      await writeRegistry(updatedRegistry);
      p.log.success(`Removed ${owner}/${repo} from registry`);
      try {
        const localState = await readLocalState();
        const updatedLocalState = removeRepoLocalState(localState, entry.id);
        await writeLocalState(updatedLocalState);
      } catch (error) {
        p.log.warn(
          `Local state was not updated: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } catch (error) {
      p.log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    p.outro('Done!');
  },
});

async function interactiveRemove(args: { 'keep-disk'?: boolean; yes?: boolean }) {
  const registry = await readRegistry();
  if (registry.repos.length === 0) {
    p.log.info('No repositories in registry.');
    return;
  }

  const options: Option<RegistryEntry>[] = registry.repos.map((entry) => ({
    value: entry,
    label: `${entry.owner}/${entry.repo}`,
    hint: entry.description,
  }));

  const filter = (searchText: string, option: Option<RegistryEntry>): boolean => {
    if (!searchText) return true;
    const term = searchText.toLowerCase();
    const entry = option.value;
    const label = `${entry.owner}/${entry.repo}`.toLowerCase();
    const tags = entry.tags?.join(' ').toLowerCase() ?? '';
    const desc = entry.description?.toLowerCase() ?? '';
    return label.includes(term) || tags.includes(term) || desc.includes(term);
  };

  const selected = await p.autocompleteMultiselect({
    message: 'Select repositories to remove (type to filter, Tab to select)',
    options,
    placeholder: 'Type to search...',
    filter,
  });

  if (p.isCancel(selected)) {
    p.cancel('Cancelled');
    return;
  }

  if (selected.length === 0) {
    p.log.info('No repositories selected.');
    return;
  }

  const willDeleteFromDisk = !args['keep-disk'];
  const confirmMessage = willDeleteFromDisk
    ? `Remove ${selected.length} repositories? (this will delete from disk)`
    : `Remove ${selected.length} repositories from registry?`;

  if (!args.yes) {
    const shouldContinue = await p.confirm({
      message: confirmMessage,
    });

    if (p.isCancel(shouldContinue) || !shouldContinue) {
      p.cancel('Cancelled');
      return;
    }
  }

  for (const entry of selected) {
    const localPath = getRepoPath(entry.owner, entry.repo);
    const diskExists = existsSync(localPath);

    if (willDeleteFromDisk && diskExists) {
      try {
        await rm(localPath, { recursive: true, force: true });
        p.log.step(`Deleted ${localPath}`);
      } catch (error) {
        p.log.error(
          `Failed to delete ${localPath}: ${error instanceof Error ? error.message : String(error)}`
        );
        continue;
      }
    }

    try {
      let updatedRegistry = await readRegistry();
      updatedRegistry = removeEntry(updatedRegistry, entry.id);
      updatedRegistry = addTombstone(updatedRegistry, entry.id);
      await writeRegistry(updatedRegistry);
      p.log.success(`Removed ${entry.owner}/${entry.repo}`);

      try {
        const localState = await readLocalState();
        const updatedLocalState = removeRepoLocalState(localState, entry.id);
        await writeLocalState(updatedLocalState);
      } catch {
        // Ignore local state errors
      }
    } catch (error) {
      p.log.error(
        `Failed to remove ${entry.owner}/${entry.repo}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  p.outro('Done!');
}
