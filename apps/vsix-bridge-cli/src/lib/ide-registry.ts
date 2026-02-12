import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import type { IDEConfig, DetectedIDE } from '../types.js';

const IDE_CONFIGS: IDEConfig[] = [
  {
    id: 'cursor',
    name: 'Cursor',
    cli: 'cursor',
    appPath: '/Applications/Cursor.app',
    engineVersionKey: 'vscodeVersion',
    dataFolderName: 'Cursor',
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    cli: 'agy',
    appPath: '/Applications/Antigravity.app',
    engineVersionKey: 'version',
    dataFolderName: 'Antigravity',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    cli: 'surf',
    appPath: '/Applications/Windsurf.app',
    engineVersionKey: 'version',
    dataFolderName: 'Windsurf',
  },
];

const VSCODE_CONFIG: IDEConfig = {
  id: 'vscode',
  name: 'VS Code',
  cli: 'code',
  appPath: '/Applications/Visual Studio Code.app',
  engineVersionKey: 'version',
  dataFolderName: 'Code',
};

export function getIDEConfigs(): IDEConfig[] {
  return IDE_CONFIGS;
}

export function getVSCodeConfig(): IDEConfig {
  return VSCODE_CONFIG;
}

export function getProductJsonPath(appPath: string): string {
  return join(appPath, 'Contents', 'Resources', 'app', 'product.json');
}

export function getSettingsPath(dataFolderName: string): string {
  return join(homedir(), 'Library', 'Application Support', dataFolderName, 'User', 'settings.json');
}

export function readEngineVersion(appPath: string, versionKey: string): string | null {
  const productJsonPath = getProductJsonPath(appPath);
  if (!existsSync(productJsonPath)) {
    return null;
  }
  try {
    const content = readFileSync(productJsonPath, 'utf-8');
    const product = JSON.parse(content);
    return product[versionKey] ?? null;
  } catch {
    return null;
  }
}

export function isCliAvailable(cli: string): boolean {
  try {
    execSync(`which ${cli}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function detectIDE(config: IDEConfig): DetectedIDE | null {
  if (!existsSync(config.appPath)) {
    return null;
  }
  const engineVersion = readEngineVersion(config.appPath, config.engineVersionKey);
  if (!engineVersion) {
    return null;
  }
  return {
    ...config,
    engineVersion,
    cliAvailable: isCliAvailable(config.cli),
  };
}

export function detectAllIDEs(): DetectedIDE[] {
  const detected: DetectedIDE[] = [];
  for (const config of IDE_CONFIGS) {
    const ide = detectIDE(config);
    if (ide) {
      detected.push(ide);
    }
  }
  return detected;
}

export function detectVSCode(): DetectedIDE | null {
  return detectIDE(VSCODE_CONFIG);
}
