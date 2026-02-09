import { defineCommand } from 'citty';
import { outro, text, isCancel, cancel, confirm } from '@clack/prompts';
import { ConfigManager } from '../lib/config.js';
import { SUPPORTED_TOOLS, BASE_PROFILE_SLUG } from '../types/index.js';
import color from 'picocolors';
import { validateProfileName, slugify } from '../lib/validation.js';
import { generateName } from '@criblinc/docker-names';
import { promptForAgent } from '../lib/prompts.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function addCommand(agent?: string, name?: string) {
  let resolvedAgent = agent;

  if (!resolvedAgent) {
    resolvedAgent = await promptForAgent('Select agent to create profile for:');
  }

  if (!SUPPORTED_TOOLS[resolvedAgent]) {
    console.error(color.red(`Unsupported agent: ${resolvedAgent}`));
    process.exit(1);
  }

  if (!name) {
    const suggestedName = generateName();
    const response = await text({
      message: 'Enter profile name:',
      placeholder: suggestedName,
      initialValue: suggestedName,
      validate(value) {
        return validateProfileName(value) || undefined;
      },
    });

    if (isCancel(response)) {
      cancel('Operation cancelled.');
      process.exit(0);
    }
    name = response;
  }
  const validationError = validateProfileName(name);
  if (validationError) {
    console.error(color.red(validationError));
    process.exit(1);
  }

  // Reject _base as a profile name (it's reserved)
  if (name === BASE_PROFILE_SLUG || name.toLowerCase() === BASE_PROFILE_SLUG) {
    console.error(color.red(`Profile name '${BASE_PROFILE_SLUG}' is reserved and cannot be used.`));
    process.exit(1);
  }

  const config = new ConfigManager();
  await config.init();
  try {
    const profileDir = await config.createProfile(resolvedAgent, name);

    // Check if _base exists for this agent and copy its contents
    const baseDir = path.join(config.getContentDir(), resolvedAgent, BASE_PROFILE_SLUG);
    try {
      await fs.access(baseDir);
      // _base exists, copy its contents to the new profile
      await fs.cp(baseDir, profileDir, { recursive: true, force: true });
      // Overwrite meta.json with the new profile's metadata
      const slug = slugify(name);
      const metaPath = path.join(profileDir, 'meta.json');
      const meta = {
        name,
        slug,
        agent: resolvedAgent,
        created_at: new Date().toISOString(),
      };
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    } catch {
      // _base doesn't exist, that's fine
    }

    outro(`Profile created at ${color.cyan(profileDir)}`);

    // Offer to switch to the new profile
    const shouldSwitch = await confirm({
      message: 'Switch to this profile now?',
      initialValue: true,
    });

    if (isCancel(shouldSwitch)) {
      process.exit(0);
    }

    if (shouldSwitch) {
      const slug = slugify(name);
      await config.switchProfile(resolvedAgent, slug);
      outro(`Switched to profile ${color.cyan(name)}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(color.red(message));
    process.exit(1);
  }
}

export default defineCommand({
  meta: {
    name: 'add',
    description: 'Create a new profile (alias: create)',
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
    await addCommand(args.agent, args.name);
  },
});
