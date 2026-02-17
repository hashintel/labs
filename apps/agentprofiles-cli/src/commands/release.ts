import { defineCommand } from 'citty';
import { confirm, outro, cancel } from '@clack/prompts';
import { SUPPORTED_TOOLS } from '../types/index.js';
import color from 'picocolors';
import { promptForAgent } from '../lib/prompts.js';
import { ConfigManager } from '../lib/config.js';

export async function releaseCommand(agent?: string) {
  const resolvedAgent: string = agent ?? (await promptForAgent('Select agent to release:'));

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

  // Get the active profile to show what will happen
  const activeProfile = await config.getActiveProfile(resolvedAgent);
  const globalPath = config.getGlobalConfigPath(resolvedAgent);

  const shouldRelease = await confirm({
    message: `Release ${color.cyan(resolvedAgent)} from management? This will move the active profile (${color.cyan(activeProfile || 'unknown')}) back to ${color.cyan(globalPath)} and remove the symlink.`,
    initialValue: false,
  });

  if (!shouldRelease) {
    cancel('Operation cancelled.');
    process.exit(0);
  }

  try {
    await config.unlinkProfile(resolvedAgent);
    outro(
      `Released ${color.cyan(resolvedAgent)} from management. Profile restored to ${color.cyan(globalPath)}.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(color.red(message));
    process.exit(1);
  }
}

export default defineCommand({
  meta: {
    name: 'release',
    description: 'Release an agent from management (stop managing profiles)',
  },
  args: {
    agent: {
      type: 'positional',
      description: 'Agent name',
      required: false,
    },
  },
  async run({ args }) {
    await releaseCommand(args.agent);
  },
});
