import { readdir, stat, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { getClonesDir } from './config.js';
import { isSafePathSegment } from './path-utils.js';

/**
 * Represents a discovered repository on disk
 */
export interface DiscoveredRepo {
  owner: string;
  repo: string;
  localPath: string;
  hasGit: boolean;
}

/**
 * Represents the result of scanning a potential repo location
 */
export interface ScanResult {
  discovered: DiscoveredRepo[];
  skipped: { path: string; reason: string }[];
}

/**
 * Check if a path is a symlink
 */
async function isSymlink(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    return stats.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Check if a path is a directory (following symlinks)
 */
async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Scan the clones directory for repositories at depth 2
 * Expects structure: $CLONES_DIR/owner/repo/.git
 */
export async function scanClonesDir(): Promise<ScanResult> {
  const clonesDir = getClonesDir();
  const discovered: DiscoveredRepo[] = [];
  const skipped: { path: string; reason: string }[] = [];

  // Ensure clones dir exists
  if (!existsSync(clonesDir)) {
    return { discovered, skipped };
  }

  // List owner directories (depth 1)
  let ownerDirs: string[];
  try {
    ownerDirs = await readdir(clonesDir);
  } catch (error) {
    skipped.push({
      path: clonesDir,
      reason: `Cannot read directory: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { discovered, skipped };
  }

  for (const owner of ownerDirs) {
    // Skip hidden files and registry files
    if (
      owner.startsWith('.') ||
      owner === 'registry.json' ||
      owner === 'registry.toml' ||
      owner === 'registry.jsonl'
    ) {
      continue;
    }
    if (!isSafePathSegment(owner)) {
      skipped.push({ path: join(clonesDir, owner), reason: 'Unsafe path segment' });
      continue;
    }

    const ownerPath = join(clonesDir, owner);

    // Skip symlinks at owner level
    if (await isSymlink(ownerPath)) {
      skipped.push({ path: ownerPath, reason: 'Symlink (skipped)' });
      continue;
    }

    // Skip non-directories
    if (!(await isDirectory(ownerPath))) {
      continue;
    }

    // List repo directories (depth 2)
    let repoDirs: string[];
    try {
      repoDirs = await readdir(ownerPath);
    } catch (error) {
      skipped.push({
        path: ownerPath,
        reason: `Cannot read directory: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    for (const repo of repoDirs) {
      // Skip hidden directories
      if (repo.startsWith('.')) {
        continue;
      }
      if (!isSafePathSegment(repo)) {
        skipped.push({ path: join(ownerPath, repo), reason: 'Unsafe path segment' });
        continue;
      }

      const repoPath = join(ownerPath, repo);

      // Skip symlinks at repo level
      if (await isSymlink(repoPath)) {
        skipped.push({ path: repoPath, reason: 'Symlink (skipped)' });
        continue;
      }

      // Skip non-directories
      if (!(await isDirectory(repoPath))) {
        continue;
      }

      // Check for .git directory
      const gitPath = join(repoPath, '.git');
      const hasGit = existsSync(gitPath);

      if (!hasGit) {
        skipped.push({ path: repoPath, reason: 'No .git directory' });
        continue;
      }

      discovered.push({
        owner,
        repo,
        localPath: repoPath,
        hasGit: true,
      });
    }
  }

  return { discovered, skipped };
}

/**
 * Check if a repo appears to be a submodule or worktree (nested repo)
 * A submodule has a .git file (not directory) pointing elsewhere
 * A worktree has a .git file with "gitdir:" reference
 */
export async function isNestedRepo(localPath: string): Promise<boolean> {
  const gitPath = join(localPath, '.git');

  try {
    const stats = await lstat(gitPath);

    // If .git is a file (not directory), it's likely a submodule or worktree
    if (stats.isFile()) {
      return true;
    }

    // Check for signs of being inside another repo
    // Walk up to see if there's a parent .git
    const clonesDir = getClonesDir();
    let current = localPath;

    while (current !== clonesDir && current !== '/') {
      const parent = join(current, '..');
      const parentGit = join(parent, '.git');

      if (existsSync(parentGit) && parent !== clonesDir) {
        // There's a .git above us (but not at clones root)
        return true;
      }

      current = parent;
    }

    return false;
  } catch {
    return false;
  }
}
