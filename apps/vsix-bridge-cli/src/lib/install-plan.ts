import type { Extension, SyncedVSIX, InstallAction } from '../types.js';
import { isNewerVersion } from './semver.js';

export interface PlanOptions {
  syncRemovals: boolean;
}

export function generateInstallPlan(
  installedExtensions: Extension[],
  syncedVsix: SyncedVSIX[],
  options: PlanOptions
): InstallAction[] {
  const actions: InstallAction[] = [];
  const installedMap = new Map(installedExtensions.map((e) => [e.id, e]));
  const syncedMap = new Map(syncedVsix.map((v) => [v.extensionId, v]));

  // Install missing extensions and update outdated ones
  for (const vsix of syncedVsix) {
    const installed = installedMap.get(vsix.extensionId);

    if (!installed) {
      // Fresh install: copy source's disabled state
      actions.push({
        type: 'install',
        extensionId: vsix.extensionId,
        version: vsix.version,
        vsixPath: vsix.path,
      });

      if (vsix.sourceDisabled) {
        actions.push({
          type: 'disable',
          extensionId: vsix.extensionId,
        });
      }
      continue;
    }

    // Update: preserve target's current disabled state (no enable/disable action)
    if (isNewerVersion(vsix.version, installed.version)) {
      actions.push({
        type: 'update',
        extensionId: vsix.extensionId,
        version: vsix.version,
        vsixPath: vsix.path,
        currentVersion: installed.version,
      });
    }
  }

  // Optionally remove extensions that are no longer in source
  if (options.syncRemovals) {
    for (const installed of installedExtensions) {
      if (!syncedMap.has(installed.id)) {
        actions.push({
          type: 'uninstall',
          extensionId: installed.id,
        });
      }
    }
  }

  return actions;
}

export function describeAction(action: InstallAction): string {
  switch (action.type) {
    case 'install':
      return `Install ${action.extensionId}@${action.version}`;
    case 'update':
      return `Update ${action.extensionId}: ${action.currentVersion} → ${action.version}`;
    case 'uninstall':
      return `Uninstall ${action.extensionId}`;
    case 'disable':
      return `Disable ${action.extensionId}`;
    case 'enable':
      return `Enable ${action.extensionId}`;
  }
}
