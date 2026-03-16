import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SUPPORTED_TOOLS } from '../types/index.js';
import type { CacheDir } from '../types/index.js';

export interface CacheDirInfo {
  dir: CacheDir;
  absolutePath: string;
  exists: boolean;
  sizeBytes: number;
}

export interface ClearResult {
  dir: CacheDir;
  absolutePath: string;
  cleared: boolean;
  error?: string;
}

/** Check whether an agent has cacheDirs defined */
export function hasCacheDirs(agent: string): boolean {
  const tool = SUPPORTED_TOOLS[agent];
  if (!tool?.cacheDirs) return false;
  return tool.cacheDirs.safe.length > 0 || tool.cacheDirs.optional.length > 0;
}

/** Return agent names that have cacheDirs defined */
export function agentsWithCacheDirs(): string[] {
  return Object.keys(SUPPORTED_TOOLS).filter(hasCacheDirs);
}

/** Recursively compute total size of a directory in bytes */
async function dirSize(dirPath: string): Promise<number> {
  let total = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += await dirSize(entryPath);
      } else {
        const stat = await fs.stat(entryPath);
        total += stat.size;
      }
    }
  } catch {
    // Directory may have been removed or be inaccessible
  }
  return total;
}

/** Inspect cache dirs for an agent, returning info about each */
export async function inspectAgentCacheDirs(
  agent: string
): Promise<{ safe: CacheDirInfo[]; optional: CacheDirInfo[] } | null> {
  const tool = SUPPORTED_TOOLS[agent];
  if (!tool?.cacheDirs) return null;

  const home = os.homedir();

  async function inspect(dir: CacheDir): Promise<CacheDirInfo> {
    const absolutePath = path.join(home, dir.path);
    let exists = false;
    let sizeBytes = 0;
    try {
      await fs.access(absolutePath);
      exists = true;
      sizeBytes = await dirSize(absolutePath);
    } catch {
      // Does not exist
    }
    return { dir, absolutePath, exists, sizeBytes };
  }

  const [safe, optional] = await Promise.all([
    Promise.all(tool.cacheDirs.safe.map(inspect)),
    Promise.all(tool.cacheDirs.optional.map(inspect)),
  ]);

  return { safe, optional };
}

/** Delete the given directories, returning results for each */
export async function clearCacheDirs(dirs: CacheDirInfo[]): Promise<ClearResult[]> {
  const results: ClearResult[] = [];
  for (const info of dirs) {
    if (!info.exists) {
      results.push({ dir: info.dir, absolutePath: info.absolutePath, cleared: false });
      continue;
    }
    try {
      await fs.rm(info.absolutePath, { recursive: true, force: true });
      results.push({ dir: info.dir, absolutePath: info.absolutePath, cleared: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        dir: info.dir,
        absolutePath: info.absolutePath,
        cleared: false,
        error: message,
      });
    }
  }
  return results;
}

/** Format byte count as human-readable string */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}
