import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showSingleRepoActions } from '../../../src/lib/browse/single-actions.js';
import type { RepoInfo } from '../../../src/lib/browse/batch-actions.js';
import { copyToClipboard } from '../../../src/lib/ui-utils.js';

const prompts = vi.hoisted(() => ({
  select: vi.fn(),
  isCancel: vi.fn(() => false),
  log: {
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    step: vi.fn(),
  },
}));

vi.mock('@clack/prompts', () => ({
  select: prompts.select,
  isCancel: prompts.isCancel,
  log: prompts.log,
}));

vi.mock('../../../src/lib/ui-utils.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/ui-utils.js')>(
    '../../../src/lib/ui-utils.js'
  );
  return {
    ...actual,
    copyToClipboard: vi.fn(),
  };
});

vi.mock('../../../src/lib/local-state.js', () => ({
  readLocalState: vi.fn().mockResolvedValue({ version: '1.0.0', repos: {} }),
  getLastSyncedAt: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

const baseRepo: RepoInfo = {
  entry: {
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
  },
  status: {
    exists: true,
    isGitRepo: true,
    currentBranch: 'main',
    isDetached: false,
    tracking: 'origin/main',
    ahead: 0,
    behind: 0,
    isDirty: false,
  },
  localPath: '/tmp/owner/repo',
};

describe('showSingleRepoActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('copies path and exits in browse mode', async () => {
    prompts.select.mockResolvedValue('copy');

    const result = await showSingleRepoActions(baseRepo, 'browse');

    expect(result).toBe('exit');
    expect(copyToClipboard).toHaveBeenCalledTimes(1);
  });

  it('returns browse when chosen', async () => {
    prompts.select.mockResolvedValue('browse');

    const result = await showSingleRepoActions(baseRepo, 'browse');

    expect(result).toBe('browse');
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it('returns add-another when chosen in add mode', async () => {
    prompts.select.mockResolvedValue('add-another');

    const result = await showSingleRepoActions(baseRepo, 'add');

    expect(result).toBe('add-another');
  });
});
