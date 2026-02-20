import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import { readRegistry } from '../lib/registry.js';
import { getGitHubConfig } from '../lib/config.js';
import { fetchStarredRepos } from '../lib/github-stars.js';

export default defineCommand({
  meta: {
    name: 'stars',
    description: 'Show sync status between local registry and GitHub stars',
  },
  async run() {
    p.intro('clones stars');

    // Check authentication
    const config = getGitHubConfig();
    if (!config.token) {
      p.log.error('Not authenticated with GitHub');
      p.log.info("Run 'clones auth login' to authenticate");
      p.outro('');
      return;
    }

    const s = p.spinner();

    try {
      // Fetch data in parallel
      s.start('Fetching GitHub stars and registry...');
      const [starredRepos, registry] = await Promise.all([
        fetchStarredRepos(config.token),
        readRegistry(),
      ]);
      s.stop('Data fetched');

      // Build sets for comparison
      const starredIds = new Set(
        starredRepos.map(
          (star) => `github.com:${star.owner.toLowerCase()}/${star.repo.toLowerCase()}`
        )
      );

      const registryGitHubIds = new Set(
        registry.repos.filter((r) => r.host === 'github.com').map((r) => r.id)
      );

      // Calculate stats
      const totalStars = starredRepos.length;
      const totalRegistry = registry.repos.length;
      const totalRegistryGitHub = registryGitHubIds.size;

      // Stars not in registry
      const newStars = starredRepos.filter((star) => {
        const id = `github.com:${star.owner.toLowerCase()}/${star.repo.toLowerCase()}`;
        return !registryGitHubIds.has(id);
      });

      // Registry GitHub repos not starred
      const unstarred = registry.repos.filter((r) => {
        return r.host === 'github.com' && !starredIds.has(r.id);
      });

      // Display results
      p.log.info(`GitHub stars: ${totalStars}`);
      p.log.info(`Registry repos: ${totalRegistry} (${totalRegistryGitHub} from GitHub)`);
      p.log.info('');

      if (newStars.length > 0) {
        p.log.warn(`${newStars.length} starred repos not in registry:`);
        for (const star of newStars.slice(0, 20)) {
          p.log.info(`  ★ ${star.owner}/${star.repo}`);
        }
        if (newStars.length > 20) {
          p.log.info(`  ... and ${newStars.length - 20} more`);
        }
        p.log.info("Run 'clones sync' to add them");
      } else {
        p.log.success('All starred repos are in registry');
      }

      p.log.info('');

      if (unstarred.length > 0) {
        p.log.warn(`${unstarred.length} registry repos not starred on GitHub:`);
        for (const repo of unstarred.slice(0, 20)) {
          p.log.info(`  ○ ${repo.owner}/${repo.repo}`);
        }
        if (unstarred.length > 20) {
          p.log.info(`  ... and ${unstarred.length - 20} more`);
        }
      } else {
        p.log.success('All GitHub registry repos are starred');
      }

      // Sync status summary
      const syncedCount = totalRegistryGitHub - unstarred.length;
      p.log.info('');
      p.log.info(`Sync status: ${syncedCount}/${totalRegistryGitHub} GitHub repos in sync`);
      if (config.syncStars) {
        p.log.info('Auto-sync: enabled (stars will sync during `clones sync`)');
      } else {
        p.log.info('Auto-sync: disabled (enable with syncStars in config)');
      }
    } catch (error) {
      s.stop('Failed');
      if (error instanceof Error && error.message.includes('Invalid GitHub token')) {
        p.log.error('GitHub token is invalid or expired');
        p.log.info("Run 'clones auth login' to re-authenticate");
      } else {
        p.log.error(error instanceof Error ? error.message : String(error));
      }
    }

    p.outro('');
  },
});
