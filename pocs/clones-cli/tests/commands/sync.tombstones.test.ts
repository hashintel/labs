import { describe, it, expect, vi, beforeEach } from 'vitest';

const readRegistry = vi.fn();
const writeRegistry = vi.fn();
const readLocalState = vi.fn();
const writeLocalState = vi.fn();
const scanClonesDir = vi.fn();
const isNestedRepo = vi.fn();
const getRemoteUrl = vi.fn();
const getRepoStatus = vi.fn();
const rm = vi.fn();
class GitCloneError extends Error {}
const getCloneErrorHints = vi.fn(() => []);

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
  isNestedRepo,
}));

vi.mock('../../src/lib/git.js', () => ({
  fetchWithPrune: vi.fn(),
  resetHard: vi.fn(),
  pullFastForward: vi.fn(),
  updateSubmodules: vi.fn(),
  usesLfs: vi.fn(),
  pullLfs: vi.fn(),
  cloneRepo: vi.fn(),
  GitCloneError,
  getCloneErrorHints,
  getRemoteUrl,
  getRepoStatus,
}));

vi.mock('node:fs/promises', () => ({
  rm,
}));

const { default: syncCommand } = await import('../../src/commands/sync.js');

describe('clones sync tombstones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes tombstoned repos from disk and does not adopt them', async () => {
    readRegistry.mockResolvedValue({
      version: '1.0.0',
      repos: [],
      tombstones: ['github.com:owner/repo'],
    });
    readLocalState.mockResolvedValue({ version: '1.0.0', repos: {} });
    scanClonesDir.mockResolvedValue({
      discovered: [{ owner: 'owner', repo: 'repo', localPath: '/tmp/owner/repo' }],
      skipped: [],
    });
    isNestedRepo.mockResolvedValue(false);
    getRemoteUrl.mockResolvedValue('https://github.com/owner/repo.git');
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

    await syncCommand.run?.({ args: {} } as any);

    expect(rm).toHaveBeenCalledWith('/tmp/owner/repo', { recursive: true, force: true });
    const writtenRegistry = writeRegistry.mock.calls[0][0];
    expect(writtenRegistry.repos).toHaveLength(0);
    expect(writtenRegistry.tombstones).toContain('github.com:owner/repo');
  });

  it('keeps tombstoned repos on disk when --keep is set', async () => {
    readRegistry.mockResolvedValue({
      version: '1.0.0',
      repos: [],
      tombstones: ['github.com:owner/repo'],
    });
    readLocalState.mockResolvedValue({ version: '1.0.0', repos: {} });
    scanClonesDir.mockResolvedValue({
      discovered: [{ owner: 'owner', repo: 'repo', localPath: '/tmp/owner/repo' }],
      skipped: [],
    });
    isNestedRepo.mockResolvedValue(false);
    getRemoteUrl.mockResolvedValue('https://github.com/owner/repo.git');
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

    await syncCommand.run?.({ args: { keep: true } } as any);

    expect(rm).not.toHaveBeenCalled();
    const writtenRegistry = writeRegistry.mock.calls[0][0];
    expect(writtenRegistry.repos).toHaveLength(0);
    expect(writtenRegistry.tombstones).toContain('github.com:owner/repo');
  });

  it('skips adoption when remote owner/repo mismatches path', async () => {
    readRegistry.mockResolvedValue({
      version: '1.0.0',
      repos: [],
      tombstones: [],
    });
    readLocalState.mockResolvedValue({ version: '1.0.0', repos: {} });
    scanClonesDir.mockResolvedValue({
      discovered: [{ owner: 'owner', repo: 'repo', localPath: '/tmp/owner/repo' }],
      skipped: [],
    });
    isNestedRepo.mockResolvedValue(false);
    getRemoteUrl.mockResolvedValue('https://github.com/other/other-repo.git');
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

    await syncCommand.run?.({ args: {} } as any);

    const writtenRegistry = writeRegistry.mock.calls[0][0];
    expect(writtenRegistry.repos).toHaveLength(0);
    expect(rm).not.toHaveBeenCalled();
  });
});
