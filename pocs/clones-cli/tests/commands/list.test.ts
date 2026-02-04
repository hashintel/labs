import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const readRegistry = vi.fn();
const filterByTags = vi.fn((registry: any) => registry.repos);
const filterByPattern = vi.fn((registry: any) => registry.repos);
const getRepoStatus = vi.fn();
const getRepoPath = vi.fn(() => '/tmp/owner/repo');
const getClonesDir = vi.fn(() => '/tmp');
const readLocalState = vi.fn();
const getLastSyncedAt = vi.fn((state: any, repoId: string) => state.repos[repoId]?.lastSyncedAt);

const prompts = vi.hoisted(() => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@clack/prompts', () => ({
  intro: prompts.intro,
  outro: prompts.outro,
  log: prompts.log,
}));

vi.mock('../../src/lib/registry.js', () => ({
  readRegistry,
  filterByTags,
  filterByPattern,
}));

vi.mock('../../src/lib/git.js', () => ({
  getRepoStatus,
}));

vi.mock('../../src/lib/config.js', () => ({
  getRepoPath,
  getClonesDir,
}));

vi.mock('../../src/lib/local-state.js', () => ({
  readLocalState,
  getLastSyncedAt,
}));

const { default: listCommand } = await import('../../src/commands/list.js');

describe('clones list', () => {
  const originalLog = console.log;

  beforeEach(() => {
    console.log = vi.fn();
  });

  afterEach(() => {
    console.log = originalLog;
    vi.clearAllMocks();
  });

  it('uses local state lastSyncedAt for JSON output', async () => {
    const entry = {
      id: 'github.com:owner/repo',
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      cloneUrl: 'https://github.com/owner/repo.git',
      defaultRemoteName: 'origin',
      updateStrategy: 'hard-reset',
      submodules: 'none',
      lfs: 'auto',
      managed: true,
    };

    readRegistry.mockResolvedValue({ version: '1.0.0', repos: [entry], tombstones: [] });
    readLocalState.mockResolvedValue({
      version: '1.0.0',
      lastSyncRun: '2026-01-02T00:00:00Z',
      repos: {
        [entry.id]: { lastSyncedAt: '2026-01-03T00:00:00Z' },
      },
    });

    getRepoStatus.mockResolvedValue({
      exists: true,
      isGitRepo: true,
      currentBranch: 'main',
      isDetached: false,
      tracking: 'origin/main',
      ahead: 0,
      behind: 0,
      isDirty: false,
    });

    await listCommand.run?.({ args: { json: true } } as any);

    const output = (console.log as unknown as vi.Mock).mock.calls[0][0];
    const parsed = JSON.parse(output);

    expect(parsed.repos[0].lastSyncedAt).toBe('2026-01-03T00:00:00Z');
    expect(prompts.intro).not.toHaveBeenCalled();
    expect(prompts.outro).not.toHaveBeenCalled();
  });

  it("prints 'last sync never' when local state has no lastSyncRun", async () => {
    const entry = {
      id: 'github.com:owner/repo',
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      cloneUrl: 'https://github.com/owner/repo.git',
      defaultRemoteName: 'origin',
      updateStrategy: 'hard-reset',
      submodules: 'none',
      lfs: 'auto',
      managed: true,
    };

    readRegistry.mockResolvedValue({ version: '1.0.0', repos: [entry], tombstones: [] });
    readLocalState.mockResolvedValue({ version: '1.0.0', repos: {} });

    getRepoStatus.mockResolvedValue({
      exists: false,
      isGitRepo: false,
      currentBranch: null,
      isDetached: false,
      tracking: null,
      ahead: 0,
      behind: 0,
      isDirty: false,
    });

    await listCommand.run?.({ args: { json: false } } as any);

    const calls = (console.log as unknown as vi.Mock).mock.calls.flat().join('\n');
    expect(calls).toContain('last sync never');
    expect(prompts.intro).not.toHaveBeenCalled();
    expect(prompts.outro).not.toHaveBeenCalled();
  });
});
