import { describe, it, expect, vi, beforeEach } from 'vitest';

const readRegistry = vi.fn();
const writeRegistry = vi.fn();
const readLocalState = vi.fn();
const writeLocalState = vi.fn();
const scanClonesDir = vi.fn();
const cancellation = {
  signal: new AbortController().signal,
  cancel: vi.fn(),
  dispose: vi.fn(),
};

const prompts = vi.hoisted(() => ({
  intro: vi.fn(),
  outro: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn(),
  autocompleteMultiselect: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  progress: vi.fn(() => ({
    start: vi.fn(),
    advance: vi.fn(),
    message: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    error: vi.fn(),
    clear: vi.fn(),
  })),
  taskLog: vi.fn(() => ({
    message: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  })),
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
  text: prompts.text,
  confirm: prompts.confirm,
  select: prompts.select,
  autocompleteMultiselect: prompts.autocompleteMultiselect,
  spinner: prompts.spinner,
  progress: prompts.progress,
  taskLog: prompts.taskLog,
  log: prompts.log,
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
  fetchGitHubMetadata: vi.fn(),
}));

const { default: syncCommand } = await import('../../src/commands/sync.js');

describe('clones sync direct', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs without interactive prompts when fully specified', async () => {
    readRegistry.mockResolvedValue({ version: '1.0.0', repos: [], tombstones: [] });
    readLocalState.mockResolvedValue({ version: '1.0.0', repos: {} });
    scanClonesDir.mockResolvedValue({ discovered: [], skipped: [] });

    await syncCommand.run?.({ args: { 'dry-run': true } } as any);

    expect(prompts.text).not.toHaveBeenCalled();
    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(prompts.select).not.toHaveBeenCalled();
    expect(prompts.autocompleteMultiselect).not.toHaveBeenCalled();
  });
});
