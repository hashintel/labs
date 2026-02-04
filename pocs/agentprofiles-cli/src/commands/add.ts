import { defineCommand } from 'citty';
import { outro, text, isCancel, cancel } from '@clack/prompts';
import { ConfigManager } from '../lib/config.js';
import { SUPPORTED_TOOLS } from '../types/index.js';
import color from 'picocolors';
import { validateProfileName } from '../lib/validation.js';
import { generateName } from '@criblinc/docker-names';
import { promptForAgent } from '../lib/prompts.js';

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

  const config = new ConfigManager();
  await config.init();
  try {
    const path = await config.createProfile(resolvedAgent, name);
    outro(`Profile created at ${color.cyan(path)}`);
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
