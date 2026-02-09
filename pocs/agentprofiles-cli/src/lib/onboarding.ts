import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { ConfigManager } from './config.js';
import { SUPPORTED_TOOLS, SHARED_DIRECTORIES, BASE_PROFILE_SLUG } from '../types/index.js';

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

export async function isInitialized(): Promise<boolean> {
  try {
    await fs.access(getConfigPath());
    return true;
  } catch {
    return false;
  }
}

export async function runOnboarding(options: { isRerun?: boolean } = {}): Promise<boolean> {
  const config = new ConfigManager();

  if (options.isRerun) {
    p.intro(color.cyan('Re-running agentprofiles setup'));
  } else {
    p.intro(color.cyan('Welcome to agentprofiles!'));
    p.note(
      `This tool manages configuration profiles for LLM agent tools.\n` +
        `Profiles are stored as symlinks to centralized directories.`,
      'About'
    );
  }

  const configDir = config.getConfigDir();
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
  contentDir = expandTildePath(contentDir);

  // If contentDir differs from configDir, set it in environment for ConfigManager
  if (contentDir !== configDir) {
    process.env.AGENTPROFILES_CONTENT_DIR = contentDir;
  }

  const spinner = p.spinner();
  spinner.start('Creating directories...');

  try {
    await config.ensureConfigDir();

    // Persist contentDir to config.json if it differs from configDir
    if (contentDir !== configDir) {
      await config.setContentDir(contentDir);
    }

    spinner.stop('Directories created');
  } catch (error) {
    spinner.stop('Failed to create directories');
    p.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }

  // Scan agents for adoption
  const adoptedAgents: string[] = [];
  for (const [agent, toolDef] of Object.entries(SUPPORTED_TOOLS)) {
    const status = await config.getSymlinkStatus(agent);

    if (status === 'unmanaged') {
      const globalPath = config.getGlobalConfigPath(agent);
      const shouldAdopt = await p.confirm({
        message: `Found existing ${toolDef.description} config at ${color.dim(globalPath)}. Adopt as _base profile?`,
        initialValue: true,
      });

      if (p.isCancel(shouldAdopt)) {
        p.cancel('Setup cancelled.');
        return false;
      }

      if (shouldAdopt === true) {
        try {
          await config.adoptExisting(agent, BASE_PROFILE_SLUG);

          // Verify adoption was successful
          const verified = await config.verifyAdoption(agent, BASE_PROFILE_SLUG);
          if (!verified) {
            p.log.warn(
              `Adoption of ${agent} may have failed verification. ` +
                `Please check that ${config.getGlobalConfigPath(agent)} is a symlink pointing to the correct profile.`
            );
          } else {
            adoptedAgents.push(agent);
            p.log.success(`Adopted ${toolDef.description} as _base profile`);
          }
        } catch (error) {
          p.log.error(
            `Failed to adopt ${agent}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    } else if (status === 'active') {
      p.log.info(`${toolDef.description} is already managed`);
    }
  }

  // Scan shared directories for adoption
  const adoptedSharedDirs: string[] = [];
  for (const [name, sharedDir] of Object.entries(SHARED_DIRECTORIES)) {
    const status = await config.getSharedDirStatus(name);

    if (status === 'unmanaged') {
      const globalPath = config.getSharedDirGlobalPath(name);
      const shouldAdopt = await p.confirm({
        message: `Found existing ${sharedDir.description} at ${color.dim(globalPath)}. Adopt?`,
        initialValue: true,
      });

      if (p.isCancel(shouldAdopt)) {
        p.cancel('Setup cancelled.');
        return false;
      }

      if (shouldAdopt === true) {
        try {
          await config.adoptSharedDir(name);

          // Verify adoption was successful
          const verified = (await config.getSharedDirStatus(name)) === 'active';
          if (!verified) {
            p.log.warn(
              `Adoption of ${name} may have failed verification. ` +
                `Please check that ${config.getSharedDirGlobalPath(name)} is a symlink pointing to the correct location.`
            );
          } else {
            adoptedSharedDirs.push(name);
            p.log.success(`Adopted ${sharedDir.description}`);
          }
        } catch (error) {
          p.log.error(
            `Failed to adopt ${name}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    } else if (status === 'active') {
      p.log.info(`${sharedDir.description} is already managed`);
    }
  }

  // Show summary
  let summary = color.green('Setup complete!');
  if (adoptedAgents.length > 0 || adoptedSharedDirs.length > 0) {
    summary += '\n\nAdopted:';
    for (const agent of adoptedAgents) {
      const toolDef = SUPPORTED_TOOLS[agent];
      if (toolDef) {
        summary += `\n  • ${toolDef.description} (_base profile)`;
      }
    }
    for (const name of adoptedSharedDirs) {
      const sharedDir = SHARED_DIRECTORIES[name];
      if (sharedDir) {
        summary += `\n  • ${sharedDir.description}`;
      }
    }
  }
  summary += `\n\nRun ${color.cyan('agentprofiles add <agent>')} to create additional profiles.`;

  p.outro(summary);
  return true;
}

export async function ensureInitialized(): Promise<boolean> {
  if (await isInitialized()) {
    return true;
  }

  if (!process.stdout.isTTY) {
    console.error(color.red('agentprofiles is not initialized.'));
    console.error(`Run ${color.cyan('agentprofiles setup')} to set up.`);
    process.exit(1);
  }

  return runOnboarding();
}
