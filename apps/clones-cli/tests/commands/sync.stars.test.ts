import { describe, it, expect, vi, beforeEach } from 'vitest';

const readRegistry = vi.fn();
const writeRegistry = vi.fn();
const readLocalState = vi.fn();
const writeLocalState = vi.fn();
const fetchStarredRepos = vi.fn();
const getGitHubConfig = vi.fn();
const cancellation = {
  signal: new AbortController().signal,
  cancel: vi.fn(),
  dispose: vi.fn(),
};

const prompts = vi.hoisted(() => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    message: vi.fn(),
    step: vi.fn(),
  },
}));

vi.mock('@clack/prompts', () => ({
  intro: prompts.intro,
  outro: prompts.outro,
  log: prompts.log,
  progress: vi.fn(() => ({
    start: vi.fn(),
    advance: vi.fn(),
    message: vi.fn(),
    stop: vi.fn(),
  })),
  taskLog: vi.fn(() => ({
    message: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../../src/lib/cancel.js', () => ({
  createCancellationController: () => cancellation,
}));

vi.mock('../../src/lib/registry.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/registry.js')>(
    '../../src/lib/registry.js'
  );
  return {
    ...actual,
    readRegistry,
    writeRegistry,
  };
});

vi.mock('../../src/lib/local-state.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/local-state.js')>(
    '../../src/lib/local-state.js'
  );
  return {
    ...actual,
    readLocalState,
    writeLocalState,
  };
});

vi.mock('../../src/lib/github-stars.js', () => ({
  fetchStarredRepos,
}));

vi.mock('../../src/lib/config.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/lib/config.js')>('../../src/lib/config.js');
  return {
    ...actual,
    getGitHubConfig,
  };
});

vi.mock('../../src/lib/scan.js', () => ({
  scanClonesDir: vi.fn().mockResolvedValue({ discovered: [] }),
  isNestedRepo: vi.fn(),
}));
vi.mock('../../src/lib/git.js', () => ({
  getRepoStatus: vi.fn().mockResolvedValue({
    exists: false,
    isGitRepo: false,
    currentBranch: null,
    isDetached: false,
    tracking: null,
    ahead: 0,
    behind: 0,
    isDirty: false,
  }),
  getRemoteUrl: vi.fn(),
}));
vi.mock('../../src/lib/github.js', () => ({
  fetchGitHubMetadata: vi.fn(),
}));
vi.mock('../../src/lib/concurrency.js', () => ({
  normalizeConcurrency: vi.fn((val, opts) => ({
    value: val ? Number.parseInt(val, 10) : opts.defaultValue,
    warning: undefined,
  })),
  runWithConcurrency: vi.fn(async function* () {
    // Empty async generator
  }),
}));
vi.mock('../../src/lib/db.js');
vi.mock('../../src/lib/db-sync.js');
vi.mock('../../src/lib/db-search.js');
vi.mock('../../src/lib/readme.js');

describe('sync command - Phase 0: GitHub Stars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip phase when not authenticated', async () => {
    getGitHubConfig.mockReturnValue({ token: undefined, syncStars: true });
    readRegistry.mockResolvedValue({ version: '1.0.0', repos: [], tombstones: [] });
    readLocalState.mockResolvedValue({ version: '1.0.0', repos: {} });

    const { default: syncCommand } = await import('../../src/commands/sync.js');
    await syncCommand.run({ args: {} });

    expect(fetchStarredRepos).not.toHaveBeenCalled();
    expect(prompts.log.step).not.toHaveBeenCalledWith('Phase 0: Syncing GitHub stars...');
  });

  it('should skip phase when syncStars is false', async () => {
    getGitHubConfig.mockReturnValue({ token: 'test-token', syncStars: false });
    readRegistry.mockResolvedValue({ version: '1.0.0', repos: [], tombstones: [] });
    readLocalState.mockResolvedValue({ version: '1.0.0', repos: {} });

    const { default: syncCommand } = await import('../../src/commands/sync.js');
    await syncCommand.run({ args: {} });

    expect(fetchStarredRepos).not.toHaveBeenCalled();
  });

  it('should add new starred repos to registry', async () => {
    getGitHubConfig.mockReturnValue({ token: 'test-token', syncStars: true });
    const emptyRegistry = { version: '1.0.0' as const, repos: [], tombstones: [] };
    readRegistry.mockResolvedValue(emptyRegistry);
    readLocalState.mockResolvedValue({ version: '1.0.0', repos: {} });

    fetchStarredRepos.mockResolvedValue([
      {
        owner: 'colinhacks',
        repo: 'zod',
        cloneUrl: 'https://github.com/colinhacks/zod.git',
        description: 'TypeScript-first schema validation',
        topics: ['typescript', 'validation'],
        starredAt: '2024-01-01T00:00:00Z',
      },
    ]);

    const { default: syncCommand } = await import('../../src/commands/sync.js');
    await syncCommand.run({ args: {} });

    expect(fetchStarredRepos).toHaveBeenCalledWith('test-token');
    expect(writeRegistry).toHaveBeenCalled();
  });

  it('should handle API errors gracefully', async () => {
    getGitHubConfig.mockReturnValue({ token: 'test-token', syncStars: true });
    readRegistry.mockResolvedValue({ version: '1.0.0', repos: [], tombstones: [] });
    readLocalState.mockResolvedValue({ version: '1.0.0', repos: {} });

    fetchStarredRepos.mockRejectedValue(new Error('Rate limit exceeded'));

    const { default: syncCommand } = await import('../../src/commands/sync.js');
    await syncCommand.run({ args: {} });

    expect(prompts.log.warn).toHaveBeenCalledWith(expect.stringContaining('Phase 0 failed'));
  });
});
