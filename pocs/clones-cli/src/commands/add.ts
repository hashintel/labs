import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import { parseGitUrl, generateRepoId, isValidGitUrl } from '../lib/url-parser.js';
import {
  readRegistry,
  writeRegistry,
  addEntry,
  findEntry,
  removeTombstone,
} from '../lib/registry.js';
import { readLocalState, writeLocalState, updateRepoLocalState } from '../lib/local-state.js';
import { GitCloneError, cloneRepo, getCloneErrorHints, getRepoStatus } from '../lib/git.js';
import { getRepoPath, DEFAULTS, ensureClonesDir } from '../lib/config.js';
import { fetchGitHubMetadata } from '../lib/github.js';
import type { Registry, LocalState, RegistryEntry } from '../types/index.js';
import type { RepoInfo } from '../lib/browse/batch-actions.js';
import { showSingleRepoActions } from '../lib/browse/single-actions.js';

interface CloneOptions {
  tags?: string;
  description?: string;
  updateStrategy?: string;
  submodules?: string;
  lfs?: string;
  full: boolean;
  allBranches: boolean;
}

interface CloneContext {
  registry: Registry;
  localState: LocalState;
}

type CloneOutcome = {
  context: CloneContext;
  added?: {
    entry: RegistryEntry;
    localPath: string;
  };
};

async function cloneUrl(
  url: string,
  options: CloneOptions,
  context: CloneContext
): Promise<CloneOutcome> {
  let { registry, localState } = context;
  let spinnerStarted = false;
  const s = p.spinner();

  try {
    const parsed = parseGitUrl(url);
    const repoId = generateRepoId(parsed);
    const localPath = getRepoPath(parsed.owner, parsed.repo);

    p.log.info(`Repository: ${parsed.owner}/${parsed.repo}`);
    p.log.info(`Host: ${parsed.host}`);

    if (findEntry(registry, repoId)) {
      p.log.error(`Repository already exists in registry: ${repoId}`);
      p.log.info("Use 'clones update' to sync it, or 'clones rm' to remove it first.");
      return { context };
    }

    const status = await getRepoStatus(localPath);
    if (status.exists) {
      p.log.error(`Local directory already exists: ${localPath}`);
      p.log.info("Use 'clones adopt' to add existing repos to the registry.");
      return { context };
    }

    await ensureClonesDir();

    let autoDescription: string | undefined;
    let autoTopics: string[] | undefined;

    if (parsed.host === 'github.com' && !options.description) {
      s.start(`Fetching metadata from GitHub...`);
      spinnerStarted = true;
      const metadata = await fetchGitHubMetadata(parsed.owner, parsed.repo);
      if (metadata) {
        autoDescription = metadata.description || undefined;
        autoTopics = metadata.topics.length > 0 ? metadata.topics : undefined;
        s.stop('Metadata fetched');
      } else {
        s.stop('Could not fetch metadata (continuing without)');
      }
    }

    s.start(`Cloning ${parsed.owner}/${parsed.repo}...`);
    spinnerStarted = true;

    await cloneRepo(parsed.cloneUrl, localPath, {
      fullHistory: options.full,
      allBranches: options.allBranches,
    });

    s.stop(`Cloned to ${localPath}`);

    const userTags = options.tags
      ? options.tags.split(',').map((t: string) => t.trim())
      : undefined;

    const tags = userTags || autoTopics;

    const updateStrategy =
      options.updateStrategy === 'ff-only' ? 'ff-only' : DEFAULTS.updateStrategy;

    const submodules = options.submodules === 'recursive' ? 'recursive' : DEFAULTS.submodules;

    const lfs =
      options.lfs === 'always' ? 'always' : options.lfs === 'never' ? 'never' : DEFAULTS.lfs;

    const entry: RegistryEntry = {
      id: repoId,
      host: parsed.host,
      owner: parsed.owner,
      repo: parsed.repo,
      cloneUrl: parsed.cloneUrl,
      description: options.description || autoDescription,
      tags,
      defaultRemoteName: DEFAULTS.defaultRemoteName,
      updateStrategy,
      submodules,
      lfs,
      managed: true,
    };

    registry = addEntry(registry, entry);
    registry = removeTombstone(registry, repoId);
    await writeRegistry(registry);

    localState = updateRepoLocalState(localState, repoId, {
      lastSyncedAt: new Date().toISOString(),
    });
    await writeLocalState(localState);

    p.log.success(`Added ${parsed.owner}/${parsed.repo} to registry`);

    if (tags && tags.length > 0) {
      p.log.info(`Tags: ${tags.join(', ')}`);
    }

    return { context: { registry, localState }, added: { entry, localPath } };
  } catch (error) {
    if (spinnerStarted) {
      s.stop(error instanceof GitCloneError ? 'Clone failed' : 'Failed');
    }

    if (error instanceof GitCloneError) {
      p.log.error(error.message);
      for (const hint of getCloneErrorHints(error)) {
        p.log.info(hint);
      }
      return { context };
    }

    p.log.error(error instanceof Error ? error.message : String(error));
    return { context };
  }
}

