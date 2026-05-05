import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const testDir = join(tmpdir(), `clones-local-${randomUUID()}`);
const localStatePath = join(testDir, 'local.json');

vi.mock('../../src/lib/config.js', () => ({
  getLocalStatePath: () => localStatePath,
  ensureConfigDir: async () => {
    await mkdir(testDir, { recursive: true });
  },
}));

const {
  createEmptyLocalState,
  readLocalState,
  writeLocalState,
  updateRepoLocalState,
  removeRepoLocalState,
  updateLastSyncRun,
  getLastSyncedAt,
} = await import('../../src/lib/local-state.js');

describe('local-state', () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('returns empty state when file does not exist', async () => {
    const state = await readLocalState();

    expect(state).toEqual({
      version: '1.0.0',
      repos: {},
    });
  });

  it('throws on corrupted JSON', async () => {
    await writeFile(localStatePath, '{ invalid json }');

    await expect(readLocalState()).rejects.toThrow('Local state file is corrupted');
  });

  it('writes and reads state', async () => {
    const state = {
      version: '1.0.0',
      repos: {
        'github.com:owner/repo': {
          lastSyncedAt: '2026-01-01T00:00:00Z',
        },
      },
      lastSyncRun: '2026-01-02T00:00:00Z',
    };

    await writeLocalState(state);

    const stored = JSON.parse(await readFile(localStatePath, 'utf-8'));
    expect(stored).toEqual(state);

    const read = await readLocalState();
    expect(read).toEqual(state);
  });

  it('updates repo local state', () => {
    const initial = createEmptyLocalState();
    const updated = updateRepoLocalState(initial, 'github.com:owner/repo', {
      lastSyncedAt: '2026-01-01T00:00:00Z',
    });

    expect(updated.repos['github.com:owner/repo']).toEqual({
      lastSyncedAt: '2026-01-01T00:00:00Z',
    });
  });

  it('removes repo local state', () => {
    const initial = {
      version: '1.0.0',
      repos: {
        'github.com:owner/repo': {
          lastSyncedAt: '2026-01-01T00:00:00Z',
        },
      },
    };

    const updated = removeRepoLocalState(initial, 'github.com:owner/repo');

    expect(updated.repos['github.com:owner/repo']).toBeUndefined();
  });

  it('updates lastSyncRun timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-03T12:00:00Z'));

    const updated = updateLastSyncRun(createEmptyLocalState());

    expect(updated.lastSyncRun).toBe('2026-01-03T12:00:00.000Z');

    vi.useRealTimers();
  });

  it('gets lastSyncedAt for repo', () => {
    const state = {
      version: '1.0.0',
      repos: {
        'github.com:owner/repo': {
          lastSyncedAt: '2026-01-01T00:00:00Z',
        },
      },
    };

    expect(getLastSyncedAt(state, 'github.com:owner/repo')).toBe('2026-01-01T00:00:00Z');
    expect(getLastSyncedAt(state, 'github.com:missing/repo')).toBeUndefined();
  });
});
