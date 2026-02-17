import { defineCommand } from 'citty';
import { log, note } from '@clack/prompts';
import { ConfigManager } from '../lib/config.js';
import { SUPPORTED_TOOLS, BASE_PROFILE_SLUG } from '../types/index.js';
import color from 'picocolors';

export async function listCommand(agent?: string) {
  const config = new ConfigManager();
  await config.init();

  if (agent && !SUPPORTED_TOOLS[agent]) {
    console.error(color.red(`Unsupported agent: ${agent}`));
    process.exit(1);
  }

  const configDir = config.getConfigDir();
  const contentDir = config.getContentDir();

  const configLines = [`Config:  ${color.dim(configDir)}`];
  if (contentDir !== configDir) {
    configLines.push(`Content: ${color.dim(contentDir)}`);
  }
  log.info(configLines.join('\n'));

  const agents = agent ? [agent] : Object.keys(SUPPORTED_TOOLS);

  for (const a of agents) {
    const profiles = await config.getProfiles(a);
    const activeProfile = await config.getActiveProfile(a);
    const tool = SUPPORTED_TOOLS[a];
    if (!tool) continue;

    // Filter out _base from the display list
    const displayProfiles = profiles.filter((p) => p.slug !== BASE_PROFILE_SLUG);

    if (displayProfiles.length === 0) {
      note(color.dim('No profiles found'), `${tool.description} Profiles`);
    } else {
      const lines = displayProfiles.map((p) => {
        let label = p.name !== p.slug ? `${p.name} (${p.slug})` : p.name;

        if (p.slug === activeProfile) {
          label = `● ${label}`;
        }

        if (p.description) {
          return `${color.cyan(label)} ${color.dim('-')} ${p.description}`;
        }
        return color.cyan(label);
      });

      // If active profile is _base, show an indicator at the end
      if (activeProfile === BASE_PROFILE_SLUG) {
        lines.push(`● ${color.dim('Base profile')}`);
      }

      note(lines.join('\n'), `${tool.description} Profiles`);
    }
  }
}

export default defineCommand({
  meta: {
    name: 'list',
    description: 'List available profiles',
  },
  args: {
    agent: {
      type: 'positional',
      description: 'Filter by agent name',
      required: false,
    },
  },
  async run({ args }) {
    await listCommand(args.agent);
  },
});