export default defineCommand({
  meta: {
    name: 'add',
    description: 'Add a new clone by Git URL',
  },
  args: {
    url: {
      type: 'positional',
      description: 'Git URL (HTTPS or SSH) - can provide multiple',
      required: false,
    },
    tags: {
      type: 'string',
      description: 'Comma-separated tags',
    },
    description: {
      type: 'string',
      description: 'Human-readable description',
    },
    'update-strategy': {
      type: 'string',
      description: 'Update strategy: hard-reset (default) or ff-only',
    },
    submodules: {
      type: 'string',
      description: 'Submodule handling: none (default) or recursive',
    },
    lfs: {
      type: 'string',
      description: 'LFS handling: auto (default), always, or never',
    },
    full: {
      type: 'boolean',
      description: 'Clone full history (default: shallow clone with depth 1)',
      default: false,
    },
    'all-branches': {
      type: 'boolean',
      description: 'Clone all branches (default: single branch only)',
      default: false,
    },
  },
  async run({ args, rawArgs }) {
    p.intro('clones add');

    const options: CloneOptions = {
      tags: args.tags,
      description: args.description,
      updateStrategy: args['update-strategy'],
      submodules: args.submodules,
      lfs: args.lfs,
      full: args.full,
      allBranches: args['all-branches'],
    };

    const urls: string[] = [];
    if (args.url) {
      urls.push(args.url);
    }
    for (const arg of rawArgs ?? []) {
      if (!arg.startsWith('-') && arg !== args.url && !urls.includes(arg)) {
        urls.push(arg);
      }
    }

    let context: CloneContext = {
      registry: await readRegistry(),
      localState: await readLocalState(),
    };

    if (urls.length > 0) {
      for (const url of urls) {
        const outcome = await cloneUrl(url, options, context);
        context = outcome.context;
      }
      p.outro('Done!');
      return;
    }

    while (true) {
      const url = await p.text({
        message: 'Enter Git URL',
        placeholder: 'https://github.com/owner/repo or git@github.com:owner/repo',
        validate: (value) => {
          if (!value) return undefined;
          if (!isValidGitUrl(value)) {
            return 'Enter a valid Git URL (HTTPS or SSH)';
          }
          return undefined;
        },
      });

      if (p.isCancel(url)) {
        p.cancel('Cancelled');
        return;
      }

      if (!url) {
        break;
      }

      const outcome = await cloneUrl(url, options, context);
      context = outcome.context;

      if (outcome.added) {
        const status = await getRepoStatus(outcome.added.localPath);
        const repoInfo: RepoInfo = {
          entry: outcome.added.entry,
          status,
          localPath: outcome.added.localPath,
        };

        const action = await showSingleRepoActions(repoInfo, 'add');
        if (action === 'add-another') {
          continue;
        }
        p.outro('Done!');
        return;
      }

      const another = await p.confirm({ message: 'Add another?' });
      if (p.isCancel(another)) {
        p.cancel('Cancelled');
        return;
      }

      if (!another) {
        break;
      }
    }

    p.outro('Done!');
  },
});
