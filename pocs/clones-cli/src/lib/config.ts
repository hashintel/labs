import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { assertPathInsideBase, assertSafePathSegment } from './path-utils.js';

function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

type ConfigFile = {
  contentDir?: string;
  sync?: {
    concurrency?: number;
  };
  syncConcurrency?: number;
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
 * Get the config directory (for registry.toml and local.json)
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
 * Get the path to registry.toml (shared across machines)
 */
export function getRegistryPath(): string {
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
