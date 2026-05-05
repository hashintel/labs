import { simpleGit, type StatusResult } from 'simple-git';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { RepoStatus } from '../types/index.js';

const CLONE_TIMEOUT_MS = 60_000;

export class GitCloneError extends Error {
  readonly isTimeout: boolean;
  readonly isAuthError: boolean;
  readonly isNotFound: boolean;

  constructor(
    message: string,
    options: { isTimeout?: boolean; isAuthError?: boolean; isNotFound?: boolean } = {}
  ) {
    super(message);
    this.name = 'GitCloneError';
    this.isTimeout = options.isTimeout ?? false;
    this.isAuthError = options.isAuthError ?? false;
    this.isNotFound = options.isNotFound ?? false;
  }
}

export function getCloneErrorHints(error: GitCloneError): string[] {
  const hints: string[] = [];

  if (error.isTimeout) {
    hints.push('Clone timed out: check network access or try again later.');
  }

  if (error.isAuthError) {
    hints.push('Authentication failed: verify SSH keys or HTTPS credentials.');
  }

  if (error.isNotFound) {
    hints.push('Repository not found or you do not have access.');
  }

  return hints;
}

function classifyCloneError(error: unknown): GitCloneError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const isTimeout = lower.includes('timeout') || lower.includes('timed out');
  const isAuthError =
    lower.includes('authentication failed') ||
    lower.includes('permission denied') ||
    lower.includes('publickey') ||
    lower.includes('could not read from remote repository') ||
    lower.includes('access denied');
  const isNotFound = lower.includes('repository not found') || lower.includes('not found');

  return new GitCloneError(message, { isTimeout, isAuthError, isNotFound });
}

async function removeDirIfEmpty(dir: string): Promise<void> {
  try {
    const entries = await readdir(dir);
    if (entries.length === 0) {
      await rm(dir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Clone a repository to a local path
 *
 * By default uses shallow clone (--depth 1) and single branch (--single-branch)
 * for faster cloning. Use fullHistory and allBranches options to override.
 */
export async function cloneRepo(
  url: string,
  localPath: string,
  options: {
    remoteName?: string;
    fullHistory?: boolean;
    allBranches?: boolean;
  } = {}
): Promise<void> {
  const git = simpleGit({ timeout: { block: CLONE_TIMEOUT_MS } });
  const remoteName = options.remoteName || 'origin';
  const parentDir = dirname(localPath);
  const parentExisted = existsSync(parentDir);

  const cloneArgs: string[] = ['--origin', remoteName];

  // Default to shallow clone unless fullHistory is requested
  if (!options.fullHistory) {
    cloneArgs.push('--depth', '1');
  }

  // Default to single branch unless allBranches is requested
  if (!options.allBranches) {
    cloneArgs.push('--single-branch');
  }

  if (!parentExisted) {
    await mkdir(parentDir, { recursive: true });
  }

  const tempDir = await mkdtemp(join(parentDir, '.clone-'));

  try {
    await git.clone(url, tempDir, cloneArgs);
    await rename(tempDir, localPath);
  } catch (error) {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    if (!parentExisted) {
      await removeDirIfEmpty(parentDir);
    }

    throw classifyCloneError(error);
  }
}

/**
 * Fetch from remote with prune
 */
export async function fetchWithPrune(
  localPath: string,
  remoteName: string = 'origin'
): Promise<void> {
  const git = simpleGit(localPath);
  await git.fetch(remoteName, ['--prune']);
}

/**
 * Reset to upstream tracking branch (hard reset)
 */
export async function resetHard(localPath: string): Promise<number> {
  const git = simpleGit(localPath);

  // Get current position before reset
  const beforeLog = await git.log({ maxCount: 1 });
  const beforeHash = beforeLog.latest?.hash;

  // Reset to upstream
  await git.reset(['--hard', '@{u}']);

  // Get new position after reset
  const afterLog = await git.log({ maxCount: 1 });
  const afterHash = afterLog.latest?.hash;

  // Count commits between old and new position
  if (beforeHash && afterHash && beforeHash !== afterHash) {
    try {
      const log = await git.log({ from: beforeHash, to: afterHash });
      return log.total;
    } catch {
      // If we can't count (e.g., history rewrite), return -1
      return -1;
    }
  }

  return 0;
}

/**
 * Pull with fast-forward only
 */
export async function pullFastForward(localPath: string): Promise<number> {
  const git = simpleGit(localPath);

  const beforeLog = await git.log({ maxCount: 1 });
  const beforeHash = beforeLog.latest?.hash;

  await git.pull(['--ff-only']);

  const afterLog = await git.log({ maxCount: 1 });
  const afterHash = afterLog.latest?.hash;

  if (beforeHash && afterHash && beforeHash !== afterHash) {
    try {
      const log = await git.log({ from: beforeHash, to: afterHash });
      return log.total;
    } catch {
      return -1;
    }
  }

  return 0;
}

/**
 * Update submodules recursively
 */
export async function updateSubmodules(localPath: string): Promise<void> {
  const git = simpleGit(localPath);
  await git.submoduleUpdate(['--init', '--recursive']);
}

/**
 * Get the status of a local repository
 */
export async function getRepoStatus(localPath: string): Promise<RepoStatus> {
  // Check if directory exists
  if (!existsSync(localPath)) {
    return {
      exists: false,
      isGitRepo: false,
      currentBranch: null,
      isDetached: false,
      tracking: null,
      ahead: 0,
      behind: 0,
      isDirty: false,
    };
  }

  // Check if it's a git repo
  if (!existsSync(join(localPath, '.git'))) {
    return {
      exists: true,
      isGitRepo: false,
      currentBranch: null,
      isDetached: false,
      tracking: null,
      ahead: 0,
      behind: 0,
      isDirty: false,
    };
  }

  const git = simpleGit(localPath);

  try {
    const status: StatusResult = await git.status();

    return {
      exists: true,
      isGitRepo: true,
      currentBranch: status.current,
      isDetached: status.detached,
      tracking: status.tracking,
      ahead: status.ahead,
      behind: status.behind,
      isDirty: status.files.length > 0,
    };
  } catch {
    // Corrupted git repo
    return {
      exists: true,
      isGitRepo: false,
      currentBranch: null,
      isDetached: false,
      tracking: null,
      ahead: 0,
      behind: 0,
      isDirty: false,
    };
  }
}

/**
 * Get the remote URL for a repository
 */
export async function getRemoteUrl(
  localPath: string,
  remoteName: string = 'origin'
): Promise<string | null> {
  const git = simpleGit(localPath);

  try {
    const remotes = await git.getRemotes(true);
    const remote = remotes.find((r) => r.name === remoteName);
    return remote?.refs?.fetch || null;
  } catch {
    return null;
  }
}

/**
 * Check if a repository uses LFS (by checking .gitattributes)
 */
export async function usesLfs(localPath: string): Promise<boolean> {
  const gitattributes = join(localPath, '.gitattributes');
  if (!existsSync(gitattributes)) {
    return false;
  }

  try {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(gitattributes, 'utf-8');
    return content.includes('filter=lfs');
  } catch {
    return false;
  }
}

/**
 * Pull LFS objects
 */
export async function pullLfs(localPath: string, remoteName: string = 'origin'): Promise<void> {
  const git = simpleGit(localPath);
  await git.raw(['lfs', 'pull', remoteName]);
}
