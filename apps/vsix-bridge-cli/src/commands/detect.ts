import * as p from '@clack/prompts';
import { detectAllIDEs, detectVSCode } from '../lib/ide-registry.js';
import { getMarketplaceLockStatus } from '../lib/marketplace-lock.js';

export async function runDetect(): Promise<void> {
  p.log.info('Detecting installed IDEs...\n');

  const vscode = detectVSCode();
  if (vscode) {
    p.log.success(`VS Code (source)`);
    p.log.step(`  Engine: ${vscode.engineVersion}`);
    p.log.step(`  CLI: ${vscode.cli} ${vscode.cliAvailable ? '✓' : '✗ (not in PATH)'}`);
    p.log.step(`  Path: ${vscode.appPath}`);
  } else {
    p.log.warn('VS Code not found');
  }

  console.log('');

  const ides = detectAllIDEs();
  if (ides.length === 0) {
    p.log.warn('No target IDEs detected (Cursor, Antigravity, Windsurf)');
    return;
  }

  for (const ide of ides) {
    p.log.success(`${ide.name}`);
    p.log.step(`  Engine: ${ide.engineVersion}`);
    p.log.step(`  CLI: ${ide.cli} ${ide.cliAvailable ? '✓' : '✗ (not in PATH)'}`);
    p.log.step(`  Path: ${ide.appPath}`);

    const lockStatus = getMarketplaceLockStatus(ide.dataFolderName, ide.marketplaceSettings);
    const lockLabel =
      lockStatus === 'locked' ? 'locked' : lockStatus === 'partial' ? 'partially locked' : 'open';
    p.log.step(`  Marketplace: ${lockLabel}`);

    if (!ide.cliAvailable) {
      p.log.warn(`  Run "Shell Command: Install '${ide.cli}' command in PATH" from ${ide.name}`);
    }
    console.log('');
  }
}
