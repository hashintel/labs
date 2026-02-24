import * as p from '@clack/prompts';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { DetectedIDE, InstallAction } from '../types.js';
import { detectAllIDEs, detectVSCode, getSettingsPath } from '../lib/ide-registry.js';
import { getExtensionsWithState, getDisabledExtensions } from '../lib/extensions.js';
import { listCachedVsix } from '../lib/vsix.js';
import { generateInstallPlan, describeAction } from '../lib/install-plan.js';

interface InstallOptions {
  to: string[];
  dryRun: boolean;
  syncRemovals: boolean;
  verbose?: boolean;
}

interface CommandResult {
  ok: boolean;
  stderr: string | null;
}

export interface ActionOutcome {
  action: InstallAction;
  ok: boolean;
  error?: string;
}

export interface InstallResult {
  outcomes: ActionOutcome[];
}

// --- Internal helpers ---

function executeCliCommand(cli: string, args: string[]): CommandResult {
  try {
    execFileSync(cli, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, stderr: null };
  } catch (err: unknown) {
    let stderr: string | null = null;
    if (err && typeof err === 'object' && 'stderr' in err) {
      const raw = (err as { stderr: Buffer | string }).stderr;
      stderr = typeof raw === 'string' ? raw : raw.toString('utf-8');
      stderr = stderr.trim() || null;
    }
    return { ok: false, stderr };
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

// --- Data layer (no UI) ---

export function buildInstallPlan(
  targetIDE: DetectedIDE,
  vscodeDataFolderName: string,
  options: { syncRemovals: boolean }
): { plan: InstallAction[]; cachedCount: number } {
  const vscodeDisabled = getDisabledExtensions(vscodeDataFolderName);

  const cachedVsix = listCachedVsix(targetIDE.id).map((vsix) => ({
    ...vsix,
    sourceDisabled: vscodeDisabled.has(vsix.extensionId),
  }));

  if (cachedVsix.length === 0) {
    return { plan: [], cachedCount: 0 };
  }

  const targetExtensions = getExtensionsWithState(targetIDE.cli, targetIDE.dataFolderName);

  const plan = generateInstallPlan(targetExtensions, cachedVsix, {
    syncRemovals: options.syncRemovals,
  });

  return { plan, cachedCount: cachedVsix.length };
}

export function performInstallActions(
  targetIDE: DetectedIDE,
  plan: InstallAction[],
  onProgress?: (current: number, total: number, description: string) => void
): InstallResult {
  const outcomes: ActionOutcome[] = [];
  const toDisable: string[] = [];
  const toEnable: string[] = [];
  let completed = 0;

  for (const action of plan) {
    onProgress?.(completed, plan.length, describeAction(action));

    switch (action.type) {
      case 'install':
      case 'update': {
        const result = executeCliCommand(targetIDE.cli, [
          '--install-extension',
          action.vsixPath!,
          '--force',
        ]);
        outcomes.push({ action, ok: result.ok, error: result.stderr ?? undefined });
        completed++;
        break;
      }
      case 'uninstall': {
        const result = executeCliCommand(targetIDE.cli, [
          '--uninstall-extension',
          action.extensionId,
        ]);
        outcomes.push({ action, ok: result.ok, error: result.stderr ?? undefined });
        completed++;
        break;
      }
      case 'disable':
        toDisable.push(action.extensionId);
        continue;
      case 'enable':
        toEnable.push(action.extensionId);
        continue;
    }
  }

  if (toDisable.length > 0 || toEnable.length > 0) {
    const settingsPath = getSettingsPath(targetIDE.dataFolderName);
    const ok = updateDisabledExtensions(settingsPath, toDisable, toEnable);
    for (const id of toDisable) {
      outcomes.push({ action: { type: 'disable', extensionId: id }, ok });
    }
    for (const id of toEnable) {
      outcomes.push({ action: { type: 'enable', extensionId: id }, ok });
    }
  }

  return { outcomes };
}

// --- UI layer ---

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

export interface InstallForIDEOptions {
  syncRemovals: boolean;
  verbose?: boolean;
  dryRun?: boolean;
}

export async function runInstallForIDE(
  targetIDE: DetectedIDE,
  vscodeDataFolderName: string,
  options: InstallForIDEOptions
): Promise<void> {
  if (!targetIDE.cliAvailable) {
    p.log.error(
      `CLI '${targetIDE.cli}' not available. Run "Shell Command: Install '${targetIDE.cli}' command in PATH" from ${targetIDE.name}.`
    );
    return;
  }

  const { plan, cachedCount } = buildInstallPlan(targetIDE, vscodeDataFolderName, {
    syncRemovals: options.syncRemovals,
  });

  if (cachedCount === 0) {
    p.log.warn(
      `No synced VSIX files for ${targetIDE.name}. Run 'vsix-bridge sync --sync-only' first.`
    );
    return;
  }

  if (plan.length === 0) {
    p.log.success(`${targetIDE.name}: already in sync`);
    return;
  }

  if (options.dryRun) {
    p.log.info(`${plan.length} actions planned for ${targetIDE.name}:`);
    for (const action of plan) {
      p.log.step(describeAction(action));
    }
    p.log.warn('Dry run - no changes made.');
    return;
  }

  const spinner = p.spinner();
  spinner.start(`Installing to ${targetIDE.name}...`);

  const { outcomes } = performInstallActions(targetIDE, plan, (current, total, desc) => {
    spinner.message(`${desc} (${current + 1}/${total})`);
  });

  const successCount = outcomes.filter((o) => o.ok).length;
  const failedCount = outcomes.filter((o) => !o.ok).length;

  if (failedCount > 0) {
    spinner.stop(`${targetIDE.name}: ${successCount} succeeded, ${failedCount} failed`);
  } else {
    spinner.stop(`${targetIDE.name}: installed ${successCount} extensions`);
  }

  const failures = outcomes.filter((o) => !o.ok);
  for (const f of failures) {
    const desc = describeAction(f.action);
    const reason = f.error ? `: ${f.error}` : '';
    p.log.warn(`  FAILED ${desc}${reason}`);
  }

  if (options.verbose) {
    const successes = outcomes.filter((o) => o.ok);
    for (const s of successes) {
      p.log.step(`  OK ${describeAction(s.action)}`);
    }
  }
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

  await runInstallForIDE(targetIDE, vscode.dataFolderName, {
    syncRemovals: options.syncRemovals,
    verbose: options.verbose,
    dryRun: options.dryRun,
  });
}
