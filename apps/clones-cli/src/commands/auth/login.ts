import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { performDeviceFlowAuth, GITHUB_CLIENT_ID } from '../../lib/github-auth.js';
import { setGitHubToken, getGitHubConfig } from '../../lib/config.js';

export default defineCommand({
  meta: {
    name: 'login',
    description: 'Authenticate with GitHub using Device Flow',
  },
  async run() {
    p.intro('clones auth login');

    const config = getGitHubConfig();
    if (config.token) {
      p.log.warn(`Already logged in as ${config.username}`);
      const overwrite = await p.confirm({
        message: 'Overwrite existing token?',
      });

      if (p.isCancel(overwrite) || !overwrite) {
        p.cancel('Cancelled');
        return;
      }
    }

    try {
      const token = await performDeviceFlowAuth(GITHUB_CLIENT_ID);

      // Extract username from token by calling GitHub API
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!userResponse.ok) {
        throw new Error('Failed to verify token with GitHub API');
      }

      const userData = (await userResponse.json()) as { login: string };
      const username = userData.login;

      await setGitHubToken(token, username);

      p.log.success(`Logged in as ${pc.cyan(username)}`);
      p.outro('Done!');
    } catch (error) {
      p.log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
});
