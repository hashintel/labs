import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LocalState, RepoLocalState } from '../types/index.js';
import { getLocalStatePath, ensureConfigDir } from './config.js';
import { normalizeLocalState } from './schema.js';

/**
 * Create an empty local state
 */
export function createEmptyLocalState(): LocalState {
  return {
    version: '1.0.0',
    repos: {},
  };
}

/**
 * Read the local state from disk
 * Returns an empty state if the file doesn't exist
 */
export async function readLocalState(): Promise<LocalState> {
  const path = getLocalStatePath();

  if (!existsSync(path)) {
    return createEmptyLocalState();
  }

  try {
    const content = await readFile(path, 'utf-8');
    const data = JSON.parse(content) as LocalState;
    const normalized = normalizeLocalState(data);
    return normalized.data;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Local state file is corrupted: ${path}`);
    }
    throw error;
  }
}

/**
 * Write the local state to disk atomically
 * Uses write-to-temp + rename pattern to prevent corruption
 */
export async function writeLocalState(state: LocalState): Promise<void> {
  await ensureConfigDir();

  const normalized = normalizeLocalState(state);
  const path = getLocalStatePath();
  const tempPath = join(dirname(path), `.local.${randomUUID()}.tmp`);

  // Write to temp file
  const content = JSON.stringify(normalized.data, null, 2);
  await writeFile(tempPath, content, 'utf-8');

  // Atomic rename
  await rename(tempPath, path);
}

/**
 * Get the local state for a specific repo
 */
export function getRepoLocalState(state: LocalState, repoId: string): RepoLocalState | undefined {
  return state.repos[repoId];
}

/**
 * Update the local state for a specific repo
 */
export function updateRepoLocalState(
  state: LocalState,
  repoId: string,
  updates: Partial<RepoLocalState>
): LocalState {
  const existing = state.repos[repoId] || {};

  return {
    ...state,
    repos: {
      ...state.repos,
      [repoId]: {
        ...existing,
        ...updates,
      },
    },
  };
}

/**
 * Remove a repo from local state
 */
export function removeRepoLocalState(state: LocalState, repoId: string): LocalState {
  const { [repoId]: _, ...remainingRepos } = state.repos;

  return {
    ...state,
    repos: remainingRepos,
  };
}

/**
 * Update the lastSyncRun timestamp
 */
export function updateLastSyncRun(state: LocalState): LocalState {
  return {
    ...state,
    lastSyncRun: new Date().toISOString(),
  };
}

/**
 * Get the lastSyncedAt for a repo, or undefined if not set
 */
export function getLastSyncedAt(state: LocalState, repoId: string): string | undefined {
  return state.repos[repoId]?.lastSyncedAt;
}
