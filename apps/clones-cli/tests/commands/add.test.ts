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
const starRepo = vi.fn();
const isRepoStarred = vi.fn();

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
    step: vi.fn(),
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
    getGitHubToken: vi.fn(),
  };
});

vi.mock('../../src/lib/github.js', () => ({
  fetchGitHubMetadata,
}));

vi.mock('../../src/lib/github-stars.js', () => ({
  starRepo,
  isRepoStarred,
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
    browseActions.showSingleRepoActions.mockResolvedValue('exit');
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
    expect(browseActions.showSingleRepoActions).toHaveBeenCalledTimes(1);
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

  it('stars GitHub repo when authenticated and not already starred', async () => {
    const { getGitHubToken } = await import('../../src/lib/config.js');
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
    (getGitHubToken as vi.Mock).mockReturnValue('test-token');
    isRepoStarred.mockResolvedValue(false);
    starRepo.mockResolvedValue(true);

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

    expect(isRepoStarred).toHaveBeenCalledWith('test-token', 'owner', 'repo');
    expect(starRepo).toHaveBeenCalledWith('test-token', 'owner', 'repo');
    expect(prompts.log.info).toHaveBeenCalledWith('★ Starred on GitHub');
  });

  it('skips starring when repo is already starred', async () => {
    const { getGitHubToken } = await import('../../src/lib/config.js');
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
    (getGitHubToken as vi.Mock).mockReturnValue('test-token');
    isRepoStarred.mockResolvedValue(true);

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

    expect(isRepoStarred).toHaveBeenCalledWith('test-token', 'owner', 'repo');
    expect(starRepo).not.toHaveBeenCalled();
  });

  it('does not attempt to star when not authenticated', async () => {
    const { getGitHubToken } = await import('../../src/lib/config.js');
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
    (getGitHubToken as vi.Mock).mockReturnValue(null);

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

    expect(isRepoStarred).not.toHaveBeenCalled();
    expect(starRepo).not.toHaveBeenCalled();
  });

  it('does not attempt to star non-GitHub repos', async () => {
    const { getGitHubToken } = await import('../../src/lib/config.js');
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
    (getGitHubToken as vi.Mock).mockReturnValue('test-token');

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
        url: 'https://gitlab.com/owner/repo',
        tags: undefined,
        description: undefined,
        'update-strategy': undefined,
        submodules: undefined,
        lfs: undefined,
        full: false,
        'all-branches': false,
      },
    } as any);

    expect(isRepoStarred).not.toHaveBeenCalled();
    expect(starRepo).not.toHaveBeenCalled();
  });

  it('logs warning and continues when starring fails', async () => {
    const { getGitHubToken } = await import('../../src/lib/config.js');
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
    (getGitHubToken as vi.Mock).mockReturnValue('test-token');
    isRepoStarred.mockResolvedValue(false);
    starRepo.mockRejectedValue(new Error('API error'));

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

    expect(prompts.log.warn).toHaveBeenCalledWith('Could not star on GitHub (continuing)');
    expect(writeRegistry).toHaveBeenCalled();
  });

  it('sets source to manual on added entry', async () => {
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

    const addedEntry = (addEntry as vi.Mock).mock.calls[0][1];
    expect(addedEntry.source).toBe('manual');
  });

  it('shows progress and summary for multi-URL add', async () => {
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
        url: 'https://github.com/owner/repo1',
        tags: undefined,
        description: undefined,
        'update-strategy': undefined,
        submodules: undefined,
        lfs: undefined,
        full: false,
        'all-branches': false,
      },
      rawArgs: ['https://github.com/owner/repo1', 'https://github.com/owner/repo2'],
    } as any);

    expect(cloneRepo).toHaveBeenCalledTimes(2);
    expect(prompts.log.step).toHaveBeenCalledTimes(2);
    expect(prompts.outro).toHaveBeenCalledWith('2 added');
    expect(browseActions.showSingleRepoActions).not.toHaveBeenCalled();
  });

  it('shows action menu after single non-interactive add', async () => {
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

    expect(browseActions.showSingleRepoActions).toHaveBeenCalledTimes(1);
    const callArgs = browseActions.showSingleRepoActions.mock.calls[0];
    expect(callArgs[1]).toBe('add');
    expect(callArgs[0].entry.owner).toBe('owner');
    expect(callArgs[0].entry.repo).toBe('repo');
  });

  it('falls through to interactive loop when add-another is chosen', async () => {
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
    browseActions.showSingleRepoActions.mockResolvedValue('add-another');
    // After falling through to interactive loop, user cancels
    const cancelSym = Symbol('cancel');
    prompts.text.mockResolvedValueOnce(cancelSym);
    prompts.isCancel.mockImplementation((v: unknown) => v === cancelSym);

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

    expect(browseActions.showSingleRepoActions).toHaveBeenCalledTimes(1);
    expect(prompts.text).toHaveBeenCalledTimes(1);
  });
});
