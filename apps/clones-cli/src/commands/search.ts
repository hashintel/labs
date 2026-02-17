import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import { openDb, closeDb } from '../lib/db.js';
import { ensureSearchTables, searchReadmes } from '../lib/db-search.js';

export default defineCommand({
  meta: {
    name: 'search',
    description: 'Search repositories by README content using FTS5',
  },
  args: {
    query: {
      type: 'string',
      description: 'Search query',
      required: true,
    },
  },
  async run({ args }) {
    const query = args.query;

    if (!query || query.trim().length === 0) {
      p.log.error('Search query cannot be empty');
      process.exit(1);
    }

    try {
      const db = await openDb();

      try {
        ensureSearchTables(db);
        const results = searchReadmes(db, query);

        if (results.length === 0) {
          p.log.info('No results found for query: ' + query);
          p.log.info('Try running "clones sync" to index repository READMEs first.');
          return;
        }

        console.log();
        console.log(`Search results for: "${query}" (${results.length} matches)`);
        console.log('─'.repeat(60));

        for (const result of results) {
          const repoLabel = `${result.owner}/${result.repo}`;
          const scoreLabel = `(score: ${result.score.toFixed(2)})`;

          console.log(`\n${repoLabel} ${scoreLabel}`);

          // Truncate snippet to 100 chars for readability
          const snippet =
            result.snippet.length > 100 ? result.snippet.substring(0, 100) + '...' : result.snippet;

          console.log(`  ${snippet}`);
        }

        console.log();
        console.log('─'.repeat(60));
      } finally {
        closeDb();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      p.log.error(`Search failed: ${message}`);
      process.exit(1);
    }
  },
});
