import { defineCommand } from 'citty';
import { outro, text, isCancel, cancel, confirm } from '@clack/prompts';
import { ConfigManager } from '../lib/config.js';
import { SUPPORTED_TOOLS, BASE_PROFILE_SLUG } from '../types/index.js';
import color from 'picocolors';
import { validateNewProfileName, slugify } from '../lib/validation.js';
import { joyful } from 'joyful';
import { promptForAgent } from '../lib/prompts.js';
import { copyDirectory } from '../lib/symlink.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function addCommand(agent?: string, name?: string, from?: string) {
  let resolvedAgent = agent;

  if (!resolvedAgent) {
    resolvedAgent = await promptForAgent('Select agent to create profile for:');
  }

  if (!SUPPORTED_TOOLS[resolvedAgent]) {
    console.error(color.red(`Unsupported agent: ${resolvedAgent}`));
    process.exit(1);
  }

  if (!name) {
    const suggestedName = joyful();
    const response = await text({
      message: 'Enter profile name:',
      placeholder: suggestedName,
      initialValue: suggestedName,
      validate(value) {
        if (!value) return 'Profile name is required.';
        return validateNewProfileName(value) || undefined;
      },
    });

    if (isCancel(response)) {
      cancel('Operation cancelled.');
      process.exit(0);
    }
    name = response;
  }
  const validationError = validateNewProfileName(name);
  if (validationError) {
    console.error(color.red(validationError));
    process.exit(1);
  }

  const config = new ConfigManager();
  await config.init();
  try {
    const profileDir = await config.createProfile(resolvedAgent, name);
    const slug = slugify(name);

    // Determine source profile directory
    let sourceDir: string;
    if (from) {
      // Use the specified source profile
      const sourceSlug = slugify(from);
      sourceDir = path.join(config.getContentDir(), resolvedAgent, sourceSlug);
      try {
        await fs.access(sourceDir);
      } catch {
        console.error(
          color.red(`Source profile '${from}' does not exist for agent '${resolvedAgent}'`)
        );
        process.exit(1);
      }
    } else {
      // Default to _base
      sourceDir = path.join(config.getContentDir(), resolvedAgent, BASE_PROFILE_SLUG);
    }

    // Copy from source profile if it exists
    try {
      await fs.access(sourceDir);
      // Source exists, copy its contents to the new profile (preserving symlinks)
      await copyDirectory(sourceDir, profileDir);
      // Overwrite meta.json with the new profile's metadata
      const metaPath = path.join(profileDir, 'meta.json');
      const meta = {
        name,
        slug,
        agent: resolvedAgent,
        created_at: new Date().toISOString(),
      };
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    } catch {
      // Source doesn't exist, that's fine (only happens if --from not specified and _base doesn't exist)
    }

    // Scaffold include-list dir entries for include-based agents.
    await config.ensureIncludeProfileLayout(resolvedAgent, slug);

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
      description: 'Agent name',
      required: false,
    },
    name: {
      type: 'positional',
      description: 'Profile name',
      required: false,
    },
    from: {
      type: 'string',
      description: 'Source profile to clone from (defaults to _base)',
      required: false,
    },
  },
  async run({ args }) {
    await addCommand(args.agent, args.name, args.from);
  },
});
