import { defineCommand } from 'citty';
import { outro, confirm, isCancel, cancel, note } from '@clack/prompts';
import { ConfigManager } from '../lib/config.js';
import { SUPPORTED_TOOLS, BASE_PROFILE_SLUG, SHARED_PROFILE_SLUG } from '../types/index.js';
import color from 'picocolors';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promptForAgent, promptForProfile } from '../lib/prompts.js';

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

  // Block removal of _base
  if (resolvedName === BASE_PROFILE_SLUG) {
    console.error(color.red(`Cannot remove the base profile (${BASE_PROFILE_SLUG}).`));
    process.exit(1);
  }

  // Block removal of reserved non-profile directories
  if (resolvedName === SHARED_PROFILE_SLUG) {
    console.error(color.red(`Cannot remove reserved directory (${SHARED_PROFILE_SLUG}).`));
    process.exit(1);
  }

  // Block removal of active profile
  const activeProfile = await config.getActiveProfile(resolvedAgent);
  if (activeProfile === resolvedName) {
    console.error(
      color.red(
        `Cannot remove the active profile. Switch to a different profile first.\nUse: agentprofiles set ${resolvedAgent} <profile-name>`
      )
    );
    process.exit(1);
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
      description: 'Agent name',
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
