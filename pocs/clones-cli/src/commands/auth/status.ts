import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { getGitHubConfig } from '../../lib/config.js';

export default defineCommand({
  meta: {
    name: 'status',
    description: 'Show GitHub authentication status',
  },
  async run() {
    p.intro('clones auth status');

    const config = getGitHubConfig();

    if (config.token && config.username) {
      p.log.success(`Logged in as ${pc.cyan(config.username)}`);
    } else {
      p.log.info('Not logged in');
    }

    p.outro('Done!');
  },
});
