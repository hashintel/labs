import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showBatchActions, type RepoInfo } from '../../../src/lib/browse/batch-actions.js';
import { ExitRequestedError } from '../../../src/lib/browse/errors.js';
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

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

const repo: RepoInfo = {
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

describe('showBatchActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exits after performing a batch action', async () => {
    prompts.select.mockResolvedValue('copy-paths');

    await expect(showBatchActions([repo])).rejects.toBeInstanceOf(ExitRequestedError);
    expect(copyToClipboard).toHaveBeenCalledTimes(1);
  });

  it('returns to browse when requested', async () => {
    prompts.select.mockResolvedValue('browse');

    await expect(showBatchActions([repo])).resolves.toBeUndefined();
  });
});
