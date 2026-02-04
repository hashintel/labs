import { defineCommand } from 'citty';
import { outro, confirm, isCancel, cancel, note } from '@clack/prompts';
import { ConfigManager } from '../lib/config.js';
import { SUPPORTED_TOOLS } from '../types/index.js';
import color from 'picocolors';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promptForAgent, promptForProfile } from '../lib/prompts.js';
import {
  MANAGED_ENVRC_FILENAME,
  LEGACY_MANAGED_ENVRC_FILENAME,
  getActiveProfile,
  removeAgentBlock,
  hasAnyAgentBlocks,
  removeBootstrapBlock,
  isEffectivelyEmpty,
} from '../lib/envrc.js';

export async function removeCommand(agent?: string, name?: string) {
  const resolvedAgent: string = agent ?? (await promptForAgent('Select agent:'));

  if (!SUPPORTED_TOOLS[resolvedAgent]) {
    console.error(color.red(`Unsupported agent: ${resolvedAgent}`));
    process.exit(1);
  }

  const config = new ConfigManager();
  await config.init();
  const profiles = await config.getProfiles(resolvedAgent);

  if (profiles.length === 0) {
    note(`No profiles found for ${resolvedAgent}. Nothing to remove.`, 'No Profiles');
    process.exit(0);
  }

  let resolvedName: string;
  if (name) {
    resolvedName = name;
  } else {
    const selected = await promptForProfile(config, resolvedAgent, 'Select a profile to remove:');
    if (!selected) {
      note(`No profiles found for ${resolvedAgent}.`, 'No Profiles');
      process.exit(0);
    }
    resolvedName = selected;
  }

  const profileDir = path.join(config.getContentDir(), resolvedAgent, resolvedName);
  try {
    await fs.access(profileDir);
  } catch {
    console.error(color.red(`Profile '${resolvedName}' not found for agent '${resolvedAgent}'`));
    process.exit(1);
  }

  const shouldDelete = await confirm({
    message: `Are you sure you want to delete the profile ${color.cyan(resolvedName)}? This cannot be undone.`,
    initialValue: false,
  });

  if (isCancel(shouldDelete) || !shouldDelete) {
    cancel('Operation cancelled.');
    process.exit(0);
  }

  const cwd = process.cwd();
  const envrcPath = path.join(cwd, '.envrc');
  const nextPath = path.join(cwd, MANAGED_ENVRC_FILENAME);
  const legacyPath = path.join(cwd, LEGACY_MANAGED_ENVRC_FILENAME);
  let managedEnvrcPath = nextPath;

  try {
    await fs.access(nextPath);
    managedEnvrcPath = nextPath;
  } catch {
    try {
      await fs.access(legacyPath);
      try {
        await fs.rename(legacyPath, nextPath);
        managedEnvrcPath = nextPath;
      } catch {
        try {
          const legacyContent = await fs.readFile(legacyPath, 'utf-8');
          await fs.writeFile(nextPath, legacyContent);
          await fs.unlink(legacyPath);
          managedEnvrcPath = nextPath;
        } catch {
          // If migration fails, we'll fall back to attempting to read the legacy file directly.
          managedEnvrcPath = legacyPath;
        }
      }
    } catch {
      // No managed envrc file in current directory, nothing to unset.
      managedEnvrcPath = nextPath;
    }
  }
  try {
    const managedContent = await fs.readFile(managedEnvrcPath, 'utf-8');
    const activeProfile = getActiveProfile(managedContent, resolvedAgent);
    if (activeProfile === resolvedName) {
      const nextManaged = removeAgentBlock(managedContent, resolvedAgent);

      if (!hasAnyAgentBlocks(nextManaged)) {
        await fs.unlink(managedEnvrcPath);

        try {
          const envrcContent = await fs.readFile(envrcPath, 'utf-8');
          const withoutBootstrap = removeBootstrapBlock(envrcContent);

          if (isEffectivelyEmpty(withoutBootstrap)) {
            await fs.unlink(envrcPath);
          } else {
            await fs.writeFile(envrcPath, withoutBootstrap + '\n');
          }
        } catch {
          // No .envrc to update
        }
      } else {
        await fs.writeFile(managedEnvrcPath, nextManaged);
      }

      note(
        `Profile was active in this directory. Unset automatically.\nRun 'direnv allow' to apply changes.`,
        'Auto-unset'
      );
    }
  } catch {
    // No managed envrc file in current directory, nothing to unset
  }

  await fs.rm(profileDir, { recursive: true, force: true });

  outro(`Deleted profile ${color.cyan(resolvedName)} for ${resolvedAgent}.`);
}

export default defineCommand({
  meta: {
    name: 'remove',
    description: 'Remove a profile (alias: rm)',
  },
  args: {
    agent: {
      type: 'positional',
      description: 'Agent name (claude/opencode)',
      required: false,
    },
    name: {
      type: 'positional',
      description: 'Profile name',
      required: false,
    },
  },
  async run({ args }) {
    await removeCommand(args.agent, args.name);
  },
});
