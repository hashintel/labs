import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { getConfigDir } from './config.js';

function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

export async function isInitialized(): Promise<boolean> {
  return existsSync(getConfigPath());
}

interface ClonesConfig {
  contentDir: string;
  createdAt: string;
  version: number;
}

export async function loadConfig(): Promise<ClonesConfig | null> {
  try {
    const content = await fs.readFile(getConfigPath(), 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function expandTildePath(input: string): string {
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  if (input.startsWith('~')) {
    return path.join(os.homedir(), input.slice(1));
  }
  return input;
}

export async function runOnboarding(options: { isRerun?: boolean } = {}): Promise<boolean> {
  const configDir = getConfigDir();
  const configPath = getConfigPath();
  const defaultContentDir = path.join(os.homedir(), 'Clones');

  if (options.isRerun) {
    p.intro(pc.cyan('Re-running clones setup'));
  } else {
    p.intro(pc.cyan('Welcome to clones!'));
    p.note(
      `This tool manages read-only Git repository clones for exploration and reference.\n` +
        `Repositories are organized by owner/repo structure.`,
      'About'
    );
  }

  p.log.info(`Config directory: ${pc.dim(configDir)}`);

  const existingConfig = await loadConfig();
  const currentContentDir = existingConfig?.contentDir || defaultContentDir;

  const contentDirChoice = await p.text({
    message: 'Where should cloned repositories be stored?',
    placeholder: currentContentDir,
    defaultValue: currentContentDir,
    validate: (value) => {
      if (!value) return 'Please enter a directory path';
      if (!path.isAbsolute(value) && !value.startsWith('~')) {
        return 'Please enter an absolute path';
      }
      return undefined;
    },
  });

  if (p.isCancel(contentDirChoice)) {
    p.cancel('Setup cancelled.');
    return false;
  }

  let contentDir = contentDirChoice as string;
  contentDir = expandTildePath(contentDir);

  const spinner = p.spinner();
  spinner.start('Creating directories...');

  try {
    await fs.mkdir(configDir, { recursive: true });
    await fs.mkdir(contentDir, { recursive: true });

    const config: ClonesConfig = {
      contentDir,
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

  p.outro(pc.green('Setup complete! Run `clones add <url>` to clone your first repository.'));
  return true;
}

export async function ensureInitialized(): Promise<boolean> {
  if (await isInitialized()) {
    return true;
  }

  if (!process.stdout.isTTY) {
    console.error(pc.red('clones is not initialized.'));
    console.error(`Run ${pc.cyan('clones init')} to set up.`);
    process.exit(1);
  }

  return runOnboarding();
}
