import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertPathInsideBase, assertSafePathSegment } from './path-utils.js';
import type { GitHubAuthConfig } from '../types/index.js';

function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

type ConfigFile = {
  contentDir?: string;
  sync?: {
    concurrency?: number;
  };
  syncConcurrency?: number;
  github?: GitHubAuthConfig;
};

function loadConfigSync(): ConfigFile | null {
  try {
    const configPath = getConfigPath();
    if (!existsSync(configPath)) return null;
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Get the clones directory from environment, config, or default to ~/Clones
 */
export function getClonesDir(): string {
  if (process.env.CLONES_CONTENT_DIR) return process.env.CLONES_CONTENT_DIR;
  if (process.env.CLONES_DIR) return process.env.CLONES_DIR;

  const config = loadConfigSync();
  if (config?.contentDir) return config.contentDir;

  return join(homedir(), 'Clones');
}

/**
 * Get the default sync concurrency from env or config.
 */
export function getSyncConcurrency(): number | undefined {
  const env = process.env.CLONES_SYNC_CONCURRENCY;
  if (env) {
    const parsed = Number.parseInt(env, 10);
    if (Number.isFinite(parsed)) return parsed;
  }

  const config = loadConfigSync();
  if (config?.sync && typeof config.sync.concurrency === 'number') {
    return config.sync.concurrency;
  }

  if (typeof config?.syncConcurrency === 'number') {
    return config.syncConcurrency;
  }

  return undefined;
}

/**
 * Get the config directory (for registry.jsonl and local.json)
 * Uses CLONES_CONFIG_DIR if set, otherwise XDG_CONFIG_HOME/clones, otherwise ~/.config/clones
 */
export function getConfigDir(): string {
  if (process.env.CLONES_CONFIG_DIR) {
    return process.env.CLONES_CONFIG_DIR;
  }

  const xdgConfig = process.env.XDG_CONFIG_HOME;
  return xdgConfig ? join(xdgConfig, 'clones') : join(homedir(), '.config', 'clones');
}

/**
 * Get the path to registry.jsonl (shared across machines)
 */
export function getRegistryPath(): string {
  return join(getConfigDir(), 'registry.jsonl');
}

/**
 * Get the path to the legacy registry.toml (shared across machines)
 */
export function getLegacyRegistryTomlPath(): string {
  return join(getConfigDir(), 'registry.toml');
}

/**
 * Get the path to the legacy registry.json (shared across machines)
 */
export function getLegacyRegistryPath(): string {
  return join(getConfigDir(), 'registry.json');
}

/**
 * Get the path to local.json (machine-specific state)
 */
export function getLocalStatePath(): string {
  return join(getConfigDir(), 'local.json');
}

/**
 * Get the path to clones.db (machine-specific SQLite database)
 */
export function getDbPath(): string {
  return join(getConfigDir(), 'clones.db');
}

/**
 * Get the local path for a repository based on owner/repo
 */
export function getRepoPath(owner: string, repo: string): string {
  assertSafePathSegment(owner, 'owner');
  assertSafePathSegment(repo, 'repo');

  const base = getClonesDir();
  const repoPath = join(base, owner, repo);
  assertPathInsideBase(base, repoPath);
  return repoPath;
}

/**
 * Ensure the clones directory exists
 */
export async function ensureClonesDir(): Promise<void> {
  const dir = getClonesDir();
  await mkdir(dir, { recursive: true });
}

/**
 * Ensure the config directory exists
 */
export async function ensureConfigDir(): Promise<void> {
  const dir = getConfigDir();
  await mkdir(dir, { recursive: true });
}

/**
 * Default values for new registry entries
 */
export const DEFAULTS = {
  updateStrategy: 'hard-reset' as const,
  submodules: 'none' as const,
  lfs: 'auto' as const,
  defaultRemoteName: 'origin',
};

/**
 * Get the GitHub token from config
 */
export function getGitHubToken(): string | null {
  const config = loadConfigSync();
  return config?.github?.token ?? null;
}

/**
 * Get the GitHub username from config
 */
export function getGitHubUsername(): string | null {
  const config = loadConfigSync();
  return config?.github?.username ?? null;
}

/**
 * Get all GitHub configuration
 */
export function getGitHubConfig(): GitHubAuthConfig {
  const config = loadConfigSync();
  return {
    token: config?.github?.token,
    username: config?.github?.username,
    syncStars: config?.github?.syncStars ?? false,
  };
}

/**
 * Set the GitHub token and username in config atomically
 */
export async function setGitHubToken(token: string, username: string): Promise<void> {
  await ensureConfigDir();

  const configPath = getConfigPath();
  const config = loadConfigSync() ?? {};

  config.github = {
    ...config.github,
    token,
    username,
  };

  const tempPath = join(dirname(configPath), `.config.${randomUUID()}.tmp`);

  // Write to temp file
  await writeFile(tempPath, JSON.stringify(config, null, 2), 'utf-8');

  // Atomic rename
  await rename(tempPath, configPath);
}

/**
 * Clear the GitHub token from config atomically
 */
export async function clearGitHubToken(): Promise<void> {
  await ensureConfigDir();

  const configPath = getConfigPath();
  const config = loadConfigSync() ?? {};

  if (config.github) {
    delete config.github.token;
    delete config.github.username;
  }

  const tempPath = join(dirname(configPath), `.config.${randomUUID()}.tmp`);

  // Write to temp file
  await writeFile(tempPath, JSON.stringify(config, null, 2), 'utf-8');

  // Atomic rename
  await rename(tempPath, configPath);
}
