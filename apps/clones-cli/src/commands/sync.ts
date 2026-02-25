import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import { rm } from 'node:fs/promises';
import {
  readRegistry,
  writeRegistry,
  updateEntry,
  addEntry,
  filterByPattern,
  findEntry,
} from '../lib/registry.js';
import {
  readLocalState,
  writeLocalState,
  updateRepoLocalState,
  updateLastSyncRun,
} from '../lib/local-state.js';
import {
  GitCloneError,
  fetchWithPrune,
  resetHard,
  pullFastForward,
  getRepoStatus,
  updateSubmodules,
  usesLfs,
  pullLfs,
  cloneRepo,
  getCloneErrorHints,
  getRemoteUrl,
} from '../lib/git.js';
import { getRepoPath, DEFAULTS, getSyncConcurrency, getGitHubConfig } from '../lib/config.js';
import { createCancellationController } from '../lib/cancel.js';
import { scanClonesDir, isNestedRepo } from '../lib/scan.js';
import { parseGitUrl, generateRepoId } from '../lib/url-parser.js';
import { fetchGitHubMetadata } from '../lib/github.js';
import { fetchStarredRepos } from '../lib/github-stars.js';
import { normalizeConcurrency, runWithConcurrency } from '../lib/concurrency.js';
import { openDb, closeDb } from '../lib/db.js';
import { syncRegistryToDb } from '../lib/db-sync.js';
import { ensureSearchTables, indexReadme } from '../lib/db-search.js';
import {
  readIndexableDocuments,
  buildRepoProfileText,
  hashIndexInputs,
  chunkText,
} from '../lib/readme.js';
import type { RegistryEntry, UpdateResult, Registry } from '../types/index.js';

interface UpdateSummary {
  name: string;
  action: 'adopted' | 'removed' | 'cloned' | 'updated' | 'skipped' | 'refreshed' | 'error';
  detail?: string;
}

