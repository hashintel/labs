import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const openDb = vi.fn();
const closeDb = vi.fn();
const ensureSearchTables = vi.fn();
const searchRepos = vi.fn();

const prompts = vi.hoisted(() => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@clack/prompts', () => ({
  log: prompts.log,
}));

vi.mock('../../src/lib/db.js', () => ({
  openDb,
  closeDb,
}));

vi.mock('../../src/lib/db-search.js', () => ({
  ensureSearchTables,
  searchRepos,
}));

const { default: searchCommand } = await import('../../src/commands/search.js');

describe('clones search', () => {
  const originalLog = console.log;

  beforeEach(() => {
    console.log = vi.fn();
    vi.clearAllMocks();
    openDb.mockResolvedValue({});
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it('uses hybrid defaults when optional flags are omitted', async () => {
    searchRepos.mockReturnValue([]);

    await searchCommand.run?.({ args: { query: 'prompt toolkit' } } as any);

    expect(ensureSearchTables).toHaveBeenCalled();
    expect(searchRepos).toHaveBeenCalledWith(
      expect.anything(),
      'prompt toolkit',
      expect.objectContaining({
        mode: 'hybrid',
        limit: 10,
        blend: 0.5,
        rerankTop: 0,
      })
    );
    expect(prompts.log.info).toHaveBeenCalledWith(
      expect.stringContaining('No results found for query')
    );
    expect(closeDb).toHaveBeenCalled();
  });

  it('passes parsed mode, limit, blend, and rerank options to searchRepos', async () => {
    searchRepos.mockReturnValue([
      {
        repoId: 'github.com:owner/repo',
        owner: 'owner',
        repo: 'repo',
        snippet: 'Command line prompt tooling',
        score: 0.1234,
        explain: {
          bm25Rank: 1,
          bm25RawScore: -0.75,
          vectorRank: 2,
          vectorScore: 0.81,
          rrfScore: 0.1234,
          rerankScore: 0.65,
        },
      },
    ]);

    await searchCommand.run?.({
      args: {
        query: 'command prompt',
        mode: 'vector',
        limit: '7',
        blend: '0.3',
        'rerank-top': '5',
        explain: true,
      },
    } as any);

    expect(searchRepos).toHaveBeenCalledWith(
      expect.anything(),
      'command prompt',
      expect.objectContaining({
        mode: 'vector',
        limit: 7,
        blend: 0.3,
        rerankTop: 5,
      })
    );

    const output = (console.log as unknown as vi.Mock).mock.calls.flat().join('\n');
    expect(output).toContain('mode=vector');
    expect(output).toContain('explain:');
  });
});
