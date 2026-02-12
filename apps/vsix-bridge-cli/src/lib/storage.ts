import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

const APP_NAME = 'vsix-bridge';

export function getConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdgConfig, APP_NAME);
}

export function getCacheDir(): string {
  const xdgCache = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(xdgCache, APP_NAME);
}

export function getVsixCacheDir(ideId: string): string {
  return join(getCacheDir(), ideId);
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

export function getStatePath(): string {
  return join(getConfigDir(), 'state.json');
}
