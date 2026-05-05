import * as p from '@clack/prompts';
import type { DetectedIDE, Extension } from '../types.js';
import { detectAllIDEs, detectVSCode } from '../lib/ide-registry.js';
import { getExtensionsWithState } from '../lib/extensions.js';
import { listCachedVsix } from '../lib/vsix.js';

interface StatusOptions {
  to: string[];
}

interface ExtensionDiff {
  inVSCodeOnly: Extension[];
  inForkOnly: Extension[];
  versionDifferences: Array<{
    id: string;
    vscodeVersion: string;
    forkVersion: string;
  }>;
  disabledDifferences: Array<{
    id: string;
    vscodeDisabled: boolean;
    forkDisabled: boolean;
  }>;
}

function computeDiff(vscodeExts: Extension[], forkExts: Extension[]): ExtensionDiff {
  const vscodeMap = new Map(vscodeExts.map((e) => [e.id, e]));
  const forkMap = new Map(forkExts.map((e) => [e.id, e]));

  const inVSCodeOnly: Extension[] = [];
  const inForkOnly: Extension[] = [];
  const versionDifferences: ExtensionDiff['versionDifferences'] = [];
  const disabledDifferences: ExtensionDiff['disabledDifferences'] = [];

  for (const ext of vscodeExts) {
    const forkExt = forkMap.get(ext.id);
    if (!forkExt) {
      inVSCodeOnly.push(ext);
    } else {
      if (ext.version !== forkExt.version) {
        versionDifferences.push({
          id: ext.id,
          vscodeVersion: ext.version,
          forkVersion: forkExt.version,
        });
      }
      if (ext.disabled !== forkExt.disabled) {
        disabledDifferences.push({
          id: ext.id,
          vscodeDisabled: ext.disabled,
          forkDisabled: forkExt.disabled,
        });
      }
    }
  }

  for (const ext of forkExts) {
    if (!vscodeMap.has(ext.id)) {
      inForkOnly.push(ext);
    }
  }

  return { inVSCodeOnly, inForkOnly, versionDifferences, disabledDifferences };
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

export async function runStatus(options: StatusOptions): Promise<void> {
  const vscode = detectVSCode();
  if (!vscode) {
    p.log.error('VS Code not found.');
    return;
  }

  if (!vscode.cliAvailable) {
    p.log.error('VS Code CLI not available.');
    return;
  }

  let targetIDEs = detectAllIDEs();
  if (options.to.length > 0) {
    targetIDEs = targetIDEs.filter((ide) => options.to.includes(ide.id));
  }

  if (targetIDEs.length === 0) {
    p.log.error('No target IDEs detected.');
    return;
  }

  const targetIDE = await selectTargetIDE(targetIDEs);
  if (!targetIDE) {
    p.log.warn('Cancelled.');
    return;
  }

  if (!targetIDE.cliAvailable) {
    p.log.error(`CLI '${targetIDE.cli}' not available.`);
    return;
  }

  const vscodeExts = getExtensionsWithState(vscode.cli, vscode.dataFolderName);
  const forkExts = getExtensionsWithState(targetIDE.cli, targetIDE.dataFolderName);

  const cachedVsix = listCachedVsix(targetIDE.id);

  p.log.info(`Comparing VS Code with ${targetIDE.name}:\n`);
  p.log.step(`VS Code: ${vscodeExts.length} extensions`);
  p.log.step(`${targetIDE.name}: ${forkExts.length} extensions`);
  p.log.step(`Synced VSIX: ${cachedVsix.length} files`);
  console.log('');

  const diff = computeDiff(vscodeExts, forkExts);

  if (diff.inVSCodeOnly.length > 0) {
    p.log.warn(`In VS Code only (${diff.inVSCodeOnly.length}):`);
    for (const ext of diff.inVSCodeOnly.slice(0, 10)) {
      p.log.step(`  ${ext.id}@${ext.version}`);
    }
    if (diff.inVSCodeOnly.length > 10) {
      p.log.step(`  ... and ${diff.inVSCodeOnly.length - 10} more`);
    }
    console.log('');
  }

  if (diff.inForkOnly.length > 0) {
    p.log.warn(`In ${targetIDE.name} only (${diff.inForkOnly.length}):`);
    for (const ext of diff.inForkOnly.slice(0, 10)) {
      p.log.step(`  ${ext.id}@${ext.version}`);
    }
    if (diff.inForkOnly.length > 10) {
      p.log.step(`  ... and ${diff.inForkOnly.length - 10} more`);
    }
    console.log('');
  }

  if (diff.versionDifferences.length > 0) {
    p.log.warn(`Version differences (${diff.versionDifferences.length}):`);
    for (const d of diff.versionDifferences.slice(0, 10)) {
      p.log.step(`  ${d.id}: VS Code ${d.vscodeVersion} vs ${targetIDE.name} ${d.forkVersion}`);
    }
    if (diff.versionDifferences.length > 10) {
      p.log.step(`  ... and ${diff.versionDifferences.length - 10} more`);
    }
    console.log('');
  }

  if (diff.disabledDifferences.length > 0) {
    p.log.warn(`Disabled state differences (${diff.disabledDifferences.length}):`);
    for (const d of diff.disabledDifferences.slice(0, 10)) {
      const vscodeState = d.vscodeDisabled ? 'disabled' : 'enabled';
      const forkState = d.forkDisabled ? 'disabled' : 'enabled';
      p.log.step(`  ${d.id}: VS Code ${vscodeState} vs ${targetIDE.name} ${forkState}`);
    }
    if (diff.disabledDifferences.length > 10) {
      p.log.step(`  ... and ${diff.disabledDifferences.length - 10} more`);
    }
    console.log('');
  }

  const totalDiffs =
    diff.inVSCodeOnly.length +
    diff.inForkOnly.length +
    diff.versionDifferences.length +
    diff.disabledDifferences.length;

  if (totalDiffs === 0) {
    p.log.success('Extensions are in sync!');
  } else {
    p.log.info(`${totalDiffs} total differences found.`);
  }
}
