import { createWriteStream, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { ensureDir, getVsixCacheDir } from './storage.js';
import { getVsixFilename } from './marketplace.js';
import type { SyncedVSIX } from '../types.js';
import { FETCH_VSIX_TIMEOUT_MS } from './timeouts.js';

export async function downloadVsix(url: string, destPath: string): Promise<boolean> {
  if (existsSync(destPath)) {
    return true;
  }

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_VSIX_TIMEOUT_MS) });
    if (!response.ok || !response.body) {
      return false;
    }

    const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);
    const fileStream = createWriteStream(destPath);
    await pipeline(nodeStream, fileStream);
    return true;
  } catch {
    if (existsSync(destPath)) {
      unlinkSync(destPath);
    }
    return false;
  }
}

export function getVsixPath(ideId: string, extensionId: string, version: string): string {
  const cacheDir = getVsixCacheDir(ideId);
  const filename = getVsixFilename(extensionId, version);
  return join(cacheDir, filename);
}

export function ensureVsixCacheDir(ideId: string): void {
  ensureDir(getVsixCacheDir(ideId));
}

export function listCachedVsix(ideId: string): SyncedVSIX[] {
  const cacheDir = getVsixCacheDir(ideId);
  if (!existsSync(cacheDir)) {
    return [];
  }

  const files = readdirSync(cacheDir).filter((f) => f.endsWith('.vsix'));
  const result: SyncedVSIX[] = [];

  for (const file of files) {
    const match = file.match(/^(.+)-(\d+\.\d+\.\d+.*)\.vsix$/);
    if (match?.[1] && match[2]) {
      result.push({
        extensionId: match[1],
        version: match[2],
        path: join(cacheDir, file),
        sourceDisabled: false,
      });
    }
  }

  return result;
}

export function cleanupStaleVsix(ideId: string, expectedFiles: Set<string>): string[] {
  const cacheDir = getVsixCacheDir(ideId);
  if (!existsSync(cacheDir)) {
    return [];
  }

  const removed: string[] = [];
  const files = readdirSync(cacheDir).filter((f) => f.endsWith('.vsix'));

  for (const file of files) {
    if (!expectedFiles.has(file)) {
      const fullPath = join(cacheDir, file);
      try {
        unlinkSync(fullPath);
        removed.push(file);
      } catch {
        // Skip undeletable files (permissions, concurrent access, etc.)
      }
    }
  }

  return removed;
}

export function parseVsixFilename(
  filename: string
): { extensionId: string; version: string } | null {
  const match = filename.match(/^(.+)-(\d+\.\d+\.\d+.*)\.vsix$/);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return {
    extensionId: match[1],
    version: match[2],
  };
}
