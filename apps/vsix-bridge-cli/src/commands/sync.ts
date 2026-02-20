import * as p from '@clack/prompts';
import type { Extension, MarketplaceExtension, MarketplaceVersion } from '../types.js';
import { detectAllIDEs, detectVSCode } from '../lib/ide-registry.js';
import { getExtensionsWithState } from '../lib/extensions.js';
import { fetchExtensionMetadata } from '../lib/marketplace.js';
import { satisfiesEngineSpec, compareVersions } from '../lib/semver.js';
import { downloadVsix, getVsixPath, ensureVsixCacheDir, cleanupStaleVsix } from '../lib/vsix.js';
import { getVsixFilename } from '../lib/marketplace.js';
import { mapWithConcurrency } from '../lib/concurrency.js';

const DEFAULT_CONCURRENCY = 8;

interface SyncOptions {
  to: string[];
  concurrency?: number;
}

interface SyncResult {
  ide: string;
  synced: number;
  skipped: number;
  failed: number;
  cleaned: number;
}

interface ExtensionWithMetadata {
  ext: Extension;
  metadata: MarketplaceExtension | null;
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
    `Syncing to: ${targetIDEs.map((ide) => `${ide.name} (engine ${ide.engineVersion})`).join(', ')}`
  );

  const extensions = getExtensionsWithState(vscode.cli, vscode.dataFolderName);
  p.log.info(`Found ${extensions.length} extensions in VS Code`);
  p.log.info(`Using concurrency: ${concurrency}`);

  for (const ide of targetIDEs) {
    ensureVsixCacheDir(ide.id);
  }

  const results: SyncResult[] = targetIDEs.map((ide) => ({
    ide: ide.name,
    synced: 0,
    skipped: 0,
    failed: 0,
    cleaned: 0,
  }));

  const expectedFilesByIde = new Map<string, Set<string>>();
  for (const ide of targetIDEs) {
    expectedFilesByIde.set(ide.id, new Set());
  }

  const spinner = p.spinner();

  spinner.start(`Fetching metadata for ${extensions.length} extensions...`);

  let fetchedCount = 0;
  const extensionsWithMetadata = await mapWithConcurrency(
    extensions,
    async (ext): Promise<ExtensionWithMetadata> => {
      const metadata = await fetchExtensionMetadata(ext.id);
      fetchedCount++;
      spinner.message(`Fetched ${fetchedCount}/${extensions.length}: ${ext.id}`);
      return { ext, metadata };
    },
    concurrency
  );

  spinner.message('Downloading VSIX files...');

  interface DownloadTask {
    ext: Extension;
    ideIndex: number;
    compatible: MarketplaceVersion;
    vsixPath: string;
    filename: string;
  }

  const downloadTasks: DownloadTask[] = [];

  for (const { ext, metadata } of extensionsWithMetadata) {
    if (!metadata) {
      for (const result of results) {
        result.failed++;
      }
      continue;
    }

    for (let i = 0; i < targetIDEs.length; i++) {
      const ide = targetIDEs[i]!;
      const result = results[i]!;

      const compatible = findCompatibleVersion(metadata.versions, ide.engineVersion);

      if (!compatible || !compatible.vsixUrl) {
        result.skipped++;
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
      spinner.message(`Downloaded ${downloadedCount}/${downloadTasks.length}`);

      const result = results[task.ideIndex]!;
      if (success) {
        const ide = targetIDEs[task.ideIndex]!;
        expectedFilesByIde.get(ide.id)!.add(task.filename);
        result.synced++;
      } else {
        result.failed++;
      }
    },
    concurrency
  );

  // expectedFiles populated only after successful downloads (see above)
  for (let i = 0; i < targetIDEs.length; i++) {
    const ide = targetIDEs[i]!;
    const result = results[i]!;
    const expectedFiles = expectedFilesByIde.get(ide.id)!;
    const removed = cleanupStaleVsix(ide.id, expectedFiles);
    result.cleaned = removed.length;
  }

  spinner.stop('Sync complete');

  for (const result of results) {
    p.log.success(
      `${result.ide}: ${result.synced} synced, ${result.skipped} skipped, ${result.failed} failed, ${result.cleaned} cleaned`
    );
  }
}
