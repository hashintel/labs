import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as p from '@clack/prompts';

function getXdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function getConfigDir(): string {
  if (process.env.VSIX_BRIDGE_CONFIG_DIR) {
    return process.env.VSIX_BRIDGE_CONFIG_DIR;
  }
  return path.join(getXdgConfigHome(), 'vsix-bridge');
}

function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

function getDefaultCacheDir(): string {
  const xdgCache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(xdgCache, 'vsix-bridge');
}

export async function isInitialized(): Promise<boolean> {
  return existsSync(getConfigPath());
}

interface VsixBridgeConfig {
  cacheDir: string;
  createdAt: string;
  version: number;
}

export async function loadConfig(): Promise<VsixBridgeConfig | null> {
  try {
    const content = await fs.readFile(getConfigPath(), 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function runOnboarding(options: { isRerun?: boolean } = {}): Promise<boolean> {
  const configDir = getConfigDir();
  const configPath = getConfigPath();
  const defaultCacheDir = getDefaultCacheDir();

  if (options.isRerun) {
    p.intro('Re-running vsix-bridge setup');
  } else {
    p.intro('Welcome to vsix-bridge!');
    p.note(
      `This tool syncs VS Code extensions to fork IDEs (Cursor, Windsurf, etc).\n` +
        `Downloaded VSIX files are cached locally for fast installation.`,
      'About'
    );
  }

  p.log.info(`Config directory: ${configDir}`);

  const existingConfig = await loadConfig();
  const currentCacheDir = existingConfig?.cacheDir || defaultCacheDir;

  const cacheDirChoice = await p.text({
    message: 'Where should downloaded VSIX files be cached?',
    placeholder: currentCacheDir,
    defaultValue: currentCacheDir,
    validate: (value) => {
      if (!value) return 'Please enter a directory path';
      if (!path.isAbsolute(value) && !value.startsWith('~')) {
        return 'Please enter an absolute path';
      }
      return undefined;
    },
  });

  if (p.isCancel(cacheDirChoice)) {
    p.cancel('Setup cancelled.');
    return false;
  }

  let cacheDir = cacheDirChoice as string;
  if (cacheDir.startsWith('~')) {
    cacheDir = path.join(os.homedir(), cacheDir.slice(1));
  }

  const spinner = p.spinner();
  spinner.start('Creating directories...');

  try {
    await fs.mkdir(configDir, { recursive: true });
    await fs.mkdir(cacheDir, { recursive: true });

    const config: VsixBridgeConfig = {
      cacheDir, // used by storage.getCacheDir() for sync/install
      createdAt: existingConfig?.createdAt || new Date().toISOString(),
      version: 1,
    };
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    spinner.stop('Directories created');
  } catch (error) {
    spinner.stop('Failed to create directories');
    p.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }

  p.outro('Setup complete! Run `vsix-bridge detect` to find your installed IDEs.');
  return true;
}

export async function ensureInitialized(): Promise<boolean> {
  if (await isInitialized()) {
    return true;
  }

  if (!process.stdout.isTTY) {
    console.error('vsix-bridge is not initialized.');
    console.error('Run `vsix-bridge init` to set up.');
    process.exit(1);
  }

  return runOnboarding();
}
