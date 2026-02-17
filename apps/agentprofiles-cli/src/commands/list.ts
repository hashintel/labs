import { defineCommand } from 'citty';
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

  console.log(color.bold('Configuration:'));
  console.log(`  Config:  ${color.dim(configDir)}`);
  if (contentDir !== configDir) {
    console.log(`  Content: ${color.dim(contentDir)}`);
  }

  const agents = agent ? [agent] : Object.keys(SUPPORTED_TOOLS);

  for (const a of agents) {
    const profiles = await config.getProfiles(a);
    const activeProfile = await config.getActiveProfile(a);
    const tool = SUPPORTED_TOOLS[a];
    if (!tool) continue;
    console.log(color.bold(`\n${tool.description} Profiles:`));
    if (profiles.length === 0) {
      console.log(color.dim('  No profiles found'));
    } else {
      for (const p of profiles) {
        let label = p.name !== p.slug ? `${p.name} (${p.slug})` : p.name;

        // Mark active profile
        if (p.slug === activeProfile) {
          label = `● ${label}`;
        }

        // Label _base profile
        let description = p.description || 'No description';
        if (p.slug === BASE_PROFILE_SLUG) {
          description = 'Base profile';
        }

        console.log(`  ${color.cyan(label)} - ${description}`);
      }
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
