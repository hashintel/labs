import { defineCommand } from 'citty';
import { outro, select, text, isCancel, cancel, note } from '@clack/prompts';
import { ConfigManager } from '../lib/config.js';
import { SUPPORTED_TOOLS, BASE_PROFILE_SLUG } from '../types/index.js';
import color from 'picocolors';
import { validateProfileName, slugify } from '../lib/validation.js';
import { generateName } from '@criblinc/docker-names';
import { promptForAgent } from '../lib/prompts.js';

export async function setCommand(agent?: string, name?: string) {
  const resolvedAgent: string = agent ?? (await promptForAgent('Select agent to set profile for:'));

  if (!SUPPORTED_TOOLS[resolvedAgent]) {
    console.error(color.red(`Unsupported agent: ${resolvedAgent}`));
    process.exit(1);
  }

  const config = new ConfigManager();
  await config.init();

  // Check that agent is managed
  const status = await config.getSymlinkStatus(resolvedAgent);
  if (status === 'unmanaged') {
    console.error(
      color.red(`Agent '${resolvedAgent}' is not managed. Run 'agentprofiles setup' first.`)
    );
    process.exit(1);
  }
  if (status === 'missing') {
    console.error(color.red(`Agent '${resolvedAgent}' is not installed.`));
    process.exit(1);
  }

  let resolvedName: string | undefined = name;

  if (!resolvedName) {
    const profiles = await config.getProfiles(resolvedAgent);
    const activeProfile = await config.getActiveProfile(resolvedAgent);

    if (profiles.length === 0) {
      note(`No profiles found for ${resolvedAgent}. Let's create one.`, 'New Profile');

      const suggestedName = generateName();
      const nameResponse = await text({
        message: 'Enter a name for this profile:',
        placeholder: suggestedName,
        initialValue: suggestedName,
        validate(value) {
          return validateProfileName(value) || undefined;
        },
      });

      if (isCancel(nameResponse)) {
        cancel('Operation cancelled.');
        process.exit(0);
      }

      const newName = nameResponse as string;
      await config.createProfile(resolvedAgent, newName);
      note(`Created profile ${color.cyan(newName)}`, 'Profile Created');
      resolvedName = slugify(newName);
    } else {
      const response = await select({
        message: 'Select a profile to activate:',
        options: profiles.map((p) => ({
          value: p.slug,
          label: p.slug === BASE_PROFILE_SLUG ? 'Base profile' : p.name,
          hint: p.slug === activeProfile ? '(active)' : p.description,
        })),
      });

      if (isCancel(response)) {
        cancel('Operation cancelled.');
        process.exit(0);
      }
      resolvedName = response as string;
    }
  } else {
    // Handle 'base' alias for BASE_PROFILE_SLUG
    if (resolvedName === 'base') {
      resolvedName = BASE_PROFILE_SLUG;
    } else {
      const validationError = validateProfileName(resolvedName);
      if (validationError) {
        console.error(color.red(validationError));
        process.exit(1);
      }
      resolvedName = slugify(resolvedName);
    }
  }

  if (!resolvedName) {
    console.error(color.red('Profile name is required.'));
    process.exit(1);
  }

  try {
    await config.switchProfile(resolvedAgent, resolvedName);
    outro(`Activated ${color.cyan(resolvedName)} profile for ${resolvedAgent}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(color.red(message));
    process.exit(1);
  }
}

export default defineCommand({
  meta: {
    name: 'set',
    description: 'Set the active profile for an agent',
  },
  args: {
    agent: {
      type: 'positional',
      description: 'Agent name',
      required: false,
    },
    name: {
      type: 'positional',
      description: 'Profile name (or "base" for base profile)',
      required: false,
    },
  },
  async run({ args }) {
    await setCommand(args.agent, args.name);
  },
});
