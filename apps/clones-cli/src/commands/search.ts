import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import { openDb, closeDb } from '../lib/db.js';
import { ensureSearchTables, searchRepos, type SearchMode } from '../lib/db-search.js';

const VALID_MODES: SearchMode[] = ['bm25', 'vector', 'hybrid'];

export default defineCommand({
  meta: {
    name: 'search',
    description: 'Search repositories by indexed content (bm25, vector, or hybrid)',
  },
  args: {
    query: {
      type: 'string',
      description: 'Search query',
      required: true,
    },
    mode: {
      type: 'string',
      description: 'Search mode: bm25 | vector | hybrid (default: hybrid)',
    },
    limit: {
      type: 'string',
      description: 'Maximum number of results (default: 10)',
    },
    blend: {
      type: 'string',
      description: 'Hybrid lexical blend weight from 0 to 1 (default: 0.5)',
    },
    'rerank-top': {
      type: 'string',
      description: 'Rerank top-N hybrid candidates (default: 0)',
    },
    explain: {
      type: 'boolean',
      description: 'Show score breakdown per result',
    },
  },
  async run({ args }) {
    const query = args.query;

    if (!query || query.trim().length === 0) {
      p.log.error('Search query cannot be empty');
      process.exit(1);
    }

    const mode = parseMode(args.mode);
    if (!mode) {
      p.log.error(`Invalid --mode. Expected one of: ${VALID_MODES.join(', ')}`);
      process.exit(1);
    }

    const limit = parsePositiveInteger(args.limit, 10, '--limit');
    if (limit === null) {
      process.exit(1);
    }

    const blend = parseBoundedNumber(args.blend, 0.5, 0, 1, '--blend');
    if (blend === null) {
      process.exit(1);
    }

    const rerankTop = parseNonNegativeInteger(args['rerank-top'], 0, '--rerank-top');
    if (rerankTop === null) {
      process.exit(1);
    }

    const explain = args.explain || false;

    try {
      const db = await openDb();

      try {
        ensureSearchTables(db);
        const results = searchRepos(db, query, {
          mode,
          limit,
          blend,
          rerankTop,
        });

        if (results.length === 0) {
          p.log.info(`No results found for query: ${query}`);
          p.log.info('Try running "clones sync" to refresh indexed search content.');
          return;
        }

        console.log();
        console.log(`Search results for: "${query}" (${results.length} matches, mode=${mode})`);
        console.log('─'.repeat(80));

        for (const result of results) {
          const repoLabel = `${result.owner}/${result.repo}`;
          const scoreLabel = `(score: ${result.score.toFixed(4)})`;

          console.log(`\n${repoLabel} ${scoreLabel}`);

          const snippet = truncateSnippet(result.snippet, 140);
          if (snippet.length > 0) {
            console.log(`  ${snippet}`);
          }

          if (explain) {
            const parts: string[] = [`rrf=${result.explain.rrfScore.toFixed(4)}`];

            if (result.explain.bm25Rank !== undefined) {
              parts.push(`bm25.rank=${result.explain.bm25Rank}`);
            }
            if (result.explain.bm25RawScore !== undefined) {
              parts.push(`bm25.raw=${result.explain.bm25RawScore.toFixed(4)}`);
            }
            if (result.explain.vectorRank !== undefined) {
              parts.push(`vector.rank=${result.explain.vectorRank}`);
            }
            if (result.explain.vectorScore !== undefined) {
              parts.push(`vector.score=${result.explain.vectorScore.toFixed(4)}`);
            }
            if (result.explain.rerankScore !== undefined) {
              parts.push(`rerank=${result.explain.rerankScore.toFixed(4)}`);
            }

            console.log(`  explain: ${parts.join(' | ')}`);
          }
        }

        console.log();
        console.log('─'.repeat(80));
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

function parseMode(input: string | undefined): SearchMode | null {
  if (!input) {
    return 'hybrid';
  }

  const normalized = input.toLowerCase() as SearchMode;
  return VALID_MODES.includes(normalized) ? normalized : null;
}

function parsePositiveInteger(
  input: string | undefined,
  fallback: number,
  flag: string
): number | null {
  if (input === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(input, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    p.log.error(`Invalid ${flag}: expected a positive integer`);
    return null;
  }

  return parsed;
}

function parseNonNegativeInteger(
  input: string | undefined,
  fallback: number,
  flag: string
): number | null {
  if (input === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(input, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    p.log.error(`Invalid ${flag}: expected a non-negative integer`);
    return null;
  }

  return parsed;
}

function parseBoundedNumber(
  input: string | undefined,
  fallback: number,
  min: number,
  max: number,
  flag: string
): number | null {
  if (input === undefined) {
    return fallback;
  }

  const parsed = Number.parseFloat(input);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    p.log.error(`Invalid ${flag}: expected a number between ${min} and ${max}`);
    return null;
  }

  return parsed;
}

function truncateSnippet(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.substring(0, maxLength)}...`;
}
