import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import { getGitHubConfig, clearGitHubToken } from '../../lib/config.js';

export default defineCommand({
  meta: {
    name: 'logout',
    description: 'Remove stored GitHub authentication',
  },
  async run() {
    p.intro('clones auth logout');

    const config = getGitHubConfig();
    if (!config.token) {
      p.log.info('Not logged in');
      p.outro('Done!');
      return;
    }

    const confirm = await p.confirm({
      message: `Remove GitHub token for ${config.username}?`,
    });

    if (p.isCancel(confirm) || !confirm) {
      p.cancel('Cancelled');
      return;
    }

    try {
      await clearGitHubToken();
      p.log.success('Logged out');
      p.outro('Done!');
    } catch (error) {
      p.log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
});
