import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import type { Extension } from '../types.js';
import { getSettingsPath } from './ide-registry.js';
import { CLI_LIST_EXTENSIONS_TIMEOUT_MS } from './timeouts.js';

export function listInstalledExtensions(cli: string): Extension[] {
  try {
    const output = execSync(`${cli} --list-extensions --show-versions`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: CLI_LIST_EXTENSIONS_TIMEOUT_MS,
    });

    const extensions: Extension[] = [];
    for (const line of output.trim().split('\n')) {
      if (!line.includes('@')) continue;
      const [id, version] = line.split('@');
      if (id && version) {
        extensions.push({
          id: id.toLowerCase(),
          version,
          disabled: false,
        });
      }
    }
    return extensions;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'killed' in err && (err as { killed: boolean }).killed) {
      console.warn(
        `Warning: '${cli} --list-extensions' timed out after ${CLI_LIST_EXTENSIONS_TIMEOUT_MS / 1000}s`
      );
    }
    return [];
  }
}

export function getDisabledExtensions(dataFolderName: string): Set<string> {
  const settingsPath = getSettingsPath(dataFolderName);
  if (!existsSync(settingsPath)) {
    return new Set();
  }

  try {
    const content = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(content);
    const disabled = settings['extensions.disabled'] ?? [];
    return new Set(disabled.map((id: string) => id.toLowerCase()));
  } catch {
    return new Set();
  }
}

export function getExtensionsWithState(cli: string, dataFolderName: string): Extension[] {
  const extensions = listInstalledExtensions(cli);
  const disabledSet = getDisabledExtensions(dataFolderName);

  return extensions.map((ext) => ({
    ...ext,
    disabled: disabledSet.has(ext.id),
  }));
}
