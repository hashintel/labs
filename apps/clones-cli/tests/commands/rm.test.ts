import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const readRegistry = vi.fn();
const writeRegistry = vi.fn();
const removeEntry = vi.fn();
const findEntryByOwnerRepo = vi.fn();
const addTombstone = vi.fn();
const readLocalState = vi.fn();
const writeLocalState = vi.fn();
const removeRepoLocalState = vi.fn();
const getRepoPath = vi.fn(() => '/tmp/owner/repo');

const prompts = vi.hoisted(() => ({
  intro: vi.fn(),
  outro: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
  autocompleteMultiselect: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
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
  confirm: prompts.confirm,
  isCancel: prompts.isCancel,
  cancel: prompts.cancel,
  autocompleteMultiselect: prompts.autocompleteMultiselect,
  spinner: prompts.spinner,
  log: prompts.log,
}));

vi.mock('../../src/lib/registry.js', () => ({
  readRegistry,
  writeRegistry,
  removeEntry,
  findEntryByOwnerRepo,
  addTombstone,
}));

vi.mock('../../src/lib/local-state.js', () => ({
  readLocalState,
  writeLocalState,
  removeRepoLocalState,
}));

vi.mock('../../src/lib/config.js', () => ({
  getRepoPath,
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

const { default: rmCommand } = await import('../../src/commands/rm.js');

describe('clones rm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes repo from local state when deleting from registry', async () => {
    const entry = {
      id: 'github.com:owner/repo',
      owner: 'owner',
      repo: 'repo',
    };

    readRegistry.mockResolvedValue({ version: '1.0.0', repos: [entry], tombstones: [] });
    findEntryByOwnerRepo.mockReturnValue(entry);
    removeEntry.mockReturnValue({ version: '1.0.0', repos: [], tombstones: [] });
    addTombstone.mockImplementation((registry: any, id: string) => ({
      ...registry,
      tombstones: [...registry.tombstones, id],
    }));
    readLocalState.mockResolvedValue({
      version: '1.0.0',
      repos: { [entry.id]: { lastSyncedAt: '2026-01-01T00:00:00Z' } },
    });
    removeRepoLocalState.mockReturnValue({ version: '1.0.0', repos: {} });

    await rmCommand.run?.({
      args: { repo: 'owner/repo', 'keep-disk': true, yes: true },
    } as any);

    expect(writeRegistry).toHaveBeenCalledTimes(1);
    const updatedRegistry = writeRegistry.mock.calls[0][0];
    expect(updatedRegistry.tombstones).toContain(entry.id);
    expect(writeLocalState).toHaveBeenCalledTimes(1);
    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(prompts.autocompleteMultiselect).not.toHaveBeenCalled();
  });
});