export default defineCommand({
  meta: {
    name: 'sync',
    description: 'Synchronize registry and clones (adopt, clone missing, fetch/reset)',
  },
  args: {
    filter: {
      type: 'string',
      description: 'Filter by owner/repo pattern (supports wildcards)',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Show what would happen without making changes',
    },
    force: {
      type: 'boolean',
      description: 'Proceed even if working tree is dirty',
    },
    keep: {
      type: 'boolean',
      description: 'Keep tombstoned repos on disk (do not delete)',
    },
    refresh: {
      type: 'boolean',
      description: 'Refresh metadata (description, tags) from GitHub for all repos',
    },
    concurrency: {
      type: 'string',
      description: 'Number of parallel git operations (default: 4, max: 10)',
    },
  },
  async run({ args }) {
    p.intro('clones sync');

    const cancellation = createCancellationController();
    let cancelled = false;
    const noticeCancellation = () => {
      if (!cancelled && cancellation.signal.aborted) {
        cancelled = true;
        p.log.warn('Cancellation requested; skipping remaining phases.');
      }
      return cancelled;
    };

    try {
      const dryRun = args['dry-run'] || false;
      const force = args.force || false;
      const keep = args.keep || false;
      const configConcurrency = getSyncConcurrency();
      const normalizedConfigConcurrency = normalizeConcurrency(configConcurrency, {
        defaultValue: 4,
      });
      if (configConcurrency !== undefined && normalizedConfigConcurrency.warning) {
        p.log.warn(normalizedConfigConcurrency.warning);
      }
      const { value: concurrency, warning: concurrencyWarning } = normalizeConcurrency(
        args.concurrency,
        {
          defaultValue: normalizedConfigConcurrency.value,
        }
      );
      if (concurrencyWarning) {
        p.log.warn(concurrencyWarning);
      }

      const syncOptions = {
        dryRun,
        force,
        keep,
        concurrency,
        signal: cancellation.signal,
        cancel: cancellation.cancel,
      };

      if (dryRun) {
        p.log.warn('Dry run mode - no changes will be made');
      }

      let registry = await readRegistry();
      let localState = await readLocalState();
      const summaries: UpdateSummary[] = [];

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 0: GITHUB STARS - Fetch and add starred repos
      // ═══════════════════════════════════════════════════════════════════
      const githubConfig = getGitHubConfig();
      if (githubConfig.token && githubConfig.syncStars) {
        if (!noticeCancellation()) {
          try {
            p.log.step('Phase 0: Syncing GitHub stars...');

            const starredRepos = await fetchStarredRepos(githubConfig.token);
            let newStars = 0;

            for (const star of starredRepos) {
              const repoId = generateRepoId({
                host: 'github.com',
                owner: star.owner,
                repo: star.repo,
                cloneUrl: star.cloneUrl,
              });

              // Check if already in registry
              if (findEntry(registry, repoId)) {
                continue;
              }

              if (!dryRun) {
                const entry: RegistryEntry = {
                  id: repoId,
                  host: 'github.com',
                  owner: star.owner,
                  repo: star.repo,
                  cloneUrl: star.cloneUrl,
                  description: star.description ?? undefined,
                  tags: star.topics.length > 0 ? star.topics : undefined,
                  defaultRemoteName: DEFAULTS.defaultRemoteName,
                  updateStrategy: DEFAULTS.updateStrategy,
                  submodules: DEFAULTS.submodules,
                  lfs: DEFAULTS.lfs,
                  managed: true,
                  source: 'github-star',
                  starredAt: star.starredAt,
                };

                registry = addEntry(registry, entry);
              }

              newStars += 1;
              summaries.push({
                name: `${star.owner}/${star.repo}`,
                action: 'adopted',
                detail: 'from GitHub stars',
              });
            }

            if (!dryRun && newStars > 0) {
              await writeRegistry(registry);
            }

            if (newStars > 0) {
              p.log.info(`  Found ${newStars} new starred repos`);
            } else {
              p.log.info('  No new starred repos');
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            p.log.warn(`Phase 0 failed: ${message}`);
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 1: ADOPT - Discover untracked repos on disk
      // ═══════════════════════════════════════════════════════════════════
      p.log.step('Phase 1: Discovering untracked repos...');

      const {
        adopted,
        removed,
        skipped: adoptSkipped,
        registry: registryAfterAdopt,
      } = await adoptPhase(registry, syncOptions);
      registry = registryAfterAdopt;

      for (const repo of adopted) {
        summaries.push({
          name: `${repo.owner}/${repo.repo}`,
          action: 'adopted',
        });
      }

      for (const repo of removed) {
        summaries.push({
          name: `${repo.owner}/${repo.repo}`,
          action: 'removed',
        });
      }

      for (const skipped of adoptSkipped) {
        summaries.push({
          name: `${skipped.owner}/${skipped.repo}`,
          action: 'skipped',
          detail: skipped.reason,
        });
      }

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 2: CLONE - Clone repos in registry but missing from disk
      // ═══════════════════════════════════════════════════════════════════
      if (!noticeCancellation()) {
        p.log.step('Phase 2: Cloning missing repos...');

        const { cloned, errors: cloneErrors } = await clonePhase(registry, syncOptions);

        for (const repo of cloned) {
          summaries.push({
            name: `${repo.owner}/${repo.repo}`,
            action: 'cloned',
          });
        }

        for (const err of cloneErrors) {
          summaries.push({
            name: err.name,
            action: 'error',
            detail: err.error,
          });
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 3: UPDATE - Fetch and reset all tracked repos
      // ═══════════════════════════════════════════════════════════════════
      if (!noticeCancellation()) {
        p.log.step('Phase 3: Updating repos...');

        // Apply filter if specified
        let reposToUpdate = registry.repos.filter((r) => r.managed);

        if (args.filter) {
          reposToUpdate = filterByPattern({ ...registry, repos: reposToUpdate }, args.filter);
          p.log.info(`  Filtering to: ${args.filter}`);
        }

        const concurrency = Math.min(Math.max(syncOptions.concurrency, 1), reposToUpdate.length);
        const progress = p.progress({
          max: reposToUpdate.length,
          style: 'heavy',
          signal: syncOptions.signal,
          onCancel: syncOptions.cancel,
        });
        let completed = 0;
        let updateErrors = 0;
        let noopCount = 0;

        if (reposToUpdate.length === 0) {
          p.log.info('  No repos to update');
        } else {
          progress.start();

          for await (const outcome of runWithConcurrency(
            reposToUpdate,
            concurrency,
            async (entry) => {
              const result = await updateRepo(entry, syncOptions);
              return { entry, result };
            },
            syncOptions.signal
          )) {
            completed += 1;
            const name = `${outcome.entry.owner}/${outcome.entry.repo}`;

            if (outcome.result.status === 'updated') {
              const commits = outcome.result.commits ?? 0;
              const wasDirty = outcome.result.wasDirty;
              const hadChanges = commits > 0 || wasDirty;

              if (hadChanges || dryRun) {
                const actionLabel = dryRun
                  ? 'would update'
                  : outcome.entry.updateStrategy === 'hard-reset'
                    ? 'reset'
                    : 'ff-only';
                const parts: string[] = [actionLabel];
                if (commits > 0) parts.push(`${commits} commits`);
                if (wasDirty) parts.push('was dirty');
                progress.message(`  ✓ ${name} (${parts.join(', ')})`);
              } else {
                noopCount += 1;
              }

              summaries.push({
                name,
                action: 'updated',
                detail: commits ? `${commits} commits` : undefined,
              });

              if (!dryRun) {
                localState = updateRepoLocalState(localState, outcome.entry.id, {
                  lastSyncedAt: new Date().toISOString(),
                });
              }
            } else if (outcome.result.status === 'skipped') {
              progress.message(`  ○ ${name} (${outcome.result.reason})`);
              summaries.push({
                name,
                action: 'skipped',
                detail: outcome.result.reason,
              });
            } else {
              updateErrors += 1;
              progress.message(`  ✗ ${name} (${outcome.result.error})`);
              summaries.push({
                name,
                action: 'error',
                detail: outcome.result.error,
              });
            }

            progress.advance(1, `${completed}/${reposToUpdate.length} updated`);
          }

          const parts: string[] = [];
          const actualUpdates = completed - noopCount - updateErrors;
          if (actualUpdates > 0) parts.push(`${actualUpdates} updated`);
          if (noopCount > 0) parts.push(`${noopCount} already up-to-date`);
          if (updateErrors > 0) parts.push(`${updateErrors} errors`);
          const summary = parts.length > 0 ? parts.join(', ') : 'Update complete';

          if (updateErrors > 0) {
            progress.stop(`Update completed with errors: ${summary}`);
          } else {
            progress.stop(`Update complete: ${summary}`);
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 4: REFRESH METADATA (optional)
      // ═══════════════════════════════════════════════════════════════════
      if (!noticeCancellation() && args.refresh) {
        p.log.step('Phase 4: Refreshing metadata from GitHub...');

        const githubRepos = registry.repos.filter((r) => r.host === 'github.com');

        if (githubRepos.length === 0) {
          p.log.info('  No GitHub repos to refresh');
        } else {
          const progress = p.progress({
            max: githubRepos.length,
            style: 'heavy',
            signal: syncOptions.signal,
            onCancel: syncOptions.cancel,
          });
          const log = p.taskLog({
            title: 'Refreshing metadata',
            retainLog: true,
            signal: syncOptions.signal,
          });
          let completed = 0;
          let refreshErrors = 0;

          progress.start('Refreshing metadata');

          for await (const outcome of runWithConcurrency(
            githubRepos,
            syncOptions.concurrency,
            async (entry) => {
              if (dryRun) {
                return { entry, status: 'dry-run' as const };
              }

              try {
                const metadata = await fetchGitHubMetadata(entry.owner, entry.repo);
                if (!metadata) {
                  return { entry, status: 'missing' as const };
                }
                return { entry, status: 'ok' as const, metadata };
              } catch (error) {
                return { entry, status: 'error' as const, error };
              }
            },
            syncOptions.signal
          )) {
            completed += 1;
            progress.advance(1, `${completed}/${githubRepos.length} refreshed`);

            const name = `${outcome.entry.owner}/${outcome.entry.repo}`;

            if (outcome.status === 'dry-run') {
              log.message(`  ↻ ${name} (would refresh)`);
              summaries.push({ name, action: 'refreshed' });
              continue;
            }

            if (outcome.status === 'missing') {
              log.message(`  ○ ${name} (could not fetch)`);
              continue;
            }

            if (outcome.status === 'error') {
              refreshErrors += 1;
              const message =
                outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
              log.message(`  ✗ ${name} (${message})`);
              continue;
            }

            const newDescription = outcome.metadata.description || undefined;
            const newTags =
              outcome.metadata.topics.length > 0 ? outcome.metadata.topics : undefined;

            const descChanged = outcome.entry.description !== newDescription;
            const tagsChanged = JSON.stringify(outcome.entry.tags) !== JSON.stringify(newTags);

            if (descChanged || tagsChanged) {
              registry = updateEntry(registry, outcome.entry.id, {
                description: newDescription,
                tags: newTags,
              });
              log.message(`  ↻ ${name} (refreshed)`);
              summaries.push({ name, action: 'refreshed' });
            } else {
              log.message(`  ○ ${name} (unchanged)`);
            }
          }

          if (refreshErrors > 0) {
            progress.stop('Refresh completed with errors');
            log.error('Refresh completed with errors');
          } else {
            progress.stop('Refresh complete');
            log.success('Refresh complete');
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // SAVE & SUMMARY
      // ═══════════════════════════════════════════════════════════════════
      noticeCancellation();
      if (!dryRun) {
        await writeRegistry(registry);
        // Update lastSyncRun and save local state
        localState = updateLastSyncRun(localState);
        await writeLocalState(localState);

        // Keep SQLite sidecar in sync even if later phases are cancelled.
        try {
          const db = await openDb();
          try {
            syncRegistryToDb(db, registry);
          } finally {
            closeDb();
          }
        } catch (error) {
          p.log.warn(
            `Could not update local index database: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 5: INDEX SEARCH CONTENT
      // ═══════════════════════════════════════════════════════════════════
      if (!dryRun && !noticeCancellation()) {
        p.log.step('Phase 5: Indexing search content...');

        try {
          const db = await openDb();

          try {
            // Sync registry to DB
            syncRegistryToDb(db, registry);

            // Ensure search tables exist
            ensureSearchTables(db);

            // Get managed repos
            const managedRepos = registry.repos.filter((r) => r.managed);

            if (managedRepos.length === 0) {
              p.log.info('  No managed repos to index');
            } else {
              const log = p.taskLog({
                title: 'Indexing search content',
                retainLog: true,
                signal: syncOptions.signal,
              });
              let indexed = 0;
              let skipped = 0;
              let errors = 0;

              for (const entry of managedRepos) {
                if (cancellation.signal.aborted) {
                  break;
                }

                const localPath = getRepoPath(entry.owner, entry.repo);
                const name = `${entry.owner}/${entry.repo}`;

                try {
                  const documents = await readIndexableDocuments(localPath);
                  const profileText = buildRepoProfileText(entry);
                  const fileChunks = documents.flatMap((doc) => chunkText(doc.content));
                  const profileChunks = chunkText(profileText, 500, 0);
                  const chunks = [...fileChunks, ...profileChunks];

                  if (chunks.length === 0) {
                    log.message(`  ○ ${name} (no indexable content)`);
                    skipped += 1;
                    continue;
                  }

                  const contentHash = hashIndexInputs(documents, profileText);
                  indexReadme(db, entry.id, profileText, contentHash, chunks);
                  log.message(`  ✓ ${name} (${documents.length} files + profile)`);
                  indexed += 1;
                } catch (error) {
                  errors += 1;
                  const message = error instanceof Error ? error.message : String(error);
                  log.message(`  ✗ ${name} (${message})`);
                }
              }

              const parts: string[] = [];
              if (indexed > 0) parts.push(`${indexed} indexed`);
              if (skipped > 0) parts.push(`${skipped} skipped`);
              if (errors > 0) parts.push(`${errors} errors`);
              const summary = parts.length > 0 ? parts.join(', ') : 'Indexing complete';

              if (errors > 0) {
                log.error(`Indexing completed with errors: ${summary}`);
              } else {
                log.success(summary);
              }
            }
          } finally {
            closeDb();
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          p.log.warn(`Phase 5 failed: ${message}`);
        }
      }

      console.log();
      printSummary(summaries, dryRun);

      p.outro(cancelled ? 'Cancelled' : 'Done!');
    } finally {
      cancellation.dispose();
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1: ADOPT
// ─────────────────────────────────────────────────────────────────────────────

interface AdoptResult {
  adopted: { owner: string; repo: string }[];
  removed: { owner: string; repo: string }[];
  skipped: { owner: string; repo: string; reason: string }[];
  registry: Registry;
}

async function adoptPhase(
  registry: Registry,
  options: { dryRun: boolean; force: boolean; keep: boolean; signal?: AbortSignal }
): Promise<AdoptResult> {
  const adopted: { owner: string; repo: string }[] = [];
  const removed: { owner: string; repo: string }[] = [];
  const skipped: { owner: string; repo: string; reason: string }[] = [];
  let updatedRegistry = registry;

  const { discovered } = await scanClonesDir();

  const log = p.taskLog({ title: 'Discovering repos', retainLog: true, signal: options.signal });
  let hasOutput = false;

  for (const repo of discovered) {
    // Check if already in registry
    const existing = registry.repos.find((e) => e.owner === repo.owner && e.repo === repo.repo);

    if (existing) {
      continue; // Already tracked
    }

    // Check if nested repo
    if (await isNestedRepo(repo.localPath)) {
      continue;
    }

    // Get remote URL
    const remoteUrl = await getRemoteUrl(repo.localPath);
    if (!remoteUrl) {
      continue; // No origin remote
    }

    // Parse URL
    let parsed;
    try {
      parsed = parseGitUrl(remoteUrl);
    } catch {
      continue; // Can't parse URL
    }

    const repoId = generateRepoId(parsed);
    const pathOwner = repo.owner.toLowerCase();
    const pathRepo = repo.repo.toLowerCase();

    if (pathOwner !== parsed.owner || pathRepo !== parsed.repo) {
      skipped.push({
        owner: repo.owner,
        repo: repo.repo,
        reason: `remote mismatch (${parsed.owner}/${parsed.repo})`,
      });
      log.message(
        `  ○ ${repo.owner}/${repo.repo} (remote mismatch: ${parsed.owner}/${parsed.repo})`
      );
      hasOutput = true;
      continue;
    }

    if (registry.tombstones.includes(repoId)) {
      if (options.keep) {
        skipped.push({ owner: repo.owner, repo: repo.repo, reason: 'tombstoned (--keep)' });
        log.message(`  ○ ${repo.owner}/${repo.repo} (tombstoned, keeping)`);
        hasOutput = true;
        continue;
      }

      const status = await getRepoStatus(repo.localPath);
      if (status.isDirty && !options.force) {
        skipped.push({ owner: repo.owner, repo: repo.repo, reason: 'dirty working tree' });
        log.message(`  ○ ${repo.owner}/${repo.repo} (dirty, use --force)`);
        hasOutput = true;
        continue;
      }

      if (options.dryRun) {
        removed.push({ owner: repo.owner, repo: repo.repo });
        log.message(`  - ${repo.owner}/${repo.repo} (would remove)`);
        hasOutput = true;
        continue;
      }

      try {
        await rm(repo.localPath, { recursive: true, force: true });
        removed.push({ owner: repo.owner, repo: repo.repo });
        log.message(`  - ${repo.owner}/${repo.repo} (removed)`);
        hasOutput = true;
      } catch (error) {
        skipped.push({
          owner: repo.owner,
          repo: repo.repo,
          reason: error instanceof Error ? error.message : String(error),
        });
        log.message(`  ○ ${repo.owner}/${repo.repo} (remove failed)`);
        hasOutput = true;
      }

      continue;
    }

    // Check if ID already exists (different owner/repo but same ID)
    if (findEntry(updatedRegistry, repoId)) {
      continue;
    }

    if (!options.dryRun) {
      // Fetch GitHub metadata if applicable
      let description: string | undefined;
      let tags: string[] | undefined;

      if (parsed.host === 'github.com') {
        const metadata = await fetchGitHubMetadata(parsed.owner, parsed.repo);
        if (metadata) {
          description = metadata.description || undefined;
          tags = metadata.topics.length > 0 ? metadata.topics : undefined;
        }
      }

      const entry: RegistryEntry = {
        id: repoId,
        host: parsed.host,
        owner: parsed.owner,
        repo: parsed.repo,
        cloneUrl: parsed.cloneUrl,
        description,
        tags,
        defaultRemoteName: DEFAULTS.defaultRemoteName,
        updateStrategy: DEFAULTS.updateStrategy,
        submodules: DEFAULTS.submodules,
        lfs: DEFAULTS.lfs,
        managed: true,
      };

      updatedRegistry = addEntry(updatedRegistry, entry);
    }

    adopted.push({ owner: repo.owner, repo: repo.repo });
    log.message(`  + ${repo.owner}/${repo.repo}${options.dryRun ? ' (would adopt)' : ''}`);
    hasOutput = true;
  }

  if (hasOutput) {
    const parts: string[] = [];
    if (adopted.length > 0) parts.push(`${adopted.length} adopted`);
    if (removed.length > 0) parts.push(`${removed.length} removed`);
    if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
    log.success(parts.length > 0 ? parts.join(', ') : 'Discovery complete');
  } else {
    log.success('No untracked repos found');
  }

  return { adopted, removed, skipped, registry: updatedRegistry };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2: CLONE
// ─────────────────────────────────────────────────────────────────────────────

interface CloneResult {
  cloned: { owner: string; repo: string }[];
  errors: { name: string; error: string }[];
}

async function clonePhase(
  registry: Registry,
  options: { dryRun: boolean; concurrency?: number; signal?: AbortSignal; cancel?: () => void }
): Promise<CloneResult> {
  const cloned: { owner: string; repo: string }[] = [];
  const errors: { name: string; error: string }[] = [];
  const targets: { entry: RegistryEntry; localPath: string; name: string }[] = [];

  for (const entry of registry.repos) {
    if (!entry.managed) continue;

    const localPath = getRepoPath(entry.owner, entry.repo);
    const status = await getRepoStatus(localPath);

    if (status.exists && status.isGitRepo) {
      continue; // Already exists
    }

    const name = `${entry.owner}/${entry.repo}`;
    targets.push({ entry, localPath, name });
  }

  const log = p.taskLog({ title: 'Cloning repos', retainLog: true, signal: options.signal });

  if (targets.length === 0) {
    log.success('No missing repos to clone');
    return { cloned, errors };
  }

  if (options.dryRun) {
    for (const target of targets) {
      log.message(`  + ${target.name} (would clone)`);
      cloned.push({ owner: target.entry.owner, repo: target.entry.repo });
    }
    log.success(`${cloned.length} would be cloned`);
    return { cloned, errors };
  }

  const concurrency = Math.min(Math.max(options.concurrency ?? 4, 1), targets.length);
  const progress = p.progress({
    max: targets.length,
    style: 'heavy',
    signal: options.signal,
    onCancel: options.cancel,
  });
  let completed = 0;

  progress.start('Cloning repos');

  for await (const result of runWithConcurrency(
    targets,
    concurrency,
    async (target) => {
      try {
        await cloneRepo(target.entry.cloneUrl, target.localPath, {
          remoteName: target.entry.defaultRemoteName,
        });
        return { target, status: 'cloned' as const };
      } catch (error) {
        return { target, status: 'error' as const, error };
      }
    },
    options.signal
  )) {
    completed += 1;
    progress.advance(1, `${completed}/${targets.length} cloned`);

    if (result.status === 'cloned') {
      cloned.push({ owner: result.target.entry.owner, repo: result.target.entry.repo });
      log.message(`  ✓ ${result.target.name} (cloned)`);
    } else {
      const error = result.error;
      log.message(`  ✗ ${result.target.name} (clone failed)`);
      if (error instanceof GitCloneError) {
        for (const hint of getCloneErrorHints(error)) {
          log.message(`    ${hint}`);
        }
      }
      errors.push({
        name: result.target.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (errors.length > 0) {
    progress.stop('Cloning completed with errors');
    log.error(`${cloned.length} cloned, ${errors.length} errors`);
  } else {
    progress.stop('Cloning complete');
    log.success(`${cloned.length} cloned`);
  }

  return { cloned, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3: UPDATE (existing logic, slightly refactored)
// ─────────────────────────────────────────────────────────────────────────────

async function updateRepo(
  entry: RegistryEntry,
  options: { dryRun: boolean; force: boolean }
): Promise<UpdateResult> {
  const localPath = getRepoPath(entry.owner, entry.repo);
  // Check status
  const status = await getRepoStatus(localPath);

  if (!status.exists) {
    return { status: 'skipped', reason: 'directory missing' };
  }

  if (!status.isGitRepo) {
    return { status: 'skipped', reason: 'not a git repo' };
  }

  if (status.isDetached) {
    return { status: 'skipped', reason: 'detached HEAD' };
  }

  if (!status.tracking) {
    return { status: 'skipped', reason: 'no upstream tracking' };
  }

  const wasDirty = status.isDirty;

  if (wasDirty && !options.force) {
    return { status: 'skipped', reason: 'dirty working tree' };
  }

  if (options.dryRun) {
    return { status: 'updated', commits: 0, wasDirty };
  }

  try {
    await fetchWithPrune(localPath, entry.defaultRemoteName);

    // Reset or pull based on strategy
    let commits = 0;
    if (entry.updateStrategy === 'hard-reset') {
      commits = await resetHard(localPath);
    } else {
      commits = await pullFastForward(localPath);
    }

    // Submodules
    if (entry.submodules === 'recursive') {
      try {
        await updateSubmodules(localPath);
      } catch {
        // Silent fail for submodules
      }
    }

    // LFS
    if (entry.lfs === 'always' || (entry.lfs === 'auto' && (await usesLfs(localPath)))) {
      try {
        await pullLfs(localPath, entry.defaultRemoteName);
      } catch {
        // Silent fail for LFS
      }
    }

    return { status: 'updated', commits, wasDirty };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'error', error: message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

function printSummary(summaries: UpdateSummary[], dryRun: boolean): void {
  const adopted = summaries.filter((s) => s.action === 'adopted').length;
  const removed = summaries.filter((s) => s.action === 'removed').length;
  const cloned = summaries.filter((s) => s.action === 'cloned').length;
  const updated = summaries.filter((s) => s.action === 'updated').length;
  const refreshed = summaries.filter((s) => s.action === 'refreshed').length;
  const skipped = summaries.filter((s) => s.action === 'skipped').length;
  const errors = summaries.filter((s) => s.action === 'error').length;

  console.log('─'.repeat(50));

  if (dryRun) {
    console.log('Would:');
  }

  const parts: string[] = [];
  if (adopted > 0) parts.push(`${adopted} adopted`);
  if (removed > 0) parts.push(`${removed} removed`);
  if (cloned > 0) parts.push(`${cloned} cloned`);
  if (refreshed > 0) parts.push(`${refreshed} refreshed`);
  if (updated > 0) parts.push(`${updated} updated`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (errors > 0) parts.push(`${errors} errors`);

  if (parts.length === 0) {
    console.log('Nothing to do.');
  } else {
    console.log(parts.join(', '));
  }
}
