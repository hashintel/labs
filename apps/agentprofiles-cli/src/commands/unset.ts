import { defineCommand } from 'citty';
import { outro } from '@clack/prompts';
import { SUPPORTED_TOOLS, BASE_PROFILE_SLUG } from '../types/index.js';
import color from 'picocolors';
import { promptForAgent } from '../lib/prompts.js';
import { ConfigManager } from '../lib/config.js';

export async function unsetCommand(agent?: string) {
  const resolvedAgent: string = agent ?? (await promptForAgent('Select agent to unset:'));

  if (!SUPPORTED_TOOLS[resolvedAgent]) {
    console.error(color.red(`Unsupported agent: ${resolvedAgent}`));
    process.exit(1);
  }

  const config = new ConfigManager();
  await config.init();

  // Check that agent is managed
  const status = await config.getSymlinkStatus(resolvedAgent);
  if (status === 'unmanaged') {
    console.error(color.red(`Agent '${resolvedAgent}' is not managed.`));
    process.exit(1);
  }
  if (status === 'missing') {
    console.error(color.red(`Agent '${resolvedAgent}' is not installed.`));
    process.exit(1);
  }

  try {
    await config.switchProfile(resolvedAgent, BASE_PROFILE_SLUG);
    outro(`Switched ${resolvedAgent} to base profile.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(color.red(message));
    process.exit(1);
  }
}

export default defineCommand({
  meta: {
    name: 'unset',
    description: 'Switch an agent back to its base profile',
  },
  args: {
    agent: {
      type: 'positional',
      description: 'Agent name',
      required: false,
    },
  },
  async run({ args }) {
    await unsetCommand(args.agent);
  },
});
