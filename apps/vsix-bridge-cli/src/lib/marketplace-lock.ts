import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { MarketplaceSettings } from '../types.js';
import { getSettingsPath } from './ide-registry.js';

export const BLOCKED_URL = 'http://0.0.0.0';

export type LockStatus = 'locked' | 'unlocked' | 'partial';

function readSettings(dataFolderName: string): Record<string, unknown> {
  const path = getSettingsPath(dataFolderName);
  if (!existsSync(path)) {
    return {};
  }
  try {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function writeSettings(dataFolderName: string, settings: Record<string, unknown>): void {
  const path = getSettingsPath(dataFolderName);
  writeFileSync(path, JSON.stringify(settings, null, 2));
}

export function lockMarketplace(dataFolderName: string, ms: MarketplaceSettings): void {
  const settings = readSettings(dataFolderName);
  settings[ms.serviceUrlKey] = BLOCKED_URL;
  if (ms.itemUrlKey) {
    settings[ms.itemUrlKey] = BLOCKED_URL;
  }
  settings['extensions.autoCheckUpdates'] = false;
  settings['extensions.autoUpdate'] = false;
  writeSettings(dataFolderName, settings);
}

export function unlockMarketplace(dataFolderName: string, ms: MarketplaceSettings): void {
  const settings = readSettings(dataFolderName);
  if (Object.keys(settings).length === 0) {
    return;
  }
  delete settings[ms.serviceUrlKey];
  if (ms.itemUrlKey) {
    delete settings[ms.itemUrlKey];
  }
  delete settings['extensions.autoCheckUpdates'];
  delete settings['extensions.autoUpdate'];
  writeSettings(dataFolderName, settings);
}

export function getMarketplaceLockStatus(
  dataFolderName: string,
  ms: MarketplaceSettings
): LockStatus {
  const settings = readSettings(dataFolderName);

  const checks: boolean[] = [
    settings[ms.serviceUrlKey] === BLOCKED_URL,
    settings['extensions.autoCheckUpdates'] === false,
    settings['extensions.autoUpdate'] === false,
  ];

  if (ms.itemUrlKey) {
    checks.push(settings[ms.itemUrlKey] === BLOCKED_URL);
  }

  const passed = checks.filter(Boolean).length;
  if (passed === checks.length) return 'locked';
  if (passed === 0) return 'unlocked';
  return 'partial';
}
