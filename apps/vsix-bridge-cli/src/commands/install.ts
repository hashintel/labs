import * as p from '@clack/prompts';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { DetectedIDE } from '../types.js';
import { detectAllIDEs, detectVSCode, getSettingsPath } from '../lib/ide-registry.js';
import { getExtensionsWithState, getDisabledExtensions } from '../lib/extensions.js';
import { listCachedVsix } from '../lib/vsix.js';
import { generateInstallPlan, describeAction } from '../lib/install-plan.js';

interface InstallOptions {
  to: string[];
  dryRun: boolean;
  syncRemovals: boolean;
}

function executeCliCommand(cli: string, args: string[]): boolean {
  try {
    execSync(`${cli} ${args.join(' ')}`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function updateDisabledExtensions(
  settingsPath: string,
  toDisable: string[],
  toEnable: string[]
): boolean {
  if (toDisable.length === 0 && toEnable.length === 0) {
    return true;
  }

  try {
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      const content = readFileSync(settingsPath, 'utf-8');
      settings = JSON.parse(content);
    }

    const disabled = new Set<string>(
      (settings['extensions.disabled'] as string[] | undefined) ?? []
    );

    for (const id of toDisable) {
      disabled.add(id);
    }
    for (const id of toEnable) {
      disabled.delete(id);
    }

    settings['extensions.disabled'] = Array.from(disabled);
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return true;
  } catch {
    return false;
  }
}

async function selectTargetIDE(targetIDEs: DetectedIDE[]): Promise<DetectedIDE | null> {
  if (targetIDEs.length === 1) {
    return targetIDEs[0] ?? null;
  }

  const selected = await p.select({
    message: 'Select target IDE:',
    options: targetIDEs.map((ide) => ({
      value: ide.id,
      label: `${ide.name} (engine ${ide.engineVersion})`,
    })),
  });

  if (p.isCancel(selected)) {
    return null;
  }

  return targetIDEs.find((ide) => ide.id === selected) ?? null;
}

export async function runInstall(options: InstallOptions): Promise<void> {
  const vscode = detectVSCode();
  if (!vscode) {
    p.log.error('VS Code not found. Cannot determine source extension state.');
    return;
  }

  let targetIDEs = detectAllIDEs();
  if (options.to.length > 0) {
    targetIDEs = targetIDEs.filter((ide) => options.to.includes(ide.id));
  }

  if (targetIDEs.length === 0) {
    p.log.error('No target IDEs detected. Install Cursor, Antigravity, or Windsurf.');
    return;
  }

  const targetIDE = await selectTargetIDE(targetIDEs);
  if (!targetIDE) {
    p.log.warn('Cancelled.');
    return;
  }

  if (!targetIDE.cliAvailable) {
    p.log.error(
      `CLI '${targetIDE.cli}' not available. Run "Shell Command: Install '${targetIDE.cli}' command in PATH" from ${targetIDE.name}.`
    );
    return;
  }

  const vscodeDisabled = getDisabledExtensions(vscode.dataFolderName);

  const cachedVsix = listCachedVsix(targetIDE.id).map((vsix) => ({
    ...vsix,
    sourceDisabled: vscodeDisabled.has(vsix.extensionId),
  }));

  if (cachedVsix.length === 0) {
    p.log.warn(`No synced VSIX files for ${targetIDE.name}. Run 'vsix-bridge sync' first.`);
    return;
  }

  const targetExtensions = getExtensionsWithState(targetIDE.cli, targetIDE.dataFolderName);

  const plan = generateInstallPlan(targetExtensions, cachedVsix, {
    syncRemovals: options.syncRemovals,
  });

  if (plan.length === 0) {
    p.log.success(`${targetIDE.name} is already in sync.`);
    return;
  }

  p.log.info(`${plan.length} actions planned for ${targetIDE.name}:`);
  for (const action of plan) {
    p.log.step(describeAction(action));
  }

  if (options.dryRun) {
    p.log.warn('Dry run - no changes made.');
    return;
  }

  const spinner = p.spinner();
  spinner.start(`Executing ${plan.length} actions...`);

  let success = 0;
  let failed = 0;
  const toDisable: string[] = [];
  const toEnable: string[] = [];

  for (const action of plan) {
    spinner.message(describeAction(action));

    let ok = false;
    switch (action.type) {
      case 'install':
      case 'update':
        ok = executeCliCommand(targetIDE.cli, ['--install-extension', action.vsixPath!, '--force']);
        break;
      case 'uninstall':
        ok = executeCliCommand(targetIDE.cli, ['--uninstall-extension', action.extensionId]);
        break;
      case 'disable':
        toDisable.push(action.extensionId);
        ok = true;
        break;
      case 'enable':
        toEnable.push(action.extensionId);
        ok = true;
        break;
    }

    if (ok) {
      success++;
    } else {
      failed++;
    }
  }

  if (toDisable.length > 0 || toEnable.length > 0) {
    const settingsPath = getSettingsPath(targetIDE.dataFolderName);
    updateDisabledExtensions(settingsPath, toDisable, toEnable);
  }

  spinner.stop('Installation complete');
  p.log.success(`${success} succeeded, ${failed} failed`);
}
