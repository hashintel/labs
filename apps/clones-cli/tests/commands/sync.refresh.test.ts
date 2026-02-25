import { describe, it, expect, vi, beforeEach } from 'vitest';

const readRegistry = vi.fn();
const writeRegistry = vi.fn();
const readLocalState = vi.fn();
const writeLocalState = vi.fn();
const scanClonesDir = vi.fn();
const fetchGitHubMetadata = vi.fn();

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  progress: () => ({
    start: vi.fn(),
    advance: vi.fn(),
    message: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    error: vi.fn(),
    clear: vi.fn(),
  }),
  taskLog: () => ({
    message: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
  log: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    message: vi.fn(),
    step: vi.fn(),
  },
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

vi.mock('../../src/lib/scan.js', () => ({
  scanClonesDir,
  isNestedRepo: vi.fn(),
}));

vi.mock('../../src/lib/git.js', () => ({
  fetchWithPrune: vi.fn(),
  resetHard: vi.fn(),
  pullFastForward: vi.fn(),
  updateSubmodules: vi.fn(),
  usesLfs: vi.fn(),
  pullLfs: vi.fn(),
  cloneRepo: vi.fn(),
  GitCloneError: class GitCloneError extends Error {},
  getCloneErrorHints: vi.fn(() => []),
  getRemoteUrl: vi.fn(),
  getRepoStatus: vi.fn(),
}));

vi.mock('../../src/lib/github.js', () => ({
  fetchGitHubMetadata,
}));

const { default: syncCommand } = await import('../../src/commands/sync.js');

describe('clones sync refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates registry metadata when refresh detects changes', async () => {
    readRegistry.mockResolvedValue({
      version: '1.0.0',
      repos: [
        {
          id: 'github.com:owner/repo',
          host: 'github.com',
          owner: 'owner',
          repo: 'repo',
          cloneUrl: 'https://github.com/owner/repo.git',
          description: 'old',
          tags: ['old'],
          defaultRemoteName: 'origin',
          updateStrategy: 'hard-reset',
          submodules: 'none',
          lfs: 'auto',
          managed: false,
        },
      ],
      tombstones: [],
    });
    readLocalState.mockResolvedValue({ version: '1.0.0', repos: {} });
    scanClonesDir.mockResolvedValue({ discovered: [], skipped: [] });
    fetchGitHubMetadata.mockResolvedValue({
      description: 'new',
      topics: ['new'],
    });

    await syncCommand.run?.({ args: { refresh: true } } as any);

    expect(fetchGitHubMetadata).toHaveBeenCalledWith('owner', 'repo');
    const writtenRegistry = writeRegistry.mock.calls[0][0];
    expect(writtenRegistry.repos[0].description).toBe('new');
    expect(writtenRegistry.repos[0].tags).toEqual(['new']);
  });

  it('skips metadata fetch and writes in dry-run mode', async () => {
    readRegistry.mockResolvedValue({
      version: '1.0.0',
      repos: [
        {
          id: 'github.com:owner/repo',
          host: 'github.com',
          owner: 'owner',
          repo: 'repo',
          cloneUrl: 'https://github.com/owner/repo.git',
          defaultRemoteName: 'origin',
          updateStrategy: 'hard-reset',
          submodules: 'none',
          lfs: 'auto',
          managed: false,
        },
      ],
      tombstones: [],
    });
    readLocalState.mockResolvedValue({ version: '1.0.0', repos: {} });
    scanClonesDir.mockResolvedValue({ discovered: [], skipped: [] });

    await syncCommand.run?.({ args: { refresh: true, 'dry-run': true } } as any);

    expect(fetchGitHubMetadata).not.toHaveBeenCalled();
    expect(writeRegistry).not.toHaveBeenCalled();
    expect(writeLocalState).not.toHaveBeenCalled();
  });
});
