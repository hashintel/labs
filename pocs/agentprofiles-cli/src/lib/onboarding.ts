import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as p from '@clack/prompts';
import color from 'picocolors';

function getXdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function getDefaultConfigDir(): string {
  if (process.env.AGENTPROFILES_CONFIG_DIR) {
    return process.env.AGENTPROFILES_CONFIG_DIR;
  }
  return path.join(getXdgConfigHome(), 'agentprofiles');
}

function getConfigPath(): string {
  return path.join(getDefaultConfigDir(), 'config.json');
}

export async function isInitialized(): Promise<boolean> {
  try {
    await fs.access(getConfigPath());
    return true;
  } catch {
    return false;
  }
}

export async function runOnboarding(options: { isRerun?: boolean } = {}): Promise<boolean> {
  const configDir = getDefaultConfigDir();
  const configPath = getConfigPath();

  if (options.isRerun) {
    p.intro(color.cyan('Re-running agentprofiles setup'));
  } else {
    p.intro(color.cyan('Welcome to agentprofiles!'));
    p.note(
      `This tool manages configuration profiles for LLM agent tools.\n` +
        `Profiles are stored as directories that can be activated per-project using direnv.`,
      'About'
    );
  }

  p.log.info(`Config directory: ${color.dim(configDir)}`);

  const defaultContentDir = configDir;

  const contentDirChoice = await p.text({
    message: 'Where should profile contents be stored?',
    placeholder: defaultContentDir,
    defaultValue: defaultContentDir,
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
  if (contentDir.startsWith('~')) {
    contentDir = path.join(os.homedir(), contentDir.slice(1));
  }

  const spinner = p.spinner();
  spinner.start('Creating directories...');

  try {
    await fs.mkdir(configDir, { recursive: true });
    await fs.mkdir(contentDir, { recursive: true });

    const config = {
      contentDir: contentDir === configDir ? undefined : contentDir,
      createdAt: new Date().toISOString(),
      version: 1,
    };
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    for (const tool of ['claude', 'opencode']) {
      await fs.mkdir(path.join(contentDir, tool), { recursive: true });
    }

    spinner.stop('Directories created');
  } catch (error) {
    spinner.stop('Failed to create directories');
    p.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }

  p.outro(
    color.green('Setup complete! Run `agentprofiles add <agent>` to create your first profile.')
  );
  return true;
}

export async function ensureInitialized(): Promise<boolean> {
  if (await isInitialized()) {
    return true;
  }

  if (!process.stdout.isTTY) {
    console.error(color.red('agentprofiles is not initialized.'));
    console.error(`Run ${color.cyan('agentprofiles init')} to set up.`);
    process.exit(1);
  }

  return runOnboarding();
}
