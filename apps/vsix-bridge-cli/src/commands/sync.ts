import * as p from '@clack/prompts';
import type { Extension, MarketplaceExtension, MarketplaceVersion } from '../types.js';
import { detectAllIDEs, detectVSCode } from '../lib/ide-registry.js';
import { getExtensionsWithState } from '../lib/extensions.js';
import { fetchExtensionMetadataWithReason } from '../lib/marketplace.js';
import { satisfiesEngineSpec, compareVersions } from '../lib/semver.js';
import { downloadVsix, getVsixPath, ensureVsixCacheDir, cleanupStaleVsix } from '../lib/vsix.js';
import { getVsixFilename } from '../lib/marketplace.js';
import { mapWithConcurrency } from '../lib/concurrency.js';
import { buildInstallPlan, performInstallActions, type ActionOutcome } from './install.js';
import { describeAction } from '../lib/install-plan.js';

const DEFAULT_CONCURRENCY = 8;

interface SyncOptions {
  to: string[];
  concurrency?: number;
  verbose?: boolean;
  syncOnly?: boolean;
  syncRemovals?: boolean;
  dryRun?: boolean;
}

interface ExtensionOutcome {
  extensionId: string;
  status: 'synced' | 'skipped' | 'failed';
  reason?: string;
}

interface SyncResult {
  ide: string;
  synced: number;
  skipped: number;
  failed: number;
  cleaned: number;
  details: ExtensionOutcome[];
}

interface ExtensionWithMetadata {
  ext: Extension;
  metadata: MarketplaceExtension | null;
  error: string | null;
}

interface DownloadTask {
  ext: Extension;
  ideIndex: number;
  compatible: MarketplaceVersion;
  vsixPath: string;
  filename: string;
}

function findCompatibleVersion(
  versions: MarketplaceVersion[],
  engineVersion: string
): MarketplaceVersion | null {
  const sorted = [...versions].sort((a, b) => compareVersions(b.version, a.version));

  for (const v of sorted) {
    if (satisfiesEngineSpec(engineVersion, v.engineSpec)) {
      return v;
    }
  }
  return null;
}

