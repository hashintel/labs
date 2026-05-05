import * as p from '@clack/prompts';
import { detectAllIDEs } from '../lib/ide-registry.js';
import {
  lockMarketplace,
  unlockMarketplace,
  getMarketplaceLockStatus,
  type LockStatus,
} from '../lib/marketplace-lock.js';

interface LockOptions {
  to: string[];
}

function statusLabel(status: LockStatus): string {
  switch (status) {
    case 'locked':
      return 'locked';
    case 'unlocked':
      return 'unlocked';
    case 'partial':
      return 'partially locked';
  }
}

export async function runLock(options: LockOptions): Promise<void> {
  let targetIDEs = detectAllIDEs();
  if (options.to.length > 0) {
    targetIDEs = targetIDEs.filter((ide) => options.to.includes(ide.id));
  }

  if (targetIDEs.length === 0) {
    p.log.error('No target IDEs detected. Install Cursor, Antigravity, or Windsurf.');
    return;
  }

  for (const ide of targetIDEs) {
    const before = getMarketplaceLockStatus(ide.dataFolderName, ide.marketplaceSettings);

    if (before === 'locked') {
      p.log.info(`${ide.name}: already locked`);
      continue;
    }

    lockMarketplace(ide.dataFolderName, ide.marketplaceSettings);
    p.log.success(`${ide.name}: marketplace locked (was ${statusLabel(before)})`);
  }

  p.log.warn('Restart target IDEs for changes to take effect.');
}

export async function runUnlock(options: LockOptions): Promise<void> {
  let targetIDEs = detectAllIDEs();
  if (options.to.length > 0) {
    targetIDEs = targetIDEs.filter((ide) => options.to.includes(ide.id));
  }

  if (targetIDEs.length === 0) {
    p.log.error('No target IDEs detected. Install Cursor, Antigravity, or Windsurf.');
    return;
  }

  for (const ide of targetIDEs) {
    const before = getMarketplaceLockStatus(ide.dataFolderName, ide.marketplaceSettings);

    if (before === 'unlocked') {
      p.log.info(`${ide.name}: already unlocked`);
      continue;
    }

    unlockMarketplace(ide.dataFolderName, ide.marketplaceSettings);
    p.log.success(`${ide.name}: marketplace unlocked (was ${statusLabel(before)})`);
  }

  p.log.warn('Restart target IDEs for changes to take effect.');
}
