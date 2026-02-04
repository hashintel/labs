import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const readRegistry = vi.fn();
const writeRegistry = vi.fn();
const addEntry = vi.fn();
const findEntry = vi.fn();
const removeTombstone = vi.fn();
const readLocalState = vi.fn();
const writeLocalState = vi.fn();
const updateRepoLocalState = vi.fn();
const cloneRepo = vi.fn();
const getRepoStatus = vi.fn();
class GitCloneError extends Error {}
const getCloneErrorHints = vi.fn(() => []);
const fetchGitHubMetadata = vi.fn();

const prompts = vi.hoisted(() => ({
  intro: vi.fn(),
  outro: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
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
  text: prompts.text,
  confirm: prompts.confirm,
  isCancel: prompts.isCancel,
  cancel: prompts.cancel,
  spinner: prompts.spinner,
  log: prompts.log,
}));

vi.mock('../../src/lib/registry.js', () => ({
  readRegistry,
  writeRegistry,
  addEntry,
  findEntry,
  removeTombstone,
}));

vi.mock('../../src/lib/local-state.js', () => ({
  readLocalState,
  writeLocalState,
  updateRepoLocalState,
}));

vi.mock('../../src/lib/git.js', () => ({
  cloneRepo,
  getRepoStatus,
  GitCloneError,
  getCloneErrorHints,
}));

vi.mock('../../src/lib/config.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/lib/config.js')>('../../src/lib/config.js');
  return {
    ...actual,
    getRepoPath: () => '/tmp/owner/repo',
    getClonesDir: () => '/tmp',
    ensureClonesDir: vi.fn(),
  };
});

vi.mock('../../src/lib/github.js', () => ({
  fetchGitHubMetadata,
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

const browseActions = vi.hoisted(() => ({
  showSingleRepoActions: vi.fn(),
}));

vi.mock('../../src/lib/browse/single-actions.js', () => ({
  showSingleRepoActions: browseActions.showSingleRepoActions,
}));

const { default: addCommand } = await import('../../src/commands/add.js');

describe('clones add', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-26T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes local state with initial lastSyncedAt', async () => {
    readRegistry.mockResolvedValue({ version: '1.0.0', repos: [], tombstones: [] });
    findEntry.mockReturnValue(undefined);
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
    fetchGitHubMetadata.mockResolvedValue(null);
    cloneRepo.mockResolvedValue(undefined);

    const emptyLocalState = { version: '1.0.0', repos: {} };
    readLocalState.mockResolvedValue(emptyLocalState);
    updateRepoLocalState.mockImplementation((state: any, repoId: string, updates: any) => ({
      ...state,
      repos: {
        ...state.repos,
        [repoId]: { ...updates },
      },
    }));
    addEntry.mockImplementation((registry: any, entry: any) => ({
      ...registry,
      repos: [...registry.repos, entry],
    }));
    removeTombstone.mockImplementation((registry: any) => registry);

    await addCommand.run?.({
      args: {
        url: 'https://github.com/owner/repo',
        tags: undefined,
        description: undefined,
        'update-strategy': undefined,
        submodules: undefined,
        lfs: undefined,
        full: false,
        'all-branches': false,
      },
    } as any);

    expect(prompts.text).not.toHaveBeenCalled();
    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(removeTombstone).toHaveBeenCalled();
    expect(writeLocalState).toHaveBeenCalledTimes(1);
    expect(browseActions.showSingleRepoActions).not.toHaveBeenCalled();
    const writtenState = (writeLocalState as vi.Mock).mock.calls[0][0];
    expect(writtenState.repos['github.com:owner/repo'].lastSyncedAt).toBe(
      '2026-01-26T00:00:00.000Z'
    );
  });

  it('exits after interactive add when user chooses exit', async () => {
    readRegistry.mockResolvedValue({ version: '1.0.0', repos: [], tombstones: [] });
    findEntry.mockReturnValue(undefined);
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
    fetchGitHubMetadata.mockResolvedValue(null);
    cloneRepo.mockResolvedValue(undefined);

    const emptyLocalState = { version: '1.0.0', repos: {} };
    readLocalState.mockResolvedValue(emptyLocalState);
    updateRepoLocalState.mockImplementation((state: any, repoId: string, updates: any) => ({
      ...state,
      repos: {
        ...state.repos,
        [repoId]: { ...updates },
      },
    }));
    addEntry.mockImplementation((registry: any, entry: any) => ({
      ...registry,
      repos: [...registry.repos, entry],
    }));
    removeTombstone.mockImplementation((registry: any) => registry);

    prompts.text.mockResolvedValueOnce('https://github.com/owner/repo');
    browseActions.showSingleRepoActions.mockResolvedValue('exit');

    await addCommand.run?.({
      args: {
        url: undefined,
        tags: undefined,
        description: undefined,
        'update-strategy': undefined,
        submodules: undefined,
        lfs: undefined,
        full: false,
        'all-branches': false,
      },
      rawArgs: [],
    } as any);

    expect(prompts.text).toHaveBeenCalledTimes(1);
    expect(browseActions.showSingleRepoActions).toHaveBeenCalledTimes(1);
    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(prompts.outro).toHaveBeenCalled();
  });
});