export async function runSync(options: SyncOptions): Promise<void> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  const vscode = detectVSCode();
  if (!vscode) {
    p.log.error('VS Code not found. Cannot determine extension list.');
    return;
  }

  if (!vscode.cliAvailable) {
    p.log.error(
      'VS Code CLI (code) not available. Run "Shell Command: Install \'code\' command in PATH" from VS Code.'
    );
    return;
  }

  let targetIDEs = detectAllIDEs();
  if (options.to.length > 0) {
    targetIDEs = targetIDEs.filter((ide) => options.to.includes(ide.id));
    if (targetIDEs.length === 0) {
      p.log.error(`No matching IDEs found for: ${options.to.join(', ')}`);
      return;
    }
  }

  if (targetIDEs.length === 0) {
    p.log.error('No target IDEs detected. Install Cursor, Antigravity, or Windsurf.');
    return;
  }

  p.log.info(
    `Syncing to: ${targetIDEs.map((ide) => `${ide.name} (engine ${ide.engineVersion}${ide.cliAvailable ? '' : ', no CLI'})`).join(', ')}`
  );

  const cliLessIDEs = targetIDEs.filter((ide) => !ide.cliAvailable);
  for (const ide of cliLessIDEs) {
    p.log.warn(
      `${ide.name}: CLI '${ide.cli}' not found — VSIX files will be downloaded but install will be skipped. Run "Shell Command: Install '${ide.cli}' command in PATH" from ${ide.name} to fix.`
    );
  }

  const extensions = getExtensionsWithState(vscode.cli, vscode.dataFolderName);
  p.log.info(`Found ${extensions.length} extensions in VS Code`);

  for (const ide of targetIDEs) {
    ensureVsixCacheDir(ide.id);
  }

  const results: SyncResult[] = targetIDEs.map((ide) => ({
    ide: ide.name,
    synced: 0,
    skipped: 0,
    failed: 0,
    cleaned: 0,
    details: [] as ExtensionOutcome[],
  }));

  const expectedFilesByIde = new Map<string, Set<string>>();
  for (const ide of targetIDEs) {
    expectedFilesByIde.set(ide.id, new Set());
  }

  // Variables populated by tasks
  let extensionsWithMetadata: ExtensionWithMetadata[] = [];

  // Phase 1: Fetch metadata + Download VSIX files
  await p.tasks([
    {
      title: 'Fetching extension metadata',
      task: async (message) => {
        let fetchedCount = 0;
        extensionsWithMetadata = await mapWithConcurrency(
          extensions,
          async (ext): Promise<ExtensionWithMetadata> => {
            const result = await fetchExtensionMetadataWithReason(ext.id);
            fetchedCount++;
            message(`Fetching metadata (${fetchedCount}/${extensions.length})`);
            return { ext, metadata: result.metadata, error: result.error };
          },
          concurrency
        );
        return `Fetched metadata for ${extensions.length} extensions`;
      },
    },
    {
      title: 'Downloading VSIX files',
      task: async (message) => {
        const downloadTasks: DownloadTask[] = [];

        for (const { ext, metadata, error } of extensionsWithMetadata) {
          if (!metadata) {
            for (const result of results) {
              result.failed++;
              result.details.push({
                extensionId: ext.id,
                status: 'failed',
                reason: error ?? 'Unknown error',
              });
            }
            continue;
          }

          for (let i = 0; i < targetIDEs.length; i++) {
            const ide = targetIDEs[i]!;
            const result = results[i]!;

            const compatible = findCompatibleVersion(metadata.versions, ide.engineVersion);

            if (!compatible || !compatible.vsixUrl) {
              result.skipped++;
              result.details.push({
                extensionId: ext.id,
                status: 'skipped',
                reason: `No version compatible with engine ${ide.engineVersion}`,
              });
              continue;
            }

            const filename = getVsixFilename(ext.id, compatible.version);
            const vsixPath = getVsixPath(ide.id, ext.id, compatible.version);
            downloadTasks.push({ ext, ideIndex: i, compatible, vsixPath, filename });
          }
        }

        let downloadedCount = 0;
        await mapWithConcurrency(
          downloadTasks,
          async (task) => {
            const success = await downloadVsix(task.compatible.vsixUrl!, task.vsixPath);
            downloadedCount++;
            message(`Downloading (${downloadedCount}/${downloadTasks.length})`);

            const result = results[task.ideIndex]!;
            if (success) {
              const ide = targetIDEs[task.ideIndex]!;
              expectedFilesByIde.get(ide.id)!.add(task.filename);
              result.synced++;
              result.details.push({ extensionId: task.ext.id, status: 'synced' });
            } else {
              result.failed++;
              result.details.push({
                extensionId: task.ext.id,
                status: 'failed',
                reason: 'Download failed',
              });
            }
          },
          concurrency
        );

        // Cleanup stale cached files
        for (let i = 0; i < targetIDEs.length; i++) {
          const ide = targetIDEs[i]!;
          const result = results[i]!;
          const expectedFiles = expectedFilesByIde.get(ide.id)!;
          const removed = cleanupStaleVsix(ide.id, expectedFiles);
          result.cleaned = removed.length;
        }

        return `Downloaded ${downloadTasks.length} VSIX files`;
      },
    },
  ]);

  // Sync summary
  const verbose = options.verbose ?? false;

  for (const result of results) {
    const parts = [`${result.synced} synced`];
    if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
    if (result.failed > 0) parts.push(`${result.failed} failed`);
    if (result.cleaned > 0) parts.push(`${result.cleaned} cleaned`);
    p.log.success(`${result.ide}: ${parts.join(', ')}`);

    const failures = result.details.filter((d) => d.status === 'failed');
    for (const f of failures) {
      p.log.warn(`  FAILED ${f.extensionId}: ${f.reason}`);
    }

    if (verbose) {
      const skips = result.details.filter((d) => d.status === 'skipped');
      for (const s of skips) {
        p.log.warn(`  SKIPPED ${s.extensionId}: ${s.reason}`);
      }

      const synced = result.details.filter((d) => d.status === 'synced');
      for (const s of synced) {
        p.log.step(`  OK ${s.extensionId}`);
      }
    }
  }

  if (options.syncOnly) {
    return;
  }

  // Phase 2: Install extensions into target IDEs
  const installableIDEs = targetIDEs.filter((ide) => ide.cliAvailable);

  if (installableIDEs.length === 0) {
    return;
  }

  // Collect outcomes for failure reporting after all tasks complete
  const installOutcomes = new Map<string, ActionOutcome[]>();

  await p.tasks(
    installableIDEs.map((ide) => ({
      title: `Installing to ${ide.name}`,
      task: (message: (msg: string) => void) => {
        const { plan, cachedCount } = buildInstallPlan(ide, vscode.dataFolderName, {
          syncRemovals: options.syncRemovals ?? false,
        });

        if (cachedCount === 0 || plan.length === 0) {
          return `${ide.name}: already in sync`;
        }

        if (options.dryRun) {
          return `${ide.name}: ${plan.length} actions planned (dry run)`;
        }

        const { outcomes } = performInstallActions(ide, plan, (current, total, desc) => {
          message(`${ide.name} (${current + 1}/${total}): ${desc}`);
        });

        installOutcomes.set(ide.name, outcomes);

        const ok = outcomes.filter((o) => o.ok).length;
        const fail = outcomes.filter((o) => !o.ok).length;
        return fail > 0
          ? `${ide.name}: ${ok} succeeded, ${fail} failed`
          : `${ide.name}: installed ${ok} extensions`;
      },
    }))
  );

  // Show install failures and verbose details after all tasks
  for (const [, outcomes] of installOutcomes) {
    const failures = outcomes.filter((o) => !o.ok);
    for (const f of failures) {
      const desc = describeAction(f.action);
      const reason = f.error ? `: ${f.error}` : '';
      p.log.warn(`  FAILED ${desc}${reason}`);
    }

    if (verbose) {
      const successes = outcomes.filter((o) => o.ok);
      for (const s of successes) {
        p.log.step(`  OK ${describeAction(s.action)}`);
      }
    }
  }
}
