import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import { openDb, closeDb } from '../lib/db.js';
import { readRegistry } from '../lib/registry.js';
import { syncRegistryToDb } from '../lib/db-sync.js';
import { ensureSearchTables, clearAllChunks, indexReadme } from '../lib/db-search.js';
import { readReadmeContent, hashContent, chunkText } from '../lib/readme.js';
import { getRepoPath } from '../lib/config.js';

const rebuildCommand = defineCommand({
  meta: {
    name: 'rebuild',
    description: 'Rebuild the search index from scratch',
  },
  args: {},
  async run() {
    p.intro('clones index rebuild');

    try {
      // Open database
      const db = await openDb();

      // Read registry
      const registry = await readRegistry();

      // Sync registry to DB
      p.log.step('Syncing registry to database...');
      syncRegistryToDb(db, registry);

      // Ensure search tables exist
      p.log.step('Ensuring search tables...');
      ensureSearchTables(db);

      // Clear all existing chunks
      p.log.step('Clearing existing chunks...');
      clearAllChunks(db);

      // Index all managed repos
      const managedRepos = registry.repos.filter((r) => r.managed);

      if (managedRepos.length === 0) {
        p.log.info('No managed repositories to index');
        p.outro('Done!');
        closeDb();
        return;
      }

      const progress = p.progress({
        max: managedRepos.length,
        style: 'heavy',
      });

      progress.start();

      let indexed = 0;
      let skipped = 0;
      let errors = 0;

      for (const repo of managedRepos) {
        const localPath = getRepoPath(repo.owner, repo.repo);
        const name = `${repo.owner}/${repo.repo}`;

        try {
          // Read README
          const readmeContent = await readReadmeContent(localPath);

          if (!readmeContent) {
            progress.message(`  ○ ${name} (no README)`);
            skipped += 1;
            progress.advance(1, `${indexed} indexed, ${skipped} skipped, ${errors} errors`);
            continue;
          }

          // Hash content
          const contentHash = hashContent(readmeContent);

          // Chunk text
          const chunks = chunkText(readmeContent);

          if (chunks.length === 0) {
            progress.message(`  ○ ${name} (empty README)`);
            skipped += 1;
            progress.advance(1, `${indexed} indexed, ${skipped} skipped, ${errors} errors`);
            continue;
          }

          // Index README
          indexReadme(db, repo.id, readmeContent, contentHash, chunks);

          progress.message(`  ✓ ${name} (${chunks.length} chunks)`);
          indexed += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          progress.message(`  ✗ ${name} (${message})`);
          errors += 1;
        }

        progress.advance(1, `${indexed} indexed, ${skipped} skipped, ${errors} errors`);
      }

      progress.stop(`Indexing complete: ${indexed} indexed, ${skipped} skipped, ${errors} errors`);

      p.outro('Done!');
      closeDb();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      p.log.error(`Error: ${message}`);
      closeDb();
      process.exit(1);
    }
  },
});

export default defineCommand({
  meta: {
    name: 'index',
    description: 'Manage the search index',
  },
  subCommands: {
    rebuild: () => Promise.resolve(rebuildCommand),
  },
});
